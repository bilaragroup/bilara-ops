import assert from 'node:assert/strict';
const root='http://localhost:3000/api/';const get=async()=>await(await fetch(root+'settings')).json();
async function post(path,body,status=200){const r=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
const original=await get();assert.deepEqual(original.values.owners,['Jithin','Jiby','Rosmi','Sneha','Stevo']);
await post('settings',{...original,values:{...original.values,owners:[]}},400);await post('settings',{...original,values:{...original.values,owners:['Jiby','jiby']}},400);
let changed=await post('settings',{...original,values:{...original.values,itemCategories:[...original.values.itemCategories,'QA Temporary']}});assert.ok((await get()).values.itemCategories.includes('QA Temporary'));
await post('settings',original,409);await post('settings',{version:changed.version,values:original.values});
await post('records',{kind:'plan',project:'988',window:'2026-10-01',due:'2026-10-01',item:'Settings QA',milestone:'1',activity:'1',activityName:'Settings activity',activityBoqQty:1,boqQty:1,unit:'NOS',owner:'Unknown owner',itemCategory:'Materials'},400);
const backup=await(await fetch(root+'forecast?backup=1&window=2026-10-01&project=all')).json();assert.deepEqual(backup.settings.owners,original.values.owners);
console.log('PASS: configuration saves/reloads, empty/duplicate list rejection, stale-save protection, owner enforcement and backup inclusion.');
