import {protect} from '@/lib/access';
import {Actor,has,inProject,visible} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {cents,dateValid,purchaseCost,validProject} from '@/lib/calculations';
import {addDays,indiaToday,thursday} from '@/lib/weekly';
import {TRADES,budgetSource,budgetFor,cheapestQuote,committed,orderFor,quoteList,selectedQuote} from '@/lib/quotes';

// Plumbing & electrical requests, bought against a cost budget per project.
//  budget        BOQ / GM: set the plumbing or electrical budget for a project
//  create        Site Engineer / PM / GM: new request from a photo of the handwritten list
//  typedList     Purchase (optional): type the photo out as a list to send every vendor
//  addQuote / removeQuote / sendToBoq   Purchase: vendor quotes, then hand over to BOQ
//  select / returnToPurchase            BOQ: choose a quote within the remaining budget
//  audit         Audit: Approved / Returned (to BOQ) / Rejected
//  order         Purchase: lump-sum PO line + payment forecast; GRN, bill check and payment follow as usual
//  cancel        raiser, PM, GM or Purchase Manager, before a PO exists
// Every write is checked against the versions of all requests and the budget of that
// project and trade, so two people cannot spend the same budget at once.
const fail=(error:string,status=400)=>Response.json({error},{status});
const SYSTEM=['id','kind','parent','sourceId','version','total','paid','updated'];
const str=(v:any,max:number)=>String(v??'').trim().slice(0,max);
const paise=(v:any)=>{const n=Number(v);return Number.isFinite(n)&&n>0&&n<=1e9?cents(n):null;};
const FP=`SELECT COALESCE(group_concat(id||':'||version,'|'),'') FROM (SELECT id,version FROM records WHERE kind IN ('quote','budget') AND json_extract(data,'$.project')=? AND json_extract(data,'$.trade')=? ORDER BY id)`;
const fingerprint=(records:any[],project:string,trade:string)=>records.filter(r=>['quote','budget'].includes(r.kind)&&r.project===project&&r.trade===trade).sort((x,y)=>x.id<y.id?-1:x.id>y.id?1:0).map(r=>r.id+':'+r.version).join('|');
const plain=(raw:any)=>{const d=JSON.parse(raw.data);for(const k of SYSTEM)delete d[k];return d;};
async function hasDoc(db:any,id:string,type:string,docId?:string){
 return !!await db.prepare(`SELECT 1 FROM documents WHERE type=? ${docId?'AND id=?':''} AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.recordIds')) WHERE value=?)`).bind(...(docId?[type,docId,id]:[type,id])).first();
}

