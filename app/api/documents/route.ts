import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {documentStorage,decodeDocument,boundedBody,validDriveLink} from '@/lib/documents';
import {validProject} from '@/lib/calculations';
import {validWindow,recordWindow} from '@/lib/weekly';
const fail=(error:string,status=400)=>Response.json({error},{status});
async function handleGET(req:Request,a:Actor){try{const db=database(),q=new URL(req.url).searchParams,id=q.get('id');
 if(id){const row=await db.prepare('SELECT * FROM documents WHERE id=?').bind(id).first<any>();if(!row)return fail('Document not found',404);const meta=decodeDocument(row);const allowed=(await db.prepare('SELECT * FROM records').all()).results.map(decode).filter(r=>visible(a,r));if(!inProject(a,meta.project)||(meta.confidential&&!confidential(a))||(meta.type==='Vendor quote'&&!has(a,'Purchase Manager','Purchase Team','Accounts','GM','BOQ Team','Audit'))||(!confidential(a)&&!meta.recordIds.every((id:string)=>allowed.some(r=>r.id===id))))return fail('Document is outside your access.',403);if(meta.driveUrl){if(!validDriveLink(meta.driveUrl))return fail('Invalid document link');return Response.redirect(meta.driveUrl,302);}const file=await documentStorage().get(row.object_key);if(!file)return fail('File is unavailable',404);return new Response(file.body,{headers:{'Content-Type':row.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
 const rows=await db.prepare('SELECT * FROM documents ORDER BY created DESC').all();return Response.json({documents:rows.results.map(decodeDocument)},{headers:{'Cache-Control':'no-store'}});
 }catch{return fail('Documents are unavailable. Please retry.',503);}}
async function handlePOST(req:Request,a:Actor){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Origin not allowed',403);
 const bytes=await boundedBody(req,11*1024*1024);const form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();
 const file=form.get('file');const link=String(form.get('driveUrl')||'').trim();if(link&&!validDriveLink(link))return fail('Use an HTTPS Google Drive or Google Docs file link.');if(!link&&(!(file instanceof File)||file.size===0||file.size>10*1024*1024))return fail('Choose a PDF, PNG or JPG file up to 10 MB.');
 const b=JSON.parse(String(form.get('metadata')||'{}'));if(!validProject(b.project)||!validWindow(b.window)||!['Estimate','Final bill','Payment receipt','Site list','Vendor quote'].includes(b.type))return fail('Choose project, Thursday week and document type.');
 for(const k of ['vendor','uploadedBy','reference'])if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>200)return fail('Vendor, document reference and uploaded by are required (up to 200 characters).');
 if(!Array.isArray(b.recordIds)||!b.recordIds.length||b.recordIds.length>100||b.recordIds.some((id:any)=>typeof id!=='string'))return fail('Select between 1 and 100 items.');b.recordIds=[...new Set(b.recordIds)];
 const db=database(),rs=await db.prepare('SELECT * FROM records').all(),records=rs.results.map(decode);if(!inProject(a,b.project)||(b.confidential&&!confidential(a)))return fail('Document is outside your access.',403);const selected=b.recordIds.map((id:string)=>records.find(r=>r.id===id));
 if(selected.some((r:any)=>!r||!visible(a,r)||r.project!==b.project||recordWindow(r,records)!==b.window))return fail('All linked items must belong to this project and week.');
 if(['Site list','Vendor quote'].includes(b.type)&&selected.some((r:any)=>r.kind!=='quote'))return fail('Site list photos and vendor quotes attach to a plumbing / electrical request.');
 if(!['Site list','Vendor quote'].includes(b.type)&&selected.some((r:any)=>b.type==='Estimate'?!['plan','request','purchase'].includes(r.kind):b.type==='Final bill'?r.kind!=='purchase':!['payment','purchase'].includes(r.kind)))return fail('Choose requirements for estimates, purchases for final bills, and purchases or payment schedules for receipts.');
 if(!['Estimate','Site list','Vendor quote'].includes(b.type)&&selected.some((r:any)=>String(r.vendor||'').trim().toLowerCase()!==b.vendor.trim().toLowerCase()))return fail('A bill or receipt can only link items from the same vendor.');
 const content=link?new Uint8Array():new Uint8Array(await (file as File).arrayBuffer());const isPDF=new TextDecoder().decode(content.slice(0,5))==='%PDF-',isPNG=[137,80,78,71,13,10,26,10].every((n,i)=>content[i]===n),isJPG=content[0]===255&&content[1]===216&&content[2]===255;
 const mime=link?'text/uri-list':isPDF?'application/pdf':isPNG?'image/png':isJPG?'image/jpeg':null;if(!mime)return fail('Only PDF, PNG and JPG documents are supported.');
 const id=crypto.randomUUID(),key='documents/'+id,created=new Date().toISOString(),filename=(link?'Google Drive document':(file as File).name).replace(/[\\/\x00-\x1f]/g,'_').slice(0,180);const data=JSON.stringify({confidential:!!b.confidential,recordIds:b.recordIds,uploadedBy:b.uploadedBy.trim(),reference:b.reference.trim(),driveUrl:link||undefined,notes:String(b.notes||'').slice(0,2000)});
 if(!link)await documentStorage().put(key,content,{httpMetadata:{contentType:mime}});
 await db.batch([db.prepare('INSERT INTO documents (id,project,window,vendor,type,filename,mime,size,object_key,data,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,b.project,b.window,b.vendor.trim(),b.type,filename,mime,link?0:(file as File).size,link?'':key,data,created),...b.recordIds.map((recordId:string)=>db.prepare('INSERT INTO history (id,record_id,action,data,at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),recordId,'Document linked',JSON.stringify({documentId:id,type:b.type,reference:b.reference,uploadedBy:b.uploadedBy,linkedItems:b.recordIds}),created))]);
 return Response.json({ok:true,id});
 }catch(e){return fail(e instanceof Error&&e.message==='Upload is too large'?e.message:'Unable to upload document. Check the file and retry.');}}

export async function GET(req:Request){return protect(req,'read',handleGET);}

export async function POST(req:Request){return protect(req,'documents',handlePOST);}
