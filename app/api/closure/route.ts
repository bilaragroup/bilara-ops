import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {decodeDocument} from '@/lib/documents';
import {closureChecks} from '@/lib/closure';
const fail=(error:string,status=400)=>Response.json({error},{status});
const fingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id=? OR parent=? OR parent IN (SELECT id FROM records WHERE parent=?) ORDER BY id)";
async function handlePOST(req:Request,a:Actor){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Origin not allowed',403);
 const text=await req.text();if(text.length>12000)return fail('Request too large');const b=JSON.parse(text);const db=database();
 const snapshot=await db.batch([db.prepare('SELECT * FROM records ORDER BY id'),db.prepare('SELECT * FROM documents')]);
 const records=snapshot[0].results.map(decode),docs=snapshot[1].results.map(decodeDocument),r=records.find(x=>x.id===b.id);
 if(!r||!['plan','request'].includes(r.kind))return fail('Choose a purchase request');if(r.version!==b.version)return fail('Request changed. Refresh and retry.',409);
 const by=String(b.by||'').trim(),reason=String(b.reason||'').trim();if(!by||by.length>200||!reason||reason.length>2000)return fail('Enter your name and a reason / completion note.');
 const now=new Date().toISOString();const data=JSON.parse((snapshot[0].results.find((x:any)=>x.id===r.id) as any).data);
 if(b.action==='reopen'){if(r.closure?.state!=='Closed')return fail('Request is already open');data.closure={state:'Open',reopenedBy:by,reopenedAt:now,reason,previous:r.closure};}
 else if(b.action==='cancelBalance'){
  if(r.closure?.state==='Closed')return fail('Reopen the request first');if(r.stage!=='Audit approved')return fail('Complete audit approval first');
  const qty=Number(r.boqQty||r.qty)-records.filter(x=>x.kind==='purchase'&&x.parent===r.id&&x.status!=='Cancelled').reduce((n,p)=>n+Number(p.qty),0);
  if(qty<=0)return fail('No unordered balance remains');if(b.confirmed!==true)return fail('Confirm audit approval of this cancellation');
  data.cancellation={qty,approvedBy:by,approvedAt:now,reason};
 }else if(b.action==='close'){
  if(r.closure?.state==='Closed')return fail('Request is already closed');const issues=closureChecks(r,records,docs);if(issues.length)return fail(issues.join(' '));
  if(b.confirmed!==true)return fail('Confirm final vendor settlement and no unresolved delivery or billing issues.');
  data.closure={state:'Closed',closedBy:by,closedAt:now,note:reason,finalSettlementConfirmed:true,noUnresolvedIssues:true};
 }else return fail('Unknown action');
 const related=records.filter(x=>x.id===r.id||x.parent===r.id||records.some(p=>p.parent===r.id&&x.parent===p.id)).sort((x,y)=>x.id.localeCompare(y.id));const stamp=related.map(x=>x.id+':'+x.version).join('|');const event=crypto.randomUUID();
 const result=await db.batch([
 db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ('+fingerprint+')=?').bind(event,r.id,b.action==='close'?'Request closed':b.action==='reopen'?'Request reopened':'Balance cancellation approved',JSON.stringify({before:r,after:data}),now,r.id,r.id,r.id,stamp),
 db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(data),now,r.id,r.version,event)
 ]);if(!result[1].meta.changes)return fail('Linked records changed. Refresh and check settlement again.',409);return Response.json({ok:true});
 }catch{return fail('Unable to save closure. Refresh and retry.');}}

export async function POST(req:Request){return protect(req,'closure',handlePOST);}
