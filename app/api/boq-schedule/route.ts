import { protect } from '@/lib/access';
import { Actor, has, inProject } from '@/lib/permissions';
import { database, decode } from '@/lib/database';
import { defaultSettings } from '@/lib/settings';
import { RATE_CARD_ITEMS } from '@/lib/rate-card';
import { validProject } from '@/lib/calculations';
import {
  BOQ_SCHEDULE_COLUMNS,
  BOQ_SCHEDULE_KIND,
  type BoqLine,
  diffSchedule,
  overRequested,
  parseSchedule,
  scheduleSource,
  unpackLines,
} from '@/lib/boq-schedule';

// BOQ schedule per project (BOQ Team, GM, Super Admin).
//  save   replace the project's schedule, or only the listed milestones (large files are
//         sent a few milestones at a time to stay under the request size limit)
//  clear  remove the project's schedule
// Every write checks the version the user saw, so two uploads cannot overwrite each other.
// Existing requests keep the quantity they were checked against; new and edited requests
// use the saved schedule.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function handlePOST(req: Request, a: Actor) {
  try {
    if (!has(a, 'BOQ Team', 'GM'))
      return fail('Only the BOQ team or GM can change a BOQ schedule.', 403);
    const b = JSON.parse(await req.text());
    const action = String(b.action || ''),
      project = String(b.project || '').trim(),
      version = Number(b.version || 0);
    if (!validProject(project)) return fail('Choose a project from 100 to 999.');
    if (!inProject(a, project)) return fail('This project is outside your access.', 403);
    const db = database(),
      now = new Date().toISOString();
    const raw = await db
      .prepare('SELECT * FROM records WHERE source_id=?')
      .bind(scheduleSource(project))
      .first<any>();
    const old = raw ? decode(raw) : null;
    if ((old?.version || 0) !== version)
      return fail('The BOQ schedule changed since you opened it. Refresh and upload again.', 409);
    const oldLines: BoqLine[] = old?.lines || [];

    let lines: BoqLine[];
    if (action === 'clear') lines = [];
    else if (action === 'save') {
      const saved = await db.prepare("SELECT data FROM settings WHERE id='main'").first<any>();
      const settings = { ...defaultSettings, ...(saved ? JSON.parse(saved.data) : {}) };
      // Re-check on the server exactly what the browser checked.
      const rows = unpackLines(b.lines).map((r) => [project, ...r]);
      const { lines: incoming, issues } = parseSchedule(
        [[...BOQ_SCHEDULE_COLUMNS], ...rows],
        project,
        { milestones: settings.milestones, standardItems: RATE_CARD_ITEMS },
      );
      if (issues.length)
        return fail(
          'The schedule has problems: ' +
            issues.slice(0, 5).map((i) => `row ${i.row}: ${i.message}`).join(' '),
        );
      const only: string[] | null = Array.isArray(b.milestones)
        ? b.milestones.map((m: unknown) => String(m))
        : null;
      if (only && incoming.some((l) => !only.includes(l.milestone)))
        return fail('A row belongs to a milestone that is not part of this upload step.');
      lines = only
        ? [...oldLines.filter((l) => !only.includes(l.milestone)), ...incoming]
        : incoming;
      // A partial step may add rows already present in a milestone it does not replace.
      const keys = new Set<string>();
      for (const l of lines) {
        const k = [l.milestone, l.activity, l.item.toLowerCase(), l.unit.toLowerCase()].join('|');
        if (keys.has(k)) return fail(`${l.item} (${l.unit}) appears twice in milestone ${l.milestone}, activity ${l.activity}.`);
        keys.add(k);
      }
    } else return fail('Unknown action.');

    const records = (await db.prepare("SELECT * FROM records WHERE kind IN ('plan','request')").all()).results.map(decode);
    const change = diffSchedule(oldLines, lines);
    const data = {
      project,
      lines,
      updatedBy: a.name,
      updatedByEmail: a.email,
      updatedAt: now,
      fileName: String(b.fileName || '').slice(0, 200),
    };
    const summary = {
      added: change.added.length,
      changed: change.changed.length,
      removed: change.removed.length,
      lines: lines.length,
      by: a.name,
      fileName: data.fileName,
    };
    const event = crypto.randomUUID();
    const label = action === 'clear' ? 'BOQ schedule cleared' : 'BOQ schedule uploaded';
    // History is written first and only if the version still matches; the record write
    // depends on that history row, so the two succeed or fail together.
    const guard = `EXISTS(SELECT 1 FROM history WHERE id='${event}')`;
    const versionNow = `COALESCE((SELECT version FROM records WHERE source_id=?),0)=?`;
    const statements = [
      db
        .prepare(`INSERT INTO history(id,record_id,action,data,at) SELECT ?,?,?,?,? WHERE ${versionNow}`)
        .bind(event, old?.id || scheduleSource(project), label, JSON.stringify({ ...summary, changes: { added: change.added.slice(0, 200), changed: change.changed.slice(0, 200), removed: change.removed } }), now, scheduleSource(project), version),
      old
        ? db
            .prepare(`UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=? AND ${guard}`)
            .bind(JSON.stringify(data), now, old.id, old.version)
        : db
            .prepare(`INSERT INTO records(id,kind,parent,source_id,data,version,total,paid,updated) SELECT ?,?,NULL,?,?,1,0,0,? WHERE ${guard}`)
            .bind(crypto.randomUUID(), BOQ_SCHEDULE_KIND, scheduleSource(project), JSON.stringify(data), now),
    ];
    const result = await db.batch(statements);
    if (!result[0].meta.changes || !result[1].meta.changes)
      return fail('The BOQ schedule changed since you opened it. Refresh and upload again.', 409);
    return Response.json({
      ok: true,
      version: (old?.version || 0) + 1,
      ...summary,
      overRequested: overRequested(records, project, lines).slice(0, 50),
    });
  } catch (e) {
    return fail(e instanceof SyntaxError ? 'Send the schedule as JSON.' : 'Unable to save the BOQ schedule. Please retry.');
  }
}

export async function POST(req: Request) {
  return protect(req, 'boqSchedule', handlePOST);
}
