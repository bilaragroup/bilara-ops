import assert from 'node:assert/strict';
import fs from 'node:fs';
const api='http://localhost:3000/api/',ids=[];
async function call(path,body,status=200){const r=await fetch(api+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,path+': '+JSON.stringify(d));if(d.id)ids.push(d.id);return d;}
const all=async()=>(await call('records')).records;
const read=async id=>(await all()).find(r=>r.id===id);
const batch=crypto.randomUUID(),window='2026-10-01';
const settings=await call('settings');
const original=settings.values;
try{
 await call('settings',{version:settings.version,values:{...original,targetDiscountPercent:5,projectRates:[...(original.projectRates||[]),{id:crypto.randomUUID(),project:'987',item:'Cement',unit:'BAG',originalRate:400,discountPercent:5,active:true}]}});
 const common={kind:'plan',project:'987',milestone:'2',activity:'4',activityName:'Masonry',activityBoqQty:500,window,due:'2026-10-02',owner:'Jithin',itemCategory:'Materials',requestBatchId:batch};
 const first=await call('records',{...common,item:'Cement',unit:'BAG',boqQty:100,demandQty:100});
 const second=await call('records',{...common,item:'Sand',unit:'CFT',boqQty:200,demandQty:200});
 let cement=await read(first.id),sand=await read(second.id);
 assert.equal(cement.activityRequestCode,'4.1');assert.equal(sand.activityRequestCode,'4.1');
 assert.equal(cement.stage,'BOQ priced');assert.equal(cement.boqOriginalRate,400);assert.equal(cement.boqRate,380);assert.equal(cement.rateSource,'Project rate catalogue');
 assert.equal(sand.stage,'Submitted');assert.equal(sand.boqRate,'');
 await call('records',{...sand,boqOriginalRate:100,targetDiscountPercent:5,boqOwner:'Jithin'});sand=await read(sand.id);assert.equal(sand.boqRate,95);assert.equal(sand.stage,'Submitted');
 await call('records',{...sand,stage:'BOQ priced'});sand=await read(sand.id);
 for(const row of [cement,sand]){await call('records',{...row,entity:'BUILDERS',entityConfirmed:true,vendor:'Rate QA Vendor',vendorPhone:'9876543210',quoteRate:row.item==='Cement'?370:90,quoteReference:'RATE-QA',stage:'Vendors finalized'});let latest=await read(row.id);await call('records',{...latest,stage:'Audit approved',auditOwner:'QA Audit',reviewNote:'Rates checked'});}
 cement=await read(cement.id);sand=await read(sand.id);const orderId=crypto.randomUUID();await call('orders',{orderId,creditDays:7,exceptionReason:'Rate and credit QA',items:[{id:cement.id,version:cement.version,qty:100},{id:sand.id,version:sand.version,qty:200}]});
 let records=await all(),purchases=records.filter(r=>r.orderId===orderId),payments=records.filter(r=>r.kind==='payment'&&purchases.some(p=>p.id===r.parent));
 assert.equal(purchases.length,2);assert.equal(payments.length,2);assert.ok(purchases.every(p=>p.creditDays===7&&p.expectedPaymentDate==='2026-10-09'));assert.ok(payments.every(p=>p.due==='2026-10-09'&&p.window==='2026-10-08'));
 const delayed=purchases[0],schedule=payments.find(p=>p.parent===delayed.id);await call('order-progress',{action:'delayDay',items:[{id:delayed.id,version:delayed.version}],by:'QA Purchase',reason:'Supplier delay'});assert.equal((await read(delayed.id)).expectedDelivery,'2026-10-03');assert.equal((await read(schedule.id)).due,'2026-10-10');assert.equal((await read(schedule.id)).window,'2026-10-08');
 console.log('PASS: project catalogue match, 5% target automation, BOQ exception, shared multi-item request sequence, entity confirmation, grouped PO, credit-day forecast and unpaid forecast movement.');
}finally{
 const current=await call('settings');await call('settings',{version:current.version,values:original});
 const records=await all(),roots=new Set(ids),linked=records.filter(r=>roots.has(r.parent)||records.some(p=>roots.has(p.parent)&&r.parent===p.id)).map(r=>r.id),allIds=[...new Set([...ids,...linked])];fs.mkdirSync('work/rate-credit-tests',{recursive:true});fs.writeFileSync('work/rate-credit-tests/cleanup.sql',`DELETE FROM history WHERE record_id IN (${allIds.map(x=>"'"+x+"'").join(',')}); DELETE FROM reference_rates WHERE record_id IN (${ids.map(x=>"'"+x+"'").join(',')}); DELETE FROM records WHERE id IN (${allIds.map(x=>"'"+x+"'").join(',')});`);
}
