import {protect} from '@/lib/access';
import {Actor,confidential,cleanSettings} from '@/lib/permissions';
import {database} from '@/lib/database';
import {defaultSettings,validateSettings} from '@/lib/settings';
import {MILESTONE_NUMBERS} from '@/lib/activities';
async function handleGET(req:Request,a:Actor){try{const row=await database().prepare("SELECT * FROM settings WHERE id='main'").first<any>(),values=row?{...defaultSettings,...JSON.parse(row.data)}:defaultSettings;
// Only the company milestones (1-5) are offered, even if an older saved list had more.
values.milestones=(values.milestones||[]).filter((m:any)=>MILESTONE_NUMBERS.includes(String(m)));if(!values.milestones.length)values.milestones=defaultSettings.milestones;return Response.json({values:confidential(a)?values:cleanSettings(values),version:row?.version||0},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Settings are unavailable.'},{status:503});}}
async function handlePOST(req:Request,a:Actor){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Origin not allowed'},{status:403});
 const text=await req.text();if(text.length>70000)throw Error('Settings are too large.');const b=JSON.parse(text),values=validateSettings({...b.values,projectRates:[]}),db=database(),now=new Date().toISOString();if(!Number.isInteger(b.version)||b.version<0)throw Error('Refresh settings before saving.');
 const old=await db.prepare("SELECT * FROM settings WHERE id='main'").first<any>();if((old?.version||0)!==b.version)return Response.json({error:'Settings changed. Reload before saving.'},{status:409});
 // Rate cards are kept by /api/rate-cards (BOQ Team and Super Admin); a Settings save leaves them as they are.
 {const kept=old?JSON.parse(old.data):{};values.projectRates=kept.projectRates||[];values.rateCardImportedAt=kept.rateCardImportedAt||'';values.rateCardImportedFile=kept.rateCardImportedFile||'';}
 const event=crypto.randomUUID();const result=await db.batch([
 db.prepare("INSERT INTO history(id,record_id,action,data,at) SELECT ?,'settings','Settings updated',?,? WHERE COALESCE((SELECT version FROM settings WHERE id='main'),0)=?").bind(event,JSON.stringify({before:old?JSON.parse(old.data):defaultSettings,after:values}),now,b.version),
 db.prepare("INSERT INTO settings(id,data,version,updated) SELECT 'main',?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated").bind(JSON.stringify(values),b.version+1,now,event)
 ]);if(!result[0].meta.changes)return Response.json({error:'Settings changed. Reload before saving.'},{status:409});return Response.json({values,version:b.version+1});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Unable to save settings.'},{status:400});}}

export async function GET(req:Request){return protect(req,'read',handleGET);}

export async function POST(req:Request){return protect(req,'settings',handlePOST);}
