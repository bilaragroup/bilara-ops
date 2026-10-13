import {protect} from '@/lib/access';
import {database} from '@/lib/database';
import {has,type Actor} from '@/lib/permissions';
import {refreshProjectAccess} from '@/lib/project-assignments';

const valid=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254;
const decode=(r:any)=>({project:r.project,name:r.name,site:r.site,managerEmail:r.manager_email,qcEmail:JSON.parse(r.qc_emails||'[]')[0]||'',engineerEmails:JSON.parse(r.engineer_emails),active:!!r.active,version:r.version,updated:r.updated});
async function get(_:Request,a:Actor){
 const db=database(),[ps,us]=await Promise.all([db.prepare('SELECT * FROM project_configs ORDER BY CAST(project AS INTEGER)').all(),has(a)?db.prepare('SELECT email,name,roles,active FROM app_users ORDER BY name').all():Promise.resolve({results:[]})]);
 return Response.json({projects:ps.results.map(decode).filter((p:any)=>has(a,'GM','Audit')||a.projects.includes(p.project)),users:us.results.map((u:any)=>({...u,roles:JSON.parse(u.roles),active:!!u.active}))},{headers:{'Cache-Control':'no-store'}});
}
async function save(req:Request,a:Actor){
 const b:any=await req.json(),project=String(b.project||'').trim(),name=String(b.name||'').trim(),site=String(b.site||'').trim(),managerEmail=String(b.managerEmail||'').trim().toLowerCase(),qcEmail=String(b.qcEmail||'').trim().toLowerCase(),engineerEmails=[...new Set<string>((Array.isArray(b.engineerEmails)?b.engineerEmails:[]).map((x:any)=>String(x).trim().toLowerCase()).filter(Boolean))],version=Number(b.version||0);
 const fail=(error:string,status=400)=>Response.json({error},{status});
 if(!/^[1-9][0-9]{2}$/.test(project)||!name||name.length>150||!site||site.length>200||!valid(managerEmail)||(qcEmail&&!valid(qcEmail))||engineerEmails.some(x=>!valid(x))||![0,1,true,false].includes(b.active)||!Number.isInteger(version)||version<0)return fail('Enter project 100–999, project name, site and one Project Manager. QC and Site Engineer are optional.');
 // One site engineer runs each site.
 if(engineerEmails.length>1)return fail('Assign one Site Engineer per site.');
 if((qcEmail&&managerEmail===qcEmail)||engineerEmails.includes(managerEmail)||(qcEmail&&engineerEmails.includes(qcEmail)))return fail('Project Manager, QC and Site Engineer assignments must be separate users.');
 const db=database(),old=await db.prepare('SELECT * FROM project_configs WHERE project=?').bind(project).first<any>();
 if((old?.version||0)!==version)return fail('Project configuration changed. Reload and retry.',409);
 const assignments=[{email:managerEmail,role:'Project Manager'},...(qcEmail?[{email:qcEmail,role:'QC'}]:[]),...engineerEmails.map(email=>({email,role:'Site Engineer'}))];
 for(const assignment of assignments){const u=await db.prepare('SELECT roles,active FROM app_users WHERE email=?').bind(assignment.email).first<any>();if(!u?.active||!JSON.parse(u.roles).includes(assignment.role))return fail(`${assignment.email} must be an active user with the ${assignment.role} role.`);}
 const now=new Date().toISOString(),event=crypto.randomUUID();
 const roleGuards=assignments.map(()=>`EXISTS(SELECT 1 FROM app_users u,json_each(u.roles) r WHERE u.email=? AND u.active=1 AND r.value=?)`).join(' AND ');
 const saved=await db.batch([
  db.prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT version FROM project_configs WHERE project=?),0)=? AND ${roleGuards}`).bind(event,'project:'+project,old?'Project configuration updated':'Project configured',JSON.stringify({by:a.email,after:{project,name,site,managerEmail,qcEmail,engineerEmails,active:!!b.active}}),now,project,version,...assignments.flatMap(x=>[x.email,x.role])),
  db.prepare(`INSERT INTO project_configs(project,name,site,manager_email,qc_emails,engineer_emails,active,version,updated)
   SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?)
   ON CONFLICT(project) DO UPDATE SET name=excluded.name,site=excluded.site,manager_email=excluded.manager_email,qc_emails=excluded.qc_emails,engineer_emails=excluded.engineer_emails,active=excluded.active,version=excluded.version,updated=excluded.updated`).bind(project,name,site,managerEmail,JSON.stringify(qcEmail?[qcEmail]:[]),JSON.stringify(engineerEmails),b.active?1:0,version+1,now,event),
  refreshProjectAccess(db,event)
 ]);
 return saved[0].meta.changes?Response.json({ok:true}):fail('Project configuration or assigned roles changed. Reload and retry.',409);
}
export async function GET(req:Request){return protect(req,'read',get);}
export async function POST(req:Request){return protect(req,'projects',save);}
