// The PM no longer enters the approved activity BOQ quantity; the BOQ team does on review.
// Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const row=async(id)=>(await call('records')).data.records.find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const d=new Date(today+'T00:00:00Z');let w=add(add(today,-((d.getUTCDay()+3)%7)),7);while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);return w;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',BOQ='boq@example.invalid',GM='gm@example.invalid';
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[GM,'QA GM',['GM']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'980',name:'QA 980',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const W=normalWindow();
 const base={kind:'plan',project:'980',item:'Cement',unit:'BAG',milestone:'1',activity:'7',activityName:'Footing',owner:'Jithin',itemCategory:'Materials',window:W,due:W};
 const id=(await ok('records',{...base,boqQty:100,requestBatchId:'a'},PM)).id;
 let r=await row(id);assert.equal(r.activityBoqQty,undefined);assert.equal(r.stage,'Submitted');assert.equal(r.gmApproval,undefined);
 pass('PM raises a request without any BOQ quantity; it waits for BOQ, not the GM');

 await ok('records',{id,version:r.version,boqOriginalRate:350,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);
 r=await row(id);const s=await call('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
 assert.equal(s.status,400);assert.match(s.data.error,/approved activity BOQ quantity/);
 pass('BOQ cannot release it until the approved activity quantity is entered');

 await ok('records',{id,version:r.version,activityBoqQty:120},BOQ);r=await row(id);
 assert.equal(r.activityBoqQty,120);assert.equal(r.quantityControl.remaining,20);
 await ok('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
 pass('BOQ enters 120 bags; the check runs (100 of 120 used) and BOQ releases it');

 const id2=(await ok('records',{...base,boqQty:40,requestBatchId:'b'},PM)).id;
 r=await row(id2);assert.equal(r.activityBoqQty,120);assert.equal(r.quantityControl.excess,20);assert.equal(r.gmApproval.state,'Pending');
 pass('a second request for the same activity picks up BOQ\'s 120 automatically; 40 more is 20 over, so it goes to the GM');

 const id3=(await ok('records',{...base,item:'MSand',unit:'CFT',boqQty:50,requestBatchId:'c'},PM)).id;
 r=await row(id3);await call('records',{id:id3,version:r.version,activityBoqQty:9999,notes:'pm edit'},PM);
 assert.equal((await row(id3)).activityBoqQty,undefined);
 pass('the PM cannot set or change the BOQ quantity by editing the request');
 console.log(`\n${passed} BOQ quantity checks passed`);
}finally{await runtime.dispose();}
