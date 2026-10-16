import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const dir='work/cutoff-tests';fs.mkdirSync(dir,{recursive:true});
for(const name of ['calculations','weekly','request-policy','workflow'])fs.writeFileSync(`${dir}/${name}.mjs`,ts.transpileModule(fs.readFileSync(`lib/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));
const {requestPolicy:p,requestDateIssue:issue,plannedWindowRoute:route}=await import(`../${dir}/request-policy.mjs`);
// Planned delivery: any day at least 14 days after the request; sooner is ad hoc.
const fri=new Date('2026-09-11T12:00:00+05:30'),thu=new Date('2026-09-17T12:00:00+05:30');
assert.equal(p(fri).earliest,'2026-09-25');assert.equal(p(fri).late,'2026-09-24');assert.equal(p(fri).normal,'2026-10-01');
assert.equal(p(thu).earliest,'2026-10-01');assert.equal(p(thu).late,'2026-10-01');assert.equal(p(thu).normal,'2026-10-01');
assert.equal(route('2026-09-24',thu),'adhoc');assert.equal(route('2026-10-01',thu),'standard');assert.equal(route('2026-09-24',fri),'standard');
assert.ok(issue('plan',{window:'2026-09-24',due:'2026-09-24'},null,fri),'13 days is too soon');
assert.equal(issue('plan',{window:'2026-09-24',due:'2026-09-25'},null,fri),null,'14 days, a Friday, is fine');
assert.equal(issue('plan',{window:'2026-11-05',due:'2026-11-10'},null,fri),null,'a Tuesday weeks ahead is fine');
assert.ok(issue('request',{window:'2026-09-10',due:'2026-09-10'},null,fri));
const root='http://localhost:3000/api/';async function call(path,b,status=200){const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const read=async id=>(await(await fetch(root+'records')).json()).records.find(r=>r.id===id);
if(process.argv[2]==='approve'){
 const {id}=JSON.parse(fs.readFileSync(dir+'/fixture.json'));let r=await read(id);
 await call('records',{...r,stage:'Vendors finalized',boqQty:1,boqRate:10,boqOwner:'Jithin',vendor:'QA',quoteRate:10,quoteReference:'QA',gmApproval:{state:'Approved'}},400);
 await call('gm-approval',{id,version:r.version,decision:'Approved',by:'QA GM',note:'Approve late cycle',confirmed:true});r=await read(id);assert.equal(r.gmApproval.state,'Approved');
 await call('records',{...r,stage:'Vendors finalized',boqQty:1,boqRate:10,boqOwner:'Jithin',vendor:'QA',quoteRate:10,quoteReference:'QA'});
 console.log('PASS: pending GM cannot be bypassed in ordinary updates; explicit GM approval unlocks preparation.');
}else{
 const normal=p().normal,suffix=Date.now();const base={kind:'plan',project:'120',item:`Cutoff QA ${suffix}`,milestone:'1',activity:'1',activityName:'Cutoff activity',activityBoqQty:1,unit:'NOS',demandQty:1,boqQty:1,owner:'Jithin',itemCategory:'Materials',window:normal,due:normal};
 await call('records',{...base,window:'2026-09-15',due:'2026-09-15'},400);await call('records',{...base,window:'2020-01-02',due:'2020-01-02'},400);await call('records',{...base,kind:'request',qty:1,estimateRate:10,reason:'Urgent',window:'2020-01-02',due:'2020-01-02'},400);
 const d=await call('records',{...base,gmApproval:{state:'Approved'}});const r=await read(d.id);assert.ok(!r.gmApproval);
 let lateId='';await call('records',{...base,item:'Cutoff QA too soon',due:p().late<p().earliest?p().late:p().today},400);
 fs.writeFileSync(dir+'/fixture.json',JSON.stringify(d));fs.writeFileSync(dir+'/seed.sql',`UPDATE records SET data=json_set(data,'$.gmApproval',json('{"state":"Pending","window":"${normal}"}')) WHERE id='${d.id}';`);
 fs.writeFileSync(dir+'/cleanup.sql',`DELETE FROM history WHERE record_id IN ('${d.id}','${lateId}');DELETE FROM records WHERE id IN ('${d.id}','${lateId}');`);
 console.log('PASS: cutoff boundary, immediate GM routing, ad hoc routing, past-date and non-Thursday rejection, no client-forged approval.');
}
