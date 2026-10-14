// Delivery → bill → payment → closure, the way the site and Accounts work.
// Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const all=async()=>(await call('records')).data.records;
const row=async(id)=>(await all()).find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function normalWindow(now=new Date()){const d=new Date(today+'T00:00:00Z');let w=add(add(today,-((d.getUTCDay()+3)%7)),7);while(new Date(add(w,-12)+'T09:00:00+05:30').getTime()<=now.getTime())w=add(w,7);return w;}
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',SE='se@example.invalid',SE2='se2@example.invalid',BOQ='boq@example.invalid',BUY='pmgr@example.invalid',AUD='audit@example.invalid',ACC='acc@example.invalid',GM='gm@example.invalid';
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[SE,'QA Site Engineer',['Site Engineer']],[SE2,'Other SE',['Site Engineer']],[BOQ,'QA BOQ',['BOQ Team']],[BUY,'QA Buyer',['Purchase Manager']],[AUD,'QA Audit',['Audit']],[ACC,'QA Accounts',['Accounts']],[GM,'QA GM',['GM']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'960',name:'QA 960',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE],active:1,version:0});
 await ok('projects',{project:'961',name:'QA 961',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE2],active:1,version:0});
 const W=normalWindow();let seq=0;
 async function approvedPO(item,unit,qty,boq,rate,credit){seq++;
  const id=(await ok('records',{kind:'plan',project:'960',item,unit,milestone:'1',activity:String(seq),activityName:'Footing',activityBoqQty:qty,boqQty:qty,owner:'Jithin',itemCategory:'Materials',window:W,due:W,requestBatchId:'g'+seq},PM)).id;
  let r=await row(id);await ok('records',{id,version:r.version,boqOriginalRate:boq,targetDiscountPercent:5,boqOwner:'Subha'},BOQ);r=await row(id);
  await ok('gm-approval',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},BOQ);
  r=await row(id);await ok('records',{id,version:r.version,vendor:'QA Traders',quoteRate:rate,quoteReference:'Q'+seq,entity:'GROUP',stage:'Vendors finalized'},BUY);
  r=await row(id);await ok('audit-decision',{ids:[id],versions:{[id]:r.version},decision:'Approved',note:'ok',confirmed:true},AUD);
  r=await row(id);await ok('orders',{orderId:crypto.randomUUID(),items:[{id,version:r.version,qty}],creditDays:credit,exceptionReason:'QA'},BUY);
  const p=(await all()).find(x=>x.kind==='purchase'&&x.parent===id);return {req:id,po:p.id};}
 const schedules=async(po)=>(await all()).filter(r=>r.kind==='payment'&&r.parent===po);
 const grn=async(po,grnNo,received,accepted,email=SE,extra={})=>{const p=await row(po);return call('grn',{action:'receive',grnNo,date:today,challan:'CH-1',items:[{id:po,version:p.version,received,accepted}],...extra},email);};

 // Cement: 100 bags @ ₹320, 7 days credit → PO value ₹32,000
 const cement=await approvedPO('Cement','BAG',100,350,320,7);
 assert.equal((await schedules(cement.po))[0].total,3200000);
 assert.equal((await call('order-progress',{action:'delivered',items:[{id:cement.po,version:(await row(cement.po)).version}],date:today,grn:'X',by:'x',reason:'x'},BUY)).status,400);
 assert.equal((await grn(cement.po,'GRN-1',95,90,SE2)).status,403);
 assert.equal((await grn(cement.po,'GRN-1',95,90,ACC)).status,403);
 pass('only the site team or Purchase of that project can record a GRN; the old "mark delivered" is closed');

 const g1=await grn(cement.po,'GRN-1',95,90);assert.equal(g1.status,200,JSON.stringify(g1));
 let p=await row(cement.po),ss=await schedules(cement.po);
 assert.equal(p.status,'Part delivered');assert.equal(p.acceptedQty,90);assert.equal(p.rejectedQty,5);assert.equal(p.receipts[0].by,'QA Site Engineer');
 const grnSched=ss.find(s=>s.basis==='GRN'),fc=ss.find(s=>s.basis!=='GRN');
 assert.equal(grnSched.total,2880000);assert.equal(grnSched.due,add(today,7));assert.equal(fc.total,320000);
 assert.equal(ss.reduce((n,s)=>n+s.total,0),3200000);
 pass('95 arrive, 90 accepted: payment ₹28,800 due in 7 days, ₹3,200 stays as forecast for the 10 still to come');

 assert.equal((await grn(cement.po,'GRN-2',15,15)).status,400);
 assert.equal((await grn(cement.po,'grn-1',5,5)).status,409);
 pass('accepting more than ordered and reusing a GRN number are refused');

 const pay=async(s,amount,email=ACC)=>{const x=(await all()).find(r=>r.id===s);return call('records',{id:s,version:x.version,action:'settle',amount,date:today,reference:'UTR-'+Math.random(),paymentMode:'UPI',accountsBy:'QA'},email);};
 let r=await pay(grnSched.id,28800);assert.equal(r.status,400);assert.match(r.data.error,/check the vendor bill/);
 const bill=async(po,body,email=ACC)=>{const x=await row(po);return call('bill-check',{id:po,version:x.version,action:'add',...body},email);};
 r=await bill(cement.po,{billNo:'KT-501',billDate:today,qty:90,rate:330,amount:29700});assert.equal(r.status,200);assert.equal(r.data.status,'Mismatch');
 assert.match(r.data.issues.join(' '),/above the PO rate/);
 r=await pay(grnSched.id,28800);assert.equal(r.status,400);assert.match(r.data.error,/does not match/);
 assert.equal((await call('bill-check',{id:cement.po,version:(await row(cement.po)).version,action:'approve',reason:'x'},ACC)).status,403);
 assert.equal((await bill(cement.po,{billNo:'KT-501',billDate:today,qty:1,rate:320,amount:320})).status,409);
 pass('no payment without a bill check; a bill above the PO rate is flagged and blocks payment; Accounts cannot overrule it; bill numbers cannot repeat');

 r=await ok('bill-check',{id:cement.po,version:(await row(cement.po)).version,action:'approve',reason:'Unloading charge agreed with vendor'},GM);assert.equal(r.status,'Approved');
 r=await pay(grnSched.id,28800);assert.equal(r.status,200,JSON.stringify(r));
 pass('GM approves the mismatch with a reason; Accounts can then pay the accepted value ₹28,800');

 // Vendor will not send the last 10 bags: close short, cancel the request balance, close the request.
 assert.equal((await call('grn',{action:'shortClose',reason:'Vendor out of stock',items:[{id:cement.po,version:(await row(cement.po)).version}]},SE)).status,403);
 await ok('grn',{action:'shortClose',reason:'Vendor out of stock',items:[{id:cement.po,version:(await row(cement.po)).version}]},BUY);
 p=await row(cement.po);ss=await schedules(cement.po);
 assert.equal(p.qty,90);assert.equal(p.total,2880000);assert.equal(p.status,'Delivered');
 assert.equal(ss.reduce((n,s)=>n+s.total,0),2880000);assert.equal(ss.reduce((n,s)=>n+s.paid,0),2880000);
 const req=await row(cement.req);await ok('closure',{id:cement.req,version:req.version,action:'cancelBalance',reason:'Not needed after short supply',confirmed:true},BUY);
 const f=new FormData();f.set('file',new Blob([Buffer.from('%PDF-1.4\n%QA\n%%EOF')],{type:'application/pdf'}),'bill.pdf');f.set('metadata',JSON.stringify({project:'960',window:W,vendor:'QA Traders',type:'Final bill',recordIds:[cement.po],reference:'KT-501',uploadedBy:'QA'}));
 const rq=new Request('http://localhost/api/documents',{method:'POST',headers:{'x-bilara-test-user-email':BUY,'x-bilara-test-user-id':BUY},body:f});
 const up=await mf.dispatchFetch(rq.url,{method:'POST',headers:Object.fromEntries(rq.headers),body:await rq.arrayBuffer()});assert.equal(up.status,200,await up.text());
 const close=await call('closure',{id:cement.req,version:(await row(cement.req)).version,action:'close',reason:'Delivered 90, paid',confirmed:true},BUY);assert.equal(close.status,200,JSON.stringify(close));
 pass('short supply: line closed at 90 bags, PO value becomes ₹28,800, balance cancelled, request closes with everything paid');

 // MSand with an advance: 100 cft @ ₹50 → ₹5,000; ₹2,000 paid in advance before delivery.
 const sand=await approvedPO('MSand','CFT',100,60,50,0);
 const sf=(await schedules(sand.po))[0];assert.equal((await pay(sf.id,2000)).status,200);
 await ok('grn',{action:'receive',grnNo:'GRN-S1',date:today,items:[{id:sand.po,version:(await row(sand.po)).version,received:100,accepted:100}]},SE);
 ss=await schedules(sand.po);const sg=ss.find(s=>s.basis==='GRN');
 assert.equal(sg.total,300000);assert.equal(ss.reduce((n,s)=>n+s.total,0),500000);assert.equal(ss.find(s=>s.basis!=='GRN').total,200000);
 assert.equal(sg.due,today);
 await ok('bill-check',{id:sand.po,version:(await row(sand.po)).version,action:'add',billNo:'PC-9',billDate:today,qty:100,rate:50,amount:5000},ACC);
 assert.equal((await row(sand.po)).billStatus,'Matched');
 assert.equal((await pay(sg.id,3000)).status,200);
 r=await bill(sand.po,{billNo:'PC-10',billDate:today,qty:1,rate:50,amount:50});assert.equal(r.status,400);assert.match(r.data.error,/already billed/);
 pass('advance of ₹2,000 is used first: the GRN schedules only ₹3,000 more, due the same day (no credit); matching bill is paid; no second bill once everything received is billed');

 // Purchase cannot change delivery status or a GRN payment through the edit form.
 p=await row(sand.po);await ok('records',{id:sand.po,version:p.version,status:'Not delivered',notes:'edit'},BUY);assert.equal((await row(sand.po)).status,'Delivered');
 const s2=await row(sg.id);assert.equal((await call('records',{id:sg.id,version:s2.version,amount:9999},BUY)).status,400);
 pass('delivery status and GRN payments cannot be edited by hand');

 console.log(`\n${passed} GRN / bill / payment checks passed`);
}finally{await runtime.dispose();}
