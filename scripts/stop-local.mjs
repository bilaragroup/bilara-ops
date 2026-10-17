// Stops the local app (npm run dev) however it was started, and clears its lock file.
//   npm run stop
import {readFileSync, rmSync, existsSync} from 'node:fs';
import {execSync} from 'node:child_process';
const lock = '.vinext/dev/lock.json';
const pids = new Set();
try { const p = JSON.parse(readFileSync(lock, 'utf8')).pid; if (p) pids.add(Number(p)); } catch {}
try { execSync('lsof -ti :3000', {encoding: 'utf8'}).split(/\s+/).filter(Boolean).forEach((p) => pids.add(Number(p))); } catch {}
for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); console.log('Stopped process ' + pid); } catch {} }
if (existsSync(lock)) rmSync(lock, {force: true});
console.log(pids.size ? 'The local app is stopped.' : 'The local app was not running.');
