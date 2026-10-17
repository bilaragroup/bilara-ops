import {readFileSync} from 'node:fs';
// Demo data for learning the whole Bilara workflow on a LOCAL copy.
//
//   1. bash setup-local.sh          (once; applies the database tables)
//   2. npm run demo:reset           (optional: removes ALL data from the local copy first)
//   3. npm run dev                  (leave running)
//   4. npm run seed:demo            (in a second terminal)
//
// It only talks to http://localhost and refuses any other address, so it can never touch
// the live site. Every step is done by the person who does it in real life (PM, BOQ,
// Purchase, Audit, Site Engineer, Accounts, QC), through the same API the screens use,
// so the data is exactly what the app would have after a real week. Sample documents
// (quotation, delivery challan, tax invoice, payment receipt) and site photos are attached.
// The guide that walks through it is docs/demo-walkthrough.md.

const BASE=(process.env.BILARA_URL||'http://localhost:3000').replace(/\/$/,'');
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname)){console.error('Refusing to run: demo data is only for a local copy (http://localhost).');process.exit(1);}
const ADMIN=process.env.BILARA_ADMIN||'seedy@sites.test';

async function call(route,body,email=ADMIN,form,now){
 const headers={'x-bilara-test-user-email':email,'x-bilara-test-user-id':email};if(!form)headers['content-type']='application/json';if(now)headers['x-bilara-test-now']=now;
 let res;try{res=await fetch(BASE+'/api/'+route,{method:body||form?'POST':'GET',headers,body:form||(body?JSON.stringify(body):undefined)});}
 catch{console.error(`\nCannot reach ${BASE}. Start the app first with: npm run dev`);process.exit(1);}
 const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(`${route}${body?.action?' '+body.action:''}: ${data.error||res.status}`);return data;
}
const site=async(action,arg,email,now)=>(await call('site',{action,args:Array.isArray(arg)?arg:[arg]},email,null,now)).value;
const records=async()=>(await call('records')).records;
const get=async id=>(await records()).find(r=>r.id===id);
const uuid=()=>crypto.randomUUID();
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const at=(day,hhmm)=>new Date(day+'T'+hhmm+':00+05:30').toISOString();
const thursday=s=>{const d=new Date(s+'T00:00:00Z');return add(s,-((d.getUTCDay()+3)%7));};
// Demo week: the first Thursday at least 14 days away (a planned delivery needs 14 days).
const W=(()=>{const e=add(today,14);return thursday(e)===e?e:add(thursday(e),7);})();

const P={pm:'pm@demo.test',boq:'boq@demo.test',buy:'purchase@demo.test',audit:'audit@demo.test',gm:'gm@demo.test',acc:'accounts@demo.test',se1:'se1@demo.test',se2:'se2@demo.test',qc:'qc@demo.test',qc2:'qc2@demo.test',labour:'labour@demo.test'};
const people=[[P.pm,'Demo PM (Biju)',['Project Manager']],[P.boq,'Demo BOQ (Subha)',['BOQ Team']],[P.buy,'Demo Purchase (Jithin)',['Purchase Manager']],[P.audit,'Demo Audit (Rijila)',['Audit']],[P.gm,'Demo GM (Sachin)',['GM']],[P.acc,'Demo Accounts (Gokul)',['Accounts']],
 [P.se1,'Demo SE (Sandeep)',['Site Engineer']],[P.se2,'Demo SE (Arun)',['Site Engineer']],[P.qc,'Demo QC (Anu)',['QC']],[P.qc2,'Demo QC (Meera)',['QC']],[P.labour,'Demo Labour manager (Jiby)',['Labour Manager']]];

