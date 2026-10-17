import {sameOrigin} from '@/lib/access';
import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
async function handlePOST(req:Request,a:Actor){try{
 const fail=(error:string,status=400)=>Response.json({error},{status});
 if(!sameOrigin(req))return fail('Origin not allowed',403);
 const text=await req.text();if(text.length>40000)return fail('Decision batch too large');const b=JSON.parse(text),db=database(),ids=Array.isArray(b.ids)?[...new Set(b.ids.filter((id:any)=>typeof id==='string'))]:[b.id];
 if(!ids.length||ids.length>100)return fail('Select between 1 and 100 pending requests.');
 const decision=String(b.decision||''),note=String(b.note||'').trim();if(!['Approved','Rejected'].includes(decision)||!note||note.length>2000||b.confirmed!==true)return fail('Enter a decision note and confirm that you are authorized to record it.');
 const rows:any[]=[];for(const id of ids){const raw=await db.prepare('SELECT * FROM records WHERE id=?').bind(id).first<any>();if(!raw)return fail('Request not found',404);const r=decode(raw),exceptionPending=r.gmApproval?.state==='Pending',baselineReady=r.stage==='Submitted'&&Number(r.kind==='plan'?r.boqRate:r.estimateRate)>0&&!!r.boqOwner;if(!exceptionPending&&r.auditReturn?.reason==='quantity'&&!r.auditReturn.fixedAt)return fail(`${r.item} (project ${r.project}): Audit sent this back for the quantity. The PM corrects it first.`);if(!exceptionPending&&r.stage==='Submitted'&&!(Number(r.activityBoqQty)>0))return fail(`${r.item} (project ${r.project}): enter the approved activity BOQ quantity before releasing.`);if(!['plan','request'].includes(r.kind)||(!exceptionPending&&!baselineReady)||r.closure?.state==='Closed')return fail('Every selected row must be pending approval or ready for BOQ baseline release.');if(exceptionPending&&!has(a,'GM'))return fail('Late requests need the General Manager\'s decision. The BOQ Team can release normal requests.',403);if(r.version!==Number(b.versions?.[id]??(ids.length===1?b.version:NaN)))return fail('One or more requests changed. Refresh the queue and retry.',409);rows.push({raw,r,exceptionPending});}
 const now=new Date().toISOString(),by=a.name,statements:any[]=[];
 for(const {raw,r,exceptionPending} of rows){const data=JSON.parse(raw.data);if(exceptionPending){data.gmApproval={...r.gmApproval,state:decision,by,note,at:now};if(decision==='Rejected')data.stage='Rejected';}else if(decision==='Approved'){data.stage='BOQ priced';data.baselineIssuedBy=a.email;data.stageDates={...(data.stageDates||{}),'BOQ priced':now};}else data.stage='Rejected';statements.push(db.prepare('INSERT INTO history (id,record_id,action,data,at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),r.id,exceptionPending?'General Manager '+decision:'BOQ baseline '+decision,JSON.stringify({before:r,after:data}),now),db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=?').bind(JSON.stringify(data),now,r.id,r.version));}
 const result=await db.batch(statements);return result.length===statements.length?Response.json({ok:true,count:rows.length}):fail('Request changed. Refresh and retry.',409);
 }catch{return Response.json({error:'Unable to record GM decision.'},{status:400});}}

export async function POST(req:Request){return protect(req,'gm',handlePOST);}
