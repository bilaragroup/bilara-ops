// BOQ schedule per project: milestones -> activities -> items with the approved quantity.
// The BOQ team uploads it once from Excel (template from the app); PM requests then take
// the approved activity quantity from here instead of anyone typing it.
// Pure functions only (no imports) so the server, the screens and the tests share them.

export type BoqLine = {
  milestone: string;
  activity: string;
  activityName: string;
  item: string;
  unit: string;
  qty: number;
  notes?: string;
};
export type ScheduleIssue = { row: number; message: string };

export const BOQ_SCHEDULE_KIND = 'boqschedule';
export const BOQ_SCHEDULE_SHEET = 'BOQ Schedule';
export const BOQ_SCHEDULE_COLUMNS = [
  'Project',
  'Milestone',
  'Activity No.',
  'Activity Name',
  'Item',
  'Unit',
  'Approved Quantity',
  'Notes',
] as const;
export const MAX_SCHEDULE_LINES = 3000;

export const scheduleSource = (project: string) => 'boqschedule:' + project;
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const lower = (v: unknown) => clean(v).toLowerCase();

/** Same identity the request check uses: project + milestone + activity + item + unit. */
export function lineKey(milestone: unknown, activity: unknown, item: unknown, unit: unknown) {
  return [clean(milestone), clean(activity), lower(item), lower(unit)].join('|');
}

/** Saved schedule record for a project, if any. */
export function scheduleFor(records: any[], project: string): any | null {
  return (
    records.find(
      (r) => r.kind === BOQ_SCHEDULE_KIND && String(r.project) === String(project),
    ) || null
  );
}

export function findLine(
  schedule: { lines?: BoqLine[] } | null | undefined,
  milestone: unknown,
  activity: unknown,
  item: unknown,
  unit: unknown,
): BoqLine | null {
  if (!schedule?.lines?.length) return null;
  const k = lineKey(milestone, activity, item, unit);
  return schedule.lines.find((l) => lineKey(l.milestone, l.activity, l.item, l.unit) === k) || null;
}

/** Activities of one milestone, sorted by number, for the PM's activity picker. */
export function activitiesOf(schedule: { lines?: BoqLine[] } | null | undefined, milestone: unknown) {
  const seen = new Map<string, string>();
  for (const l of schedule?.lines || [])
    if (clean(l.milestone) === clean(milestone) && !seen.has(l.activity))
      seen.set(l.activity, l.activityName);
  return [...seen.entries()]
    .map(([activity, activityName]) => ({ activity, activityName }))
    .sort((a, b) => Number(a.activity) - Number(b.activity));
}

export function linesOf(schedule: { lines?: BoqLine[] } | null | undefined, milestone: unknown, activity: unknown) {
  return (schedule?.lines || []).filter(
    (l) => clean(l.milestone) === clean(milestone) && clean(l.activity) === clean(activity),
  );
}

/**
 * Quantity already requested against a schedule line, counted the same way the
 * request check counts it (rejected requests excluded). `excludeId` leaves out the
 * request being edited.
 */
export function requestedAgainst(records: any[], project: string, line: BoqLine, excludeId?: string) {
  const k = lineKey(line.milestone, line.activity, line.item, line.unit);
  return records
    .filter(
      (r) =>
        ['plan', 'request'].includes(r.kind) &&
        r.id !== excludeId &&
        String(r.project) === String(project) &&
        r.stage !== 'Rejected' &&
        lineKey(r.milestone, r.activity, r.item, r.unit) === k,
    )
    .reduce((n, r) => n + Number(r.requestedQty || r.boqQty || r.qty || 0), 0);
}

/**
 * Validate rows read from the template. `values[0]` is the heading row.
 * Returns every problem with its Excel row number instead of stopping at the first.
 */
