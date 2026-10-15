import {readFileSync} from 'node:fs';
// Demo data for learning the request → payment workflow on a LOCAL copy.
//
//   1. bash setup-local.sh        (once)
//   2. npm run dev                (leave running)
//   3. node scripts/seed-demo.mjs (in a second terminal)
//
// It only talks to http://localhost and refuses any other address, so it can
// never touch the live site. It adds demo people (emails end in @demo.test),
// demo projects 901 and 902, and one item at every stage of the workflow.

const BASE=(process.env.BILARA_URL||'http://localhost:3000').replace(/\/$/,'');
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname)){console.error('Refusing to run: demo data is only for a local copy (http://localhost).');process.exit(1);}
const ADMIN='seedy@sites.test';

async function call(route,body,email=ADMIN,form){
 const headers={'x-bilara-test-user-email':email,'x-bilara-test-user-id':email};if(!form)headers['content-type']='application/json';
 let res;try{res=await fetch(BASE+'/api/'+route,{method:body||form?'POST':'GET',headers,body:form||(body?JSON.stringify(body):undefined)});}
 catch{console.error(`\nCannot reach ${BASE}. Start the app first with: npm run dev`);process.exit(1);}
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(`${route}: ${data.error||res.status}`);return data;
}
const records=async()=>(await call('records')).records;
const get=async id=>(await records()).find(r=>r.id===id);
const uuid=()=>crypto.randomUUID();
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const thursday=s=>{const d=new Date(s+'T00:00:00Z');return add(s,-((d.getUTCDay()+3)%7));};
// Next standard planned week: first Thursday whose cut-off (12 days before, 9 a.m. IST) is still ahead.
let W=add(thursday(today),7);while(new Date(add(W,-12)+'T09:00:00+05:30')<=new Date())W=add(W,7);

const P={pm:'pm@demo.test',boq:'boq@demo.test',buy:'purchase@demo.test',audit:'audit@demo.test',gm:'gm@demo.test',acc:'accounts@demo.test',se1:'se1@demo.test',se2:'se2@demo.test',qc:'qc@demo.test',qc2:'qc2@demo.test',labour:'labour@demo.test'};
const people=[[P.pm,'Demo PM (Biju)',['Project Manager']],[P.boq,'Demo BOQ (Subha)',['BOQ Team']],[P.buy,'Demo Purchase (Jithin)',['Purchase Manager']],[P.audit,'Demo Audit (Rijila)',['Audit']],[P.gm,'Demo GM (Sachin)',['GM']],[P.acc,'Demo Accounts (Gokul)',['Accounts']],[P.se1,'Demo SE (Sandeep)',['Site Engineer']],[P.se2,'Demo SE (Arun)',['Site Engineer']],[P.qc,'Demo QC (Anu)',['QC']],[P.qc2,'Demo QC (Meera)',['QC']],[P.labour,'Demo Labour manager (Jiby)',['Labour Manager']]];

const PDF=new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
async function upload(type,project,window,vendor,recordIds,reference,email){
 const form=new FormData();form.append('file',new File([PDF],reference+'.pdf',{type:'application/pdf'}));
 form.append('metadata',JSON.stringify({project,window,type,vendor,uploadedBy:'Demo data',reference,recordIds}));
 return (await call('documents',null,email,form)).id;
}

// ---- workflow steps, each performed by the role that does it in real life ----
let seq=0;
async function raise(project,item,unit,qty,window=W,extra={}){seq++;
 return (await call('records',{kind:'plan',project,item,unit,milestone:extra.milestone||'1',activity:String(extra.activity||((seq-1)%20)+1),activityName:extra.activityName||'Foundation',activityBoqQty:qty,boqQty:qty,owner:'Jithin',itemCategory:'Materials',window,due:window,requestBatchId:'demo-'+seq,notes:extra.notes||''},P.pm)).id;}
