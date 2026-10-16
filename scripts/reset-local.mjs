// Removes ALL data from the LOCAL copy (the .wrangler folder on this computer): requests,
// orders, payments, documents, users, projects, settings, rate cards, site and QC records,
// and uploaded files. The tables stay, so the app starts empty. The live site is never touched:
// this only runs wrangler with --local against wrangler.local.jsonc.
//
//   1. stop npm run dev
//   2. npm run demo:reset          (asks you to type RESET; add -- --yes to skip the question)
//   3. npm run dev, then npm run seed:demo for fresh sample data
import {execFileSync} from 'node:child_process';
import {existsSync, rmSync, readdirSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (!existsSync('wrangler.local.jsonc')) { console.error('wrangler.local.jsonc is missing. Run this in the bilara-ops folder.'); process.exit(1); }
if (!existsSync('.wrangler/state')) { console.error('No local data found (.wrangler/state). Run  bash setup-local.sh  first.'); process.exit(1); }

if (!process.argv.includes('--yes')) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  const answer = await rl.question('This deletes every record, user, project, file and setting in your LOCAL copy.\nThe live site is not touched. Stop "npm run dev" first.\nType RESET to continue: ');
  rl.close();
  if (answer.trim() !== 'RESET') { console.log('Nothing was deleted.'); process.exit(0); }
}

const wrangler = (sql) => execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'DB', '--local', '--config', 'wrangler.local.jsonc', '--json', '--command', sql],
  {encoding: 'utf8', env: {...process.env, CI: '1'}, stdio: ['ignore', 'pipe', 'inherit']});

console.log('1/3  Finding the local tables…');
const listed = JSON.parse(wrangler("SELECT name FROM sqlite_master WHERE type='table'"));
const tables = (listed[0]?.results || []).map((r) => r.name)
  .filter((n) => !/^(sqlite_|_cf_|d1_)/.test(n) && n !== 'd1_migrations' && n !== '__drizzle_migrations');
if (!tables.length) { console.error('No tables found. Run  bash setup-local.sh  first.'); process.exit(1); }

console.log(`2/3  Emptying ${tables.length} tables…`);
wrangler(tables.map((t) => `DELETE FROM "${t.replace(/"/g, '""')}";`).join(' '));
// The local sign-in user, as setup-local.sh creates it.
wrangler(`INSERT OR REPLACE INTO app_users (email,name,roles,projects,active,version) VALUES ('seedy@sites.test','Local Admin','["Super Admin"]','[]',1,1);`);

console.log('3/3  Removing uploaded files (photos, bills, reports)…');
let removed = 0;
const r2 = '.wrangler/state/v3/r2';
if (existsSync(r2)) for (const entry of readdirSync(r2)) { rmSync(join(r2, entry), {recursive: true, force: true}); removed++; }

console.log(`\nDone: ${tables.length} tables emptied${removed ? ', uploaded files removed' : ''}. The local admin (seedy@sites.test) is back.`);
console.log('Next:  npm run dev   then in a second terminal   npm run seed:demo');
