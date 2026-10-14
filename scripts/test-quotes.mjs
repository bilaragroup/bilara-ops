// Plumbing & electrical: photo → vendor quotes → BOQ choice within budget → Audit → PO → GRN → bill → payment.
// Isolated Miniflare runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime=await createRuntime(),{mf}=runtime;
async function call(route,body,email='qa-admin@example.invalid'){const res=await mf.dispatchFetch('http://localhost/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
const ok=async(...a)=>{const r=await call(...a);assert.equal(r.status,200,JSON.stringify(r));return r.data;};
const all=async(email)=>(await call('records',undefined,email)).data.records;
const row=async(id,email)=>(await all(email)).find(r=>r.id===id);
const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
let passed=0;const pass=m=>{passed++;console.log('PASS '+m);};
const PM='pm@example.invalid',SE='se@example.invalid',SE2='se2@example.invalid',BOQ='boq@example.invalid',BUY='pmgr@example.invalid',AUD='audit@example.invalid',ACC='acc@example.invalid',GM='gm@example.invalid';
async function upload(email,meta,bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]),name='list.png',type='image/png'){
 const f=new FormData();f.set('file',new Blob([bytes],{type}),name);f.set('metadata',JSON.stringify(meta));
 const rq=new Request('http://localhost/api/documents',{method:'POST',headers:{'x-bilara-test-user-email':email,'x-bilara-test-user-id':email},body:f});
 const res=await mf.dispatchFetch(rq.url,{method:'POST',headers:Object.fromEntries(rq.headers),body:await rq.arrayBuffer()});return {status:res.status,data:await res.json()};
}
try{
 for(const [email,name,roles] of [[PM,'QA PM',['Project Manager']],[SE,'QA Site Engineer',['Site Engineer']],[SE2,'Other SE',['Site Engineer']],[BOQ,'QA BOQ',['BOQ Team']],[BUY,'QA Buyer',['Purchase Manager']],[AUD,'QA Audit',['Audit']],[ACC,'QA Accounts',['Accounts']],[GM,'QA GM',['GM']]])await ok('users',{email,name,roles,projects:[],active:1,version:0});
 await ok('projects',{project:'970',name:'House 970',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE],active:1,version:0});
 await ok('projects',{project:'971',name:'House 971',site:'Isolated',managerEmail:PM,qcEmail:'',engineerEmails:[SE2],active:1,version:0});
 const need=add(today,10);

 // Budget
 assert.equal((await call('quotes',{action:'budget',project:'970',trade:'Plumbing',amount:250000,version:0},BUY)).status,403);
 await ok('quotes',{action:'budget',project:'970',trade:'Plumbing',amount:100000,version:0},BOQ);
 assert.equal((await all(SE)).filter(r=>r.kind==='budget').length,0);
 assert.equal((await all(BUY)).filter(r=>r.kind==='budget').length,1);
 pass('BOQ sets the plumbing budget per project; site roles do not see it, Purchase does');

 // Site engineer raises with a photo
 assert.equal((await call('quotes',{action:'create',project:'971',trade:'Plumbing',neededBy:need},SE)).status,403);
 assert.equal((await call('quotes',{action:'create',project:'970',trade:'Plumbing',neededBy:add(today,-1)},SE)).status,400);
 const c=await ok('quotes',{action:'create',project:'970',trade:'Plumbing',neededBy:need,activity:'First floor bathrooms',note:'As per plumber list'},SE);
 const id=c.id;let r=await row(id,SE);assert.equal(r.stage,'Awaiting quotes');assert.equal(r.raisedBy,'QA Site Engineer');
 assert.equal((await upload(SE,{project:'970',window:c.window,vendor:'Plumbing',type:'Site list',recordIds:[id],reference:'Plumber list',uploadedBy:'QA Site Engineer'})).status,200);
 pass('site engineer raises a request for own project only, needed-by date today or later, and uploads the list photo');

 // Purchase: typed list (optional), quotes
 const v=async()=>(await row(id,BUY)).version;
 await ok('quotes',{action:'typedList',id,version:await v(),lines:[{item:'CPVC elbow',size:'3/4"',qty:18,unit:'NOS'},{item:'CPVC pipe SDR-11',size:'3/4"',qty:36,unit:'MTR'}]},BUY);
 assert.equal((await call('quotes',{action:'addQuote',id,version:await v(),vendor:'Cheap Pipes',amount:62000},SE)).status,403);
 const qf=await upload(BUY,{project:'970',window:c.window,vendor:'Supreme Agencies',type:'Vendor quote',recordIds:[id],reference:'Q-77',uploadedBy:'QA Buyer'},Buffer.from('%PDF-1.4\n%%EOF'),'q.pdf','application/pdf');assert.equal(qf.status,200);
 await ok('quotes',{action:'addQuote',id,version:await v(),vendor:'Cheap Pipes',amount:62000,brands:'Local brand',creditDays:0},BUY);
 await ok('quotes',{action:'addQuote',id,version:await v(),vendor:'Supreme Agencies',amount:69563,brands:'Supreme, Jaquar',reference:'Q-77',documentId:qf.data.id,creditDays:7},BUY);
 await ok('quotes',{action:'addQuote',id,version:await v(),vendor:'Too Dear',amount:140000,brands:'Premium'},BUY);
 assert.equal((await call('quotes',{action:'addQuote',id,version:await v(),vendor:'cheap pipes',amount:1},BUY)).status,400);
 r=await row(id,SE);assert.equal(r.quotes.length,3);assert.equal(r.quotes[0].amount,undefined);assert.equal(r.typedList.length,2);
 const docsSE=(await call('documents',undefined,SE)).data.documents;assert.ok(docsSE.some(d=>d.type==='Site list'));assert.ok(!docsSE.some(d=>d.type==='Vendor quote'));
 pass('Purchase types the list (optional) and records 3 quotes with a quote file; the site sees vendors but not prices or quote files');

 // BOQ
 assert.equal((await call('quotes',{action:'select',id,version:await v(),quoteId:r.quotes[1].id},BOQ)).status,400);
 await ok('quotes',{action:'sendToBoq',id,version:await v()},BUY);
 const q=(await row(id,BOQ)).quotes;
 let s=await call('quotes',{action:'select',id,version:await v(),quoteId:q[2].id,reason:'best brand'},BOQ);assert.equal(s.status,400);assert.match(s.data.error,/above the ₹1,00,000 left/);
 s=await call('quotes',{action:'select',id,version:await v(),quoteId:q[1].id},BOQ);assert.equal(s.status,400);assert.match(s.data.error,/not the lowest/);
 await ok('quotes',{action:'select',id,version:await v(),quoteId:q[1].id,reason:'Supreme ISI pipes and Jaquar diverter, within budget'},BOQ);
 r=await row(id,BOQ);assert.equal(r.stage,'BOQ selected');assert.equal(r.selection.amount,6956300);assert.equal(r.selection.lowest,false);
 pass('BOQ cannot pick a quote above the remaining budget; picking a dearer, better-brand quote needs a reason');

 // Budget is now committed
 const c2=await ok('quotes',{action:'create',project:'970',trade:'Plumbing',neededBy:need,activity:'Ground floor'},PM);
 await upload(PM,{project:'970',window:c2.window,vendor:'Plumbing',type:'Site list',recordIds:[c2.id],reference:'list',uploadedBy:'QA PM'});
 await ok('quotes',{action:'addQuote',id:c2.id,version:(await row(c2.id,BUY)).version,vendor:'Cheap Pipes',amount:40000},BUY);
 assert.equal((await call('quotes',{action:'sendToBoq',id:c2.id,version:(await row(c2.id,BUY)).version},BUY)).status,400);
 await ok('quotes',{action:'sendToBoq',id:c2.id,version:(await row(c2.id,BUY)).version,singleQuoteReason:'Only vendor delivering to this site'},BUY);
 s=await call('quotes',{action:'select',id:c2.id,version:(await row(c2.id,BOQ)).version,quoteId:(await row(c2.id,BOQ)).quotes[0].id},BOQ);
 assert.equal(s.status,400);assert.match(s.data.error,/30,437/);
 assert.equal((await call('quotes',{action:'budget',project:'970',trade:'Plumbing',amount:50000,version:(await all(BOQ)).find(x=>x.kind==='budget').version},BOQ)).status,400);
 await ok('quotes',{action:'returnToPurchase',id:c2.id,version:(await row(c2.id,BOQ)).version,reason:'Need a cheaper option'},BOQ);
 assert.equal((await row(c2.id,BUY)).stage,'Awaiting quotes');
 pass('the chosen quote uses up the budget: the next request sees only ₹30,437 left, the budget cannot drop below what is committed, one quote needs a reason, BOQ can send back');

 // Audit then PO
 assert.equal((await call('quotes',{action:'order',id,version:await v()},BUY)).status,400);
 assert.equal((await call('quotes',{action:'audit',id,version:await v(),decision:'Approved'},BOQ)).status,403);
 await ok('quotes',{action:'audit',id,version:await v(),decision:'Returned',note:'Check if Cheap Pipes is ISI'},AUD);
 r=await row(id,BOQ);assert.equal(r.stage,'With BOQ');assert.equal(r.selection,undefined);
 await ok('quotes',{action:'select',id,version:await v(),quoteId:q[1].id,reason:'Cheap Pipes is not ISI marked'},BOQ);
 await ok('quotes',{action:'audit',id,version:await v(),decision:'Approved',note:'ok'},AUD);
 const o=await ok('quotes',{action:'order',id,version:await v(),entity:'GROUP'},BUY);
 const recs=await all(ACC),po=recs.find(x=>x.id===o.id),pay=recs.filter(x=>x.kind==='payment'&&x.parent===o.id);
 assert.equal(po.total,6956300);assert.equal(po.unit,'LS');assert.equal(po.qty,1);assert.equal(po.vendor,'Supreme Agencies');assert.equal(po.creditDays,7);
 assert.equal(pay.length,1);assert.equal(pay[0].total,6956300);assert.equal(pay[0].due,add(need,7));
 assert.equal((await call('quotes',{action:'order',id,version:await v()},BUY)).status,400);
 pass('Audit can return to BOQ; after approval Purchase issues one lump-sum PO line for ₹69,563 with the quote\'s 7 credit days, and only once');

 // GRN, bill, payment, closure — existing steps
 await ok('grn',{action:'receive',grnNo:'GRN-P1',date:today,items:[{id:po.id,version:po.version,received:1,accepted:1}]},SE);
 let p=await row(po.id,ACC);assert.equal(p.status,'Delivered');
 const sched=(await all(ACC)).find(x=>x.kind==='payment'&&x.parent===po.id&&x.basis==='GRN');assert.equal(sched.total,6956300);assert.equal(sched.due,add(today,7));
 let b=await ok('bill-check',{id:po.id,version:p.version,action:'add',billNo:'B 2562/26-27',billDate:today,qty:1,rate:69563,amount:69563},ACC);assert.equal(b.status,'Matched');
 const settle=await call('records',{id:sched.id,version:sched.version,action:'settle',amount:69563,date:today,reference:'UTR-1',paymentMode:'Account Transfer',accountsBy:'QA'},ACC);assert.equal(settle.status,200,JSON.stringify(settle));
 await upload(BUY,{project:'970',window:c.window,vendor:'Supreme Agencies',type:'Final bill',recordIds:[po.id],reference:'B 2562',uploadedBy:'QA Buyer'},Buffer.from('%PDF-1.4\n%%EOF'),'bill.pdf','application/pdf');
 const close=await call('closure',{id,version:await v(),action:'close',reason:'Delivered and paid',confirmed:true},BUY);assert.equal(close.status,200,JSON.stringify(close));
 pass('site GRN, bill check, Thursday payment and closure work on the quote PO exactly as for other materials');

 // Cancel
 assert.equal((await call('quotes',{action:'cancel',id:c2.id,version:(await row(c2.id,BUY)).version,reason:'x'},SE2)).status,403);
 await ok('quotes',{action:'cancel',id:c2.id,version:(await row(c2.id,PM)).version,reason:'Merged with next list'},PM);
 assert.equal((await row(c2.id,PM)).stage,'Cancelled');
 pass('the raiser or PM can cancel before a PO; other sites cannot');
 console.log(`\n${passed} plumbing / electrical quote checks passed`);
}finally{await runtime.dispose();}
