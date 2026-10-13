import assert from 'node:assert/strict';import fs from 'node:fs';
const root='http://localhost:3000/api/',ids=[];
async function post(path,b,status=200){const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const list=async()=> (await (await fetch(root+'records')).json()).records;
const read=async id=>(await list()).find(r=>r.id===id);
try{
for(let i=0;i<3;i++){let d=await post('records',{kind:'plan',project:'996',item:'Grouped QA '+i,milestone:'1',activity:String(i+1),activityName:'Grouped activity '+(i+1),activityBoqQty:10,unit:'BAG',boqQty:10,demandQty:10,window:'2026-10-01',due:'2026-10-01',owner:'Jithin',itemCategory:'Materials'});ids.push(d.id);let r=await read(d.id);await post('records',{...r,stage:'Vendors finalized',boqQty:10,boqRate:100,boqOwner:'Jithin',vendor:i===2?'Other vendor':'Group vendor',quoteRate:90,quoteReference:'Q1'});r=await read(r.id);await post('records',{...r,stage:'Audit approved',auditOwner:'QA',reviewNote:'Approved'});}
let rs=await list();const body={orderId:crypto.randomUUID(),exceptionReason:'QA early order',items:ids.slice(0,2).map(id=>({id,version:rs.find(r=>r.id===id).version,qty:10}))};
await post('orders',{...body,items:[body.items[0],{id:ids[2],version:3,qty:10}]},400);
await post('orders',{...body,items:body.items.map((r,i)=>({...r,qty:i?11:10}))},400);assert.equal((await list()).filter(r=>r.orderId===body.orderId).length,0);
const created=await post('orders',body);await post('orders',body);rs=await list();let lines=rs.filter(r=>r.orderId===body.orderId);assert.equal(lines.length,2);assert.equal(new Set(lines.map(r=>r.po)).size,1);assert.equal(lines.reduce((n,r)=>n+r.total,0),180000);
await post('orders',{...body,orderId:crypto.randomUUID()},409);
await post('records',{...lines[0],shipTo:'changed'},400);await post('records',{...lines[0],freight:50});assert.equal((await read(lines[0].id)).orderId,body.orderId);
const fresh=await read(ids[2]);const a={orderId:crypto.randomUUID(),exceptionReason:'QA concurrency',items:[{id:fresh.id,version:fresh.version,qty:10}]};const outcomes=await Promise.all([a,{...a,orderId:crypto.randomUUID()}].map(b=>fetch(root+'orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})));assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
console.log('PASS: multi-line PO, shared number, exact totals, mixed-vendor rejection, all-or-nothing quantity guard, retry idempotency, immutable linkage, concurrent over-order protection.');
}finally{const all=await list();ids.push(...all.filter(r=>ids.includes(r.parent)).map(r=>r.id));fs.mkdirSync('work/group-tests',{recursive:true});fs.writeFileSync('work/group-tests/cleanup.sql',`DELETE FROM history WHERE record_id IN (${ids.map(x=>"'"+x+"'")}); DELETE FROM records WHERE id IN (${ids.map(x=>"'"+x+"'")});`);}

