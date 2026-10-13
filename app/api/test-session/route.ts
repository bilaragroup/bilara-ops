import {database} from '@/lib/database';
import {actor} from '@/lib/access';
import {has} from '@/lib/permissions';

function local(req:Request){const h=new URL(req.url).hostname;return h==='localhost'||h==='127.0.0.1';}
function selected(req:Request){const raw=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('bilara_test_user='))?.slice('bilara_test_user='.length);return raw?decodeURIComponent(raw):'';}
async function superAdmin(req:Request){try{return has(await actor(req.headers,local(req),true),'Super Admin');}catch{return false;}}

export async function GET(req:Request){
 if(!await superAdmin(req))return Response.json({error:'Only the Super Admin can switch test roles.'},{status:403});
 const rows=await database().prepare('SELECT email,name,roles,projects FROM app_users WHERE active=1 ORDER BY name').all<any>();
 return Response.json({selected:selected(req),users:rows.results.map((u:any)=>({...u,roles:JSON.parse(u.roles),projects:JSON.parse(u.projects)}))},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(req:Request){
 if(!await superAdmin(req))return Response.json({error:'Only the Super Admin can switch test roles.'},{status:403});
 const body:any=await req.json(),email=String(body.email||'').trim().toLowerCase();
 if(email){const user=await database().prepare('SELECT email FROM app_users WHERE email=? AND active=1').bind(email).first<any>();if(!user)return Response.json({error:'Choose an active test user.'},{status:400});}
 const cookie=email?`bilara_test_user=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`:'bilara_test_user=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
 return Response.json({ok:true},{headers:{'Set-Cookie':cookie,'Cache-Control':'no-store'}});
}
