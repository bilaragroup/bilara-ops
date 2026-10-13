import {protect,canEditAssigned} from '@/lib/access';
import {Actor,has,inProject,visible} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {addDays,validWindow,indiaToday} from '@/lib/weekly';
import {dateValid} from '@/lib/calculations';
const fail=(error:string,status=400)=>Response.json({error},{status});

// Carry approved requests forward to a later week when the site work slips
// (e.g. concreting did not happen). The request keeps its BOQ release, purchase
// rates and audit approval, so it does not go through approval again.
// Accepts one request ({id,version}) or a batch ({ids,versions}); a batch is all-or-nothing.
const MOVABLE=['BOQ priced','Vendors finalized','Audit approved'];
const SYSTEM=['id','kind','parent','sourceId','version','total','paid','updated'];

async function handlePOST(req:Request,a:Actor){
 try{
  const b:any=await req.json(),window=String(b.window||''),reason=String(b.reason||'').trim();
  const ids:string[]=Array.isArray(b.ids)?[...new Set<string>(b.ids.filter((x:any)=>typeof x==='string'))]:[String(b.id||'')];
  const versions=Array.isArray(b.ids)?(b.versions||{}):{[String(b.id||'')]:b.version};
  if(!ids.length||!ids[0]||ids.length>100)return fail('Select between 1 and 100 requests to move.');
  if(!validWindow(window))return fail('Choose a Thursday week to move to.');
  if(reason.length<3||reason.length>2000)return fail('Give a short reason for moving (for example: concreting postponed).');
  const db=database(),today=indiaToday(),rows:any[]=[];
  for(const id of ids){
   const raw=await db.prepare('SELECT * FROM records WHERE id=?').bind(id).first<any>();if(!raw)return fail('Request not found.',404);
   const old=decode(raw);
   if(raw.version!==Number(versions[id]))return fail('A request changed. Refresh and retry.',409);
   if(!['plan','request'].includes(old.kind)||old.closure?.state==='Closed')return fail('Only open purchase requests can be moved.');
   if(!visible(a,old)||!inProject(a,old.project))return fail('This request is outside your projects.',403);
   if(has(a,'Purchase Team')&&!has(a,'GM','Purchase Manager','Project Manager')&&!canEditAssigned(a,old))return fail(`${old.item}: this request is assigned to another purchaser.`,403);
   if(!MOVABLE.includes(old.stage))return fail(`${old.item}: only requests already released by the BOQ team can be carried forward.`);
   if(old.gmApproval&&old.gmApproval.state!=='Approved')return fail(`${old.item}: the GM decision on this late request is still pending.`);
   if(window<=old.window)return fail(`${old.item}: choose a week after ${old.window}.`);
   if(addDays(window,6)<today)return fail('Choose the current week or a later one.');
   if(ids.length>1&&rows.length&&old.project!==rows[0].old.project)return fail('Move one project at a time.');
   const children=(await db.prepare('SELECT id FROM records WHERE parent=?').bind(old.id).all()).results;
   if(children.length)return fail(`${old.item}: a purchase order already exists. Change its delivery date in Purchase orders instead.`);
   // Keep the same weekday within the new week; never before today.
   const offset=dateValid(old.due)?Math.max(0,Math.min(6,Math.round((Date.parse(old.due)-Date.parse(old.window))/864e5))):0;
   let due=ids.length===1&&b.due?String(b.due):addDays(window,offset);
   if(!dateValid(due)||due<window||due>addDays(window,6))return fail('The required date must fall inside the new week.');
   if(due<today)due=today;
   rows.push({raw,old,due});
  }
  const now=new Date().toISOString(),marker=crypto.randomUUID(),sorted=[...ids].sort();
  const stamp=rows.map(r=>r.old).sort((x:any,y:any)=>x.id.localeCompare(y.id)).map((r:any)=>r.id+':'+r.version).join('|');
  const fingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)";
  const statements:any[]=[db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ('+fingerprint+')=?').bind(marker,'carry-forward:'+rows[0].old.project,'Requests carried forward',JSON.stringify({ids:sorted,to:window,reason,by:a.name,email:a.email}),now,JSON.stringify(sorted),stamp)];
  for(const {raw,old,due} of rows){
   const data=JSON.parse(raw.data);for(const k of SYSTEM)delete data[k];
   const move={from:old.window,to:window,fromDue:old.due,toDue:due,reason,by:a.name,email:a.email,at:now};
   data.window=window;data.due=due;data.reschedule=move;data.carryForwards=[...(data.carryForwards||[]),move];
   statements.push(
    db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)').bind(crypto.randomUUID(),old.id,'Request rescheduled',JSON.stringify(move),now,marker),
    db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(data),now,old.id,marker));
  }
  const result=await db.batch(statements);
  if(!result[0].meta.changes)return fail('A request changed. Refresh and retry.',409);
  return Response.json({ok:true,count:rows.length,window});
 }catch(e){return fail(e instanceof Error?e.message:'Unable to move request.');}
}
export async function POST(req:Request){return protect(req,'reschedule',handlePOST);}
