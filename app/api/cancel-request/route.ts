// Cancel one purchase request line (Audit, GM, or the project's PM), with a reason.
//  - Before a PO: the line is cancelled.
//  - After a PO: whatever the vendor has not delivered is cancelled too. A PO line with nothing
//    accepted is cancelled; a part-delivered line is closed at the accepted quantity. Unpaid
//    forecast payments for the cancelled part are cancelled; payments for goods received stay.
//    An advance not covered by goods received must be settled with Accounts first.
// Everything is written all-or-nothing with version checks; history keeps the before/after.
import {protect} from '@/lib/access';
import {Actor,has,inProject,visible} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {acceptedQty,valueOf} from '@/lib/grn';

const fail=(error:string,status=400)=>Response.json({error},{status});
const SYSTEM=['id','kind','parent','sourceId','version','total','paid','updated'];

async function handlePOST(req:Request,a:Actor){
 try{
  const b:any=await req.json(),reason=String(b.reason||'').trim();
  if(reason.length<3||reason.length>2000)return fail('Give the reason for cancelling this line.');
  if(b.confirmed!==true)return fail('Confirm the cancellation.');
  const db=database(),snapshot=(await db.prepare('SELECT * FROM records').all()).results as any[],records=snapshot.map(decode);
  const raw=(id:string)=>{const d=JSON.parse(snapshot.find(x=>x.id===id).data);for(const k of SYSTEM)delete d[k];return d;};
  const r=records.find(x=>x.id===b.id);
  if(!r||!['plan','request'].includes(r.kind))return fail('Purchase request not found.',404);
  if(r.version!==Number(b.version))return fail('This request changed. Refresh and try again.',409);
  if(!visible(a,r)||!inProject(a,r.project))return fail('This request is outside your projects.',403);
  if(!has(a,'GM','Audit','Project Manager'))return fail('Only Audit, the GM or the project\'s PM can cancel a request.',403);
  if(r.closure?.state==='Closed')return fail('This request is closed. Reopen it first.');
  if(['Rejected','Cancelled'].includes(r.stage))return fail('This request is already '+r.stage.toLowerCase()+'.');
  const now=new Date().toISOString(),by={by:a.name,email:a.email,at:now,reason,role:has(a,'Audit')?'Audit':has(a,'GM')?'GM':'Project Manager'};
  const changes:any[]=[],orders:any[]=[];
  const requested=Number(r.kind==='plan'?(r.boqQty||r.demandQty):r.qty)||0;
  let kept=0;
  for(const p of records.filter(x=>x.kind==='purchase'&&x.parent===r.id&&x.status!=='Cancelled')){
   const acc=acceptedQty(p);
   if(p.shortClose||acc>=Number(p.qty)-1e-9){kept+=p.shortClose?Number(p.qty):acc;continue;} // already complete: nothing to cancel
   const forecast=records.filter(s=>s.kind==='payment'&&s.parent===p.id&&s.basis!=='GRN'&&s.status!=='Cancelled');
   const advanceLeft=forecast.reduce((n,s)=>n+s.paid,0)-Number(p.advanceApplied||0);
   if(advanceLeft>0)return fail(`${p.po||'The PO'}: ₹${(advanceLeft/100).toFixed(2)} advance has been paid for goods not received. Settle the refund with Accounts first.`);
   for(const s of forecast){const sd=raw(s.id);sd.amount=s.paid/100;if(s.paid===0)sd.status='Cancelled';sd.requestCancellation=by;changes.push({old:s,data:sd,total:s.paid});}
   const data=raw(p.id),orderedTotal=p.orderedTotal??p.total;
   if(acc>0){
    data.shortClose={orderedQty:p.qty,acceptedQty:acc,reason:'Request cancelled: '+reason,by:a.name,email:a.email,at:now};
    data.originalQty=p.originalQty??p.qty;data.orderedTotal=orderedTotal;data.qty=acc;data.status='Delivered';
    changes.push({old:p,data,total:valueOf({...p,orderedTotal},acc)});
   }else{
    data.status='Cancelled';data.orderCancellation={action:'cancel',...by,previousStatus:p.status,originalTotal:p.total};
    changes.push({old:p,data,total:0});
   }
   kept+=acc;orders.push({po:p.po,ordered:Number(p.qty),accepted:acc});
  }
  if(records.some(x=>x.kind==='purchase'&&x.parent===r.id&&x.status!=='Cancelled')&&!orders.length)return fail('Everything ordered for this line has been delivered. There is nothing left to cancel.');
  const data=raw(r.id);
  data.stage='Cancelled';if(r.kind==='request')data.status='Cancelled';
  data.requestCancellation={...by,requestedQty:requested,keptQty:kept,cancelledQty:Math.max(0,requested-kept),orders};
  changes.push({old:r,data,total:r.total||0});
  const touched=[...new Set(changes.map(c=>c.old.id))].sort(),stamp=touched.map(id=>id+':'+records.find(x=>x.id===id).version).join('|'),marker=crypto.randomUUID();
  const fingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)";
  const st:any[]=[db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ('+fingerprint+')=?').bind(marker,r.id,'Request cancelled',JSON.stringify(data.requestCancellation),now,JSON.stringify(touched),stamp)];
  for(const c of changes)st.push(
   db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)').bind(crypto.randomUUID(),c.old.id,'Request cancelled',JSON.stringify({before:c.old,after:c.data,by:a.name,reason}),now,marker),
   db.prepare('UPDATE records SET data=?,total=?,version=version+1,updated=? WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(c.data),c.total,now,c.old.id,marker));
  const result=await db.batch(st);
  if(!result[0].meta.changes)return fail('The request or its PO changed. Refresh and try again.',409);
  return Response.json({ok:true,keptQty:kept,cancelledQty:data.requestCancellation.cancelledQty,orders});
 }catch(e){return fail(e instanceof Error?e.message:'Unable to cancel the request.');}
}

export async function POST(req:Request){return protect(req,'cancelRequest',handlePOST);}
