import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf,db}=runtime,results=[],requests=[];
const admin='qa-admin@example.invalid';
async function call(route,body,email=admin){
 const start=performance.now();
 const response=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email===admin?'qa-admin':email},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();requests.push({route,status:response.status,ms:performance.now()-start});return {status:response.status,data};
}
async function ok(route,body,email){const r=await call(route,body,email);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
async function test(name,fn){try{await fn();results.push({name,pass:true});console.log('PASS '+name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
const users=async()=>(await ok('users')).users;
const projects=async()=>(await ok('projects')).projects;
const project=(number,qc='qc-a@example.invalid')=>({project:number,name:'QA '+number,site:'Isolated test',managerEmail:'pm@example.invalid',qcEmail:qc,engineerEmails:['se@example.invalid'],active:true,version:0});
try{
 for(const [email,role] of [['pm','Project Manager'],['qc-a','QC'],['qc-b','QC'],['se','Site Engineer'],['buyer','Purchase Team'],['gm','GM'],['boq','BOQ Team'],['audit','Audit'],['accounts','Accounts']])await ok('users',{email:email+'@example.invalid',name:'QA '+email,roles:[role],projects:[],active:1,version:0});
 await test('Anonymous API denied',async()=>{const r=await mf.dispatchFetch('http://localhost/api/users',{headers:{'x-bilara-test-strict':'1'}});assert.equal(r.status,401);});
 await test('Purchase user cannot manage users',async()=>assert.equal((await call('users',undefined,'buyer@example.invalid')).status,403));
 await test('Create project with PM QC and SE',async()=>{await ok('projects',project('997'));assert.equal((await projects()).find(p=>p.project==='997').qcEmail,'qc-a@example.invalid');});
 await test('QC change persists after reload',async()=>{const p=(await projects()).find(p=>p.project==='997');await ok('projects',{...p,qcEmail:'qc-b@example.invalid'});assert.equal((await projects()).find(p=>p.project==='997').qcEmail,'qc-b@example.invalid');});
 await test('Role change removes obsolete site assignments',async()=>{const u=(await users()).find(u=>u.email==='se@example.invalid');await ok('users',{...u,roles:['QC']});assert.ok(!(await projects()).some(p=>p.engineerEmails.includes(u.email)),'Former engineer remains in project configuration');});
 await test('Unrelated project save cannot revive removed role access',async()=>{await ok('projects',{...project('998'),engineerEmails:[]});assert.deepEqual((await users()).find(u=>u.email==='se@example.invalid').projects,[]);});
 await test('Backup respects QC project scope',async()=>{const r=await ok('forecast?backup=1&window=2026-10-08&project=998',undefined,'qc-a@example.invalid');assert.ok(!r.projectConfigs.some(p=>p.project==='997'),'Backup leaks unrelated project');});
 await test('Backup retains QC owner',async()=>{const r=await ok('forecast?backup=1&window=2026-10-08&project=all');assert.equal(r.projectConfigs.find(p=>p.project==='998').qcEmail,'qc-a@example.invalid');});
 await test('Stale project save rejected without modifying data',async()=>{const p=(await projects()).find(p=>p.project==='998');await ok('projects',{...p,site:'Winner'});assert.equal((await call('projects',{...p,site:'Stale'})).status,409);assert.equal((await projects()).find(p=>p.project==='998').site,'Winner');});
 await test('Concurrent project updates retain successful winner',async()=>{for(let i=0;i<10;i++){const p=(await projects()).find(p=>p.project==='998');const bodies=[{...p,site:'A'+i},{...p,site:'B'+i}];const rs=await Promise.all(bodies.map(b=>call('projects',b)));assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal((await projects()).find(p=>p.project==='998').site,bodies[rs.findIndex(r=>r.status===200)].site);}});
 await test('Malformed JSON returns client error',async()=>{const r=await mf.dispatchFetch('http://localhost/api/projects',{method:'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':admin,'x-bilara-test-user-id':'qa-admin'},body:'{'});assert.equal(r.status,400);});
 await test('500 authenticated reads at concurrency 20',async()=>{let next=0;await Promise.all(Array.from({length:20},async()=>{while(next++<500){const route=next%2?'users':'projects';const r=await ok(route);assert.ok(Array.isArray(r[route]));}}));});
}finally{
 const sorted=requests.map(r=>r.ms).sort((a,b)=>a-b),report={at:new Date().toISOString(),environment:'isolated local Miniflare Worker + D1/R2; NOT live/browser E2E',results,requestCount:requests.length,statusCounts:Object.fromEntries([...new Set(requests.map(r=>r.status))].map(s=>[s,requests.filter(r=>r.status===s).length])),latencyMs:{p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)]}};
 mkdirSync('outputs/qa',{recursive:true});writeFileSync('outputs/qa/regressions.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await runtime.dispose();
}
process.exitCode=results.some(r=>!r.pass)?1:0;
