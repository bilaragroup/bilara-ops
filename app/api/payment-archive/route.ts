import {protect} from '@/lib/access';
import {Actor,visible} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {decodeDocument} from '@/lib/documents';

async function handleGET(req:Request,a:Actor){try{
 const q=new URL(req.url).searchParams,project=q.get('project')||'all',window=q.get('window')||'all',db=database();
 const [rs,hs,ds]=await Promise.all([db.prepare('SELECT * FROM records WHERE kind=\'payment\' ORDER BY updated DESC').all(),db.prepare("SELECT * FROM history WHERE action='Payment recorded' ORDER BY at DESC").all(),db.prepare('SELECT * FROM documents ORDER BY created DESC').all()]);
 const records=rs.results.map(decode).filter((r:any)=>visible(a,r)&&(project==='all'||r.project===project)&&(window==='all'||r.window===window));
 const ids=new Set(records.map((r:any)=>r.id));
 const documents=ds.results.map(decodeDocument).filter((d:any)=>d.type==='Payment receipt'&&d.recordIds.some((id:string)=>ids.has(id)));
 const payments=hs.results.filter((h:any)=>ids.has(h.record_id)).map((h:any)=>{let data:any={};try{data=JSON.parse(h.data);}catch{}const r=records.find((x:any)=>x.id===h.record_id);return {id:h.id,recordId:h.record_id,at:h.at,amount:data.amount,date:data.date,reference:data.reference,paymentMode:data.paymentMode,accountsBy:data.accountsBy,project:r?.project,item:r?.item,vendor:r?.vendor,documentIds:documents.filter((d:any)=>d.recordIds.includes(h.record_id)).map((d:any)=>d.id)};});
 return Response.json({payments,documents},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Payment archive is unavailable. Retry.'},{status:503});}}
export async function GET(req:Request){return protect(req,'paymentArchive',handleGET);}
