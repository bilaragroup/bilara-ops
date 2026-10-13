import {protect} from '@/lib/access';
import {Actor,confidential,visible,inProject,has} from '@/lib/permissions';
import source from '@/data/meta.json';
import {validProject} from '@/lib/calculations';
const loaders=import.meta.glob('/data/chunks/*.json',{query:'?raw',import:'default'});
async function handleGET(req:Request,a:Actor){const q=new URL(req.url).searchParams;const kind=q.get('kind')==='payment'?'payment':'purchase';const query=(q.get('q')||'').toLowerCase();const sheet=q.get('sheet');const project=q.get('project');const offset=Math.max(0,Number(q.get('offset'))||0);let count=0;const rows:any[]=[];
 for(const s of source.sheets.filter(s=>s.kind===kind&&(!sheet||s.name===sheet))){const raw=await loaders['/data/chunks/'+s.chunk+'.json']();const chunk=JSON.parse(String(raw));for(const r of chunk){if((!project||r.project===project)&&(!query||[r.item,r.vendor,r.project,r.id,r.status].join(' ').toLowerCase().includes(query))){if(count>=offset&&rows.length<50)rows.push(r);count++;}}}
 return Response.json({rows:rows.map(r=>({...r,issues:validProject(r.project)?r.issues:[...r.issues,'Project must be a whole number from 100 to 999']})),count,summary:source.summary,sheets:source.sheets,projects:source.projects[kind],issues:source.analysis},{headers:{'Cache-Control':'private, max-age=60'}});}

export async function GET(req:Request){return protect(req,'source',handleGET);}