async function handlePOST(req:Request,a:Actor){try{
 const b=JSON.parse(await req.text()),db=database(),now=new Date().toISOString(),action=String(b.action||'');
 const rows=(await db.prepare('SELECT * FROM records').all()).results as any[];const records=rows.map(decode);
 const marker=crypto.randomUUID();
 // All statements run only if nothing in this project's trade changed since we read it.
 async function commit(project:string,trade:string,label:string,info:any,statements:any[]){
  const res=await db.batch([
   db.prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE (${FP})=?`).bind(marker,'quotes:'+project+':'+trade,label,JSON.stringify({...info,by:a.name,email:a.email}),now,project,trade,fingerprint(records,project,trade)),
   ...statements]);
  return res[0].meta.changes===1;
 }
 const guard=`EXISTS(SELECT 1 FROM history WHERE id='${marker}')`;
 const updateStmt=(r:any,data:any,total=r.total)=>[db.prepare(`UPDATE records SET data=?,version=version+1,total=?,updated=? WHERE id=? AND version=? AND ${guard}`).bind(JSON.stringify(data),total,now,r.id,r.version),
  db.prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),r.id,action,JSON.stringify(data),now)];
 const done=(ok:boolean,extra:any={})=>ok?Response.json({ok:true,...extra}):fail('Someone else changed this project\'s requests or budget. Refresh and try again.',409);

 if(action==='budget'){
  if(!has(a,'BOQ Team','GM'))return fail('Only the BOQ team or GM sets project budgets.',403);
  const project=str(b.project,10),trade=str(b.trade,20),amount=paise(b.amount);
  if(!validProject(project)||!(TRADES as readonly string[]).includes(trade))return fail('Choose the project and Plumbing or Electrical.');
  if(!inProject(a,project))return fail('This project is outside your access.',403);
  if(amount===null)return fail('Enter the budget in rupees.');
  const used=committed(records,project,trade);if(amount<used)return fail(`₹${(used/100).toLocaleString('en-IN')} is already committed to chosen quotes. The budget cannot be lower than that.`);
  const old=budgetFor(records,project,trade);if((old?.version||0)!==Number(b.version||0))return fail('The budget changed. Refresh and try again.',409);
  const data={project,trade,amount,note:str(b.note,500),setBy:a.name,setAt:now,previous:old?{amount:old.amount,setBy:old.setBy,setAt:old.setAt}:undefined};
  const st=old?updateStmt(old,data,amount):[db.prepare(`INSERT INTO records(id,kind,parent,source_id,data,version,total,paid,updated) SELECT ?,'budget',NULL,?,?,1,?,0,? WHERE ${guard}`).bind(crypto.randomUUID(),budgetSource(project,trade),JSON.stringify(data),amount,now)];
  return done(await commit(project,trade,'Trade budget set',{amount},st));
 }

 if(action==='create'){
  if(!has(a,'Site Engineer','Project Manager','GM'))return fail('The site engineer or project manager raises these requests.',403);
  const project=str(b.project,10),trade=str(b.trade,20),neededBy=str(b.neededBy,10);
  if(!validProject(project)||!(TRADES as readonly string[]).includes(trade))return fail('Choose the project and Plumbing or Electrical.');
  if(!inProject(a,project))return fail('This project is outside your access.',403);
  if(!dateValid(neededBy)||neededBy<indiaToday()||neededBy>addDays(indiaToday(),180))return fail('Choose the date the material is needed at site (today or later).');
  const id=crypto.randomUUID(),data={project,trade,neededBy,due:neededBy,window:thursday(neededBy),activity:str(b.activity,200),note:str(b.note,2000),stage:'Awaiting quotes',qty:1,boqQty:1,unit:'LS',item:`${trade} materials`,itemCategory:trade,createdBy:a.email,raisedBy:a.name,raisedAt:now,quotes:[]};
  const ok=await commit(project,trade,'Photo request raised',{id},[db.prepare(`INSERT INTO records(id,kind,parent,data,version,total,paid,updated) SELECT ?,'quote',NULL,?,1,0,0,? WHERE ${guard}`).bind(id,JSON.stringify(data),now),db.prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),id,'Photo request raised',JSON.stringify(data),now)]);
  return done(ok,{id,window:data.window});
 }

 const raw=rows.find(x=>x.id===String(b.id||''));if(!raw||raw.kind!=='quote')return fail('Request not found.',404);
 const r=decode(raw);if(r.version!==Number(b.version))return fail('This request changed. Refresh and try again.',409);
 if(!visible(a,r))return fail('This request is outside your projects.',403);
 const data=plain(raw),purchase=has(a,'Purchase Manager','Purchase Team'),stage=r.stage;
 const need=(ok:boolean,msg:string,status=400)=>ok?null:fail(msg,status);
 const write=async(label:string,extra:any[]=[],total?:number)=>done(await commit(r.project,r.trade,label,{id:r.id},[...updateStmt(r,data,total??r.total),...extra]));

 if(action==='typedList'){
  const e=need(purchase,'Only Purchase types the list.',403)||need(stage==='Awaiting quotes','The list can be changed only while quotes are being collected.');if(e)return e;
  const lines=Array.isArray(b.lines)?b.lines:[];if(lines.length>300)return fail('Up to 300 lines.');
  const clean=lines.map((l:any)=>({item:str(l.item,120),size:str(l.size,60),qty:Number(l.qty),unit:str(l.unit,20)||'NOS'})).filter((l:any)=>l.item);
  if(clean.some((l:any)=>!Number.isFinite(l.qty)||l.qty<=0||l.qty>1e6))return fail('Every typed line needs a quantity above zero.');
  data.typedList=clean;data.typedBy=a.name;data.typedAt=now;return write('Typed list saved');
 }
 if(action==='addQuote'){
  const e=need(purchase,'Only Purchase records vendor quotes.',403)||need(stage==='Awaiting quotes','Quotes can be added only before the request goes to BOQ.');if(e)return e;
  const vendor=str(b.vendor,120),amount=paise(b.amount);if(!vendor||amount===null)return fail('Enter the vendor and the quoted total including GST.');
  if(quoteList(r).some((q:any)=>q.vendor.toLowerCase()===vendor.toLowerCase()))return fail('This vendor already has a quote on this request. Remove it first to replace it.');
  if(quoteList(r).length>=10)return fail('Up to 10 quotes per request.');
  const documentId=str(b.documentId,40);if(documentId&&!await hasDoc(db,r.id,'Vendor quote',documentId))return fail('The quote file was not found on this request.');
  data.quotes=[...quoteList(r),{id:crypto.randomUUID(),vendor,phone:str(b.phone,30),amount,brands:str(b.brands,300),reference:str(b.reference,100),notes:str(b.notes,1000),creditDays:Math.max(0,Math.min(365,Math.round(Number(b.creditDays)||0))),documentId:documentId||undefined,by:a.name,at:now}];
  return write('Vendor quote added');
 }
 if(action==='removeQuote'){
  const e=need(purchase,'Only Purchase removes quotes.',403)||need(stage==='Awaiting quotes','Quotes can be removed only before the request goes to BOQ.');if(e)return e;
  data.quotes=quoteList(r).filter((q:any)=>q.id!==b.quoteId);if(data.quotes.length===quoteList(r).length)return fail('Quote not found.');return write('Vendor quote removed');
 }
 if(action==='sendToBoq'){
  const e=need(purchase,'Only Purchase sends quotes to BOQ.',403)||need(stage==='Awaiting quotes','Already sent.');if(e)return e;
  if(!quoteList(r).length)return fail('Add at least one vendor quote.');
  const why=str(b.singleQuoteReason,500);if(quoteList(r).length<2&&why.length<3)return fail('Only one quote: say why (for example, only one vendor near this site).');
  if(!await hasDoc(db,r.id,'Site list'))return fail('The photo of the site list is missing. Ask the site to upload it.');
  data.stage='With BOQ';data.sentToBoq={by:a.name,at:now,singleQuoteReason:why||undefined};delete data.boqReturn;return write('Quotes sent to BOQ');
 }
 if(action==='select'){
  const e=need(has(a,'BOQ Team'),'Only the BOQ team chooses the quote.',403)||need(stage==='With BOQ','This request is not waiting for BOQ.');if(e)return e;
  const q=quoteList(r).find((x:any)=>x.id===b.quoteId);if(!q)return fail('Choose one of the quotes.');
  const budget=budgetFor(records,r.project,r.trade);if(!budget)return fail(`Set the ${r.trade.toLowerCase()} budget for project ${r.project} first.`);
  const left=Number(budget.amount)-committed(records,r.project,r.trade,r.id);
  if(q.amount>left)return fail(`This quote (₹${(q.amount/100).toLocaleString('en-IN')}) is above the ₹${(left/100).toLocaleString('en-IN')} left in the ${r.trade.toLowerCase()} budget. Return it to Purchase or raise the budget.`);
  const low=cheapestQuote(r),reason=str(b.reason,1000);
  if(low&&q.id!==low.id&&reason.length<3)return fail('This is not the lowest quote. Say why it is better (brand, quality, delivery).');
  data.stage='BOQ selected';data.selection={quoteId:q.id,vendor:q.vendor,amount:q.amount,lowest:low?.id===q.id,lowestAmount:low?.amount,reason,budgetLeftBefore:left,by:a.name,at:now};
  data.vendor=q.vendor;data.vendorPhone=q.phone;data.quoteRate=q.amount/100;data.quoteReference=q.reference;
  return write('Quote chosen by BOQ',[],q.amount);
 }
 if(action==='returnToPurchase'){
  const e=need(has(a,'BOQ Team'),'Only the BOQ team returns quotes.',403)||need(stage==='With BOQ','This request is not with BOQ.');if(e)return e;
  const reason=str(b.reason,1000);if(reason.length<3)return fail('Tell Purchase what is needed (for example, more quotes or another brand).');
  data.stage='Awaiting quotes';data.boqReturn={reason,by:a.name,at:now};return write('Returned to Purchase');
 }
 if(action==='audit'){
  const e=need(has(a,'Audit'),'Only Audit approves.',403)||need(stage==='BOQ selected','This request is not waiting for Audit.');if(e)return e;
  const decision=String(b.decision),note=str(b.note,1000);
  if(!['Approved','Returned','Rejected'].includes(decision))return fail('Choose approve, return or reject.');
  if(decision!=='Approved'&&note.length<3)return fail('Give the reason.');
  data.audit={decision,note,by:a.name,at:now};
  if(decision==='Approved')data.stage='Audit approved';
  else if(decision==='Returned'){data.stage='With BOQ';data.auditReturn={note,by:a.name,at:now,previous:data.selection};delete data.selection;}
  else data.stage='Rejected';
  return write('Audit '+decision.toLowerCase(),[],decision==='Approved'?r.total:0);
 }
 if(action==='cancel'){
  const e=need(r.createdBy===a.email||has(a,'Project Manager','GM','Purchase Manager'),'Only the person who raised it, the PM, GM or Purchase Manager can cancel.',403)||need(['Awaiting quotes','With BOQ','BOQ selected','Audit approved'].includes(stage),'This request is already closed.')||need(!orderFor(r,records),'A PO exists. Cancel the PO instead.');if(e)return e;
  const reason=str(b.reason,1000);if(reason.length<3)return fail('Give the reason.');
  data.stage='Cancelled';data.cancelled={reason,by:a.name,at:now};return write('Request cancelled',[],0);
 }
 if(action==='order'){
  const e=need(purchase,'Only Purchase issues the PO.',403)||need(stage==='Audit approved','Audit must approve before the PO.')||need(!orderFor(r,records),'The PO is already issued.');if(e)return e;
  const q=selectedQuote(r);if(!q)return fail('No quote is chosen.');
  const entity=['GROUP','BUILDERS'].includes(b.entity)?b.entity:'GROUP',creditDays=Math.round(Number(b.creditDays??q.creditDays??0));
  if(!Number.isInteger(creditDays)||creditDays<0||creditDays>365)return fail('Enter credit days from 0 to 365.');
  const expected=str(b.expectedDelivery||r.neededBy,10);if(!dateValid(expected))return fail('Enter the expected delivery date.');
  const orderId=crypto.randomUUID(),po='PO-'+orderId.replaceAll('-','').slice(0,12).toUpperCase(),today=indiaToday();
  const p:any={orderId,orderLine:1,po,project:r.project,entity,item:`${r.trade} materials as per quote${q.reference?' '+q.reference:''}`,itemCategory:r.trade,unit:'LS',qty:1,rate:q.amount/100,vendor:q.vendor,vendorContact:q.phone||'',status:'Ordered',discount:0,freight:0,other:0,nonRecoverableTax:0,recoverableTax:0,buyerName:entity==='BUILDERS'?'Bilara Builders':'Bilara Group',creditDays,window:r.window,expectedDelivery:expected,originalDelivery:expected,poDate:today,quoteRequest:r.id,quoteBrands:q.brands||'',paymentTerms:str(b.paymentTerms,1000),shipTo:str(b.shipTo,1000),orderTerms:str(b.orderTerms,4000),exceptionReason:'Cost-based plumbing/electrical quote'};
  p.expectedPaymentDate=addDays(expected,creditDays);const total=purchaseCost(p).cash;if(total!==q.amount)return fail('The quote amount could not be converted exactly. Check the amount.');
  const pid=crypto.randomUUID(),payId=crypto.randomUUID(),pay={createdBy:a.email,project:r.project,item:p.item,vendor:p.vendor,entity,amount:total/100,due:p.expectedPaymentDate,window:thursday(p.expectedPaymentDate),category:'Material',bill:'',notes:`Auto-created from ${po} · ${creditDays} credit day(s) from delivery`,paymentMode:''};
  data.entity=entity;data.ordered={po,by:a.name,at:now};
  return done(await commit(r.project,r.trade,'PO issued from quote',{id:r.id,po},[...updateStmt(r,data),
   db.prepare(`INSERT INTO records(id,kind,parent,data,version,total,paid,updated) SELECT ?,'purchase',?,?,1,?,0,? WHERE ${guard}`).bind(pid,r.id,JSON.stringify(p),total,now),
   db.prepare(`INSERT INTO records(id,kind,parent,data,version,total,paid,updated) SELECT ?,'payment',?,?,1,?,0,? WHERE ${guard}`).bind(payId,pid,JSON.stringify(pay),total,now),
   db.prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(crypto.randomUUID(),pid,'Created purchase order from quote',JSON.stringify(p),now)]),{po,id:pid});
 }
 return fail('Unknown action.');
 }catch(e){console.error(JSON.stringify({event:'quotes_failed',message:e instanceof Error?e.message:String(e)}));return fail('Unable to save. Refresh and retry.',503);}}

export async function POST(req:Request){return protect(req,'quotes',handlePOST);}
