// 16 Oct updates: cancel a request line (before / after PO), trade on requests, PM list for the
// BOQ download, ad hoc purchase cycle, forecast split into normal / ad hoc / variations and the
// reconciliation. Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';
import './ts-resolve.mjs';
const {forecastSplit,reconciliation}=await import('../lib/forecast-split.ts');

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const all=async()=>(await call('records')).data.records;
const row=async(id)=>(await all()).find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};const t=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),e=add(t,14),back=(new Date(e+'T00:00:00Z').getUTCDay()+3)%7;return back?add(e,7-back):e;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',PM2='pm2@example.invalid',SE='se@example.invalid',BOQ='boq@example.invalid',BUY='pmgr@example.invalid',AUD='audit@example.invalid',ACC='acc@example.invalid',GM='gm@example.invalid';
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[PM2,'Other PM',['Project Manager']],[SE,'QA SE',['Site Engineer']],[BOQ,'QA BOQ',['BOQ Team']],[BUY,'QA Buyer',['Purchase Manager']],[AUD,'QA Audit',['Audit']],[ACC,'QA Accounts',['Accounts']],[GM,'QA GM',['GM']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'960',name:'QA 960',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE],active:1,version:0});
 await ok('projects',{project:'961',name:'QA 961',site:'Isolated',managerEmail:PM2,qcEmail:'',engineerEmails:[],active:1,version:0});
 const W=normalWindow();let seq=0;
 async function request(item,qty,extra={}){seq++;return (await ok('records',{kind:'plan',project:'960',item,unit:'BAG',milestone:'1',activity:String(seq),activityName:'Footing',activityBoqQty:qty,boqQty:qty,owner:'Jithin',itemCategory:'Materials',window:W,due:W,requestBatchId:'u'+seq,...extra},PM)).id;}
 async function approvedPO(item,qty,rate=320){
  const id=await request(item,qty);let r=await row(id);await ok('records',{id,version:r.version,boqOriginalRate:350,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);r=await row(id);
  await ok('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
  r=await row(id);await ok('records',{id,version:r.version,vendor:'QA Traders',quoteRate:rate,quoteReference:'Q'+seq,entity:'GROUP',stage:'Vendors finalized'},BUY);
  r=await row(id);await ok('audit-decision',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},AUD);
  r=await row(id);await ok('orders',{orderId:crypto.randomUUID(),items:[{id,version:r.version,qty}],creditDays:7,exceptionReason:'QA'},BUY);
  const p=(await all()).find(x=>x.kind==='purchase'&&x.parent===id);return {req:id,po:p.id};}
 const cancel=async(id,who,reason='Design changed')=>{const r=await row(id);return call('cancel-request',{id,version:r.version,reason,confirmed:true},who);};

 // trade
 const t1=await request('Conduit',50,{trade:'Electrical'});assert.equal((await row(t1)).trade,'Electrical');
 const t2=await request('Cement',10);assert.equal((await row(t2)).trade,'Structural');
 const bad=await call('records',{kind:'plan',project:'960',item:'X',unit:'BAG',milestone:'1',activity:'15',activityName:'x',boqQty:1,owner:'Jithin',itemCategory:'Materials',window:W,due:W,trade:'Civil'},PM);
 assert.equal(bad.status,400);assert.match(bad.data.error,/Structural, Electrical or Plumbing/);
 pass('requests carry a trade: Structural (default), Electrical or Plumbing');

 // cancel before PO
 assert.equal((await cancel(t2,BUY)).status,403);assert.equal((await cancel(t2,SE)).status,403);
 assert.equal((await cancel(t2,PM2)).status,403);
 let c=await cancel(t2,PM);assert.equal(c.status,200,JSON.stringify(c));
 let r=await row(t2);assert.equal(r.stage,'Cancelled');assert.equal(r.requestCancellation.role,'Project Manager');assert.equal(r.requestCancellation.cancelledQty,10);
 assert.equal((await cancel(t2,GM)).status,400);
 const edit=await call('records',{id:t2,version:r.version,boqQty:20},PM);assert.ok([400,403].includes(edit.status),JSON.stringify(edit));
 pass('PM (own project), GM or Audit cancel a line with a reason; Purchase, SE and another PM cannot; a cancelled line is preserved');

 // after PO, nothing received → PO line and its unpaid schedule cancelled
 const a=await approvedPO('Steel',100);
 c=await cancel(a.req,AUD,'Slab redesigned');assert.equal(c.status,200,JSON.stringify(c));
 let rec=await all();const p1=rec.find(x=>x.id===a.po),s1=rec.filter(x=>x.kind==='payment'&&x.parent===a.po);
 assert.equal(p1.status,'Cancelled');assert.equal(p1.total,0);assert.ok(s1.every(s=>s.status==='Cancelled'&&s.total===0));
 assert.equal(rec.find(x=>x.id===a.req).stage,'Cancelled');
 pass('after a PO with nothing received: the PO line and its unpaid payment schedule are cancelled');

 // after PO, part received → PO closes at accepted quantity; GRN payment stays
 const b=await approvedPO('Sand',100);
 let p=await row(b.po);assert.equal((await call('grn',{action:'receive',grnNo:'GRN-U1',date:today,items:[{id:b.po,version:p.version,received:40,accepted:40}]},SE)).status,200);
 c=await cancel(b.req,GM,'Rest not needed');assert.equal(c.status,200,JSON.stringify(c));assert.equal(c.data.keptQty,40);assert.equal(c.data.cancelledQty,60);
 rec=await all();p=rec.find(x=>x.id===b.po);
 assert.equal(p.qty,40);assert.equal(p.status,'Delivered');assert.equal(p.total,1280000);assert.match(p.shortClose.reason,/Request cancelled/);
 const grnPay=rec.filter(x=>x.kind==='payment'&&x.parent===b.po&&x.basis==='GRN');assert.equal(grnPay.length,1);assert.equal(grnPay[0].total,1280000);
 assert.equal(rec.filter(x=>x.kind==='payment'&&x.parent===b.po&&x.basis!=='GRN'&&x.status!=='Cancelled'&&x.total>0).length,0);
 pass('after a part delivery: the PO line closes at the 40 bags received, the payment for them stays, the rest is cancelled');

 // advance paid for goods not received → refused
 const d=await approvedPO('Bricks',100);
 const sched=(await all()).find(x=>x.kind==='payment'&&x.parent===d.po);
 assert.equal((await call('records',{id:sched.id,version:sched.version,action:'settle',amount:1000,date:today,reference:'UTR-adv',paymentMode:'UPI',accountsBy:'QA'},ACC)).status,200);
 c=await cancel(d.req,GM);assert.equal(c.status,400);assert.match(c.data.error,/advance has been paid/);
 pass('an advance paid for goods not received must be settled with Accounts before cancelling');

 // BOQ download PM list
 const m=await ok('managers',undefined,BOQ);assert.deepEqual(m.managers.filter(x=>x.email.endsWith('example.invalid')).map(x=>[x.name,x.projects.map(p=>p.project)]),[['Other PM',['961']],['QA PM',['960']]]);
 assert.equal((await call('managers',undefined,PM)).status,403);assert.equal((await call('managers',undefined,BUY)).status,403);
 pass('BOQ Team gets every Project Manager with their projects for the download; PM and Purchase do not');

 // ad hoc in a chosen purchase cycle
 const next=add(W,7);
 const ah=await ok('records',{kind:'request',project:'960',item:'Tile gum',unit:'BAG',qty:5,estimateRate:0,milestone:'4',activity:'73',activityName:'GF floor tile laying',owner:'Jithin',itemCategory:'Materials',window:next,due:next},PM);
 assert.equal((await row(ah.id)).window,next);
 pass('an ad hoc request is placed in the purchase cycle chosen for it');

 // forecast split and reconciliation (pure functions on the same records)
 const v=await request('Cement',100);let vr=await row(v);await ok('records',{id:v,version:vr.version,boqOriginalRate:400,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);
 const over=(await ok('records',{kind:'plan',project:'960',item:'Cement',unit:'BAG',milestone:'1',activity:vr.activity,activityName:'Footing',boqQty:50,owner:'Jithin',itemCategory:'Materials',window:W,due:W,requestBatchId:'over'},PM)).id;
 let o=await row(over);assert.equal(o.quantityControl.excess,50);
 await ok('records',{id:over,version:o.version,boqOriginalRate:400,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);
 rec=await all();
 const split=forecastSplit(rec,W,'960');
 assert.equal(split.variations.length,1);assert.equal(split.variations[0].qty,50);assert.equal(split.variations[0].value,1900000);
 assert.ok(split.classes.variation.estimate>=1900000);assert.ok(split.classes.normal.estimate>0);
 assert.equal(split.total.estimate,split.classes.normal.estimate+split.classes.adhoc.estimate+split.classes.variation.estimate+split.classes.other.estimate);
 const recon=reconciliation(rec,W,'960');const sand=recon.rows.find(x=>x.item==='Sand');
 assert.equal(sand.poValue,1280000);assert.equal(sand.accepted,1280000);assert.equal(sand.toBill,1280000);assert.ok(sand.notes.some(n=>/Closed at 40/.test(n)));
 assert.equal(recon.rows.find(x=>x.item==='Steel').notes[0],'PO line cancelled');
 assert.ok(recon.rows.find(x=>x.item==='Bricks').toReceive>0);
 pass('forecast splits normal / ad hoc / variations (the 50 bags above BOQ shown separately) and reconciles PO → GRN → bill → paid');
 console.log(`\n${passed} purchase-update checks passed`);
}finally{await runtime.dispose();}
