import {protect} from '@/lib/access';
import {Actor,visible,inProject} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {lineSaving} from '@/lib/purchase-plan';

// Audit reviews the week's purchase plan (requests with vendor rates) and
// approves, returns to purchase for re-negotiation, or rejects in one batch.
// The decision is attributed to the signed-in auditor, never a typed name.
// The whole batch is all-or-nothing: if any selected row changed, nothing is written.
const fail=(error:string,status=400)=>Response.json({error},{status});
async function handlePOST(req:Request,a:Actor){try{
 const text=await req.text();if(text.length>40000)return fail('Decision batch too large');
 const b=JSON.parse(text),db=database();
 const ids=Array.isArray(b.ids)?[...new Set<string>(b.ids.filter((id:any)=>typeof id==='string'))]:[];
 if(!ids.length||ids.length>100)return fail('Select between 1 and 100 purchase plan lines.');
 const decision=String(b.decision||''),note=String(b.note||'').trim();
 if(!['Approved','Returned','Rejected'].includes(decision))return fail('Choose Approve, Send back to purchase or Reject.');
 if(!note||note.length>2000||b.confirmed!==true)return fail('Enter a decision note and confirm that you are authorized to record it.');
 const rows:any[]=[];
 for(const id of ids){
  const raw=await db.prepare('SELECT * FROM records WHERE id=?').bind(id).first<any>();if(!raw)return fail('Request not found',404);
  const r=decode(raw);
  if(!visible(a,r)||!inProject(a,r.project))return fail('This record is outside your access.',403);
  if(!['plan','request'].includes(r.kind)||r.stage!=='Vendors finalized')return fail('Every selected line must be waiting for audit (vendor rates sent by Purchase).');
  if(r.closure?.state==='Closed')return fail('Reopen closed requests before deciding.');
  if(r.gmApproval&&r.gmApproval.state!=='Approved')return fail('A late request still needs the General Manager\'s approval.');
  if(decision==='Approved'&&(!String(r.vendor||'').trim()||!(Number(r.quoteRate)>=0)||!String(r.quoteReference||'').trim()))return fail(`${r.item}: vendor, vendor rate and quotation reference are required before approval.`);
  if(r.version!==Number(b.versions?.[id]))return fail('One or more lines changed. Refresh the purchase plan and retry.',409);
  rows.push({raw,r});
 }
 const now=new Date().toISOString(),marker=crypto.randomUUID(),sorted=[...ids].sort();
 const stamp=rows.map(x=>x.r).sort((x,y)=>x.id.localeCompare(y.id)).map(r=>r.id+':'+r.version).join('|');
 const fingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)";
 const statements:any[]=[db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ('+fingerprint+')=?').bind(marker,'audit:'+rows[0].r.window,'Audit decision · '+decision,JSON.stringify({ids:sorted,decision,note,by:a.name,email:a.email}),now,JSON.stringify(sorted),stamp)];
 for(const {raw,r} of rows){
  const data=JSON.parse(raw.data),saving=lineSaving(r);
  if(decision==='Approved'){
   data.stage='Audit approved';data.auditOwner=a.name;data.auditBy=a.email;data.reviewNote=note;
   data.auditSavings={...saving,at:now};
   if(r.kind==='request')data.status='Approved';
  }else if(decision==='Returned'){
   // Back to Purchase for a better rate; the BOQ baseline stays frozen.
   data.stage='BOQ priced';data.auditReturn={by:a.name,email:a.email,note,at:now,vendor:r.vendor,quoteRate:r.quoteRate};
   if(r.kind==='request')data.status='Pending';
  }else{
   data.stage='Rejected';data.auditOwner=a.name;data.auditBy=a.email;data.reviewNote=note;
   if(r.kind==='request')data.status='Rejected';
  }
  data.stageDates={...(data.stageDates||{}),[data.stage]:now};
  statements.push(
   db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)').bind(crypto.randomUUID(),r.id,decision==='Approved'?'Audit approved':decision==='Returned'?'Audit returned to purchase':'Audit rejected',JSON.stringify({before:r,after:data,by:a.name,note}),now,marker),
   db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(data),now,r.id,marker));
 }
 const result=await db.batch(statements);
 if(!result[0].meta.changes)return fail('One or more lines changed. Refresh the purchase plan and retry.',409);
 return Response.json({ok:true,count:rows.length,decision});
}catch{return fail('Unable to record the audit decision. Refresh and try again.');}}

export async function POST(req:Request){return protect(req,'audit',handlePOST);}
