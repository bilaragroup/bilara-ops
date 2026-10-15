// Isolated API integration runtime. Never connects to the hosted site's data.
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';

export async function createRuntime(){
 // Source downloads use Vite-only import.meta.glob and are covered separately.
 const routes=readdirSync('app/api',{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name!=='source'&&existsSync(`app/api/${x.name}/route.ts`)).map(x=>x.name);
 const source=routes.map((r,i)=>`import * as r${i} from './app/api/${r}/route.ts';`).join('\n')+
 `\nconst routes={${routes.map((r,i)=>`${JSON.stringify('/api/'+r)}:r${i}`).join(',')}};export default {fetch(req){const route=routes[new URL(req.url).pathname];return route?.[req.method]?.(req)??new Response('Not found',{status:404});}}`;
 const bundled=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'qa-entry.ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],alias:{'@':process.cwd()},logLevel:'silent'});
 const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'bilara-isolated-qa'},r2Buckets:['FILES'],bindings:{SITE_MAIL_TEST:'1',SITE_CRON_SECRET:'qa-cron-secret'},d1Persist:false,r2Persist:false});
 try{
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){
   for(const stmt of readFileSync(path.join('drizzle',file),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(stmt).run();
  }
  await db.prepare('INSERT OR REPLACE INTO app_users (email,subject,name,roles,projects,active,version) VALUES (?,?,?,?,?,1,1)').bind('qa-admin@example.invalid','qa-admin','QA Admin','["Super Admin"]','[]').run();
  return {mf,db,dispose:()=>mf.dispose()};
 }catch(e){await mf.dispose();throw e;}
}
