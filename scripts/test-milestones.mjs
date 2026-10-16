// Five company milestones (decided 15 Oct 2026, handover in milestone 5) and one activity list
// shared by purchase requests and the site DPR. Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const row=async(id)=>(await call('records')).data.records.find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};const t=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),e=add(t,14),back=(new Date(e+'T00:00:00Z').getUTCDay()+3)%7;return back?add(e,7-back):e;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid';
try{
 await ok('users',{email:PM,name:'QA PM',roles:['Project Manager'],projects:[],active:1,version:0});
 await ok('projects',{project:'980',name:'QA 980',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const s=await ok('settings');
 assert.deepEqual(s.values.milestones,['1','2','3','4','5']);
 const six=await call('settings',{values:{...s.values,milestones:['1','2','3','4','5','6']},version:s.version});
 assert.equal(six.status,400);assert.match(six.data.error,/1 to 5/);
 pass('five milestones; Settings refuses a sixth');

 const W=normalWindow();
 const base={kind:'plan',project:'980',item:'Cement',unit:'BAG',boqQty:10,owner:'Jithin',itemCategory:'Materials',window:W,due:W};
 const wrong=await call('records',{...base,milestone:'1',activity:'31',activityName:'Slab',requestBatchId:'a'},PM);
 assert.equal(wrong.status,400);assert.match(wrong.data.error,/Activity 31 \(GF slab concrete\) belongs to Milestone 2 · Ground floor structure/);
 const unknown=await call('records',{...base,milestone:'5',activity:'200',activityName:'X',requestBatchId:'b'},PM);
 assert.equal(unknown.status,400);assert.match(unknown.data.error,/not in the company activity list/);
 const m6=await call('records',{...base,milestone:'6',activity:'1',activityName:'X',requestBatchId:'c'},PM);
 assert.equal(m6.status,400);
 pass('a request must use an activity of its milestone; unknown activities and milestone 6 are refused');

 const id=(await ok('records',{...base,milestone:'5',activity:'106',activityName:'Handover to client',requestBatchId:'d'},PM)).id;
 const r=await row(id);assert.equal(r.milestone,'5');assert.equal(r.activityName,'Handover to client');
 pass('handover (activity 106) can be requested under milestone 5');

 const site=await ok('site',{action:'getDprWorkspace',args:['980',add(today,1)]},PM);
 const cat=site.value.activityCatalogue;
 assert.deepEqual([...new Set(cat.map(a=>a.milestone))].sort(),[1,2,3,4,5]);
 assert.equal(cat.find(a=>a.number===106).milestone,5);
 pass('the site DPR uses the same list (milestones 1–5, handover in 5)');
 console.log(`\n${passed} milestone checks passed`);
}finally{await runtime.dispose();}
