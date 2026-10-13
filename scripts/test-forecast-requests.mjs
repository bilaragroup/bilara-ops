import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const dir='work/forecast-tests';fs.mkdirSync(dir,{recursive:true});for(const name of ['calculations','weekly','forecast-requests']){fs.writeFileSync(dir+'/'+name+'.mjs',ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'"));}
const {forecastRequests:f}=await import('../'+dir+'/forecast-requests.mjs');
const r={id:'r',kind:'plan',project:'120',window:'2026-09-17',due:'2026-09-18',item:'Cement',demandQty:10,boqQty:'',boqRate:'',stage:'Submitted'};
assert.equal(f([r],r.window,'120')[0].estimate,null);assert.equal(f([r],r.window,'121').length,0);assert.equal(f([r],'2026-09-24').length,0);assert.equal(f([{...r,stage:'Rejected'}],r.window).length,0);
const priced={...r,boqQty:10,boqRate:100,quoteRate:90};assert.equal(f([priced],r.window)[0].estimate,90000);
const p={id:'p',kind:'purchase',parent:'r',qty:6,total:54000};let d=f([priced,p],r.window)[0];assert.equal(d.estimate,36000);assert.equal(d.unscheduled[0].remaining,54000);
const payment={kind:'payment',parent:'p',total:20000,paid:5000};assert.equal(f([priced,p,payment],r.window)[0].unscheduled[0].remaining,34000);
assert.equal(f([priced,{...p,qty:10,total:90000},{...payment,total:90000}],r.window).length,0);
assert.equal(f([priced,{...p,qty:10,total:90000},{...payment,total:90000,window:'2026-09-24'}],r.window).length,0);
console.log('PASS: automatic drafts, pending pricing, project/week filtering, rejected exclusion, partial orders, scheduled balance deduction and no duplicates across credit weeks.');
