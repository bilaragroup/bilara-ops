import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {boundedBody} from '@/lib/documents';
import {cents,dateValid} from '@/lib/calculations';
import {indiaToday} from '@/lib/weekly';
import {paymentBlock} from '@/lib/grn';
const fail=(error:string,status=400)=>Response.json({error},{status});
async function handlePOST(req:Request,a:Actor){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Origin not allowed',403);
 const b=JSON.parse(new TextDecoder().decode(await boundedBody(req,40000))),db=database();
 if(typeof b.batchId!=='string'||!/^[0-9a-f-]{36}$/.test(b.batchId))return fail('Invalid payment request.');
 if(await db.prepare('SELECT id FROM payment_batches WHERE id=?').bind(b.batchId).first())return Response.json({ok:true,alreadySaved:true});
 if(!['Cash','UPI','Account Transfer'].includes(b.paymentMode))return fail('Select Cash, UPI or Account Transfer.');
 if(!dateValid(b.date)||b.date>indiaToday())return fail('Choose an actual payment date no later than today.');
 for(const k of ['accountsBy','reference'])if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>200)return fail('Accounts name and bank/payment reference are required.');
 if(!Array.isArray(b.payments)||!b.payments.length||b.payments.length>50||new Set(b.payments.map((p:any)=>p.id)).size!==b.payments.length)return fail('Select 1–50 different payment schedules.');
 const rows:{old:any,value:number}[]=[];for(const p of b.payments){const row=await db.prepare('SELECT * FROM records WHERE id=?').bind(p.id).first<any>();if(!row||row.kind!=='payment')return fail('Payment schedule not found.');const old=decode(row),value=cents(Number(p.amount));if(old.version!==p.version)return fail('A payment changed. Refresh and review balances.',409);if(!Number.isFinite(value)||value<=0||value>old.total-old.paid)return fail('Each amount must be positive and no higher than its outstanding balance.');rows.push({old,value});}
 {const all=(await db.prepare('SELECT * FROM records').all()).results.map(decode);for(const r of rows){const blocked=paymentBlock(r.old,all,r.value);if(blocked)return fail(blocked);const s=all.find((x:any)=>x.id===r.old.id);if(s)s.paid+=r.value;}}
 if(rows.some(r=>r.old.project!==rows[0].old.project||(r.old.entity||'GROUP')!==(rows[0].old.entity||'GROUP')||r.old.vendor.trim().toLowerCase()!==rows[0].old.vendor.trim().toLowerCase()))return fail('One payment can cover only one project and vendor.');
 if(b.receiptId){const doc=await db.prepare('SELECT * FROM documents WHERE id=?').bind(b.receiptId).first<any>();if(!doc||doc.type!=='Payment receipt')return fail('Choose an uploaded payment receipt.');const links=JSON.parse(doc.data).recordIds;if(doc.project!==rows[0].old.project||doc.vendor.trim().toLowerCase()!==rows[0].old.vendor.trim().toLowerCase()||rows.some(r=>!links.includes(r.old.id)&&!links.includes(r.old.parent)))return fail('The receipt must link to every selected payment or its purchase.');}
 const now=new Date().toISOString(),data=JSON.stringify({...b,payments:rows.map(r=>({id:r.old.id,amount:r.value}))});
 const guards=rows.map(()=>'(SELECT version FROM records WHERE id=?)=?').join(' AND '),values=rows.flatMap(r=>[r.old.id,r.old.version]);
 const statements=[db.prepare('INSERT INTO payment_batches (id,data,created) SELECT ?,?,? WHERE '+guards).bind(b.batchId,data,now,...values)];
 for(const {old,value} of rows){statements.push(db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM payment_batches WHERE id=?)').bind(crypto.randomUUID(),old.id,'Payment recorded',JSON.stringify({amount:value,date:b.date,reference:b.reference,accountsBy:b.accountsBy,paymentMode:b.paymentMode,documentId:b.receiptId||null,batchId:b.batchId}),now,b.batchId));statements.push(db.prepare('UPDATE records SET paid=paid+?,version=version+1,updated=? WHERE id=? AND EXISTS (SELECT 1 FROM payment_batches WHERE id=?)').bind(value,now,old.id,b.batchId));}
 const result=await db.batch(statements);if(!result[0].meta.changes)return fail('Balances changed. Refresh and review before saving.',409);return Response.json({ok:true});
 }catch{return fail('Unable to record payment. Refresh and retry.');}}


export async function POST(req:Request){return protect(req,'accounts',handlePOST);}
