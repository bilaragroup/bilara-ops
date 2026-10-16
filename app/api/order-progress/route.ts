import {sameOrigin} from '@/lib/access';
import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {dateValid} from '@/lib/calculations';
import {addDays,indiaToday,thursday} from '@/lib/weekly';
const fail=(error:string,status=400)=>Response.json({error},{status});
async function handlePOST(req:Request,a:Actor){try{
 if(!sameOrigin(req))return fail('Origin not allowed',403);
 const text=await req.text();if(text.length>20000)return fail('Update is too large');const b=JSON.parse(text);
 if(!['delayDay','reschedule','delivered','pending','cancel'].includes(b.action))return fail('Choose a delivery action');
 if(!Array.isArray(b.items)||!b.items.length||b.items.length>100||new Set(b.items.map((x:any)=>x.id)).size!==b.items.length)return fail('Select 1–100 different PO items');
 const by=String(b.by||'').trim(),reason=String(b.reason||'').trim();if(!by||by.length>200||!reason||reason.length>2000)return fail('Enter your name and a reason / delivery note');
 if(b.action==='reschedule'&&!dateValid(b.date))return fail('Choose a valid expected delivery date');
 if(b.action==='delivered')return fail('Record deliveries in Receive goods (GRN) with the quantity received and accepted.');
 const db=database(),snapshot=await db.prepare('SELECT * FROM records ORDER BY id').all(),records=snapshot.results.map(decode);
 const changes:any[]=[];let order:string|undefined;
 for(const input of b.items){
  const p=records.find(r=>r.id===input.id);if(!p||p.kind!=='purchase')return fail('PO item not found');
  if(p.version!==input.version)return fail('An item changed. Refresh and try again.',409);
  if(order&&(p.orderId||p.id)!==order)return fail('Select items from one purchase order');order=p.orderId||p.id;
  const parent=records.find(r=>r.id===p.parent);if(!parent||parent.closure?.state==='Closed')return fail('Reopen the closed request before updating delivery');
  if(p.status==='Cancelled')return fail('Cancelled items are preserved. Create a replacement PO if needed.');
  const data=JSON.parse((snapshot.results.find((r:any)=>r.id===p.id) as any).data);
  data.originalDelivery=data.originalDelivery||parent.due;data.expectedDelivery=data.expectedDelivery||parent.due;
  const event={action:b.action,by,reason,at:new Date().toISOString(),previousStatus:p.status,previousDate:data.expectedDelivery};
  if(b.action==='delayDay'||b.action==='reschedule'){
   if(p.status==='Delivered')return fail('Mark the item not delivered before revising its delivery date');
   data.expectedDelivery=b.action==='delayDay'?addDays(data.expectedDelivery,1):b.date;
   if(!dateValid(data.expectedDelivery))return fail('Delivery date is outside the supported range');
   data.status=data.expectedDelivery>data.originalDelivery?'Delayed':'Ordered';
  }else if(b.action==='delivered'){data.status='Delivered';data.delivery=b.date;data.grn=String(b.grn).trim();}
  else if(b.action==='pending'){if(Array.isArray(p.receipts)&&p.receipts.length)return fail(p.item+': a GRN is recorded. Goods received cannot be un-received here.');data.status='Not delivered';data.delivery='';data.grn='';}
  else{
   const payments=records.filter(r=>r.kind==='payment'&&r.parent===p.id);
   if(payments.some(r=>r.paid>0))return fail(p.item+': payment has already been recorded. Resolve the advance / refund with Accounts before cancellation.');
   if(['Delivered','Part delivered'].includes(p.status)||p.delivery||p.grn||p.actualPurchaseDate)return fail(p.item+': received or purchased items need a return / correction before cancellation.');
   data.status='Cancelled';data.orderCancellation={...event,originalTotal:p.total};
   for(const s of payments){const sd=JSON.parse((snapshot.results.find((r:any)=>r.id===s.id) as any).data);changes.push({old:s,data:{...sd,amount:0,status:'Cancelled',orderCancellation:{...event,originalTotal:s.total}},total:0});}
  }
  data.deliveryUpdate={...event,date:data.expectedDelivery};
  if(b.action!=='cancel'){
   const paymentBasis=b.action==='delivered'?data.delivery:data.expectedDelivery;
   if(dateValid(paymentBasis)){
    data.expectedPaymentDate=addDays(paymentBasis,Number(data.creditDays||0));
    for(const s of records.filter(r=>r.kind==='payment'&&r.parent===p.id&&r.paid===0&&r.status!=='Cancelled'&&r.basis!=='GRN')){
     const sd=JSON.parse((snapshot.results.find((r:any)=>r.id===s.id) as any).data);
     const next={...sd,due:data.expectedPaymentDate,window:thursday(data.expectedPaymentDate),paymentTiming:{basis:paymentBasis,creditDays:Number(data.creditDays||0),updatedBy:by,updatedAt:new Date().toISOString()}};
     changes.push({old:s,data:next,total:s.total});
    }
   }
  }
  changes.push({old:p,data,total:b.action==='cancel'?0:p.total});
 }
 const selectedIds=JSON.stringify(b.items.map((x:any)=>x.id)),selected=new Set(b.items.map((x:any)=>x.id)),parents=new Set(records.filter(r=>selected.has(r.id)).map(r=>r.parent));
 const guarded=records.filter(r=>selected.has(r.id)||parents.has(r.id)||selected.has(r.parent)).sort((x,y)=>x.id.localeCompare(y.id));
 const stamp=guarded.map(r=>r.id+':'+r.version).join('|'),marker=crypto.randomUUID(),now=new Date().toISOString();
 const relatedFingerprint="SELECT group_concat(id||':'||version,'|') FROM (SELECT id,version FROM records WHERE id IN (SELECT value FROM json_each(?)) OR id IN (SELECT parent FROM records WHERE id IN (SELECT value FROM json_each(?))) OR parent IN (SELECT value FROM json_each(?)) ORDER BY id)";
 const statements=[db.prepare("INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ("+relatedFingerprint+")=?").bind(marker,changes[0].old.id,'PO delivery update',JSON.stringify({action:b.action,by,reason,items:b.items}),now,selectedIds,selectedIds,selectedIds,stamp)];
 for(const c of changes){statements.push(db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)').bind(crypto.randomUUID(),c.old.id,b.action==='cancel'?'PO cancellation':'Delivery updated',JSON.stringify({before:c.old,after:c.data,by,reason}),now,marker));statements.push(db.prepare('UPDATE records SET data=?,total=?,version=version+1,updated=? WHERE id=? AND EXISTS(SELECT 1 FROM history WHERE id=?)').bind(JSON.stringify(c.data),c.total,now,c.old.id,marker));}
 const result=await db.batch(statements);if(!result[0].meta.changes)return fail('Linked records changed. Refresh and retry.',409);
 return Response.json({ok:true});
 }catch{return fail('Unable to update the order. Refresh and try again.');}}

export async function POST(req:Request){return protect(req,'progress',handlePOST);}
