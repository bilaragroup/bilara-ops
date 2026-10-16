// Required delivery date may be any future day (not only inside the execution week); a payment's
// due date stays inside its week. Writes from the app's own address are accepted however the local
// dev server names it (localhost / 127.0.0.1 / another port in Host); other sites are refused.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid',extra={}){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email,...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const d=new Date(today+'T00:00:00Z');let w=add(add(today,-((d.getUTCDay()+3)%7)),7);while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);return w;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid';
try{
 await ok('users',{email:PM,name:'QA PM',roles:['Project Manager'],projects:[],active:1,version:0});
 await ok('projects',{project:'980',name:'QA 980',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const W=normalWindow();
 const base={kind:'plan',project:'980',item:'Cement',unit:'BAG',boqQty:10,milestone:'1',activity:'7',activityName:'Mat & haunch concreting',owner:'Jithin',itemCategory:'Materials',window:W};
 const early=await ok('records',{...base,due:add(W,-5),requestBatchId:'a'},PM);
 const later=await ok('records',{...base,due:add(W,20),requestBatchId:'b'},PM);
 assert.ok(early.id&&later.id);
 const past=await call('records',{...base,due:add(today,-1),requestBatchId:'c'},PM);assert.equal(past.status,400);assert.match(past.data.error,/before today/);
 pass('a request can be delivered before or weeks after its execution week, but not before today');
 const pay=await call('records',{kind:'payment',project:'980',item:'Cement',window:W,due:add(W,9),amount:100,vendor:'X',category:'Material'});
 assert.equal(pay.status,400);assert.match(pay.data.error,/payment due date must fall within/);
 pass('a payment due date must still be inside its Thursday–Wednesday week');
 for(const origin of ['http://localhost:3000','http://127.0.0.1:3000','http://localhost:5173'])assert.equal((await call('records',{...base,due:W,requestBatchId:'o'+origin},PM,{origin,host:'localhost:3000'})).status,200,origin);
 const evil=await call('records',{...base,due:W,requestBatchId:'e'},PM,{origin:'https://evil.example',host:'localhost:3000'});assert.equal(evil.status,403);assert.match(evil.data.error,/Origin not allowed/);
 pass('writes from the local app are accepted whether it is opened as localhost, 127.0.0.1 or another port; another site is refused');
 console.log(`\n${passed} date and origin checks passed`);
}finally{await runtime.dispose();}
