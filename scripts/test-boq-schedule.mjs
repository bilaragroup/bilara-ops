// BOQ schedule per project: the BOQ team uploads milestones -> activities -> items with the
// approved quantity; PM requests take that quantity from the schedule. Isolated runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';
import {parseSchedule,BOQ_SCHEDULE_COLUMNS,packLines,diffSchedule} from '../lib/boq-schedule.ts';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const all=async(email)=>(await call('records',undefined,email)).data.records;
const row=async(id)=>(await all()).find(r=>r.id===id);
const schedule=async(p,email)=>(await all(email)).find(r=>r.kind==='boqschedule'&&r.project===p);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const d=new Date(today+'T00:00:00Z');let w=add(add(today,-((d.getUTCDay()+3)%7)),7);while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);return w;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',BOQ='boq@example.invalid',GM='gm@example.invalid',PUR='pur@example.invalid';
const sheet=(rows,project='981')=>[[...BOQ_SCHEDULE_COLUMNS],...rows.map(r=>[project,...r])];
const opts={milestones:['1','2','3','4','5','6'],standardItems:['Cement','MSand']};
try{
 // ---- the template parser (shared by the browser and the server) ----
 const good=parseSchedule(sheet([['1','7','Footing concrete','cement','bag','120',''],['1','7','Footing concrete','MSand','CFT','300',''],['2','3','Columns','12 mm Steel','KG','850.5','phase A']]),'981',opts);
 assert.deepEqual(good.issues,[]);assert.equal(good.lines.length,3);
 assert.equal(good.lines[0].item,'Cement');assert.equal(good.lines[0].unit,'BAG');assert.equal(good.lines[2].qty,850.5);
 const bad=parseSchedule(sheet([['1','7','Footing','Cement','BAG','120',''],['1','7','Footing','Cement','BAG','10',''],['9','x','','','','-1',''],['1','7','Plinth','Sand','CFT','5','']]).concat([['982','1','1','A','Cement','BAG','1','']]),'981',opts);
 assert.deepEqual(bad.issues.map(i=>i.row),[3,4,4,4,4,4,4,5,6]);
 assert.match(bad.issues[0].message,/already listed/);assert.match(bad.issues.at(-2).message,/called "Footing"/);assert.match(bad.issues.at(-1).message,/this upload is for project 981/);
 assert.match(parseSchedule([['Project','Item']],'981',opts).issues[0].message,/template/);
 const d=diffSchedule(good.lines,[{...good.lines[0],qty:130},good.lines[1]]);assert.deepEqual([d.added.length,d.changed.length,d.removed.length,d.same],[0,1,1,1]);
 pass('the template check lists every problem with its Excel row, fixes item/unit case and previews changes');

 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[GM,'QA GM',['GM']],[PUR,'QA Purchase',['Purchase Manager']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'981',name:'QA 981',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});
 const lines=packLines(good.lines);

 for(const who of [PM,PUR]){const r=await call('boq-schedule',{action:'save',project:'981',version:0,lines},who);assert.equal(r.status,403);}
 const bogus=await call('boq-schedule',{action:'save',project:'981',version:0,lines:[['1','7','Footing','Cement','BAG','-5','']]},BOQ);
 assert.equal(bogus.status,400);assert.match(bogus.data.error,/Approved Quantity/);
 assert.equal(await schedule('981'),undefined);
 pass('only the BOQ team or GM can save a schedule, and the server re-checks every row');

 let s=await ok('boq-schedule',{action:'save',project:'981',version:0,lines,fileName:'981.xlsx'},BOQ);
 assert.deepEqual([s.version,s.added,s.lines],[1,3,3]);
 const pmView=await schedule('981',PM);assert.equal(pmView.lines.length,3);assert.equal(pmView.updatedBy,'QA BOQ');
 const stale=await call('boq-schedule',{action:'save',project:'981',version:0,lines},GM);assert.equal(stale.status,409);
 pass('BOQ uploads the schedule; the PM can read it; a stale second upload is refused');

 const W=normalWindow();
 const base={kind:'plan',project:'981',item:'Cement',unit:'BAG',milestone:'1',activity:'7',activityName:'Footing concrete',owner:'Jithin',itemCategory:'Materials',window:W,due:W};
 const id=(await ok('records',{...base,boqQty:100,activityBoqQty:5000,requestBatchId:'a'},PM)).id;
 let r=await row(id);
 assert.equal(r.activityBoqQty,120);assert.equal(r.boqQtySource,'BOQ schedule');assert.equal(r.quantityControl.remaining,20);assert.equal(r.gmApproval,undefined);
 pass('a PM request takes 120 bags from the schedule (anything the PM sends is ignored); 100 of 120 is within, so no GM');

 const id2=(await ok('records',{...base,boqQty:40,requestBatchId:'b'},PM)).id;
 r=await row(id2);assert.equal(r.quantityControl.excess,20);assert.equal(r.gmApproval.state,'Pending');
 const free=(await ok('records',{...base,item:'Red Bricks',unit:'NOS',boqQty:10,requestBatchId:'c'},PM)).id;
 r=await row(free);assert.equal(r.activityBoqQty,undefined);assert.equal(r.boqQtySource,undefined);
 pass('40 more goes 20 over the schedule and needs the GM; an item not in the schedule still waits for BOQ as before');

 await ok('gm-approval',{ids:[id2],versions:{[id2]:(await row(id2)).version},decision:'Rejected',note:'too much',confirmed:true},GM);
 const id3=(await ok('records',{...base,boqQty:20,requestBatchId:'d'},PM)).id;
 r=await row(id3);assert.equal(r.quantityControl.previousRequested,100);assert.equal(r.quantityControl.excess,0);assert.equal(r.gmApproval,undefined);
 pass('a rejected request no longer uses up the BOQ quantity: 20 more fits exactly');

 s=await ok('boq-schedule',{action:'save',project:'981',version:1,milestones:['2'],lines:[['2','3','Columns','12 mm Steel','KG',900,''],['2','4','Beams','12 mm Steel','KG',400,'']]},BOQ);
 let sch=await schedule('981');assert.equal(sch.lines.length,4);assert.equal(sch.lines.find(l=>l.activity==='3').qty,900);assert.equal(sch.lines.filter(l=>l.milestone==='1').length,2);
 assert.equal(s.changed,1);assert.equal(s.added,1);
 pass('a large file can be saved a few milestones at a time without touching the other milestones');

 r=await row(id);
 await ok('records',{id,version:r.version,boqOriginalRate:350,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);
 await ok('gm-approval',{ids:[id],versions:{[id]:(await row(id)).version},decision:'Approved',note:'ok',confirmed:true},BOQ);
 assert.equal((await row(id)).stage,'BOQ priced');
 s=await ok('boq-schedule',{action:'save',project:'981',version:2,milestones:['1'],lines:[['1','7','Footing concrete','Cement','BAG',90,''],['1','7','Footing concrete','MSand','CFT',300,'']]},BOQ);
 assert.equal(s.overRequested.length,1);assert.equal(s.overRequested[0].requested,120);
 r=await row(id);assert.equal(r.activityBoqQty,120);
 await ok('records',{id,version:r.version,notes:'GM note after schedule cut'},GM);
 r=await row(id);assert.equal(r.activityBoqQty,120);assert.equal(r.notes,'GM note after schedule cut');
 pass('cutting the schedule below what is requested is warned about; a priced request keeps its quantity and can still be edited');

 const settings=(await ok('settings')),values={...settings.values,projectRates:[{id:'r1',project:'981',item:'MSand',unit:'*',originalRate:60,discountPercent:5,active:true}]};
 await ok('settings',{version:settings.version,values});
 const auto=(await ok('records',{...base,item:'MSand',unit:'CFT',itemCategory:'Materials',boqQty:50,requestBatchId:'e'},PM)).id;
 r=await row(auto);assert.equal(r.stage,'BOQ priced');assert.equal(r.activityBoqQty,300);assert.equal(r.boqRate,57);
 pass('with a project rate and a schedule line, a request is priced at once with no manual BOQ step');

 s=await ok('boq-schedule',{action:'clear',project:'981',version:3},GM);assert.equal(s.lines,0);
 assert.equal((await schedule('981')).lines.length,0);
 pass('the GM can clear a project schedule; history keeps what changed');
 console.log(`\n${passed} BOQ schedule checks passed`);
}finally{await runtime.dispose();}
