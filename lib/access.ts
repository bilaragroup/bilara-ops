import {database,decode} from './database';
import {Actor,Role,has,confidential,inProject,visible,cleanRecord,cleanSettings,capabilities} from './permissions';
export class AccessError extends Error{constructor(message:string,public status=403){super(message);}}
export async function actor(headers:Headers,allowLocalTest=false,ignoreTestUser=false):Promise<Actor>{
 const subject=headers.get('oai-authenticated-user-id')||(allowLocalTest?headers.get('x-bilara-test-user-id')||'local-sites-user':null),email=(headers.get('oai-authenticated-user-email')||(allowLocalTest?headers.get('x-bilara-test-user-email')||'seedy@sites.test':null))?.trim().toLowerCase();
 if(!subject||!email)throw new AccessError('Sign in to access Bilara.',401);
 const db=database();let row=await db.prepare('SELECT * FROM app_users WHERE subject=?').bind(subject).first<any>();
 if(!row){row=await db.prepare('SELECT * FROM app_users WHERE email=? AND active=1').bind(email).first<any>();if(row&&row.subject!==subject){await db.prepare('UPDATE app_users SET subject=? WHERE email=? AND active=1').bind(subject,email).run();row=await db.prepare('SELECT * FROM app_users WHERE email=? AND active=1').bind(email).first<any>();}}
 if(!row||!row.active)throw new AccessError('Your account has not been enabled. Contact the Super Admin.');
 const signedIn:Actor={email:row.email,name:row.name,subject,roles:JSON.parse(row.roles),projects:JSON.parse(row.projects),version:row.version};
 const previewEmail=!ignoreTestUser?headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('bilara_test_user='))?.slice('bilara_test_user='.length):undefined;
 if(previewEmail){
  if(!allowLocalTest&&!has(signedIn,'Super Admin'))throw new AccessError('Only the Super Admin can switch test roles.');
  const selected=decodeURIComponent(previewEmail).trim().toLowerCase(),testUser=await db.prepare('SELECT * FROM app_users WHERE email=? AND active=1').bind(selected).first<any>();
  if(!testUser){if(has(signedIn,'Super Admin'))return signedIn;throw new AccessError('This test user is no longer active. Return to the Super Admin test account.');}
  return {email:testUser.email,name:testUser.name,subject:`test-role:${testUser.email}`,roles:JSON.parse(testUser.roles),projects:JSON.parse(testUser.projects),version:testUser.version};
 }
 return signedIn;
}
function assert(ok:boolean,message='Your role cannot perform this action.'){if(!ok)throw new AccessError(message);}
export function canEditAssigned(a:Actor,r:any){return has(a,'GM','Audit','Accounts','Purchase Manager')||r.assignedTo===a.email;}
function recordWrite(a:Actor,b:any,old:any){
 const kind=old?.kind||b.kind;if(b.action==='settle'){assert(has(a,'Accounts'));return;}
 if(kind==='payment'){assert(has(a,'Purchase Manager','Purchase Team'));return;}
 if(kind==='purchase'){assert(has(a,'Purchase Manager','Purchase Team'));return;}
 assert(['plan','request'].includes(kind));
 if(!old){assert(kind==='plan'?has(a,'GM','Project Manager'):has(a,'GM','Project Manager','Purchase Manager'));assert(!b.stage||b.stage==='Submitted');if(!has(a,'GM'))assert(!Number(b.estimateRate)&&!Number(b.boqRate)&&!Number(b.boqOriginalRate),'Rates come from the project catalogue or BOQ review.');return;}
 const changed=(k:string)=>b[k]!==undefined&&String(b[k]??'')!==String(old[k]??'');
 if(has(a,'GM')){if(!a.roles.includes('Super Admin')&&changed('stage'))assert(['Submitted','BOQ priced'].includes(b.stage),'Audit alone records the final approval or rejection.');return;}
 if(has(a,'BOQ Team')){assert(old.kind==='plan'&&old.stage==='Submitted','The BOQ workbook only updates submitted planned requests.');assert(Object.keys(b).filter(changed).every(k=>['activityBoqQty','boqQty','boqRate','boqOriginalRate','targetDiscountPercent','boqOwner','notes','dryRun'].includes(k)),'The BOQ Team may update BOQ quantity, original BOQ rate, target reduction, preparer and notes.');return;}
 if(has(a,'Project Manager')&&old.kind==='request'&&old.stage==='Submitted'&&old.createdBy===a.email){assert(!changed('stage')&&!changed('estimateRate')&&!changed('boqRate'),'The GM approves quantities and rates.');return;}
 if(has(a,'Audit')){assert(['Vendors finalized','Audit approved'].includes(old.stage));assert(Object.keys(b).filter(changed).every(k=>['stage','auditOwner','reviewNote','dryRun'].includes(k)),'Audit may record its decision; commercial changes go back to the GM.');return;}
 assert(has(a,'Purchase Manager','Purchase Team')&&canEditAssigned(a,old),'This request must be assigned to you before you can prepare it.');
 assert(old.stage==='BOQ priced','Only GM-priced requests can be prepared.');
 assert(Object.keys(b).filter(changed).every(k=>['vendor','vendorPhone','quoteRate','quoteReference','entity','entityConfirmed','stage','notes','dryRun'].includes(k)),'The BOQ baseline is fixed by the GM.');
 assert(!b.stage||['BOQ priced','Vendors finalized'].includes(b.stage),'Submit vendor details for audit approval.');
}
export async function protect(req:Request,cap:string,handler:(req:Request,a:Actor)=>Promise<Response>){try{
 const a=await actor(req.headers,new URL(req.url).hostname==='localhost'&&req.headers.get('x-bilara-test-strict')!=='1');assert(has(a,...(capabilities[cap]||capabilities.read)));
 if(req.method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)throw new AccessError('Origin not allowed.');
 const all=(await database().prepare('SELECT * FROM records').all()).results.map(decode);
 if(req.method==='POST'&&cap!=='documents'){
  const text=await req.clone().text();if(text.length>70000)throw new AccessError('Request too large.',413);let b:any;try{b=JSON.parse(text);}catch{throw new AccessError('Enter valid JSON.',400);}if(!b||typeof b!=='object'||Array.isArray(b))throw new AccessError('Enter a JSON object.',400);
  const ids=[b.id,b.parent,...(Array.isArray(b.items)?b.items.map((x:any)=>x.id):[]),...(Array.isArray(b.payments)?b.payments.map((x:any)=>x.id):[])].filter(Boolean);
  for(const id of ids){const r=all.find(r=>r.id===id);if(r){assert(visible(a,r),'This record is outside your access.');if(['orders','progress','assignment'].includes(cap)||cap==='records'&&['purchase','payment'].includes(b.kind||all.find(r=>r.id===b.id)?.kind)){const parent=all.find(x=>x.id===r.parent)||r;const root=all.find(x=>x.id===parent.parent)||parent;assert(cap==='assignment'||canEditAssigned(a,root),'This request is assigned to another purchaser.');}}}
  if(b.project)assert(inProject(a,b.project),'This project is outside your access.');
  if(cap==='records')recordWrite(a,b,all.find(r=>r.id===b.id));
  if(cap==='records'&&b.action==='settle')b.accountsBy=a.name;if(cap==='accounts')b.accountsBy=a.name;if(['gm','progress','closure'].includes(cap))b.by=a.name;req=new Request(req.url,{method:req.method,headers:req.headers,body:JSON.stringify(b)});
  if(cap==='closure'&&['cancelBalance','reopen'].includes(b.action))assert(has(a,'GM','Audit','Purchase Manager'),'A manager must approve cancellation or reopening.');
 }
 const res=await handler(req,a);
 if(res.ok&&res.headers.get('Content-Type')?.includes('application/json')){
  const d:any=await res.json();const allowed=all.filter(r=>visible(a,r));const ids=new Set(allowed.map(r=>r.id));
  if(d.project&&d.project!=='all')assert(inProject(a,d.project),'This forecast is outside your access.');if(!confidential(a))delete d.referenceRates;
  if(d.records)d.records=d.records.filter((r:any)=>visible(a,r)).map((r:any)=>confidential(a)?r:cleanRecord(r,a));
  if(d.history&&!confidential(a))d.history=[];
  if(d.paymentBatches&&!confidential(a))d.paymentBatches=[];
  if(d.settings&&!confidential(a))d.settings=cleanSettings(d.settings);
  if(d.snapshots)d.snapshots=d.snapshots.filter((s:any)=>inProject(a,s.project));
  if(d.projectConfigs)d.projectConfigs=d.projectConfigs.filter((p:any)=>inProject(a,p.project));
  if(d.documents)d.documents=d.documents.filter((x:any)=>inProject(a,x.project)&&(x.type!=='Vendor quote'||has(a,'Purchase Manager','Purchase Team','Accounts','GM','BOQ Team','Audit'))&&(!x.confidential||confidential(a))&&(confidential(a)||x.recordIds.every((id:string)=>ids.has(id))));
  return Response.json(d,{headers:{'Cache-Control':'private, no-store'}});
 }
 return res;
 }catch(e){if(!(e instanceof AccessError))console.error(JSON.stringify({event:'authorization_handler_failed',message:e instanceof Error?e.message:String(e)}));return Response.json({error:e instanceof AccessError?e.message:'Unable to complete this request.'},{status:e instanceof AccessError?e.status:503,headers:{'Cache-Control':'no-store'}});}}
