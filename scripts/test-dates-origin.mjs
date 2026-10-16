// Planned requests: required delivery any day at least 14 days after sending (sooner = ad hoc); a payment's
// due date stays inside its week. Writes from the app's own address are accepted however the local
// dev server names it (localhost / 127.0.0.1 / another port in Host); other sites are refused.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid',extra={}){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email,...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};const t=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),e=add(t,14),back=(new Date(e+'T00:00:00Z').getUTCDay()+3)%7;return back?add(e,7-back):e;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid';
try{
 await ok('users',{email:PM,name:'QA PM',roles:['Project Manager'],projects:[],active:1,version:0});
 await ok('projects',{project:'980',name:'QA 980',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const W=normalWindow();
 const base={kind:'plan',project:'980',item:'Cement',unit:'BAG',boqQty:10,milestone:'1',activity:'7',activityName:'Mat & haunch concreting',owner:'Jithin',itemCategory:'Materials',window:W};
 // Planned: any weekday at least 14 days ahead; the purchase week follows the delivery date.
 const rows=async()=>(await call('records',undefined,'qa-admin@example.invalid')).data.records;
 const thu=(d)=>add(d,-((new Date(d+'T00:00:00Z').getUTCDay()+3)%7));
 const first=await ok('records',{...base,due:add(today,14),requestBatchId:'a'},PM);
 const later=await ok('records',{...base,window:W,due:add(today,45),requestBatchId:'b'},PM);
 const saved=await rows();
 assert.equal(saved.find(r=>r.id===first.id).window,thu(add(today,14)));
 assert.equal(saved.find(r=>r.id===later.id).window,thu(add(today,45)));
 assert.ok(!saved.find(r=>r.id===first.id).gmApproval,'14 days ahead is a normal planned request, not a GM exception');
 const soon=await call('records',{...base,due:add(today,13),requestBatchId:'s'},PM);assert.equal(soon.status,400);assert.match(soon.data.error,/at least 14 days.*ad hoc/);
 const adhoc=await ok('records',{...base,kind:'request',qty:5,estimateRate:0,priority:'Normal',window:thu(today),due:add(today,3),requestBatchId:'h'},PM);assert.ok(adhoc.id);
 const past=await call('records',{...base,kind:'request',qty:5,estimateRate:0,priority:'Normal',window:thu(today),due:add(today,-1),requestBatchId:'c'},PM);assert.equal(past.status,400);assert.match(past.data.error,/before today/);
 pass('a planned delivery can be any day 14 or more days ahead (week follows the date); sooner is ad hoc; never before today');
 const pay=await call('records',{kind:'payment',project:'980',item:'Cement',window:W,due:add(W,9),amount:100,vendor:'X',category:'Material'});
 assert.equal(pay.status,400);assert.match(pay.data.error,/payment due date must fall within/);
 pass('a payment due date must still be inside its Thursday–Wednesday week');
 for(const origin of ['http://localhost:3000','http://127.0.0.1:3000','http://localhost:5173'])assert.equal((await call('records',{...base,due:W,requestBatchId:'o'+origin},PM,{origin,host:'localhost:3000'})).status,200,origin);
 const evil=await call('records',{...base,due:W,requestBatchId:'e'},PM,{origin:'https://evil.example',host:'localhost:3000'});assert.equal(evil.status,403);assert.match(evil.data.error,/Origin not allowed/);
 pass('writes from the local app are accepted whether it is opened as localhost, 127.0.0.1 or another port; another site is refused');
 console.log(`\n${passed} date and origin checks passed`);
}finally{await runtime.dispose();}
