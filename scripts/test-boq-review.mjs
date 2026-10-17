// BOQ review: the BOQ rate and purchase target come from the rate card automatically; the BOQ
// team enters the approved activity quantity, may replace the rate with a custom BOQ rate, and
// releases from the Requests list. Fields outside the BOQ review are refused with a clear message.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',BOQ='boq@example.invalid',PUR='pur@example.invalid';
const row=async(id)=>(await call('records',undefined,BOQ)).data.records.find(r=>r.id===id);
const version=async()=>(await ok('settings',undefined,BOQ)).version;
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[PUR,'QA Purchase',['Purchase Manager']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'902',name:'QA 902',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 await ok('rate-cards',{version:await version(),action:'save',scope:{type:'default'},lines:[{item:'MSand',unit:'CFT',originalRate:72,discountPercent:5}]},BOQ);
 const due=add(today,20);
 const base={kind:'plan',project:'902',unit:'CFT',boqQty:184,milestone:'1',activity:'7',activityName:'Mat & haunch concreting',owner:'Jithin',itemCategory:'Materials',due};
 const ms=(await ok('records',{...base,item:'MSand',requestBatchId:'m'},PM)).id;
 let r=await row(ms);
 assert.equal(r.boqOriginalRate,72);assert.equal(r.targetDiscountPercent,5);assert.equal(r.boqRate,68.4);assert.equal(r.rateCard,'Default rate card (all projects)');
 pass('a new request takes its BOQ rate (72) and purchase target (68.4) from the rate card automatically');

 // The old generic edit form sent the delivery date, vendor and next step too.
 let bad=await call('records',{id:ms,version:r.version,activityBoqQty:200,due:add(due,1),vendor:'X'},BOQ);
 assert.equal(bad.status,403);assert.match(bad.data.error,/only the approved BOQ quantity.*\(not: due, vendor\)/);
 await ok('records',{id:ms,version:r.version,activityBoqQty:200,notes:'ok'},BOQ);
 r=await row(ms);assert.equal(r.activityBoqQty,200);assert.equal(r.boqRate,68.4);assert.ok(!r.gmApproval);
 pass('the BOQ review saves only the approved quantity (and says which other fields were refused)');

 await ok('records',{id:ms,version:r.version,boqOriginalRate:80},BOQ);
 r=await row(ms);assert.equal(r.boqRate,76);assert.equal(r.rateSource,'Custom BOQ rate');assert.equal(r.boqOwner,'QA BOQ');
 await ok('records',{id:ms,version:r.version,boqOriginalRate:72},BOQ);
 r=await row(ms);assert.equal(r.boqRate,68.4);assert.equal(r.rateSource,'Project rate catalogue');
 pass('a custom BOQ rate sets the target (80 → 76); going back to the card rate is the card again');

 const res=await ok('gm-approval',{ids:[ms],versions:{[ms]:r.version},decision:'Approved',note:'BOQ baseline released',confirmed:true},BOQ);
 assert.equal(res.count,1);r=await row(ms);assert.equal(r.stage,'BOQ priced');
 pass('the BOQ team releases the request to Purchase from the Requests list');

 // No card when raised: the rate is picked up from a card added later, at BOQ review.
 const ps=(await ok('records',{...base,item:'PSand',requestBatchId:'p'},PM)).id;
 r=await row(ps);assert.ok(!(r.boqRate>0));
 await ok('rate-cards',{version:await version(),action:'save',scope:{type:'default'},lines:[{item:'PSand',unit:'CFT',originalRate:90,discountPercent:10}]},BOQ);
 await ok('records',{id:ps,version:r.version,activityBoqQty:184},BOQ);
 r=await row(ps);assert.equal(r.boqOriginalRate,90);assert.equal(r.boqRate,81);assert.equal(r.boqOwner,'Rate catalogue');
 pass('a request raised before its item had a card gets the card rate when the BOQ team reviews it');

 // Approved quantity below what was requested → GM approval first.
 const tg=(await ok('records',{...base,item:'MSand',boqQty:50,activity:'8',activityName:'Plinth beam',requestBatchId:'t'},PM)).id;
 r=await row(tg);await ok('records',{id:tg,version:r.version,activityBoqQty:40},BOQ);
 r=await row(tg);assert.equal(r.gmApproval?.state,'Pending');
 const blocked=await call('gm-approval',{ids:[tg],versions:{[tg]:r.version},decision:'Approved',note:'x',confirmed:true},BOQ);assert.equal(blocked.status,403);
 pass('an approved quantity below the request sends it to the GM; the BOQ team cannot release it');


 // Ad hoc end to end: no rate card (custom BOQ rate) → Purchase vendor → Audit → PO on any day.
 const AUD='aud@example.invalid';await ok('users',{email:AUD,name:'QA Audit',roles:['Audit'],projects:[],active:1,version:0});
 const thu=(d)=>add(d,-((new Date(d+'T00:00:00Z').getUTCDay()+3)%7));
 const ah=(await ok('records',{kind:'request',project:'902',item:'Binding wire',unit:'KG',milestone:'1',activity:'4',activityName:'Footing & column rebar',qty:25,boqQty:25,estimateRate:0,priority:'Urgent',reason:'Ran out',owner:'Jithin',itemCategory:'Materials',window:thu(today),due:add(today,2),requestBatchId:'ah'},PM)).id;
 r=await row(ah);await ok('records',{id:ah,version:r.version,activityBoqQty:25,boqOriginalRate:80},BOQ);
 r=await row(ah);assert.equal(r.estimateRate,76);await ok('gm-approval',{ids:[ah],versions:{[ah]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
 r=await row(ah);assert.equal(r.stage,'BOQ priced');
 await ok('records',{id:ah,version:r.version,kind:'request',entity:'GROUP',vendor:'Kerala Traders',vendorPhone:'9847012345',quoteRate:74,quoteReference:'KT-1',stage:'Vendors finalized'},PUR);
 r=await row(ah);assert.equal(r.stage,'Vendors finalized');
 await ok('audit-decision',{ids:[ah],versions:{[ah]:r.version},decision:'Approved',note:'ok',confirmed:true},AUD);
 r=await row(ah);const po=await call('orders',{orderId:crypto.randomUUID(),items:[{id:ah,version:r.version,qty:25}],creditDays:7},PUR);
 assert.equal(po.status,200,JSON.stringify(po));
 pass('ad hoc: custom BOQ rate → Purchase sends to Audit (only changed fields + entity) → Audit → PO without a Wednesday reason');

 console.log(`\n${passed} BOQ review checks passed`);
}finally{await runtime.dispose();}
