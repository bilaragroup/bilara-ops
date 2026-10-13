import assert from 'node:assert/strict';import fs from 'node:fs';
const root='http://localhost:3000/api/',ids=[];
const list=async()=> (await(await fetch(root+'records')).json()).records;
const read=async id=>(await list()).find(r=>r.id===id);
async function post(path,b,status=200){const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const item=p=>({id:p.id,version:p.version});
const progress=(items,action,extra={})=>post('order-progress',{items:items.map(item),action,by:'QA',reason:'QA delivery update',...extra},extra.status||200);
try{
 for(let i=0;i<2;i++){const d=await post('records',{kind:'plan',project:'990',item:'Delivery QA '+i,milestone:'1',activity:String(i+1),activityName:'Delivery activity '+(i+1),activityBoqQty:10,unit:'BAG',demandQty:10,boqQty:10,window:'2026-10-01',due:'2026-10-01',owner:'Jithin',itemCategory:'Materials'});ids.push(d.id);let r=await read(d.id);await post('records',{...r,stage:'Vendors finalized',boqQty:10,boqRate:100,boqOwner:'Jithin',vendor:'Delivery QA vendor',quoteRate:100,quoteReference:'Q'});r=await read(d.id);await post('records',{...r,stage:'Audit approved',auditOwner:'QA',reviewNote:'QA'});}
 const orderId=crypto.randomUUID();await post('orders',{orderId,exceptionReason:'QA',items:await Promise.all(ids.map(async id=>({...item(await read(id)),qty:10})))});
 let lines=(await list()).filter(r=>r.orderId===orderId);const [a,b]=lines;let firstSchedule=(await list()).find(r=>r.kind==='payment'&&r.parent===a.id);assert.equal(firstSchedule.due,'2026-10-08');
 await progress([a],'delayDay');assert.equal((await read(a.id)).expectedDelivery,'2026-10-02');assert.equal((await read(b.id)).expectedDelivery,'2026-10-01');firstSchedule=await read(firstSchedule.id);assert.equal(firstSchedule.due,'2026-10-09');assert.equal(firstSchedule.window,'2026-10-08');
 await progress([a],'delayDay',{status:409});
 lines=await Promise.all(lines.map(p=>read(p.id)));await progress(lines,'delayDay');assert.equal((await read(a.id)).expectedDelivery,'2026-10-03');assert.equal((await read(b.id)).expectedDelivery,'2026-10-02');
 lines=await Promise.all(lines.map(p=>read(p.id)));await progress(lines,'reschedule',{date:'2026-10-01'});assert.equal((await read(a.id)).window,'2026-10-01');assert.equal((await read(a.id)).originalDelivery,'2026-10-01');
 lines=await Promise.all(lines.map(p=>read(p.id)));await progress(lines,'delivered',{date:'2099-01-01',grn:'QA',status:400});await progress(lines,'delivered',{date:'2026-09-10',grn:'QA'});
 await progress([await read(a.id)],'pending');assert.equal((await read(a.id)).delivery,'');assert.equal((await read(b.id)).status,'Delivered');
 lines=await Promise.all(lines.map(p=>read(p.id)));await progress(lines,'cancel',{status:400});assert.equal((await read(a.id)).status,'Not delivered');
 const p={id:firstSchedule.id};
 await progress([await read(a.id)],'cancel');assert.equal((await read(a.id)).total,0);assert.equal((await read(p.id)).total,0);assert.equal((await read(p.id)).status,'Cancelled');
 await post('records',{...await read(a.id),status:'Ordered'},400);await post('records',{...await read(p.id),amount:1000},400);
 const parent=await read(a.parent);await post('orders',{orderId:crypto.randomUUID(),exceptionReason:'Replacement QA',items:[{...item(parent),qty:10}]});
 const replacement=(await list()).find(r=>r.kind==='purchase'&&r.parent===a.parent&&r.status!=='Cancelled');
 const pay=(await list()).find(r=>r.kind==='payment'&&r.parent===replacement.id);let schedule=await read(pay.id);await post('records',{...item(schedule),action:'settle',amount:1,date:'2026-09-10',reference:'QA',accountsBy:'QA',paymentMode:'Cash'});await progress([replacement],'cancel',{status:400});

 await progress([await read(b.id)],'pending');await progress([await read(b.id)],'cancel');let cancelledParent=await read(b.parent);
 await post('closure',{...item(cancelledParent),action:'close',by:'QA',reason:'QA',confirmed:true},400);
 await post('closure',{...item(cancelledParent),action:'cancelBalance',by:'QA',reason:'No replacement required',confirmed:true});cancelledParent=await read(b.parent);
 await post('closure',{...item(cancelledParent),action:'close',by:'QA',reason:'All outstanding quantities cancelled, no payment made',confirmed:true});
 console.log('PASS: one-line and whole-PO delay, chosen dates across weeks, original dates, stale writes, future delivery rejection, bulk delivery, one-line non-delivery, atomic cancellation, unpaid schedule cancellation, replacement PO and paid cancellation protection.');
}finally{const rs=await list();const all=[...new Set([...ids,...rs.filter(r=>ids.includes(r.parent)).map(r=>r.id)])];fs.mkdirSync('work/delivery-tests',{recursive:true});fs.writeFileSync('work/delivery-tests/cleanup.sql',`DELETE FROM history WHERE record_id IN (${all.map(x=>"'"+x+"'")}); DELETE FROM records WHERE id IN (${all.map(x=>"'"+x+"'")});`);}
