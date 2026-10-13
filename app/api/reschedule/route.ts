import {protect,canEditAssigned} from '@/lib/access';
import {Actor,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {addDays,validWindow} from '@/lib/weekly';
import {dateValid} from '@/lib/calculations';
const fail=(error:string,status=400)=>Response.json({error},{status});

async function handlePOST(req:Request,a:Actor){
 try{
  const b:any=await req.json(),window=String(b.window||''),due=String(b.due||window),reason=String(b.reason||'').trim();
  if(!validWindow(window)||!dateValid(due)||due<window||due>addDays(window,6))return fail('Choose a Thursday week and a required date inside that week.');
  if(reason.length<3||reason.length>2000)return fail('Give a short reason for moving this request.');
  const db=database(),raw=await db.prepare('SELECT * FROM records WHERE id=?').bind(b.id).first<any>();if(!raw)return fail('Request not found.',404);const old=decode(raw);
  if(raw.version!==Number(b.version))return fail('Request changed. Refresh and retry.',409);
  if(!['plan','request'].includes(old.kind)||old.closure?.state==='Closed')return fail('Only open purchase requests can be moved.');
  if(!has(a,'Purchase Manager','Purchase Team')||!canEditAssigned(a,old))return fail('This request is not assigned to you.');
  if(!['BOQ priced','Vendors finalized','Audit approved'].includes(old.stage))return fail('Move the request after the BOQ baseline is issued.');
  const children=(await db.prepare('SELECT * FROM records WHERE parent=?').bind(old.id).all()).results;if(children.length)return fail('This request already has linked purchase or payment records. Move it before creating an order.');
  const data={...old,window,due,reschedule:{from:old.window,to:window,reason,by:a.name,at:new Date().toISOString()}};const now=new Date().toISOString();const result=await db.batch([
   db.prepare('INSERT INTO history (id,record_id,action,data,at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),old.id,'Request rescheduled',JSON.stringify({by:a.name,from:old.window,to:window,fromDue:old.due,toDue:due,reason}),now),
   db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=?').bind(JSON.stringify(data),now,old.id,old.version)
  ]);return result[1].meta.changes?Response.json({ok:true}):fail('Request changed. Refresh and retry.',409);
 }catch(e){return fail(e instanceof Error?e.message:'Unable to move request.');}
}
export async function POST(req:Request){return protect(req,'reschedule',handlePOST);}
