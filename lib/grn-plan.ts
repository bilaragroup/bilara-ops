// Purchasing GRN logic shared by the GRN route and the site Receive goods page.
// planGrn() checks a 'receive' or 'shortClose' request against the PO lines and returns the
// record changes; grnStatements() turns them into version-checked D1 statements.
import {Actor,has,inProject,visible} from '@/lib/permissions';
import {decode} from '@/lib/database';
import {dateValid} from '@/lib/calculations';
import {addDays,indiaToday,thursday} from '@/lib/weekly';
import {acceptedQty,receipts,valueOf} from '@/lib/grn';

const SYSTEM=['id','kind','parent','sourceId','version','total','paid','updated'];
const strip=(raw:any)=>{const d=JSON.parse(raw.data);for(const k of SYSTEM)delete d[k];return d;};
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*1000)/1000:NaN;};
export type GrnPlan={ok:true;action:string;changes:any[];inserts:any[];event:any;lines:any[];records:any[];now:string};
export type GrnFail={ok:false;error:string;status:number};
const planFail=(error:string,status=400):GrnFail=>({ok:false,error,status});

/** opts.generatedGrnNo: the site-generated GRN number used for this receipt. */
export async function planGrn(a:Actor,b:any,db:any,opts:{generatedGrnNo?:string}={}):Promise<GrnPlan|GrnFail>{
 const now=new Date().toISOString(),today=indiaToday();
 if(opts.generatedGrnNo)b={...b,grnNo:opts.generatedGrnNo};
 const action=String(b.action||'receive');if(!['receive','shortClose'].includes(action))return planFail('Unknown action.');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>50||new Set(b.items.map((x:any)=>x.id)).size!==b.items.length)return planFail('Select 1–50 different PO lines.');
 const snapshot=(await db.prepare('SELECT * FROM records').all()).results as any[],records=snapshot.map(decode);
 const raw=(id:string)=>snapshot.find(r=>r.id===id);
 const lines:any[]=[];let order:string|undefined;
 for(const item of b.items){
  const p=records.find(r=>r.id===item.id);if(!p||p.kind!=='purchase')return planFail('PO line not found.',404);
  if(p.version!==Number(item.version))return planFail('A PO line changed. Refresh and try again.',409);
  if(!visible(a,p)||!inProject(a,p.project))return planFail('This PO is outside your projects.',403);
  if(order&&(p.orderId||p.id)!==order)return planFail('One GRN covers one purchase order. Record other POs separately.');order=p.orderId||p.id;
  const parent=records.find(r=>r.id===p.parent);if(parent?.closure?.state==='Closed')return planFail(`${p.item}: the request is closed.`);
  if(p.status==='Cancelled')return planFail(`${p.item}: this line was cancelled.`);
  if(p.shortClose)return planFail(`${p.item}: this line was already closed short.`);
  lines.push({p,item,parent});
 }
 const changes:any[]=[],inserts:any[]=[];let event:any;
 if(action==='receive'){
  const grnNo=String(b.grnNo||'').trim(),date=String(b.date||'');
  if(!grnNo||grnNo.length>60)return planFail('Enter the GRN number from site.');
  if(!dateValid(date)||date>today)return planFail('Enter the date the goods arrived (not in the future).');
  const p0=lines[0].p;
  if(records.some(r=>r.kind==='purchase'&&r.project===p0.project&&receipts(r).some(x=>String(x.grnNo).trim().toLowerCase()===grnNo.toLowerCase())))return planFail(`GRN ${grnNo} is already recorded for project ${p0.project}.`,409);
  const meta={grnNo,date,challan:String(b.challan||'').trim().slice(0,60),vehicle:String(b.vehicle||'').trim().slice(0,40),remarks:String(b.remarks||'').trim().slice(0,1000),siteGrnBookNo:String(b.siteGrnBookNo||'').trim().slice(0,60)||undefined,by:a.name,email:a.email,at:now};
  event={action:'GRN recorded',...meta};
  for(const {p,item} of lines){
   const received=num(item.received),accepted=num(item.accepted??item.received);
   if(!(received>=0)||!(accepted>=0)||accepted>received+1e-9||received===0&&accepted===0)return planFail(`${p.item}: enter the quantity received and how much of it was accepted.`);
   const before=acceptedQty(p),after=Math.round((before+accepted)*1000)/1000;
   if(after>Number(p.qty)+1e-9)return planFail(`${p.item}: accepting ${accepted} ${p.unit} would exceed the ${p.qty} ${p.unit} ordered (${before} already accepted). Return the extra or raise a new request.`);
   const data=strip(raw(p.id)),receipt={...meta,received,accepted,rejected:Math.round((received-accepted)*1000)/1000,note:String(item.note||'').trim().slice(0,500)};
   data.receipts=[...receipts(p),receipt];
   data.acceptedQty=after;data.receivedQty=Math.round(((p.receivedQty||0)+received)*1000)/1000;data.rejectedQty=Math.round(((p.rejectedQty||0)+receipt.rejected)*1000)/1000;
   data.delivery=date>(p.delivery||'')?date:p.delivery;data.grn=data.receipts.map((x:any)=>x.grnNo).join(', ');
   data.status=after>=Number(p.qty)-1e-9?'Delivered':'Part delivered';
   data.orderedTotal=data.orderedTotal??p.total;
   // Payment on accepted value: cumulative value after minus before (no rounding drift).
   const value=valueOf({...p,orderedTotal:data.orderedTotal},after)-valueOf({...p,orderedTotal:data.orderedTotal},before);
   const forecast=records.filter(r=>r.kind==='payment'&&r.parent===p.id&&r.basis!=='GRN'&&r.status!=='Cancelled');
   const advancePaid=forecast.reduce((n,r)=>n+r.paid,0),applied=Math.min(value,Math.max(0,advancePaid-Number(p.advanceApplied||0)));
   data.advanceApplied=Number(p.advanceApplied||0)+applied;
   let reduce=value-applied;
   for(const s of forecast){if(reduce<=0)break;const room=s.total-s.paid,cut=Math.min(room,reduce);if(cut<=0)continue;reduce-=cut;const sd=strip(raw(s.id)),total=s.total-cut;sd.amount=total/100;if(total===0)sd.status='Cancelled';sd.grnAdjustments=[...(sd.grnAdjustments||[]),{grnNo,cut,at:now}];changes.push({old:s,data:sd,total});}
   const credit=Number(p.creditDays||0),due=addDays(date,credit),payable=value-applied;
   data.expectedPaymentDate=due;
   if(payable>0)inserts.push({id:crypto.randomUUID(),parent:p.id,total:payable,data:{createdBy:a.email,project:p.project,item:p.item,vendor:p.vendor,entity:p.entity||'GROUP',amount:payable/100,due,window:thursday(due),category:'Material',bill:'',paymentMode:'',basis:'GRN',grnNo,acceptedQty:accepted,notes:`${grnNo} · ${accepted} ${p.unit} accepted · ${credit} credit day(s) from ${date}${applied?` · ₹${(applied/100).toFixed(2)} covered by advance`:''}`}});
   changes.push({old:p,data,total:p.total});
  }
 }else{
  if(!has(a,'Purchase Manager','Purchase Team'))return planFail('Only Purchase can close a PO line short.',403);
  const reason=String(b.reason||'').trim();if(reason.length<3||reason.length>1000)return planFail('Give the reason the rest will not be delivered.');
  event={action:'PO line closed short',reason,by:a.name,email:a.email,at:now};
  for(const {p} of lines){
   const acc=acceptedQty(p),orderedTotal=p.orderedTotal??p.total,newTotal=valueOf({...p,orderedTotal},acc);
   const forecast=records.filter(r=>r.kind==='payment'&&r.parent===p.id&&r.basis!=='GRN'&&r.status!=='Cancelled');
   const advanceLeft=forecast.reduce((n,r)=>n+r.paid,0)-Number(p.advanceApplied||0);
   if(advanceLeft>0)return planFail(`${p.item}: ₹${(advanceLeft/100).toFixed(2)} advance is not covered by goods received. Settle the refund with Accounts first.`);
   for(const s of forecast){const sd=strip(raw(s.id));sd.amount=s.paid/100;if(s.paid===0)sd.status='Cancelled';sd.shortClose={reason,at:now};changes.push({old:s,data:sd,total:s.paid});}
   const data=strip(raw(p.id));
   data.shortClose={orderedQty:p.qty,acceptedQty:acc,reason,by:a.name,email:a.email,at:now};
   data.originalQty=p.originalQty??p.qty;data.orderedTotal=orderedTotal;data.qty=acc;data.status=acc>0?'Delivered':'Cancelled';
   changes.push({old:p,data,total:newTotal});
  }
 }
 return {ok:true,action,changes,inserts,event,lines,records,now};
}

