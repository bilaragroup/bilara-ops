// Rate cards: default, range of projects and one project; most specific wins.
// BOQ Team and Super Admin edit them; Settings saves leave them alone. Isolated Miniflare runtime only.
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
const PM='pm@example.invalid',BOQ='boq@example.invalid',PUR='pur@example.invalid',GM='gm@example.invalid';
const version=async()=>(await ok('settings',undefined,BOQ)).version;
const card=async(body,who=BOQ)=>call('rate-cards',{version:await version(),...body},who);
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[BOQ,'QA BOQ',['BOQ Team']],[PUR,'QA Purchase',['Purchase Manager']],[GM,'QA GM',['GM']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 for(const p of ['125','130','200'])await ok('projects',{project:p,name:'QA '+p,site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[],active:1,version:0});

 let r=await card({action:'save',scope:{type:'default'},lines:[{item:'Cement',unit:'BAG',originalRate:400,discountPercent:5},{item:'MSand',unit:'',originalRate:60,discountPercent:''}]});
 assert.equal(r.status,200,JSON.stringify(r));assert.match(r.data.summary,/Default rate card \(all projects\): 2 added/);
 r=await card({action:'save',scope:{type:'range',from:'120',to:'150'},lines:[{item:'Cement',unit:'BAG',originalRate:380,discountPercent:5}]});assert.equal(r.status,200,JSON.stringify(r));
 r=await card({action:'save',scope:{type:'project',project:'125'},lines:[{item:'Cement',unit:'BAG',originalRate:360,discountPercent:10}]});assert.equal(r.status,200,JSON.stringify(r));
 const s=(await ok('settings',undefined,BOQ)).values.projectRates;
 assert.equal(s.length,4);assert.equal(s.find(x=>x.item==='MSand').unit,'*');assert.equal(s.find(x=>x.scope==='range').fromProject,'120');assert.equal(s[0].updatedBy,'QA BOQ');
 pass('BOQ Team adds a default card, a 120–150 range card and a project 125 card');

 r=await card({action:'save',scope:{type:'range',from:'140',to:'160'},lines:[{item:'Cement',unit:'BAG',originalRate:1}]});
 assert.equal(r.status,400);assert.match(r.data.error,/overlaps Projects 120–150/);
 r=await card({action:'save',scope:{type:'range',from:'150',to:'120'},lines:[{item:'Cement',unit:'BAG',originalRate:1}]});assert.equal(r.status,400);
 r=await card({action:'save',scope:{type:'project',project:'12'},lines:[{item:'Cement',originalRate:1}]});assert.equal(r.status,400);
 r=await card({action:'save',scope:{type:'default'},lines:[{item:'Cement',unit:'BAG',originalRate:1},{item:'cement',unit:'bag',originalRate:2}]});assert.equal(r.status,400);assert.match(r.data.error,/listed twice/);
 pass('overlapping or reversed ranges, bad project numbers and repeated items are refused');

 for(const who of [PM,PUR,GM]){r=await card({action:'save',scope:{type:'default'},lines:[{item:'X',originalRate:1}]},who);assert.equal(r.status,403,who);}
 const pmView=(await ok('settings',undefined,PM)).values;assert.deepEqual(pmView.projectRates,[]);assert.ok(pmView.catalogItems.some(c=>c.scope==='range'&&c.fromProject==='120'));
 pass('only BOQ Team and Super Admin change rate cards; PM sees which items have rates, never the rates');

 const W=normalWindow();
 const raise=async(project,item,unit)=>{const id=(await ok('records',{kind:'plan',project,item,unit,boqQty:10,milestone:'1',activity:'4',activityName:'Footing & column rebar',owner:'Jithin',itemCategory:'Materials',window:W,due:W,requestBatchId:crypto.randomUUID()},PM)).id;return row(id);};
 const expect=[['125','Cement','BAG',360,10,'Project 125'],['130','Cement','BAG',380,5,'Projects 120–150'],['200','Cement','BAG',400,5,'Default rate card (all projects)'],['125','MSand','CFT',60,5,'Default rate card (all projects)']];
 for(const [p,item,unit,rate,disc,label] of expect){
  const id=(await raise(p,item,unit)).id;const x=(await call('records',undefined,BOQ)).data.records.find(y=>y.id===id);
  assert.equal(x.boqOriginalRate,rate,p+item);assert.equal(x.targetDiscountPercent,disc);assert.equal(x.rateCard,label);
 }
 pass('a new request uses its project card, else its range card, else the default card (any-unit lines match any unit)');

 r=await card({action:'save',scope:{type:'default'},lines:[{item:'Cement',unit:'BAG',originalRate:410,discountPercent:5},{item:'PSand',unit:'CFT',originalRate:70}],source:'Excel: default.xlsx'});
 assert.match(r.data.summary,/1 added, 1 changed/);let d=r.data.values.projectRates.filter(x=>x.scope==='default');
 assert.equal(d.length,3);assert.equal(d.find(x=>x.item==='Cement').originalRate,410);assert.equal(d.find(x=>x.item==='PSand').source,'Excel: default.xlsx');
 r=await card({action:'save',scope:{type:'default'},lines:[{item:'Cement',unit:'BAG',originalRate:410,discountPercent:5}],replace:true});
 assert.match(r.data.summary,/0 added, 0 changed, 2 removed/);
 pass('updating a card changes and adds lines; "replace" also removes lines not given');

 const before=await ok('settings');await ok('settings',{version:before.version,values:{...before.values,projectRates:[]}});
 assert.equal((await ok('settings',undefined,BOQ)).values.projectRates.length,3);
 pass('a Settings save does not touch the rate cards');

 const head=['Project Number','Hitachi','Cement','MSand','20 mm Metal','PSand','Solid Cement Blocks 12 x 8 x 6','Solid Cement Blocks 12 x 8 x 4','Red Bricks','Laterite Stone','8 mm Steel','10 mm Steel','12 mm Steel','16 mm Steel','20 mm Steel','Tile Gum','Shuttering Items'];
 r=await card({action:'importSheet',file:'BilaraRateCard.xlsx',values:[head,['130','',395,62],['200','',405]]});
 assert.equal(r.status,200,JSON.stringify(r));assert.match(r.data.summary,/3 rates for 2 projects/);
 const all=r.data.values.projectRates;assert.ok(all.some(x=>x.project==='130'&&x.item==='MSand'&&x.originalRate===62));assert.ok(all.some(x=>x.scope==='range'));
 pass('the BilaraRateCard sheet still imports as one card per project, leaving default and range cards');

 const cardKey='project:130';const line=all.find(x=>x.project==='130'&&x.item==='Cement');
 r=await card({action:'removeLine',cardKey,lineId:line.id});assert.equal(r.status,200);
 r=await card({action:'removeCard',cardKey:'range:120-150'});assert.match(r.data.summary,/Projects 120–150: removed/);
 const stale=await call('rate-cards',{version:0,action:'removeCard',cardKey:'default'},BOQ);assert.equal(stale.status,409);
 pass('remove one line or a whole card; a stale page is refused');
 console.log(`\n${passed} rate-card checks passed`);
}finally{await runtime.dispose();}
