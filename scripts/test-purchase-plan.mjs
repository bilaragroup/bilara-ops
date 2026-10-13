// Purchase plan → audit review → PO flow, plus project staffing rules.
// Runs against the isolated Miniflare runtime only (never the hosted site).
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid',id=email){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':id},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const rows=async(email)=>(await call('records',undefined,email)).data.records;
const row=async(id,email)=>(await rows(email)).find(r=>r.id===id);
let passed=0;const pass=(m)=>{passed++;console.log('PASS '+m);};

// Next standard planned window: first Thursday whose cutoff (12 days before, 09:00 IST) is still ahead.
function normalWindow(now=new Date()){
 const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const d=new Date(today+'T00:00:00Z');
 const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 let w=add(add(today,-((d.getUTCDay()+3)%7)),7);
 while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);
 return w;
}
const PM='pm@example.invalid',BOQ='boq@example.invalid',BUY='pmgr@example.invalid',AUD='audit@example.invalid',GM='gm@example.invalid',SE='se@example.invalid',SE2='se2@example.invalid',QC='qc@example.invalid';
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[BUY,'QA Purchase Manager',['Purchase Manager']],[AUD,'QA Auditor',['Audit']],[GM,'QA GM',['GM']],[SE,'QA SE',['Site Engineer']],[SE2,'QA SE 2',['Site Engineer']],[QC,'QA QC',['QC']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});

 // Staffing: QC optional, one site engineer per site.
 await ok('projects',{project:'980',name:'QA 980',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE],active:1,version:0});
 let p=(await ok('projects')).projects.find(x=>x.project==='980');assert.equal(p.qcEmail,'');assert.deepEqual(p.engineerEmails,[SE]);
 assert.equal((await call('projects',{...p,engineerEmails:[SE,SE2]})).status,400);
 await ok('projects',{...p,qcEmail:QC});p=(await ok('projects')).projects.find(x=>x.project==='980');assert.equal(p.qcEmail,QC);
 pass('project saves without QC; second site engineer rejected; QC can be added later');

 const window=normalWindow();
 const base={kind:'plan',project:'980',milestone:'1',activity:'1',activityName:'Foundation',unit:'BAG',owner:'Jithin',itemCategory:'Materials',window,due:window};
 const cement=(await ok('records',{...base,item:'Cement',activityBoqQty:100,boqQty:100},PM)).id;
 const steel=(await ok('records',{...base,item:'12 mm Steel',unit:'KG',activityBoqQty:500,boqQty:500,requestBatchId:'b2'},PM)).id;
 assert.equal((await row(cement)).gmApproval,undefined,'standard window must not need GM');

 // BOQ team prices (BOQ 350, target 5% below = 332.50) and releases without the GM.
 for(const [id,rate] of [[cement,350],[steel,80]]){const r=await row(id);await ok('records',{id,version:r.version,boqOriginalRate:rate,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);}
 assert.equal((await row(cement)).boqRate,332.5);
 const q=[await row(cement),await row(steel)];
 await ok('gm-approval',{ids:q.map(r=>r.id),versions:Object.fromEntries(q.map(r=>[r.id,r.version])),decision:'Approved',note:'Within activity BOQ',confirmed:true},BOQ);
 assert.equal((await row(cement)).stage,'BOQ priced');
 pass('BOQ Team releases normal requests to Purchase');

 // Purchase sees the target, not the BOQ rate, and sends the plan to Audit.
 const seen=await row(cement,BUY);assert.equal(seen.boqOriginalRate,undefined);assert.equal(seen.boqRate,332.5);
 for(const [id,rate,ref] of [[cement,320,'Q-C1'],[steel,85,'Q-S1']]){const r=await row(id,BUY);await ok('records',{id,version:r.version,vendor:'QA Traders',vendorPhone:'99999',quoteRate:rate,quoteReference:ref,entity:'GROUP',stage:'Vendors finalized'},BUY);}
 assert.equal((await row(steel)).stage,'Vendors finalized');
 pass('Purchase Manager sends vendor rates to Audit without seeing the confidential BOQ rate');

 // Only Audit decides; PM and Purchase are refused.
 const decision=async(ids,d,email=AUD,extra={})=>{const rs=await Promise.all(ids.map(id=>row(id)));return call('audit-decision',{ids,versions:Object.fromEntries(rs.map(r=>[r.id,r.version])),decision:d,note:'Checked rates',confirmed:true,...extra},email);};
 assert.equal((await decision([cement],'Approved',PM)).status,403);
 assert.equal((await decision([cement],'Approved',BUY)).status,403);
 const stale=await row(cement);assert.equal((await call('audit-decision',{ids:[cement],versions:{[cement]:stale.version-1},decision:'Approved',note:'x',confirmed:true},AUD)).status,409);
 pass('PM and Purchase cannot record audit decisions; stale versions are refused');

 // Steel is above BOQ (85 > 80): send it back; approve cement.
 assert.equal((await decision([steel],'Returned')).status,200);
 let st=await row(steel);assert.equal(st.stage,'BOQ priced');assert.equal(st.auditReturn.by,'QA Auditor');
 assert.equal((await decision([cement],'Approved')).status,200);
 const c=await row(cement);assert.equal(c.stage,'Audit approved');assert.equal(c.auditOwner,'QA Auditor');assert.equal(c.auditBy,AUD);
 // Saving vs BOQ = (350 − 320) × 100 = ₹3,000.00 = 300000 paise
 assert.equal(c.auditSavings.savingVsBoq,300000);assert.equal(c.auditSavings.savingVsTarget,125000);
 pass('Audit returns an above-BOQ line and approves another with the saving recorded (₹3,000 on cement)');

 // Purchase renegotiates the returned line; the audit note survives the edit.
 st=await row(steel,BUY);await ok('records',{id:steel,version:st.version,quoteRate:78,quoteReference:'Q-S2',entity:'GROUP',stage:'Vendors finalized'},BUY);
 st=await row(steel);assert.equal(st.stage,'Vendors finalized');assert.equal(st.auditReturn.note,'Checked rates');
 assert.equal((await decision([steel],'Approved')).status,200);
 pass('Returned line is renegotiated, resent and approved');

 // Mixed batch is all-or-nothing.
 const extra=(await ok('records',{...base,item:'MSand',unit:'CFT',activityBoqQty:200,boqQty:200,requestBatchId:'b3'},PM)).id;
 let e=await row(extra);await ok('records',{id:extra,version:e.version,boqOriginalRate:60,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);e=await row(extra);
 await ok('gm-approval',{ids:[extra],versions:{[extra]:e.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
 e=await row(extra,BUY);await ok('records',{id:extra,version:e.version,vendor:'QA Sand',quoteRate:55,quoteReference:'Q-M1',entity:'GROUP',stage:'Vendors finalized'},BUY);
 assert.equal((await decision([extra,cement],'Approved')).status,400);assert.equal((await row(extra)).stage,'Vendors finalized');
 pass('a batch containing an already-approved line changes nothing');

 // Approved lines can be ordered; a line still with Audit cannot.
 const order=async(id)=>{const r=await row(id,BUY);return call('orders',{orderId:crypto.randomUUID(),items:[{id,version:r.version,qty:r.boqQty}],creditDays:7,exceptionReason:'QA test outside Wednesday'},BUY);};
 assert.equal((await order(extra)).status,400,'line still with Audit must not be orderable');
 const po=await order(cement);assert.equal(po.status,200,JSON.stringify(po));
 const buy=(await rows()).find(r=>r.kind==='purchase'&&r.parent===cement);assert.ok(buy,'PO line created');assert.equal(buy.rate,320);assert.equal(buy.qty,100);
 const pay=(await rows()).find(r=>r.kind==='payment'&&r.parent===buy.id);assert.ok(pay,'payment schedule auto-created');assert.equal(pay.total,3200000);
 pass('only audit-approved lines become POs; PO uses the audited rate and creates the payment schedule (₹32,000)');

 console.log(`\n${passed} purchase-plan checks passed`);
}finally{await runtime.dispose();}
