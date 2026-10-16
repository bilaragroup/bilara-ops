// Project Managers and their projects, for the BOQ Team's request download (BOQ, GM, Audit, Super Admin).
import {protect} from '@/lib/access';
import {database} from '@/lib/database';

async function handleGET() {
  const db = database();
  const [ps, us] = await Promise.all([
    db.prepare('SELECT project,name,manager_email FROM project_configs ORDER BY CAST(project AS INTEGER)').all(),
    db.prepare('SELECT email,name FROM app_users').all(),
  ]);
  const names = new Map((us.results as any[]).map((u) => [String(u.email).toLowerCase(), String(u.name || u.email)]));
  const by = new Map<string, any>();
  for (const p of ps.results as any[]) {
    const email = String(p.manager_email || '').toLowerCase();
    if (!email) continue;
    if (!by.has(email)) by.set(email, {email, name: names.get(email) || email, projects: []});
    by.get(email).projects.push({project: String(p.project), name: String(p.name || '')});
  }
  return Response.json({managers: [...by.values()].sort((a, b) => a.name.localeCompare(b.name))}, {headers: {'Cache-Control': 'no-store'}});
}
export async function GET(req: Request) { return protect(req, 'managers', handleGET); }
