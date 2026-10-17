// Purchase request updates (17 Oct): manual activity, primary + secondary owner, vendors & brands
// list (prices hidden from the PM), Audit sending back for quantity (PM) or price (BOQ),
// bill needs its image (number optional). Isolated runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',BOQ='boq@example.invalid',PUR='pur@example.invalid',AUD='aud@example.invalid';
const row=async(id)=>(await call('records',undefined,'qa-admin@example.invalid')).data.records.find(r=>r.id===id);
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[PUR,'QA Purchase',['Purchase Manager']],[AUD,'QA Audit',['Audit']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'903',name:'QA 903',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const base={kind:'plan',project:'903',unit:'NOS',boqQty:10,milestone:'2',owner:'Jithin',itemCategory:'Materials',due:add(today,20)};

 // Manual activity and a secondary owner.
 let bad=await call('records',{...base,item:'Glass',activity:'250',activityName:'Glass partition',requestBatchId:'a'},PM);
 assert.equal(bad.status,400);assert.match(bad.data.error,/not in the company activity list/);
 const g=(await ok('records',{...base,item:'Glass',activity:'250',activityName:'Glass partition',activityCustom:true,owner2:'Rosmi',requestBatchId:'b'},PM)).id;
 let r=await row(g);assert.equal(r.activityName,'Glass partition');assert.equal(r.owner2,'Rosmi');assert.equal(r.activityRequestCode,'250.1');
 bad=await call('records',{...base,item:'Glass',activity:'251',activityName:'',activityCustom:true,requestBatchId:'c'},PM);assert.equal(bad.status,400);
 bad=await call('records',{...base,item:'Glass',activity:'252',activityName:'x',activityCustom:true,owner2:'Nobody',requestBatchId:'d'},PM);assert.equal(bad.status,400);
 pass('an activity can be typed in (number + name) and a request has a primary and secondary owner');

 // Vendors & brands.
 let v=await ok('vendors',undefined,PUR);
 await ok('vendors',{version:v.version,values:[{project:'903',category:'Materials',item:'Glass',brand:'Saint-Gobain',vendor:'Glass House',phone:'98470 11111',unit:'NOS',price:450},{project:'',category:'Materials',item:'Cement',brand:'ACC',vendor:'Kerala Traders',phone:'',unit:'BAG',price:380}]},PUR);
 const pmView=await ok('vendors',undefined,PM);assert.equal(pmView.values.length,2);assert.ok(!('price' in pmView.values[0]));assert.equal(pmView.canEdit,false);
 assert.equal((await ok('vendors',undefined,AUD)).values[0].price,450);
 assert.equal((await call('vendors',{version:pmView.version,values:[]},PM)).status,403);
 bad=await call('vendors',{version:pmView.version,values:[{item:'X',vendor:''}]},PUR);assert.equal(bad.status,400);
 const gv=(await ok('records',{...base,item:'Glass',activity:'253',activityName:'Glass doors',activityCustom:true,vendor:'Glass House',brand:'Saint-Gobain',vendorPhone:'98470 11111',requestBatchId:'e'},PM)).id;
 r=await row(gv);assert.equal(r.vendor,'Glass House');assert.equal(r.brand,'Saint-Gobain');
 pass('Purchase keeps a vendor / brand / price list; the PM sees vendors and brands but not prices and can pick one on the request');

 // Audit sends back: quantity → PM, price → BOQ.
 const ready=async(id)=>{let x=await row(id);await ok('records',{id,version:x.version,activityBoqQty:20,boqOriginalRate:500},BOQ);x=await row(id);
  await ok('gm-approval',{ids:[id],versions:{[id]:x.version},decision:'Approved',note:'ok',confirmed:true},BOQ);x=await row(id);
  await ok('records',{id,version:x.version,vendor:'Glass House',vendorPhone:'1',quoteRate:450,quoteReference:'Q1',entity:'GROUP',stage:'Vendors finalized'},PUR);return row(id);};
 r=await ready(g);
 await ok('audit-decision',{ids:[g],versions:{[g]:r.version},decision:'ReturnQty',note:'10 sheets is too many for this partition',confirmed:true},AUD);
 r=await row(g);assert.equal(r.stage,'Submitted');assert.equal(r.auditReturn.reason,'quantity');
 bad=await call('gm-approval',{ids:[g],versions:{[g]:r.version},decision:'Approved',note:'x',confirmed:true},BOQ);assert.equal(bad.status,400);assert.match(bad.data.error,/PM corrects it first/);
 bad=await call('records',{id:g,version:r.version,boqQty:6,vendor:'Other'},PM);assert.equal(bad.status,403);
 await ok('records',{id:g,version:r.version,boqQty:6,notes:'Reduced'},PM);
 r=await row(g);assert.equal(r.boqQty,6);assert.ok(r.auditReturn.fixedAt);
 await ok('gm-approval',{ids:[g],versions:{[g]:r.version},decision:'Approved',note:'BOQ baseline released',confirmed:true},BOQ);
 r=await row(g);assert.equal(r.stage,'BOQ priced');
 pass('Audit "quantity issue" returns the request to the PM; after the PM corrects the quantity the BOQ team releases it again');

 r=await ready(gv);
 await ok('audit-decision',{ids:[gv],versions:{[gv]:r.version},decision:'ReturnPrice',note:'Rate above market',confirmed:true},AUD);
 r=await row(gv);assert.equal(r.stage,'Submitted');assert.equal(r.auditReturn.reason,'price');
 await ok('records',{id:gv,version:r.version,boqOriginalRate:430},BOQ);r=await row(gv);
 await ok('gm-approval',{ids:[gv],versions:{[gv]:r.version},decision:'Approved',note:'Rate re-checked',confirmed:true},BOQ);
 r=await row(gv);assert.equal(r.stage,'BOQ priced');assert.equal(r.boqOriginalRate,430);assert.equal(r.vendor,'Glass House');
 pass('Audit "price issue" returns the request to the BOQ team, who re-check the rate and release it again (vendor kept)');

 console.log(`\n${passed} purchase request update checks passed`);
}finally{await runtime.dispose();}