/**
 * The D1 statements for a plan. The marker row is written only if every touched record still
 * has the version that was read (and `extraGuard`, if given, holds); all other statements
 * check the marker, so the set applies all-or-nothing.
 */
export function grnStatements(db:any,a:Actor,b:any,plan:GrnPlan,extraGuard?:{sql:string;binds:any[]}){
 const {changes,inserts,event,lines,records,now}=plan;
 // All-or-nothing: a marker row is written only if every touched record still has the version we read.
 const touched=[...new Set(changes.map(c=>c.old.id))].sort(),stamp=touched.map(id=>id+':'+records.find(r=>r.id===id).version).join('|'),marker=crypto.randomUUID();
 const fingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)";
 const st:any[]=[db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ('+fingerprint+')=?'+(extraGuard?' AND '+extraGuard.sql:'')).bind(marker,lines[0].p.id,event.action,JSON.stringify({...event,items:b.items}),now,JSON.stringify(touched),stamp,...(extraGuard?extraGuard.binds:[]))];
 for(const c of changes)st.push(
  db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)').bind(crypto.randomUUID(),c.old.id,event.action,JSON.stringify({before:c.old,after:c.data,by:a.name}),now,marker),
  db.prepare('UPDATE records SET data=?,total=?,version=version+1,updated=? WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(c.data),c.total,now,c.old.id,marker));
 for(const i of inserts)st.push(db.prepare("INSERT INTO records(id,kind,parent,data,version,total,paid,updated) SELECT ?,'payment',?,?,1,?,0,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)").bind(i.id,i.parent,JSON.stringify(i.data),i.total,now,marker));
 return {statements:st,marker};
}