async function boqPrice(id,rate){const r=await get(id);await call('records',{id,version:r.version,boqOriginalRate:rate,targetDiscountPercent:5,boqOwner:'Subha'},P.boq);}
async function boqRelease(id,who=P.boq){const r=await get(id);await call('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'Within the activity BOQ quantity',confirmed:true},who);}
async function quote(id,vendor,rate,ref,send=true){const r=await get(id);await call('records',{id,version:r.version,vendor,vendorPhone:'98470 12345',quoteRate:rate,quoteReference:ref,entity:'GROUP',...(send?{stage:'Vendors finalized'}:{})},P.buy);}
async function audit(id,decision,note){const r=await get(id);await call('audit-decision',{ids:[id],versions:{[id]:r.version},decision,note,confirmed:true},P.audit);}
async function order(id,creditDays){const r=await get(id);await call('orders',{orderId:uuid(),items:[{id,version:r.version,qty:r.boqQty}],creditDays,exceptionReason:'Demo data created outside the Wednesday PO day'},P.buy);return (await records()).find(x=>x.kind==='purchase'&&x.parent===id);}
async function deliver(buy,grn,se,received,accepted){await call('grn',{action:'receive',grnNo:grn,date:today,challan:'CH-'+grn.slice(-4),vehicle:'KL-07-AB-1234',items:[{id:buy.id,version:buy.version,received:received??buy.qty,accepted:accepted??received??buy.qty,note:received!==accepted?'Some damaged in unloading':''}]},se);return get(buy.id);}
async function billCheck(buy,billNo,qty,rate,amount){const b=await get(buy.id);await call('bill-check',{id:buy.id,version:b.version,action:'add',billNo,billDate:today,qty,rate,amount},P.acc);return get(buy.id);}
async function pay(buy,mode,ref,receipt){const s=(await records()).find(x=>x.kind==='payment'&&x.parent===buy.id&&x.basis==='GRN');
 await call('accounts',{batchId:uuid(),paymentMode:mode,date:today,accountsBy:'Demo Accounts',reference:ref,payments:[{id:s.id,version:s.version,amount:(s.total-s.paid)/100}],...(receipt?{receiptId:receipt}:{})},P.acc);}

// ---- plumbing & electrical: photo → quotes → BOQ → Audit → PO ----
async function photo(file,project,window,recordId,email,reference,type='Site list',vendor='Plumbing'){
 const form=new FormData();const png=readFileSync(new URL('./'+file,import.meta.url));
 form.append('file',new File([png],file,{type:'image/png'}));form.append('metadata',JSON.stringify({project,window,type,vendor,uploadedBy:'Demo data',reference,recordIds:[recordId]}));
 return (await call('documents',null,email,form)).id;
}
async function seedQuotes(){
 if((await records()).some(r=>r.kind==='quote'&&['901','902'].includes(r.project))){console.log('  · Plumbing & electrical demo already loaded');return;}
 const qv=async id=>(await get(id)).version;const q=(id,body,email)=>call('quotes',{id,...body},email);
 for(const [project,trade,amount] of [['901','Plumbing',250000],['901','Electrical',180000],['902','Plumbing',220000],['902','Electrical',160000]])
  await call('quotes',{action:'budget',project,trade,amount,note:'Per-house estimate',version:(await records()).find(r=>r.kind==='budget'&&r.sourceId===`budget:${project}:${trade}`)?.version||0},P.boq);
 const need=add(W,2);
 // 902 electrical: just uploaded by the site; Purchase's turn.
 const e=await call('quotes',{action:'create',project:'902',trade:'Electrical',neededBy:need,activity:'Ground floor wiring',note:'Client wants Havells switches'},P.se2);
 await photo('demo-electrical-list.png','902',e.window,e.id,P.se2,'GF wiring list','Site list','Electrical');
 // 901 plumbing: three quotes, with BOQ to choose.
 const pl=await call('quotes',{action:'create',project:'901',trade:'Plumbing',neededBy:need,activity:'First floor bathrooms',note:'Plumber Shaji\'s list'},P.se1);
 await photo('demo-plumbing-list.png','901',pl.window,pl.id,P.se1,'FF bathroom list');
 await q(pl.id,{action:'typedList',version:await qv(pl.id),lines:[{item:'CPVC pipe SDR-11',size:'3/4"',qty:36,unit:'MTR'},{item:'CPVC elbow',size:'3/4"',qty:18,unit:'NOS'},{item:'CPVC tee',size:'3/4"',qty:8,unit:'NOS'},{item:'CPVC brass elbow',size:'3/4 x 1/2"',qty:24,unit:'NOS'},{item:'CPVC pipe SDR-11',size:'1"',qty:12,unit:'MTR'},{item:'Ball valve',size:'1"',qty:12,unit:'NOS'},{item:'SWR pipe',size:'4"',qty:15,unit:'MTR'},{item:'SWR door tee',size:'4"',qty:3,unit:'NOS'},{item:'Air cowl',size:'2"',qty:9,unit:'NOS'},{item:'Concealed diverter body (Jaquar)',size:'',qty:3,unit:'NOS'},{item:'Concealed cistern with frame',size:'',qty:3,unit:'NOS'},{item:'Teflon tape',size:'10 m',qty:20,unit:'NOS'},{item:'Solvent cement',size:'100 ml',qty:8,unit:'NOS'}]},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Local Pipes & Fittings',phone:'98470 11111',amount:61200,brands:'Local CPVC, unbranded cistern',creditDays:0,notes:'No ISI mark on pipes'},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Kollamkudiyil Agencies',phone:'95447 17661',amount:69563,brands:'Supreme ISI pipes, Jaquar diverter',reference:'B 2562',creditDays:7},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Premium Sanitary House',phone:'98470 22222',amount:84900,brands:'Ashirvad pipes, Kohler cistern',creditDays:10},P.buy);
 await q(pl.id,{action:'sendToBoq',version:await qv(pl.id)},P.buy);
 // 902 plumbing: BOQ chose a better brand, Audit approved; Purchase can issue the PO.
 const p2=await call('quotes',{action:'create',project:'902',trade:'Plumbing',neededBy:need,activity:'Kitchen and utility',note:''},P.se2);
 await photo('demo-plumbing-list.png','902',p2.window,p2.id,P.se2,'Kitchen list');
 await q(p2.id,{action:'addQuote',version:await qv(p2.id),vendor:'Aluva Pipe House',amount:38500,brands:'Finolex pipes',creditDays:0},P.buy);
 await q(p2.id,{action:'addQuote',version:await qv(p2.id),vendor:'Kollamkudiyil Agencies',amount:41200,brands:'Supreme pipes, Jaquar taps',creditDays:7},P.buy);
 await q(p2.id,{action:'sendToBoq',version:await qv(p2.id)},P.buy);
 const chosen=(await get(p2.id)).quotes.find(x=>x.vendor==='Kollamkudiyil Agencies');
 await q(p2.id,{action:'select',version:await qv(p2.id),quoteId:chosen.id,reason:'Jaquar taps as per client spec; only ₹2,700 more and 7 days credit'},P.boq);
 await q(p2.id,{action:'audit',version:await qv(p2.id),decision:'Approved',note:'Within budget'},P.audit);
 done('Plumbing & electrical: budgets set; one list waiting for quotes, one with BOQ to choose, one approved and ready for PO');
}

const steps=[];const done=(label)=>{steps.push(label);console.log('  ✓ '+label);};
try{
 const existing=(await call('projects')).projects||[];
 // People are added even when the demo is already loaded, so new demo roles appear after an update.
 {const users=(await call('users')).users||[];for(const [email,name,roles] of people)if(!users.some(u=>u.email===email))await call('users',{email,name,roles,projects:[],active:1,version:0});}
 if(existing.some(p=>['901','902'].includes(p.project))&&(await records()).some(r=>['901','902'].includes(r.project))){console.log('Demo data is already loaded (projects 901 and 902).');await seedQuotes();console.log('Open http://localhost:3000.');process.exit(0);}
 console.log(`Loading demo data into ${BASE} for the execution week starting Thursday ${W}…`);
 const users=(await call('users')).users||[];
 for(const [email,name,roles] of people)if(!users.some(u=>u.email===email))await call('users',{email,name,roles,projects:[],active:1,version:0});
 const ver=p=>existing.find(x=>x.project===p)?.version||0;
 await call('projects',{project:'901',name:'Demo – Kakkanad Villa',site:'Kakkanad',managerEmail:P.pm,qcEmail:P.qc,engineerEmails:[P.se1],active:1,version:ver('901')});
 await call('projects',{project:'902',name:'Demo – Aluva House',site:'Aluva',managerEmail:P.pm,qcEmail:'',engineerEmails:[P.se2],active:1,version:ver('902')});
 done('People (PM, BOQ, Purchase, Audit, GM, Accounts, 2 site engineers, QC) and projects 901 / 902');

 // 1. Just raised by the PM — waiting for the BOQ team.
 await raise('901','Laterite Stone','NOS',2000,W,{activityName:'Basement wall'});
 await raise('902','Red Bricks','NOS',3000,add(W,7),{activityName:'Ground floor walls'});
 done('Step 1 · PM requests waiting for BOQ check (Laterite Stone; Red Bricks for the following week)');

 // 2. Late request (inside the cut-off) — needs the GM.
 const late=await raise('902','Hitachi','HOUR',16,add(W,-7),{activityName:'Excavation',notes:'Raised after the Saturday cut-off'});
 await boqPrice(late,1400);
 done('Step 1b · Late request waiting for GM approval (Hitachi, week '+add(W,-7)+')');

 // 3. BOQ approved — waiting for Purchase to enter vendor rates.
 const psand=await raise('901','PSand','CFT',400,W,{activityName:'Plastering prep'});await boqPrice(psand,64);await boqRelease(psand);
 done('Step 2 · BOQ approved, waiting for Purchase rates (PSand)');

 // 4. With Audit — one below BOQ, one above.
 const metal=await raise('901','20 mm Metal','CFT',300,W,{activityName:'Footing concrete'});await boqPrice(metal,52);await boqRelease(metal);await quote(metal,'Periyar Crushers',48,'PC-2211');
 const steel=await raise('902','12 mm Steel','KG',900,W,{activityName:'Column reinforcement'});await boqPrice(steel,78);await boqRelease(steel);await quote(steel,'Sree Steels',81,'SS-4410');
 done('Step 3 · Purchase plan sent to Audit (20 mm Metal below BOQ; 12 mm Steel above BOQ, flagged red)');

 // 5. Sent back by Audit for a better rate.
 const steel16=await raise('902','16 mm Steel','KG',600,W,{activityName:'Beam reinforcement'});await boqPrice(steel16,77);await boqRelease(steel16);await quote(steel16,'Sree Steels',80,'SS-4411');
 await audit(steel16,'Returned','Above BOQ rate of 77. Negotiate and resend.');
 done('Step 3b · Line sent back to Purchase by Audit (16 mm Steel)');

 // 6. Audit approved — ready for a PO.
 const gum=await raise('901','Tile Gum','KG',250,W,{activityName:'Flooring'});await boqPrice(gum,28);await boqRelease(gum);await quote(gum,'Kerala Traders',26,'KT-778');
 await audit(gum,'Approved','Below BOQ. Approved.');
 done('Step 4 · Audit approved, ready for purchase order (Tile Gum)');

 // 7. PO issued, not yet delivered.
 const cement=await raise('901','Cement','BAG',120,W,{activityName:'Footing concrete'});await boqPrice(cement,350);await boqRelease(cement);await quote(cement,'Kerala Traders',320,'KT-775');
 await audit(cement,'Approved','Saving ₹30 per bag. Approved.');await order(cement,7);
 done('Step 5 · Purchase order issued, waiting for delivery (Cement, 7 days credit)');

 // 8. Delivered with GRN + bill; payment due (on credit), not yet paid.
 const msand=await raise('902','MSand','CFT',500,W,{activityName:'Footing concrete'});await boqPrice(msand,62);await boqRelease(msand);await quote(msand,'Periyar Crushers',57,'PC-2209');
 await audit(msand,'Approved','Approved.');let buy=await order(msand,10);buy=await deliver(buy,'GRN-902-0001',P.se2,500,480);
 await upload('Final bill','902',W,'Periyar Crushers',[buy.id],'PC-BILL-5521',P.buy);
 done('Step 6 · Site engineer GRN: 500 CFT arrived, 480 accepted, 20 rejected (MSand). Payment scheduled for 480 only, due in 10 days; bill waiting for Accounts to check');

 // 9. Fully paid and closed.
 const blocks=await raise('901','Solid Cement Blocks 12 x 8 x 6','NOS',1500,W,{activityName:'Basement wall'});await boqPrice(blocks,48);await boqRelease(blocks);await quote(blocks,'Kerala Traders',44,'KT-770');
 await audit(blocks,'Approved','₹4 per block below BOQ. Approved.');buy=await order(blocks,0);buy=await deliver(buy,'GRN-901-0001',P.se1);
 buy=await billCheck(buy,'KT-BILL-3301',1500,44,66000);
 await upload('Final bill','901',W,'Kerala Traders',[buy.id],'KT-BILL-3301',P.buy);
 const receipt=await upload('Payment receipt','901',W,'Kerala Traders',[buy.id],'UPI-RCPT-8891',P.acc);
 await pay(buy,'UPI','UPI-REF-889120',receipt);
 const b=await get(blocks);await call('closure',{id:blocks,version:b.version,action:'close',reason:'Delivered, billed and paid in full',confirmed:true},P.buy);
 done('Step 7 · GRN by site, bill matched by Accounts, paid by UPI with receipt and closed (Solid Cement Blocks)');

 // 10. Rejected by Audit.
 const shut=await raise('901','Shuttering Items','LOT',1,W,{activityName:'Formwork'});await boqPrice(shut,18000);await boqRelease(shut);await quote(shut,'Metro Rentals',23500,'MR-019');
 await audit(shut,'Rejected','Far above BOQ. Use company shuttering stock instead.');
 done('Step 8 · Rejected by Audit (Shuttering Items)');

 await seedQuotes();

 const pays=(await records()).filter(r=>r.kind==='payment'&&r.status!=='Cancelled'&&['901','902'].includes(r.project));
 const payWeeks=pays.map(r=>`  ${r.item}: due ${r.due} → Payment forecast week ${r.window}${r.paid>=r.total?' (paid)':''}${r.basis==='GRN'?' · for goods received':' · forecast for goods still to come'}`).join('\n');
 console.log(`\nPayments:\n${payWeeks}`);
 console.log(`
Done. Open http://localhost:3000. The Weeks filter shows the next 4 weeks; demo work is in the week of ${W}.
Use "Testing as" (bottom-left) to switch between the demo people:
  Demo PM (Biju)          → Purchase requests: raise a request
  Demo BOQ (Subha)        → Purchase requests: BOQ release queue at the top
  Demo GM (Sachin)        → Purchase requests: late request (week ${add(W,-7)})
  Demo Purchase (Jithin)  → Purchase plan, Purchase orders
  Demo SE (Sandeep / Arun)→ Receive goods (GRN)
  Demo Audit (Rijila)     → Audit review: savings, approve / send back
  Demo Accounts (Gokul)   → Payment forecast: check bills, record payment
  Plumbing & electrical   → SE uploads a list photo, Purchase adds quotes, BOQ chooses, Audit approves
Demo projects are 901 and 902; your own projects are not touched.`);
}catch(e){console.error('\nDemo data stopped: '+e.message+'\nSteps completed: '+steps.length);process.exit(1);}