export function parseSchedule(
  values: unknown[][],
  project: string,
  options: { milestones: string[]; standardItems?: readonly string[] },
): { lines: BoqLine[]; issues: ScheduleIssue[] } {
  const issues: ScheduleIssue[] = [];
  const lines: BoqLine[] = [];
  if (!values.length) return { lines, issues: [{ row: 1, message: 'The sheet is empty.' }] };
  const headers = (values[0] || []).map((v) => clean(v).replace(/^﻿/, ''));
  const missing = BOQ_SCHEDULE_COLUMNS.slice(0, 7).filter((h, i) => headers[i] !== h);
  if (missing.length)
    return {
      lines,
      issues: [
        {
          row: 1,
          message: `Use the BOQ schedule template from the app without renaming or moving columns (expected ${BOQ_SCHEDULE_COLUMNS.join(', ')}).`,
        },
      ],
    };
  const standard = new Map((options.standardItems || []).map((s) => [s.toLowerCase(), s]));
  const seen = new Map<string, number>();
  const activityNames = new Map<string, { name: string; row: number }>();
  for (let i = 1; i < values.length; i++) {
    const v = values[i] || [];
    const row = i + 1;
    // Template rows come with the project pre-filled; a row with nothing else is blank.
    if (!v.slice(1, 8).some((x) => clean(x))) continue;
    const before = issues.length;
    const p = clean(v[0]).replace(/\.0+$/, '');
    const milestone = clean(v[1]).replace(/\.0+$/, '');
    const activity = clean(v[2]).replace(/\.0+$/, '');
    const activityName = clean(v[3]);
    const rawItem = clean(v[4]);
    const unit = clean(v[5]).toUpperCase();
    const qtyText = clean(v[6]).replace(/[,\s]/g, '');
    const qty = Number(qtyText);
    const notes = clean(v[7]).slice(0, 500);
    const bad = (message: string) => issues.push({ row, message });
    if (p !== String(project)) bad(`Project is "${p || 'blank'}"; this upload is for project ${project}.`);
    if (!options.milestones.includes(milestone))
      bad(`Milestone "${milestone || 'blank'}" is not one of ${options.milestones.join(', ')} (Settings).`);
    if (!/^[1-9][0-9]{0,2}$/.test(activity)) bad('Activity No. must be a whole number from 1 to 999.');
    if (!activityName) bad('Activity Name is required.');
    else if (activityName.length > 200) bad('Activity Name is longer than 200 characters.');
    if (!rawItem) bad('Item is required.');
    else if (rawItem.length > 120) bad('Item is longer than 120 characters.');
    if (!unit) bad('Unit is required (for example BAG, KG, CFT, NOS).');
    else if (unit.length > 20) bad('Unit is longer than 20 characters.');
    if (!qtyText || !Number.isFinite(qty) || qty <= 0 || qty > 1e9)
      bad('Approved Quantity must be a number greater than zero.');
    if (issues.length > before) continue;
    const item = standard.get(rawItem.toLowerCase()) || rawItem;
    const actKey = milestone + '|' + activity;
    const named = activityNames.get(actKey);
    if (named && named.name.toLowerCase() !== activityName.toLowerCase()) {
      bad(`Activity ${activity} in milestone ${milestone} is called "${named.name}" on row ${named.row}. Use one name per activity.`);
      continue;
    }
    if (!named) activityNames.set(actKey, { name: activityName, row });
    const k = lineKey(milestone, activity, item, unit);
    if (seen.has(k)) {
      bad(`${item} (${unit}) is already listed for milestone ${milestone}, activity ${activity} on row ${seen.get(k)}. Combine them into one row.`);
      continue;
    }
    seen.set(k, row);
    lines.push({ milestone, activity, activityName: named?.name || activityName, item, unit, qty, ...(notes ? { notes } : {}) });
  }
  if (!lines.length && !issues.length) issues.push({ row: 2, message: 'No schedule rows were found below the headings.' });
  if (lines.length > MAX_SCHEDULE_LINES)
    issues.push({ row: 1, message: `A project schedule can have up to ${MAX_SCHEDULE_LINES} rows.` });
  return { lines, issues };
}

/** Compact wire format so a large schedule fits in the API's request size limit. */
export const packLines = (lines: BoqLine[]) =>
  lines.map((l) => [l.milestone, l.activity, l.activityName, l.item, l.unit, l.qty, l.notes || '']);
export const unpackLines = (rows: unknown[]): unknown[][] =>
  (Array.isArray(rows) ? rows : []).map((r) => (Array.isArray(r) ? r : []));

/** What an upload would change, for the preview before saving. */
export function diffSchedule(oldLines: BoqLine[] = [], newLines: BoqLine[] = []) {
  const before = new Map(oldLines.map((l) => [lineKey(l.milestone, l.activity, l.item, l.unit), l]));
  const after = new Map(newLines.map((l) => [lineKey(l.milestone, l.activity, l.item, l.unit), l]));
  const added: BoqLine[] = [], removed: BoqLine[] = [], changed: { from: BoqLine; to: BoqLine }[] = [];
  let same = 0;
  for (const [k, l] of after) {
    const o = before.get(k);
    if (!o) added.push(l);
    else if (o.qty !== l.qty || o.activityName !== l.activityName || (o.notes || '') !== (l.notes || '')) changed.push({ from: o, to: l });
    else same++;
  }
  for (const [k, l] of before) if (!after.has(k)) removed.push(l);
  return { added, removed, changed, same };
}

/**
 * Lines whose approved quantity is now below what is already requested; saving is
 * allowed, but later requests for them will need the GM.
 */
export function overRequested(records: any[], project: string, lines: BoqLine[]) {
  return lines
    .map((line) => ({ line, requested: requestedAgainst(records, project, line) }))
    .filter((x) => x.requested > x.line.qty);
}
