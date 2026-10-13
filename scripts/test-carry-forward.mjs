// Carry-forward: approved lines move to a later week without re-approval.
// Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const row=async(id)=>(await call('records')).data.records.find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
function normalWindow(now=new Date()){const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),d=new Date(today+'T00:00:00Z');let w=add(add(today,-((d.getUTCDay()+3)%7)),7);while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);return w;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',PM2='pm2@example.invalid',BOQ='boq@example.invalid',BUY='pmgr@example.invalid',AUD='audit@example.invalid',ACC='acc@example.invalid';
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[PM2,'Other PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[BUY,'QA Buyer',['Purchase Manager']],[AUD,'QA Audit',['Audit']],[ACC,'QA Accounts',['Accounts']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'970',name:'QA 970',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 await ok('projects',{project:'971',name:'QA 971',site:'Isolated',managerEmail:PM2,qcEmail:'',engineerEmails:[],active:1,version:0});
 const W=normalWindow(),N=add(W,7);let seq=0;
 const make=async(item,qty,{quote,approve,order}={})=>{seq++;const id=(await ok('records',{kind:'plan',project:'970',item,unit:'BAG',milestone:'2',activity:String(seq),activityName:'Slab concreting',activityBoqQty:qty,boqQty:qty,owner:'Jithin',itemCategory:'Materials',window:W,due:add(W,2),requestBatchId:'cf'+seq},PM)).id;
  let r=await row(id);await ok('records',{id,version:r.version,boqOriginalRate:350,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);r=await row(id);
  await ok('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
  if(quote){r=await row(id);await ok('records',{id,version:r.version,vendor:'QA Cement',quoteRate:320,quoteReference:'Q'+seq,entity:'GROUP',stage:'Vendors finalized'},BUY);}
  if(approve){r=await row(id);await ok('audit-decision',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},AUD);}
  if(order){r=await row(id);await ok('orders',{orderId:crypto.randomUUID(),items:[{id,version:r.version,qty}],creditDays:7,exceptionReason:'QA'},BUY);}
  return id;};
 const cement=await make('Cement',200,{quote:true,approve:true});
 const metal=await make('20 mm Metal',300);
 const steel=await make('12 mm Steel',500,{quote:true,approve:true,order:true});
 const move=async(ids,email=PM,window=N,extra={})=>{const rs=await Promise.all(ids.map(row));return call('reschedule',{ids,versions:Object.fromEntries(rs.map(r=>[r.id,r.version])),window,reason:'Concreting postponed',...extra},email);};

 assert.equal((await move([cement],ACC)).status,403);
 assert.equal((await move([cement],PM2)).status,403);
 pass('Accounts and a PM of another project cannot move the lines');

 assert.equal((await move([cement,metal,steel])).status,400);
 assert.equal((await row(cement)).window,W,'nothing moves when one line already has a PO');
 assert.equal((await move([cement],PM,add(W,-7))).status,400);
 pass('a line with a PO blocks the batch (all-or-nothing) and earlier weeks are refused');

 const before=await row(cement);
 const r=await move([cement,metal]);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.count,2);
 const c=await row(cement),m=await row(metal);
 assert.equal(c.window,N);assert.equal(c.due,add(N,2));assert.equal(c.stage,'Audit approved');assert.equal(c.auditOwner,before.auditOwner);assert.equal(c.auditSavings.savingVsBoq,before.auditSavings.savingVsBoq);
 assert.equal(m.window,N);assert.equal(m.stage,'BOQ priced');assert.equal(c.reschedule.from,W);assert.equal(c.carryForwards.length,1);
 pass('PM moves the project\'s lines to next week; stages, audit approval and saving are kept');

 assert.equal((await call('reschedule',{ids:[cement],versions:{[cement]:before.version},window:add(N,7),reason:'again'},PM)).status,409);
 pass('a stale version is refused');

 const appr=await row(cement);const po=await call('orders',{orderId:crypto.randomUUID(),items:[{id:cement,version:appr.version,qty:200}],creditDays:7,exceptionReason:'QA'},BUY);assert.equal(po.status,200,JSON.stringify(po));
 const buy=(await call('records')).data.records.find(x=>x.kind==='purchase'&&x.parent===cement);assert.equal(buy.window,N);assert.equal(buy.rate,320);
 pass('the moved line is ordered in the new week at the audited rate, with no new approval');

 const mm=await row(metal);await ok('records',{id:metal,version:mm.version,vendor:'QA Metal',quoteRate:48,quoteReference:'QM',entity:'GROUP',stage:'Vendors finalized'},BUY);
 assert.equal((await row(metal)).carryForwards.length,1,'move history survives later edits');
 pass('move history is kept when Purchase edits the line afterwards');
 console.log(`\n${passed} carry-forward checks passed`);
}finally{await runtime.dispose();}
