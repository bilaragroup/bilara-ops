'use client';
// BOQ schedule per project. The BOQ team (or GM) downloads the template, fills milestones ->
// activities -> items with the approved quantity, and uploads it. Everyone with access to the
// project can see what is approved, already requested and left.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Download, Upload, ListTree, TriangleAlert, Search, Trash2 } from 'lucide-react';
import { has } from '@/lib/permissions';
import { RATE_CARD_ITEMS } from '@/lib/rate-card';
import {
  type BoqLine,
  type ScheduleIssue,
  diffSchedule,
  overRequested,
  packLines,
  parseSchedule,
  requestedAgainst,
  scheduleFor,
} from '@/lib/boq-schedule';

const LIMIT = 60000; // the API refuses bodies over 70,000 characters
const fmt = (n: number) => Number(n.toFixed(3)).toLocaleString('en-IN');
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

type Preview = {
  fileName: string;
  lines: BoqLine[];
  issues: ScheduleIssue[];
  diff: ReturnType<typeof diffSchedule>;
  over: { line: BoqLine; requested: number }[];
};

async function post(body: any) {
  const r = await fetch('/api/boq-schedule', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await r.json();
  if (!r.ok) throw Error(data.error || 'Unable to save the BOQ schedule.');
  return data;
}

/** Split a save into steps of whole milestones so each request stays under the size limit. */
function saveSteps(oldLines: BoqLine[], lines: BoqLine[]) {
  const size = (ls: BoqLine[]) => JSON.stringify(packLines(ls)).length;
  if (size(lines) < LIMIT) return [{ milestones: null as string[] | null, lines }];
  const byMilestone = new Map<string, BoqLine[]>();
  for (const l of lines) byMilestone.set(l.milestone, [...(byMilestone.get(l.milestone) || []), l]);
  const steps: { milestones: string[] | null; lines: BoqLine[] }[] = [];
  let cur: { milestones: string[]; lines: BoqLine[] } = { milestones: [], lines: [] };
  for (const [m, ls] of byMilestone) {
    if (size(ls) >= LIMIT) throw Error(`Milestone ${m} alone is too large to upload (${ls.length} rows). Split its activities across two uploads.`);
    if (cur.lines.length && size([...cur.lines, ...ls]) >= LIMIT) {
      steps.push(cur);
      cur = { milestones: [], lines: [] };
    }
    cur.milestones.push(m);
    cur.lines.push(...ls);
  }
  if (cur.milestones.length) steps.push(cur);
  // Milestones that are no longer in the file are emptied in a last step.
  const gone = [...new Set(oldLines.map((l) => l.milestone))].filter((m) => !byMilestone.has(m));
  if (gone.length) steps.push({ milestones: gone, lines: [] });
  return steps;
}

export default function BoqSchedule({ records, project, setProject, projects, settings, user, refresh }: any) {
  const canEdit = has(user, 'BOQ Team', 'GM');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [jump, setJump] = useState('');

  const schedule = project === 'all' ? null : scheduleFor(records, project);
  const lines: BoqLine[] = schedule?.lines || [];
  const projectName = projects.find((p: any) => p.project === project)?.name || '';

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines
      .filter((l) => !q || [l.milestone, l.activity, l.activityName, l.item, l.unit].join(' ').toLowerCase().includes(q))
      .map((l) => ({ l, requested: requestedAgainst(records, project, l) }))
      .sort(
        (a, b) =>
          Number(a.l.milestone) - Number(b.l.milestone) ||
          Number(a.l.activity) - Number(b.l.activity) ||
          a.l.item.localeCompare(b.l.item),
      );
  }, [lines, records, project, query]);
  const overCount = useMemo(() => overRequested(records, project, lines).length, [records, project, lines]);
  const activityCount = new Set(lines.map((l) => l.milestone + '|' + l.activity)).size;

  async function download() {
    setError('');
    try {
      const { scheduleTemplate } = await import('@/lib/boq-schedule-excel');
      const blob = await scheduleTemplate(project, projectName, lines, settings.milestones);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BOQ-schedule-${project}${lines.length ? '' : '-blank'}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    setProgress('Reading the workbook…');
    try {
      const { readScheduleFile } = await import('@/lib/boq-schedule-excel');
      const values = await readScheduleFile(file);
      const parsed = parseSchedule(values, project, { milestones: settings.milestones, standardItems: RATE_CARD_ITEMS });
      setPreview({
        fileName: file.name,
        ...parsed,
        diff: diffSchedule(lines, parsed.lines),
        over: overRequested(records, project, parsed.lines),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function save() {
    if (!preview || preview.issues.length) return;
    setBusy(true);
    setError('');
    try {
      const steps = saveSteps(lines, preview.lines);
      let version = schedule?.version || 0;
      for (let i = 0; i < steps.length; i++) {
        setProgress(steps.length > 1 ? `Saving part ${i + 1} of ${steps.length}…` : 'Saving…');
        const s = steps[i];
        const res = await post({
          action: 'save',
          project,
          version,
          lines: packLines(s.lines),
          fileName: preview.fileName,
          ...(s.milestones ? { milestones: s.milestones } : {}),
        });
        version = res.version;
      }
      const d = preview.diff;
      setMessage(
        `Saved ${preview.lines.length} rows for project ${project}: ${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed.` +
          (preview.over.length ? ` ${preview.over.length} item(s) are already requested above the new quantity; further requests for them will need the GM.` : ''),
      );
      setPreview(null);
      await refresh({ skipDocuments: true });
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)) +
          ' Nothing after the failed step was saved; refresh and upload the file again to finish.',
      );
      await refresh({ skipDocuments: true });
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  async function clear() {
    setBusy(true);
    setError('');
    try {
      await post({ action: 'clear', project, version: schedule?.version || 0 });
      setMessage(`The BOQ schedule for project ${project} was cleared.`);
      setConfirmClear(false);
      await refresh({ skipDocuments: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (project === 'all') {
    // Project settings are only sent to assigned users, so also list projects seen in
    // requests and schedules; any other project can be opened by number.
    const names = new Map<string, string>(projects.map((p: any) => [String(p.project), p.name]));
    const numbers = [
      ...new Set<string>([
        ...projects.filter((p: any) => p.active).map((p: any) => String(p.project)),
        ...records
          .filter((r: any) => ['plan', 'request', 'boqschedule'].includes(r.kind) && r.project)
          .map((r: any) => String(r.project)),
      ]),
    ].sort((a, b) => Number(a) - Number(b));
    const list = numbers.map((n) => ({ project: n, name: names.get(n) || '' }));
    return (
      <section className="panel boq-schedule">
        <div className="section-title">
          <h2>BOQ schedules</h2>
          <ListTree size={18} />
        </div>
        <p className="muted">
          One schedule per project: milestones, activities and items with the approved quantity. Purchase
          requests take the approved quantity from here, so nobody has to type it. Choose a project.
        </p>
        <div className="boq-project-list">
          {list.map((p: any) => {
            const s = scheduleFor(records, p.project);
            const n = s?.lines?.length || 0;
            return (
              <button key={p.project} className="cash-row" onClick={() => setProject(p.project)}>
                <span>
                  <b>
                    {p.project}
                    {p.name ? ' · ' + p.name : ''}
                  </b>
                  <small>{n ? `Updated ${when(s.updatedAt)} by ${s.updatedBy}` : 'No schedule yet'}</small>
                </span>
                <span className={'tag ' + (n ? 'green' : 'amber')}>{n ? `${n} rows` : 'Not uploaded'}</span>
              </button>
            );
          })}
          {!list.length && <p className="muted">No projects with requests yet.</p>}
        </div>
        <form
          className="boq-jump"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[1-9][0-9]{2}$/.test(jump)) setProject(jump);
          }}
        >
          <label className="field">
            <span>Open another project</span>
            <input
              inputMode="numeric"
              pattern="[1-9][0-9]{2}"
              maxLength={3}
              placeholder="Project number, e.g. 120"
              value={jump}
              onChange={(e) => setJump(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </label>
          <button className="secondary" disabled={!/^[1-9][0-9]{2}$/.test(jump)}>
            Open
          </button>
        </form>
      </section>
    );
  }

  return (
    <>
      <section className="panel boq-schedule">
        <div className="tablebar boq-head">
          <div>
            <h2>
              Project {project}
              {projectName ? ' · ' + projectName : ''}
            </h2>
            <p>
              {lines.length
                ? `${lines.length} items in ${activityCount} activities · updated ${when(schedule.updatedAt)} by ${schedule.updatedBy}${schedule.fileName ? ' · ' + schedule.fileName : ''}`
                : 'No schedule uploaded yet. Requests wait for the BOQ team to enter the approved quantity.'}
            </p>
          </div>
          <div className="actions">
            <button className="secondary" onClick={download} disabled={busy}>
              <Download size={15} /> {lines.length ? 'Download current schedule' : 'Download template'}
            </button>
            {canEdit && (
              <label className={'primary file-button' + (busy ? ' disabled' : '')}>
                <Upload size={15} /> Upload XLSX
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={busy}
                  onChange={(e) => {
                    read(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>
        </div>
        {progress && <p className="alert">{progress}</p>}
        {error && (
          <p className="alert red" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="alert green" role="status">
            {message}
          </p>
        )}
        {!!overCount && (
          <p className="alert amber">
            <TriangleAlert size={16} /> {overCount} item{overCount === 1 ? ' is' : 's are'} already requested above the
            approved quantity. New requests for {overCount === 1 ? 'it' : 'them'} go to the GM.
          </p>
        )}
        {lines.length > 0 && (
          <div className="filters">
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by activity, item or milestone"
                aria-label="Filter the schedule"
              />
            </label>
            {canEdit && (
              <button className="secondary boq-clear" onClick={() => setConfirmClear(true)} disabled={busy}>
                <Trash2 size={15} /> Clear schedule
              </button>
            )}
          </div>
        )}
      </section>
      {lines.length > 0 && (
        <section className="panel tablepanel">
          <Table>
            <TableHeader>
              <TableRow>
                {['Milestone / activity', 'Item', 'Approved', 'Requested', 'Left'].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ l, requested }, i) => {
                const left = l.qty - requested;
                const first = i === 0 || rows[i - 1].l.milestone !== l.milestone || rows[i - 1].l.activity !== l.activity;
                return (
                  <TableRow key={[l.milestone, l.activity, l.item, l.unit].join('|')} className={left < 0 ? 'row-bad' : ''}>
                    <TableCell>
                      {first ? (
                        <>
                          <b>
                            A{l.activity} · {l.activityName}
                          </b>
                          <small>Milestone {l.milestone}</small>
                        </>
                      ) : (
                        <small className="boq-same">″</small>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.item}
                      {l.notes && <small>{l.notes}</small>}
                    </TableCell>
                    <TableCell>
                      {fmt(l.qty)} {l.unit}
                    </TableCell>
                    <TableCell>
                      {fmt(requested)} {l.unit}
                    </TableCell>
                    <TableCell>
                      {left < 0 ? (
                        <span className="tag red">Over by {fmt(-left)}</span>
                      ) : (
                        <b>
                          {fmt(left)} {l.unit}
                        </b>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!rows.length && <p className="empty">No items match “{query}”.</p>}
        </section>
      )}
      {!lines.length && canEdit && (
        <section className="panel boq-steps">
          <h3>How to set it up</h3>
          <ol>
            <li>Download the template. The project number is already filled in.</li>
            <li>Fill one row per item per activity: milestone, activity number and name, item, unit and the approved quantity.</li>
            <li>Upload it here. You will see every row that has a problem, or what will be added, before anything is saved.</li>
          </ol>
          <p className="muted">No rates go in the sheet. Rates stay in Settings → Project rate catalogue.</p>
        </section>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && !busy && setPreview(null)}>
        <DialogContent className="wide-dialog">
          <DialogTitle>{preview?.issues.length ? 'Fix these rows and upload again' : 'Check before saving'}</DialogTitle>
          <DialogDescription>
            {preview?.fileName} · project {project}
          </DialogDescription>
          {preview && preview.issues.length > 0 && (
            <>
              <p className="alert red">
                {preview.issues.length} problem{preview.issues.length === 1 ? '' : 's'} found. Nothing has been saved.
              </p>
              <ul className="boq-issues">
                {preview.issues.slice(0, 60).map((x, i) => (
                  <li key={i}>
                    <b>Row {x.row}</b> {x.message}
                  </li>
                ))}
              </ul>
              {preview.issues.length > 60 && <p className="muted">…and {preview.issues.length - 60} more.</p>}
            </>
          )}
          {preview && !preview.issues.length && (
            <>
              <div className="boq-diff">
                {(
                  [
                    ['Added', preview.diff.added.length, 'green'],
                    ['Changed', preview.diff.changed.length, 'amber'],
                    ['Removed', preview.diff.removed.length, preview.diff.removed.length ? 'red' : ''],
                    ['Unchanged', preview.diff.same, ''],
                  ] as const
                ).map(([label, n, tone]) => (
                  <div key={label} className={'boq-diff-cell ' + tone}>
                    <strong>{n}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              {preview.diff.changed.length > 0 && (
                <details open={preview.diff.changed.length <= 10}>
                  <summary>Quantity and name changes</summary>
                  <ul className="boq-issues">
                    {preview.diff.changed.slice(0, 50).map(({ from, to }, i) => (
                      <li key={i}>
                        <b>
                          M{to.milestone} · A{to.activity} · {to.item}
                        </b>{' '}
                        {from.qty !== to.qty ? `${fmt(from.qty)} → ${fmt(to.qty)} ${to.unit}` : ''}
                        {from.activityName !== to.activityName ? ` · renamed “${from.activityName}” → “${to.activityName}”` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.diff.removed.length > 0 && (
                <details>
                  <summary>Rows that will be removed</summary>
                  <ul className="boq-issues">
                    {preview.diff.removed.slice(0, 50).map((l, i) => (
                      <li key={i}>
                        M{l.milestone} · A{l.activity} {l.activityName} · {l.item} {fmt(l.qty)} {l.unit}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {preview.over.length > 0 && (
                <p className="alert amber">
                  <TriangleAlert size={16} /> {preview.over.length} item{preview.over.length === 1 ? ' is' : 's are'} already
                  requested above the new quantity (for example {preview.over[0].line.item}, A{preview.over[0].line.activity}:{' '}
                  {fmt(preview.over[0].requested)} requested, {fmt(preview.over[0].line.qty)} approved). Requests already made stay as
                  they are; new ones will need the GM.
                </p>
              )}
              <p className="footnote">
                Requests already priced keep the quantity they were checked against. New and still-submitted requests use this
                schedule.
              </p>
              {error && (
                <p className="alert red" role="alert">
                  {error}
                </p>
              )}
              <div className="formfooter">
                <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>
                  Cancel
                </button>
                <button className="primary" disabled={busy} onClick={save}>
                  {busy ? progress || 'Saving…' : `Save ${preview.lines.length} rows`}
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClear} onOpenChange={(o) => !busy && setConfirmClear(o)}>
        <DialogContent className="wide-dialog">
          <DialogTitle>Clear the BOQ schedule for project {project}?</DialogTitle>
          <DialogDescription>
            New requests will wait for the BOQ team to enter the approved quantity again. Existing requests keep their
            quantity. The history keeps a copy of what was removed.
          </DialogDescription>
          <div className="formfooter">
            <button className="secondary" disabled={busy} onClick={() => setConfirmClear(false)}>
              Keep it
            </button>
            <button className="primary danger" disabled={busy} onClick={clear}>
              {busy ? 'Clearing…' : 'Clear schedule'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
