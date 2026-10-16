import {sameOrigin} from '@/lib/access';
import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {defaultSettings} from '@/lib/settings';
import {decodeDocument} from '@/lib/documents';
import {database,decode} from '@/lib/database';
import {validProject} from '@/lib/calculations';
import {validWindow,weekData,indiaToday,addDays} from '@/lib/weekly';
const fail=(error:string,status=400)=>Response.json({error},{status});
const decodeProject=(r:any)=>({project:r.project,name:r.name,site:r.site,managerEmail:r.manager_email,qcEmail:JSON.parse(r.qc_emails||'[]')[0]||'',engineerEmails:JSON.parse(r.engineer_emails),active:!!r.active,version:r.version,updated:r.updated});
async function handleGET(req:Request,a:Actor){try{const db=database(),q=new URL(req.url).searchParams;
 if(q.get('id')){const row=await db.prepare('SELECT * FROM forecasts WHERE id=?').bind(q.get('id')).first<any>();return row?Response.json({...JSON.parse(row.data),snapshotId:row.id,created:row.created}):fail('Snapshot not found',404);}
 if(q.get('backup')==='1'){if(!validWindow(q.get('window'))||(q.get('project')&&q.get('project')!=='all'&&!validProject(q.get('project'))))return fail('Choose a Thursday window and a valid project, or all projects.');const r=await db.batch([db.prepare('SELECT * FROM records ORDER BY updated'),db.prepare('SELECT * FROM history ORDER BY at'),db.prepare('SELECT * FROM documents ORDER BY created'),db.prepare('SELECT * FROM payment_batches ORDER BY created'),db.prepare("SELECT * FROM settings WHERE id='main'"),db.prepare('SELECT * FROM project_configs ORDER BY CAST(project AS INTEGER)')]);return Response.json({schemaVersion:1,created:new Date().toISOString(),window:q.get('window'),project:q.get('project')||'all',referenceRates:confidential(a)?(await db.prepare('SELECT * FROM reference_rates').all()).results:undefined,records:r[0].results.map(decode),history:r[1].results,documents:r[2].results.map(decodeDocument),paymentBatches:r[3].results,settings:r[4].results[0]?JSON.parse(String((r[4].results[0] as any).data)):defaultSettings,projectConfigs:r[5].results.map(decodeProject)},{headers:{'Cache-Control':'no-store'}});}
 const rs=await db.prepare('SELECT id,window,project,created FROM forecasts ORDER BY created DESC LIMIT 100').all();return Response.json({snapshots:rs.results});
 }catch{return fail('Backup records are unavailable. Retry while the application is online.',503);}}
async function handlePOST(req:Request,a:Actor){try{if(!sameOrigin(req))return fail('Origin not allowed',403);const body=await req.json() as any;if(!validWindow(body.window)||!validProject(body.project))return fail('Choose a Thursday window and a project from 100 to 999.');
 const db=database();const result=await db.batch([db.prepare('SELECT * FROM records ORDER BY id'),db.prepare('SELECT * FROM history ORDER BY at'),db.prepare('SELECT * FROM documents ORDER BY created'),db.prepare('SELECT * FROM payment_batches ORDER BY created'),db.prepare("SELECT * FROM settings WHERE id='main'"),db.prepare('SELECT * FROM project_configs WHERE project=?').bind(body.project)]);const records=result[0].results.map(decode);const week=weekData(records,body.window,body.project);
 if(!week.requirements.length&&!week.payments.length)return fail('This project has no requirements or payments in the selected window.');
 if(week.requirements.some(r=>!['Audit approved','Rejected','Cancelled'].includes(r.stage)))return fail('Complete audit decisions for the project requirements before finalizing.');
 if(week.requirements.some(r=>r.stage==='Audit approved'&&week.purchases.filter(p=>p.parent===r.id&&p.status!=='Cancelled').reduce((n,p)=>n+p.qty,0)+Number(r.cancellation?.qty||0)<Number(r.boqQty||r.qty)-0.000000001))return fail('POs do not yet cover all audited quantities. Complete the PO quantities before finalizing.');
 if(week.purchases.some(p=>records.filter(x=>x.kind==='payment'&&x.parent===p.id).reduce((n,x)=>n+x.total,0)<p.total&&!String(p.paymentTerms||'').trim()))return fail('Schedule the full PO value or record terms explaining the remaining credit / later payment.');
 if(indiaToday()!==addDays(body.window,-1)&&!String(body.exceptionReason||'').trim())return fail('Finalization is normally on Wednesday before execution. Enter a reason for early or late finalization.');
 const scopedRecords=[...week.requirements,...week.purchases,...week.payments].sort((a,b)=>a.id.localeCompare(b.id)),scopeIds=new Set(scopedRecords.map(r=>r.id)),scopeJson=JSON.stringify([...scopeIds]);
 const referenceRates=(await db.prepare('SELECT * FROM reference_rates').all()).results.filter((r:any)=>scopeIds.has(r.record_id));
 const history=result[1].results.filter((r:any)=>scopeIds.has(r.record_id));
 const documents=result[2].results.map(decodeDocument).filter((d:any)=>d.project===body.project&&d.recordIds?.some((recordId:string)=>scopeIds.has(recordId)));
 const paymentBatches=result[3].results.filter((r:any)=>{try{return JSON.parse(String(r.data)).payments?.some((p:any)=>scopeIds.has(p.id));}catch{return false;}});
 const created=new Date().toISOString(),id=crypto.randomUUID();const content=JSON.stringify({schemaVersion:1,created,window:body.window,project:body.project,exceptionReason:body.exceptionReason||'',referenceRates,records:scopedRecords,history,documents,paymentBatches,settings:result[4].results[0]?JSON.parse(String((result[4].results[0] as any).data)):defaultSettings,projectConfigs:result[5].results.map(decodeProject)});if(new TextEncoder().encode(content).length>1500000)return fail('This project-week snapshot exceeds the current size limit. Download a live backup and contact the administrator to expand snapshot storage.');
 // Serialize finalization against this project-week only; unrelated project activity must not block it.
 const revision=scopedRecords.map(r=>r.id+':'+r.version).join('|');
 const saved=await db.prepare("INSERT INTO forecasts (id,window,project,data,created) SELECT ?,?,?,?,? WHERE ? = COALESCE((SELECT group_concat(v,'|') FROM (SELECT id||':'||version AS v FROM records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)),'')").bind(id,body.window,body.project,content,created,revision,scopeJson).run();
 if(!saved.meta.changes)return fail('Records changed during finalization. Refresh and retry.',409);
 return Response.json({snapshotId:id,...JSON.parse(content)});
 }catch{return fail('Unable to finalize the forecast. Please retry.');}}

export async function GET(req:Request){return protect(req,'read',handleGET);}

export async function POST(req:Request){return protect(req,'forecast',handlePOST);}
