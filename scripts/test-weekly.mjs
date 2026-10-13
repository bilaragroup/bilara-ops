import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
const dir='work/weekly-tests';fs.mkdirSync(dir,{recursive:true});
for(const name of ['calculations','weekly','workflow','backup']){let code=ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;code=code.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");fs.writeFileSync(dir+'/'+name+'.mjs',code);}
const w=await import('../'+dir+'/weekly.mjs');const {backupFiles}=await import('../'+dir+'/backup.mjs');
assert.equal(w.planningWindow('2026-09-24'),'2026-10-01');assert.equal(w.thursday('2026-10-07'),'2026-10-01');assert.equal(w.thursday('2026-10-08'),'2026-10-08');assert.equal(w.addDays('2026-12-31',6),'2027-01-06');assert.deepEqual(w.milestones('2026-10-01').map(x=>x.date),['2026-09-19','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01']);
const ids=[];
async function post(body,status=200,endpoint='records'){const r=await fetch('http://localhost:3000/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));if(d.id)ids.push(d.id);return d;}
async function records(){return (await (await fetch('http://localhost:3000/api/records')).json()).records;}
async function read(id){return (await records()).find(r=>r.id===id);}
const base={kind:'plan',project:'998',item:'Weekly QA cement',milestone:'1',activity:'1',activityName:'Weekly QA activity',activityBoqQty:100,unit:'BAG',demandQty:100,boqQty:'',boqRate:'',due:'2026-10-02',window:'2026-10-01',owner:'Jithin',itemCategory:'Materials',stage:'Submitted'};
await post({...base,window:'2026-10-02'},400);await post({...base,project:'1000'},400);
const created=await post(base);let p=await read(created.id);
await post({...p,stage:'Audit approved'},400);
const buy={kind:'purchase',parent:p.id,unit:'BAG',qty:100,rate:350,discount:0,freight:100,other:0,nonRecoverableTax:0,recoverableTax:0,vendor:'QA Vendor',status:'Ordered',exceptionReason:'Test of early Wednesday preparation',paymentTerms:'Balance on credit next window',creditDays:7,buyerName:'Bilara Group',buyerAddress:'QA address',buyerGstin:'QA GST',vendorAddress:'QA supplier address',vendorGstin:'QA vendor GST',vendorContact:'QA contact',shipTo:'Project 998 site',orderTerms:'QA delivery terms'};
await post(buy,400);
await post({...p,boqQty:100,boqRate:330,boqOwner:'Jithin',stage:'BOQ priced'});p=await read(p.id);
await post({...p,boqRate:300},400);
await post({...p,stage:'Vendors finalized',vendor:'QA Vendor',quoteRate:350,quoteReference:'QA quotation'});p=await read(p.id);
await post({...p,stage:'Audit approved',auditOwner:'QA auditor',reviewNote:'Rates and demand confirmed'});p=await read(p.id);
await post({window:p.window,project:p.project,exceptionReason:'QA early preparation'},400,'forecast');
const po=await post(buy);let b=await read(po.id);assert.ok(b.po.startsWith('PO-20261001-'));assert.equal(b.total,3510000);for(const field of ['buyerName','buyerAddress','buyerGstin','vendorAddress','vendorGstin','vendorContact','shipTo','orderTerms'])assert.equal(b[field],buy[field]);
await post({...buy,qty:101},400);await post({...buy,qty:1},400);
let auto=(await records()).find(r=>r.kind==='payment'&&r.parent===b.id);ids.push(auto.id);assert.equal(auto.due,'2026-10-09');assert.equal(auto.window,'2026-10-08');
await post({...auto,due:'2026-10-08',window:'2026-10-01'},400);const first={id:auto.id};await post({...auto,amount:10000,due:'2026-10-01',window:'2026-10-01'});
const pay={kind:'payment',parent:b.id,project:p.project,item:p.item,vendor:'QA Vendor',entity:'GROUP',category:'Material',amount:10000,due:'2026-10-01',window:'2026-10-01'};
await post({...pay,amount:25100,window:'2026-10-08',due:'2026-10-08'});
let payment=await read(first.id);await post({action:'settle',paymentMode:'Account Transfer',accountsBy:'QA accounts',id:payment.id,version:payment.version,amount:1000,date:w.indiaToday(),reference:'QA receipt'});
const snapshot=await post({window:p.window,project:p.project,exceptionReason:'QA early preparation'},200,'forecast');
const data=w.weekData(snapshot.records,'2026-10-01','998');assert.equal(data.total,900000);assert.equal(data.payments.length,1);
const bytes=await backupFiles(snapshot);fs.writeFileSync(dir+'/backup.zip',bytes);const zip=await JSZip.loadAsync(bytes);assert.ok(zip.file('Full data backup.json'));const wb=new ExcelJS.Workbook();await wb.xlsx.load(await zip.file('Payment Forecast 2026-10-01.xlsx').async('nodebuffer'));const sheet=wb.worksheets[0];assert.equal(sheet.getCell('A2').value,998);assert.equal(sheet.getCell('C2').value,10000);assert.equal(sheet.getCell('D2').value.result,9000);assert.equal(sheet.getCell('J2').value,'QA receipt');assert.equal(sheet.getCell('K2').value,1000);
const pw=new ExcelJS.Workbook();await pw.xlsx.load(await zip.file('Purchase Plan 2026-10-01.xlsx').async('nodebuffer'));assert.equal(pw.worksheets[0].getCell('F2').value,100);assert.equal(pw.worksheets[0].getCell('J2').value,350);assert.equal(pw.worksheets[0].getCell('Z2').value.result,35100);
payment=await read(first.id);await post({...payment,amount:9000});const stored=await (await fetch('http://localhost:3000/api/forecast?id='+snapshot.snapshotId)).json();assert.equal(w.weekData(stored.records,p.window,p.project).total,900000);
// Cleanup only UUIDs created by this test; never production data.
const createdIds=[...new Set(ids)];fs.writeFileSync(dir+'/cleanup.sql',`DELETE FROM history WHERE record_id IN (${createdIds.map(id=>"'"+id+"'").join(',')});\nDELETE FROM records WHERE id IN (${createdIds.map(id=>"'"+id+"'").join(',')});\nDELETE FROM forecasts WHERE id='${snapshot.snapshotId}';`);
console.log('PASS: Thursday boundaries, year rollover, ordered review stages, immutable BOQ, generated PO, credit-window separation, partial-payment forecast, immutable snapshot, original-column XLSX backup and receipt reconciliation.');