// ---------- sample documents ----------
/** A one-page PDF with the given lines of text (a real, openable document). */
function pdf(title,lines){
 const esc=t=>String(t).replace(/[\\()]/g,m=>'\\'+m);
 const body=['BT /F2 16 Tf 56 780 Td ('+esc(title)+') Tj ET',...lines.map((l,i)=>`BT /F1 11 Tf 56 ${748-i*18} Td (${esc(l)}) Tj ET`),'BT /F1 9 Tf 56 60 Td (Sample document created by the Bilara demo data. Not a real bill.) Tj ET'].join('\n');
 const objs=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>','<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R/F2 5 0 R>>>>/Contents 6 0 R>>',
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>','<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>',`<</Length ${body.length}>>\nstream\n${body}\nendstream`];
 let out='%PDF-1.4\n';const offs=[];objs.forEach((o,i)=>{offs.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const x=out.length;out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offs.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<</Size ${objs.length+1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
 return new TextEncoder().encode(out);
}
async function upload({type,project,window,vendor,recordIds,reference,email,file,bytes,mime='application/pdf'}){
 const form=new FormData();form.append('file',new File([bytes],file,{type:mime}));
 form.append('metadata',JSON.stringify({project,window,type,vendor,uploadedBy:'Demo data',reference,recordIds}));
 return (await call('documents',null,email,form)).id;
}
const asset=n=>readFileSync(new URL('./demo-assets/'+n,import.meta.url));
const photo=n=>({name:n,mimeType:'image/jpeg',data:'data:image/jpeg;base64,'+asset(n).toString('base64')});

// ---------- purchasing steps, each by the person who does it ----------
async function raise(project,item,unit,qty,window,activity,extra={}){
 return (await call('records',{kind:'plan',project,item,unit,milestone:extra.milestone,activity:String(activity),activityName:extra.activityName||'',boqQty:qty,owner:'Jithin',itemCategory:extra.category||'Materials',window,due:extra.due||add(window,1),requestBatchId:uuid(),notes:extra.notes||''},P.pm)).id;
}
// BOQ confirms the approved activity quantity (the rate comes from the rate card) and releases.
async function boqApprove(id,activityQty,release=true){let r=await get(id);await call('records',{id,version:r.version,activityBoqQty:activityQty,boqOwner:'Subha',...(r.boqOriginalRate?{}:{boqOriginalRate:r.boqRate||1,targetDiscountPercent:5})},P.boq);
 if(release){r=await get(id);await call('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'Within the activity BOQ quantity',confirmed:true},P.boq);}}
async function quote(id,vendor,phone,rate,ref,send=true){const r=await get(id);await call('records',{id,version:r.version,vendor,vendorPhone:phone,quoteRate:rate,quoteReference:ref,entity:'GROUP',...(send?{stage:'Vendors finalized'}:{})},P.buy);}
async function audit(id,decision,note){const r=await get(id);await call('audit-decision',{ids:[id],versions:{[id]:r.version},decision,note,confirmed:true},P.audit);}
async function order(id,creditDays){const r=await get(id);await call('orders',{orderId:uuid(),items:[{id,version:r.version,qty:r.boqQty}],creditDays,exceptionReason:'Demo data created outside the Wednesday PO day'},P.buy);return (await records()).find(x=>x.kind==='purchase'&&x.parent===id);}
// The site engineer receives goods against the PO (GRN number is generated; stock goes up).
async function receive(buy,se,received,accepted,materialCode,inputUnit,challan,measure={}){
 const v=await site('receivePurchaseOrder',{projectId:buy.project,clientRequestId:'demo-grn-'+buy.id,receivedDate:today,vehicleNo:'KL-07-BX-4412',deliveryNoteNo:challan,siteGrnBookNo:'',qualityDeclarationAccepted:true,
  poLines:[{id:buy.id,version:buy.version,received,accepted,materialCode,inputUnit,...measure}]},se);
 return {grn:v.lastRecordedGrn,buy:await get(buy.id)};
}
async function billCheck(buy,billNo,qty,rate,amount,documentId){const b=await get(buy.id);await call('bill-check',{id:buy.id,version:b.version,action:'add',billNo,billDate:today,qty,rate,amount,documentId},P.acc);return get(buy.id);}
async function pay(buy,mode,ref,receipt){const s=(await records()).find(x=>x.kind==='payment'&&x.parent===buy.id&&x.basis==='GRN');
 await call('accounts',{batchId:uuid(),paymentMode:mode,date:today,accountsBy:'Demo Accounts',reference:ref,payments:[{id:s.id,version:s.version,amount:(s.total-s.paid)/100}],...(receipt?{receiptId:receipt}:{})},P.acc);}

const steps=[];const done=label=>{steps.push(label);console.log('  ✓ '+label);};

// ---------- plumbing & electrical: photo → quotes → BOQ → Audit → PO ----------
async function seedQuotes(){
 const qv=async id=>(await get(id)).version;const q=(id,body,email)=>call('quotes',{id,...body},email);
 for(const [project,trade,amount] of [['901','Plumbing',250000],['901','Electrical',180000],['902','Plumbing',220000],['902','Electrical',160000]])
  await call('quotes',{action:'budget',project,trade,amount,note:'Per-house estimate',version:(await records()).find(r=>r.kind==='budget'&&r.sourceId===`budget:${project}:${trade}`)?.version||0},P.boq);
 const need=add(W,2);
 const listPhoto=async(file,project,window,id,email,reference,vendor)=>upload({type:'Site list',project,window,vendor,recordIds:[id],reference,email,file,bytes:readFileSync(new URL('./'+file,import.meta.url)),mime:'image/png'});
 // 902 electrical: just uploaded by the site; Purchase's turn.
 const e=await call('quotes',{action:'create',project:'902',trade:'Electrical',neededBy:need,activity:'Ground floor wiring',note:'Client wants Havells switches'},P.se2);
 await listPhoto('demo-electrical-list.png','902',e.window,e.id,P.se2,'GF wiring list','Electrical');
 // 901 plumbing: three quotes, with BOQ to choose.
 const pl=await call('quotes',{action:'create',project:'901',trade:'Plumbing',neededBy:need,activity:'First floor bathrooms',note:'Plumber Shaji\'s list'},P.se1);
 await listPhoto('demo-plumbing-list.png','901',pl.window,pl.id,P.se1,'FF bathroom list','Plumbing');
 await q(pl.id,{action:'typedList',version:await qv(pl.id),lines:[{item:'CPVC pipe SDR-11',size:'3/4"',qty:36,unit:'MTR'},{item:'CPVC elbow',size:'3/4"',qty:18,unit:'NOS'},{item:'CPVC tee',size:'3/4"',qty:8,unit:'NOS'},{item:'Concealed diverter',size:'',qty:2,unit:'NOS'}]},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Local Pipes & Fittings',phone:'98470 11111',amount:61200,brands:'Local CPVC, unbranded cistern',creditDays:0,notes:'No ISI mark on pipes'},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Kollamkudiyil Agencies',phone:'95447 17661',amount:69563,brands:'Supreme ISI pipes, Jaquar diverter',reference:'B 2562',creditDays:7},P.buy);
 await upload({type:'Vendor quote',project:'901',window:pl.window,vendor:'Kollamkudiyil Agencies',recordIds:[pl.id],reference:'B 2562',email:P.buy,file:'Kollamkudiyil quotation B 2562.pdf',
  bytes:pdf('Kollamkudiyil Agencies - Quotation B 2562',['To: Bilara Group, Project 901 (Kakkanad Villa)','Date: '+today,'','CPVC pipe SDR-11 3/4"   36 MTR   @ 410.00   14,760.00','CPVC elbow 3/4"          18 NOS   @  38.50      693.00','CPVC tee 3/4"             8 NOS   @  46.00      368.00','Jaquar concealed diverter 2 NOS @ 26,871.00 53,742.00','','Total (incl. GST): Rs 69,563.00','Credit: 7 days. Validity: 15 days.'])},P.buy);
 await q(pl.id,{action:'addQuote',version:await qv(pl.id),vendor:'Premium Sanitary House',phone:'98470 22222',amount:84900,brands:'Ashirvad pipes, Kohler cistern',creditDays:10},P.buy);
 await q(pl.id,{action:'sendToBoq',version:await qv(pl.id)},P.buy);
 // 902 plumbing: BOQ chose a better brand, Audit approved; Purchase can issue the PO.
 const p2=await call('quotes',{action:'create',project:'902',trade:'Plumbing',neededBy:need,activity:'Kitchen and utility',note:''},P.se2);
 await listPhoto('demo-plumbing-list.png','902',p2.window,p2.id,P.se2,'Kitchen list','Plumbing');
 await q(p2.id,{action:'addQuote',version:await qv(p2.id),vendor:'Aluva Pipe House',amount:38500,brands:'Finolex pipes',creditDays:0},P.buy);
 await q(p2.id,{action:'addQuote',version:await qv(p2.id),vendor:'Kollamkudiyil Agencies',amount:41200,brands:'Supreme pipes, Jaquar taps',creditDays:7},P.buy);
 await q(p2.id,{action:'sendToBoq',version:await qv(p2.id)},P.buy);
 const chosen=(await get(p2.id)).quotes.find(x=>x.vendor==='Kollamkudiyil Agencies');
 await q(p2.id,{action:'select',version:await qv(p2.id),quoteId:chosen.id,reason:'Jaquar taps as per client spec; only Rs 2,700 more and 7 days credit'},P.boq);
 await q(p2.id,{action:'audit',version:await qv(p2.id),decision:'Approved',note:'Within budget'},P.audit);
 done('Plumbing & electrical: budgets; a list waiting for quotes (902 electrical), three quotes for BOQ to choose (901 plumbing), one approved and ready for PO (902 plumbing)');
}

// ---------- site work: stock, daily reports, quality checks ----------
async function openingStock(){
 // Opening stock counted on both sites four days ago.
 for(const [p,lines] of [['901',[['CEMENT',40,20],['CEMENT_BLOCK_6_INCH',600,300],['M_SAND',300,100]]],['902',[['CEMENT',60,40],['CEMENT_BLOCK_6_INCH',3000,500],['M_SAND',200,100]]]])
  await site('recordInitialSiteStock',{projectId:p,clientRequestId:'demo-open-'+p,siteEngineerVerified:true,verifiedBy:p==='901'?'Sandeep':'Arun',notes:'Opening count',lines:lines.map(([materialCode,quantity,threshold])=>({materialCode,quantity,threshold}))},P.pm,at(add(today,-4),'08:00'));
 done('Site stock: opening count on 901 and 902 (cement, 6-inch blocks, M-sand)');
}
async function seedSite(){

 // Three finished days on 902 (Site Engineer Arun): PM target the evening before, morning headcount, end-of-day report with photos.
 for(const [i,day,done1,pct] of [[0,add(today,-3),160,90],[1,add(today,-2),175,100],[2,add(today,-1),120,70]]){
  await site('saveDprPlan',{projectId:'902',workDate:day,clientRequestId:'demo-plan-902-'+i,expectedPlanVersion:0,plannedMasons:4,plannedLabourers:4,plannedShiftCode:'8',plannedVendor:'Ravi Labour',
   targets:[{activityCategory:'BRICKWORK',floor:'FIRST_FLOOR',workStage:'UP_TO_LINTEL',materialType:'6-inch cement blocks',workArea:'Bedrooms',measurementType:'QUANTITY',unit:'sq ft',plannedTarget:180,plannedHours:8,plannedActivityMasons:2,plannedActivityLabourers:2,pmRemarks:'Full wall height'},
    {activityCategory:'OTHER',activityNumber:39,floor:'GROUND_FLOOR',workArea:'Hall',measurementType:'PERCENTAGE',plannedTarget:100,plannedHours:8,plannedActivityMasons:2,plannedActivityLabourers:2,pmRemarks:'Conduit routes'}]},P.pm,at(add(day,-1),'17:00'));
  await site('saveDprMorning',{projectId:'902',workDate:day,masons:4,labourers:4,actualShiftCode:'8',actualVendor:'Ravi Labour'},P.se2,at(day,'09:00'));
  // Three live check-ins (morning, noon, evening) with a photo, labour and progress.
  for(const [slot,hm,note] of [['MORNING','09:15','Masons started on bedroom walls'],['NOON','13:10','Walls half way to lintel'],['EVENING','17:40','Day work complete, area cleaned']])
   await site('saveDprCheckin',{projectId:'902',workDate:day,slot,clientRequestId:'demo-chk-902-'+i+slot,masons:4,labourers:4,progressNote:note,materials:[],photos:[photo('brickwork.jpg')]},P.se2,at(day,hm));
  const ws=await site('getDprWorkspace',['902',day],P.se2,at(day,'18:00'));
  const [t1,t2]=ws.targets,blocks=ws.materials.find(m=>m.materialCode==='CEMENT_BLOCK_6_INCH');
  await site('saveDprEvening',{projectId:'902',workDate:day,clientRequestId:'demo-eod-902-'+i,wastageReviewed:true,qualityAssuranceAccepted:true,
   results:[{targetId:t1.targetId,actualActivityMasons:2,actualActivityLabourers:2,hoursPerWorker:8,actualQuantity:done1,outputDescription:'Bedroom walls up to lintel',shortfallReason:done1<180?'Late start, blocks shifted from the gate':''},
    {targetId:t2.targetId,actualActivityMasons:2,actualActivityLabourers:2,hoursPerWorker:8,completionPercent:pct,outputDescription:'Conduits in hall',shortfallReason:pct<100?'Two routes redone':''}],
   materials:[{materialKey:blocks.materialKey,usedQuantity:400+i*50}],
   activityPhotos:[{targetId:t1.targetId,photos:[photo('brickwork.jpg'),photo('material.jpg')]},{targetId:t2.targetId,photos:[photo('conduit.jpg'),photo('material.jpg')]}],materialPhotos:[photo('material.jpg')]},P.se2,at(day,i===2?'23:30':'18:30'));
 }
 done('Daily reports: three finished days on 902 (targets, headcount, output, blocks used, photos); the last one filed late at 11:30 pm');
 // Tomorrow's target on 901, set by the PM today.
 await site('saveDprPlan',{projectId:'901',workDate:add(today,1),clientRequestId:'demo-plan-901',expectedPlanVersion:0,plannedMasons:3,plannedLabourers:3,plannedShiftCode:'8',plannedVendor:'Kumar Masonry',
  targets:[{activityCategory:'BRICKWORK',floor:'GROUND_FLOOR',workStage:'UP_TO_LINTEL',materialType:'6-inch cement blocks',workArea:'Living and dining',measurementType:'QUANTITY',unit:'sq ft',plannedTarget:150,plannedHours:8,plannedActivityMasons:3,plannedActivityLabourers:3,pmRemarks:'Keep openings as per drawing A-105'}]},P.pm);
 done("Daily targets: tomorrow's brickwork target on 901 (Sandeep files it tomorrow)");

 // Quality: shared checklist templates, then a checklist inspected with a minor defect and a re-site visit booked.
 const row=(stage,seq,checkpoint,criteria,extra={})=>({Template_Revision:'R01',Stage:stage,Sequence:seq,Checkpoint:checkpoint,Default_Acceptance_Criteria:criteria,Active:'Yes',...extra});
 const LINTEL='Lintel and sunshade',SLAB='Slab before concreting';
 await site('saveTemplateLibrary',[{rows:[row(LINTEL,1,'Lintel rebar as per drawing','4 bars 12 mm, stirrups 8 mm at 150 c/c, 25 mm cover blocks',{Unit:'mm'}),row(LINTEL,2,'Shuttering level and props','Level within 3 mm; props at 600 c/c',{Criticality:'Critical',Photo_Required:'Yes',Hold_Point:'Yes'}),row(LINTEL,3,'Sunshade projection','As per drawing, slope away from wall'),
  row(SLAB,1,'Bottom and top bar spacing','As per structural drawing, tolerance 10 mm'),row(SLAB,2,'Cover blocks','25 mm cover, blocks at 1 m centres',{Criticality:'Critical',Photo_Required:'Yes'}),row(SLAB,3,'Electrical conduits and junction boxes','All boxes fixed and taped before pour'),row(SLAB,4,'Shuttering level and gaps','Level within 5 mm, no gaps over 3 mm')]}],P.pm,at(add(today,-4),'10:00'));
 const items=await site('getTemplateItems',[LINTEL],P.pm,at(add(today,-4),'10:05'));
 const d1=add(today,-2),pub=await site('saveAndPublishProjectChecklist',[{projectId:'901',heading:'GF lintel and sunshade before concreting',stage:LINTEL,checklistRevision:'R01',assignedQcEmail:P.qc,plannedDate:d1,location:'Ground floor front',
  archDrawingRevision:'A-105 Rev 03',structuralDrawingRevision:'S-204 Rev 02',clientRequestId:'demo-checklist-901-lintel',items:items.map(i=>({...i,Acceptance_Criteria:i.Default_Acceptance_Criteria}))}],P.pm,at(add(today,-4),'10:10'));
 const bookingId='BKG-WEB-demo-901-lintel-0001';
 await site('createQcBooking',[{projectId:'901',projectChecklistId:pub.projectChecklistId,qcEmail:P.qc,dates:[d1],notes:'Before concreting at 2 pm',clientRequestId:bookingId}],P.pm,at(add(today,-4),'10:15'));
 await site('respondToQcBooking',[{bookingId,response:'ACCEPTED'}],P.qc,at(add(today,-4),'12:00'));
 const ex=await site('getInspectionForExecution',[pub.projectChecklistId,'',bookingId],P.qc,at(d1,'10:00'));
 await site('uploadQcEvidence',[{bookingId,files:[photo('slab.jpg')]}],P.qc,at(d1,'10:20'));
 const [i1,i2,i3]=ex.items;
 const v1=await site('submitInspection',[{projectChecklistId:pub.projectChecklistId,bookingId,declarationAccepted:true,clientRequestId:'QCI-WEB-demo-901-lintel-v01',startedAt:at(d1,'09:40'),answers:[
  {projectItemId:i1.Project_Item_ID,assessment:'MINOR DEFECT',actualValue:'20',observation:'Cover 20 mm at two front corners; add cover blocks before the pour',photos:[photo('rebar.jpg')]},
  {projectItemId:i2.Project_Item_ID,assessment:'SATISFACTORY',actualValue:'Level within 2 mm',photos:[photo('slab.jpg')]},{projectItemId:i3.Project_Item_ID,assessment:'SATISFACTORY',actualValue:'As drawn'}]}],P.qc,at(d1,'11:00'));
 await site('createReinspectionBooking',[{projectChecklistId:pub.projectChecklistId,qcEmail:P.qc2,dates:[add(today,1)],notes:'Check the corner cover blocks',clientRequestId:'BKG-WEB-demo-901-lintel-0002'}],P.pm,at(add(today,-1),'09:00'));
 done(`Quality checks: templates for two stages; 901 lintel checklist inspected by Anu (${v1.inspectionVersionId}: minor defect, signed report); re-site visit booked with Meera for tomorrow, waiting for her to accept`);
 const slab=await site('getTemplateItems',[SLAB],P.pm);
 const pub2=await site('saveAndPublishProjectChecklist',[{projectId:'902',heading:'FF roof slab before concreting',stage:SLAB,checklistRevision:'R01',assignedQcEmail:P.qc,plannedDate:add(today,3),location:'First floor roof',clientRequestId:'demo-checklist-902-slab',items:slab.map(i=>({...i,Acceptance_Criteria:i.Default_Acceptance_Criteria}))}],P.pm);
 await site('createQcBooking',[{projectId:'902',projectChecklistId:pub2.projectChecklistId,qcEmail:P.qc,dates:[add(today,3)],notes:'Concrete pour planned for the afternoon',clientRequestId:'BKG-WEB-demo-902-slab-0001'}],P.pm);
 await site('addQcUnavailability',[{date:add(today,5),type:'Leave'}],P.qc);
 done('Quality checks: 902 slab checklist booked with Anu (waiting for her to accept); Anu on leave in 5 days');
}

try{
 const existing=(await call('projects')).projects||[];
 // People are added even when the demo is already loaded, so new demo roles appear after an update.
 {const users=(await call('users')).users||[];for(const [email,name,roles] of people)if(!users.some(u=>u.email===email))await call('users',{email,name,roles,projects:[],active:1,version:0});}
 if(existing.some(p=>['901','902'].includes(p.project))&&(await records()).some(r=>['901','902'].includes(r.project))){console.log('Demo data is already loaded (projects 901 and 902). To start again: stop the app, run  npm run demo:reset , start it, run this again.');process.exit(0);}
 console.log(`Loading demo data into ${BASE} for the execution week starting Thursday ${W}…`);
 const ver=p=>existing.find(x=>x.project===p)?.version||0;
 await call('projects',{project:'901',name:'Demo – Kakkanad Villa',site:'Kakkanad',managerEmail:P.pm,qcEmail:P.qc,engineerEmails:[P.se1],active:1,version:ver('901')});
 await call('projects',{project:'902',name:'Demo – Aluva House',site:'Aluva',managerEmail:P.pm,qcEmail:P.qc,engineerEmails:[P.se2],active:1,version:ver('902')});
 done('People (PM, BOQ, Purchase, Audit, GM, Accounts, 2 site engineers, 2 QC engineers, labour manager) and projects 901 / 902');

 // Rate cards: the default card (from the BOQ team's sheet), a range for the Kochi sites, one project card.
 let v=(await call('settings',undefined,P.boq)).version;
 const card=async(scope,lines)=>{const r=await call('rate-cards',{version:v,action:'save',scope,lines,source:'Demo data'},P.boq);v=r.version;};
 await card({type:'default'},[['Hitachi','HOUR',1200],['Cement','BAG',370],['MSand','CFT',75],['20 mm Metal','CFT',70],['PSand','CFT',85],['Solid Cement Blocks 12 x 8 x 6','NOS',45],['Solid Cement Blocks 12 x 8 x 4','NOS',38],['Red Bricks','NOS',12],['Laterite Stone','NOS',48],
  ['8 mm Steel','KG',78],['10 mm Steel','KG',78],['12 mm Steel','KG',78],['16 mm Steel','KG',78],['20 mm Steel','KG',78],['Tile Gum','KG',45],['Shuttering Items','LOT',23000]].map(([item,unit,originalRate])=>({item,unit,originalRate,discountPercent:5})));
 await card({type:'range',from:'901',to:'910'},[{item:'Cement',unit:'BAG',originalRate:360,discountPercent:5},{item:'MSand',unit:'CFT',originalRate:72,discountPercent:5}]);
 await card({type:'project',project:'902'},[{item:'12 mm Steel',unit:'KG',originalRate:76,discountPercent:5},{item:'16 mm Steel',unit:'KG',originalRate:77,discountPercent:5}]);
 done('Rate cards: default card, projects 901–910 card (cement, M-sand), project 902 card (steel). New requests take their BOQ rate from these');
 // Vendors & brands (Purchase's project configuration): requests pick vendors from this list.
 {const v=await call('vendors',undefined,P.buy);await call('vendors',{version:v.version,values:[
  {project:'',category:'Materials',item:'Cement',brand:'UltraTech',vendor:'Kerala Traders',phone:'98470 34567',unit:'BAG',price:335},
  {project:'',category:'Materials',item:'Cement',brand:'ACC',vendor:'Malabar Cements Depot',phone:'98470 45678',unit:'BAG',price:342},
  {project:'',category:'Materials',item:'MSand',brand:'',vendor:'Periyar Crushers',phone:'98470 12345',unit:'CFT',price:66},
  {project:'902',category:'Materials',item:'12 mm Steel',brand:'JSW',vendor:'Sree Steels',phone:'98470 23456',unit:'KG',price:79},
  {project:'',category:'Rentals',item:'Hitachi',brand:'Hitachi EX70',vendor:'Sadhu Earthmovers',phone:'98470 56789',unit:'HOUR',price:1140},
  {project:'',category:'Shuttering Items',item:'Shuttering Items',brand:'',vendor:'Metro Rentals',phone:'98470 67890',unit:'LOT',price:''}]},P.buy);}
 done('Vendors & brands: cement (two brands), M-sand, steel for 902, Hitachi hire, shuttering');

 await openingStock();

 // 1. Just raised by the PM — waiting for the BOQ team.
 await raise('901','Laterite Stone','NOS',2000,W,20,{milestone:'1',activityName:'Basement filling & mixing'});
 await raise('902','Red Bricks','NOS',3000,add(W,7),21,{milestone:'2',activityName:'Superstructure brick work up to G/F lintel'});
 done('Step 1 · PM requests waiting for the BOQ team (Laterite Stone; Red Bricks for the week after)');

 // 1b. Request above the BOQ quantity — the GM decides.
 const over=await raise('902','Hitachi','HOUR',20,W,2,{milestone:'1',activityName:'Foundation excavation',category:'Rentals',notes:'Rock found during excavation; 4 hours more than the BOQ'});
 await boqApprove(over,16,false);
 done(`Step 1b · Request above the BOQ quantity waiting for the GM (Hitachi 20 h against 16 h${(await get(over)).gmApproval?.state==='Pending'?'':' — check: no GM step was created'})`);

 // 1c. Urgent ad hoc request from site.
 await call('records',{kind:'request',project:'902',item:'Binding wire',unit:'KG',milestone:'1',activity:'4',activityName:'Footing & column rebar',qty:25,boqQty:25,estimateRate:0,owner:'Jithin',itemCategory:'Materials',window:W,due:W,priority:'Urgent',reason:'Ran out during column rebar; work stops without it',requestBatchId:uuid()},P.pm);
 done('Step 1c · Urgent ad hoc request (Binding wire) — shows red on the sidebar counter');

 // 2. BOQ approved — Purchase to enter vendor rates.
 const psand=await raise('901','PSand','CFT',400,W,41,{milestone:'3',activityName:'G/F exterior plastering'});await boqApprove(psand,400);
 done('Step 2 · BOQ approved, waiting for Purchase rates (PSand)');

 // 3. With Audit — one below target, one above BOQ.
 const metal=await raise('901','20 mm Metal','CFT',300,W,7,{milestone:'1',activityName:'Mat & haunch concreting'});await boqApprove(metal,300);await quote(metal,'Periyar Crushers','98470 12345',62,'PC-2211');
 const steel=await raise('902','12 mm Steel','KG',900,W,4,{milestone:'1',activityName:'Footing & column rebar'});await boqApprove(steel,900);await quote(steel,'Sree Steels','98470 23456',79,'SS-4410');
 done('Step 3 · Purchase plan sent to Audit (20 mm Metal below target; 12 mm Steel above the BOQ rate, flagged)');

 // 3b. Sent back by Audit for a better rate.
 const steel16=await raise('902','16 mm Steel','KG',600,W,29,{milestone:'2',activityName:'GF roof slab rebar work'});await boqApprove(steel16,600);await quote(steel16,'Sree Steels','98470 23456',80,'SS-4411');
 await audit(steel16,'Returned','Above the BOQ rate of 77. Negotiate and resend.');
 done('Step 3b · Line sent back to Purchase by Audit (16 mm Steel)');

 // 4. Audit approved — ready for a PO.
 const gum=await raise('901','Tile Gum','KG',250,W,73,{milestone:'4',activityName:'GF floor tile laying'});await boqApprove(gum,250);await quote(gum,'Kerala Traders','98470 34567',41,'KT-778');
 await audit(gum,'Approved','Below target. Approved.');
 done('Step 4 · Audit approved, ready for a purchase order (Tile Gum)');

 // 5. PO issued, not yet delivered.
 const cement=await raise('901','Cement','BAG',120,W,7,{milestone:'1',activityName:'Mat & haunch concreting'});await boqApprove(cement,120);await quote(cement,'Kerala Traders','98470 34567',335,'KT-775');
 await audit(cement,'Approved','Saving Rs 7 a bag against target. Approved.');await order(cement,7);
 done('Step 5 · Purchase order issued, waiting for delivery (Cement, 7 days credit)');

 // 6. Delivered (part rejected), bill uploaded; Accounts still to check the bill.
 const msand=await raise('902','MSand','CFT',500,W,9,{milestone:'1',activityName:'Column concrete'});await boqApprove(msand,500);await quote(msand,'Periyar Crushers','98470 12345',66,'PC-2209');
 await audit(msand,'Approved','Approved.');let buy=await order(msand,10);
 let got=await receive(buy,P.se2,500,480,'M_SAND','CFT','PC-DC-7731',{dimensionUnit:'FT',lorryLength:20,lorryWidth:8,depthReadings:[3,3.1,2.9]});
 await upload({type:'Final bill',project:'902',window:W,vendor:'Periyar Crushers',recordIds:[buy.id],reference:'PC-INV-5521',email:P.buy,file:'Periyar Crushers invoice PC-INV-5521.pdf',
  bytes:pdf('Periyar Crushers - Tax invoice PC-INV-5521',['Bill to: Bilara Group, Project 902 (Aluva House)','PO: '+got.buy.po+'    GRN: '+got.grn+'    Challan: PC-DC-7731','Date: '+today,'','M-sand (manufactured sand)   500 CFT  @ 66.00   33,000.00','','Taxable value: 33,000.00   GST 5%: 1,650.00','Invoice total: Rs 34,650.00','Note: 20 CFT rejected at site (wet, silt) - billed in full; to be checked.'])});
 done(`Step 6 · Site received MSand: 500 CFT arrived, 480 accepted (${got.grn}); payment scheduled for 480 only; the vendor billed 500 — Accounts will see the mismatch`);

 // 7. Fully paid and closed.
 const blocks=await raise('901','Solid Cement Blocks 12 x 8 x 6','NOS',1500,W,21,{milestone:'2',activityName:'Superstructure brick work up to G/F lintel'});await boqApprove(blocks,1500);await quote(blocks,'Kerala Traders','98470 34567',41,'KT-770');
 await audit(blocks,'Approved','Rs 1.75 a block below target. Approved.');buy=await order(blocks,0);
 got=await receive(buy,P.se1,1500,1500,'CEMENT_BLOCK_6_INCH','NOS','KT-DC-3301');buy=got.buy;
 const blockBill=await upload({type:'Final bill',project:'901',window:W,vendor:'Kerala Traders',recordIds:[buy.id],reference:'KT-BILL-3301',email:P.buy,file:'Kerala Traders bill KT-BILL-3301.pdf',
  bytes:pdf('Kerala Traders - Bill KT-BILL-3301',['Bill to: Bilara Group, Project 901 (Kakkanad Villa)','PO: '+buy.po+'    GRN: '+got.grn,'Date: '+today,'','Solid cement blocks 12 x 8 x 6   1,500 NOS @ 41.00   61,500.00','','Total: Rs 61,500.00 (GST included)'])});
 buy=await billCheck(buy,'KT-BILL-3301',1500,41,61500,blockBill);
 const receipt=await upload({type:'Payment receipt',project:'901',window:W,vendor:'Kerala Traders',recordIds:[buy.id],reference:'UPI-889120',email:P.acc,file:'UPI receipt 889120.pdf',
  bytes:pdf('Payment receipt - UPI 889120',['Paid to: Kerala Traders','Amount: Rs 61,500.00','Mode: UPI    Reference: UPI-REF-889120','Date: '+today,'For: KT-BILL-3301 (PO '+buy.po+')'])});
 await pay(buy,'UPI','UPI-REF-889120',receipt);
 const b=await get(blocks);await call('closure',{id:blocks,version:b.version,action:'close',reason:'Delivered, billed and paid in full',confirmed:true},P.buy);
 done('Step 7 · GRN by site, bill matched by Accounts, paid by UPI with receipt, request closed (Solid Cement Blocks)');

 // 8. Rejected by Audit; cancelled by the PM.
 const shut=await raise('901','Shuttering Items','LOT',1,W,6,{milestone:'1',activityName:'Mat shuttering work',category:'Shuttering Items'});await boqApprove(shut,1);await quote(shut,'Metro Rentals','98470 45678',23500,'MR-019');
 await audit(shut,'Rejected','Above the BOQ rate. Use company shuttering stock instead.');
 const bricks=await raise('901','Red Bricks','NOS',500,W,21,{milestone:'2',activityName:'Superstructure brick work up to G/F lintel'});
 const rb=await get(bricks);await call('cancel-request',{id:bricks,version:rb.version,reason:'Design changed to cement blocks for this wall',confirmed:true},P.pm);
 done('Step 8 · Rejected by Audit (Shuttering Items) and cancelled by the PM (Red Bricks)');

 await seedQuotes();
 await seedSite();

 console.log(`
Done. Open ${BASE}. Demo work is in the week starting Thursday ${W} (the Weeks filter shows the next 4 weeks).
Switch people with "Testing as" (bottom-left). The guide docs/demo-walkthrough.md walks through it person by person.`);
}catch(e){console.error('\nDemo data stopped: '+e.message+'\nSteps completed: '+steps.length);process.exit(1);}
