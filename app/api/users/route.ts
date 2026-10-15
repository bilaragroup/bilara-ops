import { protect } from '@/lib/access';
import { database } from '@/lib/database';
import { roles, type Role } from '@/lib/permissions';
import { refreshProjectAccess } from '@/lib/project-assignments';

export async function GET(req: Request) {
  return protect(req, 'users', async () => {
    const r = await database()
      .prepare(
        'SELECT email,name,roles,projects,active,version FROM app_users ORDER BY name',
      )
      .all();
    return Response.json(
      {
        users: r.results.map((r: any) => ({
          email: String(r.email || ''),
          name: String(r.name || ''),
          roles: JSON.parse(r.roles),
          projects: JSON.parse(r.projects),
          active: r.active,
          version: r.version,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
export async function POST(req: Request) {
  return protect(req, 'users', async (req, a) => {
    const b: any = await req.json(),
      email = String(b.email || '')
        .trim()
        .toLowerCase(),
      name = String(b.name || '').trim();
    const fail = (error: string, status = 400) =>
      Response.json({ error }, { status });
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !name ||
      name.length > 100 ||
      !Array.isArray(b.roles) ||
      b.roles.length !== 1 ||
      b.roles.some((r: any) => !roles.includes(r)) ||
      !Array.isArray(b.projects) ||
      b.projects.some((p: any) => !/^[1-9][0-9]{2}$/.test(p)) ||
      ![0, 1].includes(b.active) ||
      !Number.isInteger(b.version) ||
      b.version < 0
    )
      return fail('Enter a name, email, exactly one role and valid project numbers.');
    if (email === a.email && (!b.active || !b.roles.includes('Super Admin')))
      return fail('You cannot remove your own Super Admin access.');
    const db = database(),
      old = await db
        .prepare('SELECT version,roles,projects FROM app_users WHERE email=?')
        .bind(email)
        .first<any>();
    if (old && b.version === 0)
      return fail(
        'This email already has an account. Open the existing user to edit it.',
        409,
      );
    if ((old?.version || 0) !== b.version)
      return fail('User changed. Reload and retry.', 409);
    const nextRoles: Role[] = [...new Set<Role>(b.roles)],
      oldRoles: Role[] = old ? JSON.parse(old.roles) : [],
      scoped: Role[] = ['Project Manager', 'QC', 'Site Engineer'];
    const removed = scoped.filter(
      (r) => oldRoles.includes(r) && (!b.active || !nextRoles.includes(r)),
    );
    // Scoped access is configured through projects, not client-supplied project IDs.
    const projects =
      nextRoles.some((r) => scoped.includes(r)) || removed.length
        ? []
        : b.projects;
    const id = crypto.randomUUID(),
      now = new Date().toISOString(),
      stmts = [
        db
          .prepare(
            'INSERT INTO history (id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT version FROM app_users WHERE email=?),0)=?',
          )
          .bind(
            id,
            email,
            'User access changed',
            JSON.stringify({
              by: a.email,
              roles: nextRoles,
              projects,
              removedAssignmentRoles: removed,
              previousProjects: old ? JSON.parse(old.projects) : [],
            }),
            now,
            email,
            b.version,
          ),
        db
          .prepare(
            'INSERT INTO app_users (email,name,roles,projects,active,version) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM history WHERE id=?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,roles=excluded.roles,projects=excluded.projects,active=excluded.active,version=excluded.version',
          )
          .bind(
            email,
            name,
            JSON.stringify(nextRoles),
            JSON.stringify(projects),
            b.active,
            b.version + 1,
            id,
          ),
      ];
    // Remove only assignments whose required role is being revoked. Other valid roles survive.
    if (removed.includes('Project Manager'))
      stmts.push(
        db
          .prepare(
            "UPDATE project_configs SET manager_email='',version=version+1,updated=? WHERE manager_email=? AND EXISTS(SELECT 1 FROM history WHERE id=?)",
          )
          .bind(now, email, id),
      );
    for (const [role, column] of [
      ['QC', 'qc_emails'],
      ['Site Engineer', 'engineer_emails'],
    ] as const) {
      if (removed.includes(role))
        stmts.push(
          db
            .prepare(
              `UPDATE project_configs SET ${column}=(SELECT json_group_array(value) FROM json_each(${column}) WHERE value<>?),version=version+1,updated=? WHERE EXISTS(SELECT 1 FROM json_each(${column}) WHERE value=?) AND EXISTS(SELECT 1 FROM history WHERE id=?)`,
            )
            .bind(email, now, email, id),
        );
    }
    stmts.push(refreshProjectAccess(db, id));
    const r = await db.batch(stmts);
    return r[0].meta.changes
      ? Response.json({ ok: true, projectsCleared: removed.length > 0 })
      : fail('User changed. Retry.', 409);
  });
}
