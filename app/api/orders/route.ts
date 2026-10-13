import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {validateWorkflow} from '@/lib/workflow';
import {purchaseCost} from '@/lib/calculations';
import {addDays,thursday} from '@/lib/weekly';
const fail=(error:string,status=400)=>Response.json({error},{status});
async function handlePOST(req:Request,a:Actor){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Origin not allowed',403);
 const text=await req.text();if(text.length>40000)return fail('Order is too large');const b=JSON.parse(text);
 if(!/^[0-9a-f-]{36}$/i.test(b.orderId||''))return fail('Invalid order reference');
 const db=database();const existing=await db.prepare("SELECT id FROM records WHERE kind='purchase' AND json_extract(data,'$.orderId')=?").bind(b.orderId).first<any>();
 if(existing)return Response.json({ok:true,id:existing.id,alreadySaved:true});
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100||new Set(b.items.map((x:any)=>x.id)).size!==b.items.length)return fail('Select 1–100 distinct approved items');
 const all=(await db.prepare('SELECT * FROM records').all()).results.map(decode);const rows:any[]=[];let first:any;
 const now=new Date().toISOString();const po='PO-'+b.orderId.replaceAll('-','').slice(0,12).toUpperCase();
 for(const line of b.items){
  const parent=all.find(r=>r.id===line.id);if(!parent||!['plan','request'].includes(parent.kind))return fail('Requirement not found');
  if(parent.version!==line.version)return fail('A requirement changed. Refresh before ordering.',409);
  if(!['GROUP','BUILDERS'].includes(parent.entity||'GROUP'))return fail('Choose Group or Builders on the request first');first=first||parent;if(parent.project!==first.project||parent.window!==first.window||parent.vendor!==first.vendor||(parent.entity||'GROUP')!==(first.entity||'GROUP'))return fail('One PO must contain items for the same project, week and vendor');
  const qty=Number(line.qty);if(!Number.isFinite(qty)||qty<=0||qty>1e9)return fail('Enter a positive order quantity');
  const data:any={orderId:b.orderId,orderLine:rows.length+1,po,project:parent.project,entity:parent.entity||'GROUP',item:parent.item,unit:parent.unit,qty,rate:Number(parent.quoteRate),vendor:parent.vendor,vendorContact:parent.vendorPhone||'',status:'Ordered',discount:0,freight:0,other:0,nonRecoverableTax:0,recoverableTax:0,buyerName:parent.entity==='BUILDERS'?'Bilara Builders':'Bilara Group',creditDays:Number(b.creditDays??7),expectedDelivery:parent.due};
  for(const key of ['paymentTerms','shipTo','orderTerms','exceptionReason']){data[key]=String(b[key]||'').trim();if(data[key].length>4000)return fail('Order details are too long');}
  const issue=validateWorkflow('purchase',data,null,parent);if(issue)return fail(issue);
  if(!Number.isSafeInteger(purchaseCost(data).cash))return fail('Order amount is outside the supported precise currency range.');
  data.expectedPaymentDate=addDays(data.expectedDelivery,data.creditDays);const total=purchaseCost(data).cash,id=crypto.randomUUID(),paymentId=crypto.randomUUID(),payment={createdBy:a.email,project:data.project,item:data.item,vendor:data.vendor,entity:data.entity,amount:total/100,due:data.expectedPaymentDate,window:thursday(data.expectedPaymentDate),category:'Material',bill:'',notes:`Auto-created from ${po} · ${data.creditDays} credit day(s) from delivery`,paymentMode:''};rows.push({id,parent:parent.id,version:parent.version,qty,limit:Number(parent.boqQty||parent.qty),data:JSON.stringify(data),total,paymentId,paymentData:JSON.stringify(payment)});
 }
 // A single INSERT checks every line against current balances before creating any line.
 const json=JSON.stringify(rows);
 const result=await db.batch([
  db.prepare(`INSERT INTO records (id,kind,parent,data,version,total,paid,updated)
   SELECT json_extract(j.value,'$.id'),'purchase',json_extract(j.value,'$.parent'),json_extract(j.value,'$.data'),1,json_extract(j.value,'$.total'),0,?
   FROM json_each(?) j WHERE NOT EXISTS (
    SELECT 1 FROM json_each(?) x LEFT JOIN records p ON p.id=json_extract(x.value,'$.parent')
    WHERE p.id IS NULL OR p.version<>json_extract(x.value,'$.version') OR
    json_extract(x.value,'$.qty')+COALESCE((SELECT SUM(CAST(json_extract(q.data,'$.qty') AS REAL)) FROM records q WHERE q.kind='purchase' AND q.parent=p.id AND COALESCE(json_extract(q.data,'$.status'),'')<>'Cancelled'),0)>json_extract(x.value,'$.limit')+0.000000001
   ) AND NOT EXISTS (SELECT 1 FROM records WHERE kind='purchase' AND json_extract(data,'$.orderId')=?)`).bind(now,json,json,b.orderId),
  db.prepare(`INSERT INTO records(id,kind,parent,data,version,total,paid,updated) SELECT json_extract(j.value,'$.paymentId'),'payment',json_extract(j.value,'$.id'),json_extract(j.value,'$.paymentData'),1,json_extract(j.value,'$.total'),0,? FROM json_each(?) j WHERE EXISTS(SELECT 1 FROM records p WHERE p.id=json_extract(j.value,'$.id') AND p.kind='purchase') AND NOT EXISTS(SELECT 1 FROM records x WHERE x.kind='payment' AND x.parent=json_extract(j.value,'$.id'))`).bind(now,json),
  db.prepare("INSERT INTO history (id,record_id,action,data,at) SELECT lower(hex(randomblob(16))),id,'Created grouped purchase order',data,? FROM records WHERE kind='purchase' AND json_extract(data,'$.orderId')=? AND updated=? AND NOT EXISTS (SELECT 1 FROM history h WHERE h.record_id=records.id)").bind(now,b.orderId,now),
  db.prepare("INSERT INTO history (id,record_id,action,data,at) SELECT lower(hex(randomblob(16))),id,'Payment forecast created from PO',data,? FROM records WHERE kind='payment' AND updated=? AND NOT EXISTS (SELECT 1 FROM history h WHERE h.record_id=records.id)").bind(now,now)
 ]);
 if(result[0].meta.changes!==rows.length){const saved=await db.prepare("SELECT id FROM records WHERE kind='purchase' AND json_extract(data,'$.orderId')=?").bind(b.orderId).first<any>();if(saved)return Response.json({ok:true,id:saved.id,alreadySaved:true});return fail('An item changed or its quantity is already ordered. Refresh and try again.',409);}
 return Response.json({ok:true,id:rows[0].id});
 }catch{return fail('Unable to create the order. Retry the same order.');}}

export async function POST(req:Request){return protect(req,'orders',handlePOST);}
