import assert from 'node:assert/strict';
const root='http://localhost:3000/api/',admin='georgezenjoe@gmail.com',project='997';
const emails={pm:'project-pm@qa.invalid',engineer:'site-engineer@qa.invalid',engineer2:'site-engineer-2@qa.invalid'};
const headers=(email,id=email===admin?'local-sites-user':email)=>({'Content-Type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':id});
async function call(path,email,body,status=200){const r=await fetch(root+path,{method:body?'POST':'GET',headers:headers(email),body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(data)}`);return data;}
for(const [key,name,role] of [['pm','QA Project Manager','Project Manager'],['engineer','QA Site Engineer','Site Engineer'],['engineer2','QA Site Engineer 2','Site Engineer']])await call('users',admin,{email:emails[key],name,roles:[role],projects:[],active:1,version:0});
await call('projects',admin,{project,name:'QA Tower',site:'QA Site',managerEmail:emails.pm,engineerEmails:[emails.engineer],active:1,version:0});
assert.deepEqual((await call('projects',emails.pm)).projects.map(p=>p.project),[project]);
assert.deepEqual((await call('projects',emails.engineer)).projects.map(p=>p.project),[project]);
await call('projects',emails.pm,{project,name:'Forbidden',site:'QA',managerEmail:emails.pm,engineerEmails:[],active:1,version:1},403);
let users=(await call('users',admin)).users;assert.deepEqual(users.find(u=>u.email===emails.pm).projects,[project]);assert.deepEqual(users.find(u=>u.email===emails.engineer).projects,[project]);
await call('projects',admin,{project,name:'QA Tower',site:'QA Site B',managerEmail:emails.pm,engineerEmails:[emails.engineer2],active:1,version:1});
users=(await call('users',admin)).users;assert.deepEqual(users.find(u=>u.email===emails.engineer).projects,[]);assert.deepEqual(users.find(u=>u.email===emails.engineer2).projects,[project]);
await call('projects',admin,{project,name:'QA Tower',site:'QA Site B',managerEmail:emails.pm,engineerEmails:[emails.engineer2],active:0,version:2});
assert.deepEqual((await call('projects',emails.pm)).projects,[]);
users=(await call('users',admin)).users;assert.deepEqual(users.find(u=>u.email===emails.pm).projects,[]);assert.deepEqual(users.find(u=>u.email===emails.engineer2).projects,[]);
await call('records',admin,{kind:'plan',project,window:'2026-10-01',due:'2026-10-01',item:'QA configured project',milestone:'1',activity:'1',activityName:'QA activity',activityBoqQty:1,boqQty:1,boqRate:0,unit:'NOS',owner:'Jithin',itemCategory:'Materials',entity:'GROUP',stage:'Submitted'},400);
console.log('Project configuration, role enforcement, project scope, reassignment and inactive-project validation passed.');
