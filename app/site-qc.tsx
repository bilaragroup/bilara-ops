'use client';
// Quality checks, converted from the QC app's PM Checklist Builder, Checklist Register, QC Calendar
// and QC Inspection screens. Blended into the site pages:
//  PM / Admin   Quality checks: checklists (build, publish, edit, delete), register and records,
//               QC visit calendar and bookings, re-site visits, checklist templates, drawings
//  GM           Quality checks: register, records and the QC calendar (books and edits visits)
//  QC           My QC visits: accept or reject a booking, run the inspection with photos and
//               evidence, sign and submit; block dates on the calendar
import { useEffect, useMemo, useState } from 'react';
import { siteCall, requestId, istToday, addDays, niceDate, titleCase, photoData } from '@/lib/site-client';
import { Sel, Txt, Photos } from './site-dpr';

type Any = any;
const REVISIONS = Array.from({ length: 20 }, (_, i) => 'R' + String(i + 1).padStart(2, '0'));
const ASSESSMENTS: [string, string][] = [['', 'Select…'], ['SATISFACTORY', 'Satisfactory'], ['MINOR DEFECT', 'Minor defect'], ['MAJOR DEFECT', 'Major defect'], ['NA', 'Not applicable']];
const UNAVAILABLE = ['Leave', 'Training', 'Holiday', 'Blocked', 'Other'];
const projLabel = (p: Any) => `${p.Project_Number || p.projectNumber || p.Project_ID || p.projectId} — ${p.Client || p.client || p.Project_Name || p.projectName || ''}`;
const resultTone = (r: string) => /PASSED/i.test(r) ? 'green' : /FAIL|HOLD/i.test(r) ? 'red' : r ? 'amber' : '';

function datesBetween(start: string, end: string) {
  if (!start) return [];
  const out: string[] = [];
  for (let d = start; d <= (end || start) && out.length < 32; d = addDays(d, 1)) out.push(d);
  return out;
}
function useLoad(fn: () => Promise<Any>, deps: any[]) {
  const [data, setData] = useState<Any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setError(''); try { setData(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { run(); }, deps);
  return { data, setData, error, busy, run };
}
function Notice({ error, message }: Any) {
  return <>{error && <p className="alert red" role="alert">{error}</p>}{message && <p className="alert green">{message}</p>}</>;
}

/** Files kept for an inspection (was a Google Drive folder). Opens inline instead of a new site. */
export function FileList({ url, prefix, title = 'Files' }: Any) {
  const key = prefix || (url ? new URLSearchParams(String(url).split('?')[1] || '').get('files') || '' : '');
  const { data, error, busy } = useLoad(() => siteCall('listSiteFiles', key), [key]);
  if (!key) return null;
  return (
    <div className="qc-files">
      <b>{title}</b>
      {busy && <p className="muted">Loading…</p>}
      {error && <p className="neg">{error}</p>}
      {data && (data.files.length
        ? <ul>{data.files.map((f: Any) => <li key={f.key}><a href={f.url} target="_blank" rel="noopener">{f.key.slice(key.length + 1) || f.name}</a> <small className="muted">{Math.max(1, Math.round(f.size / 1024))} KB</small></li>)}</ul>
        : <p className="muted">No files yet.</p>)}
    </div>
  );
}

// ======================= PM / GM / Admin: Quality checks =======================

export function SiteQuality({ boot }: Any) {
  const role = boot?.user?.role;
  const canBuild = role === 'PM' || role === 'ADMIN';
  const [view, setView] = useState('register');
  const [editId, setEditId] = useState('');
  const [prefill, setPrefill] = useState<Any>(null);
  const book = (projectId: string, projectChecklistId: string, qcEmail = '', plannedDate = '', plannedEndDate = '') => { setPrefill({ projectId, projectChecklistId, qcEmail, plannedDate, plannedEndDate, at: Date.now() }); setView('calendar'); };
  const tabs: [string, string, boolean][] = [
    ['register', 'Checklists', true], ['new', editId ? 'Edit checklist' : 'New checklist', canBuild], ['calendar', 'QC visit calendar', true],
    ['templates', 'Checklist templates', canBuild], ['drawings', 'Drawings', canBuild],
  ];
  return (
    <section className="site-page">
      <div className="site-tabs" role="tablist">
        {tabs.filter((t) => t[2]).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => { if (id === 'new' && view !== 'new') setEditId(''); setView(id); }}>{label}</button>)}
      </div>
      {view === 'register' && <Register boot={boot} onBook={book} onEdit={(id: string) => { setEditId(id); setView('new'); }} />}
      {view === 'new' && canBuild && <Builder key={editId || 'new'} boot={boot} editId={editId} onBook={book} onDone={() => { setEditId(''); setView('register'); }} />}
      {view === 'calendar' && <QcCalendar boot={boot} prefill={prefill} />}
      {view === 'templates' && canBuild && <Templates />}
      {view === 'drawings' && canBuild && <Drawings boot={boot} />}
    </section>
  );
}

// ---------- checklist register and records ----------

function Register({ boot, onBook, onEdit }: Any) {
  const role = boot?.user?.role;
  const canBuild = role === 'PM' || role === 'ADMIN', canBook = canBuild || role === 'GM';
  const { data, error, busy, run } = useLoad(() => siteCall('getPmChecklistRegister'), []);
  const [status, setStatus] = useState('ONGOING'), [search, setSearch] = useState(''), [pm, setPm] = useState('');
  const [openId, setOpenId] = useState(''), [action, setAction] = useState<Any>(null), [message, setMessage] = useState('');
  const records: Any[] = (data?.records || []).filter((r: Any) => !pm || r.pmEmail === pm);
  const days: Any[] = (data?.dayWiseRecords || []).filter((r: Any) => !pm || r.pmEmail === pm);
  const q = search.trim().toLowerCase();
  const match = (r: Any) => !q || [r.projectNumber, r.projectName, r.client, r.heading, r.stage, r.qualityCode].join(' ').toLowerCase().includes(q);
  const groups = { ONGOING: records.filter((r) => !r.completed && !r.reinspectionRequired), FAILED: records.filter((r) => r.reinspectionRequired), COMPLETED: records.filter((r) => r.completed) } as Any;
  const managers = useMemo(() => Array.from(new Map([...(data?.records || []), ...(data?.dayWiseRecords || [])].filter((r: Any) => r.pmEmail).map((r: Any) => [r.pmEmail, r.pmName || r.pmEmail])).entries()), [data]);
  const done = (text: string) => { setAction(null); setMessage(text); run(); };
  const shown = status === 'DAY_WISE' ? days.filter(match) : (groups[status] || []).filter(match);
  const byProject: Record<string, Any[]> = {};
  shown.forEach((r: Any) => { (byProject[r.projectNumber + ' — ' + (r.projectName || r.client)] ||= []).push(r); });
  return (
    <>
      <div className="panel site-picker">
        <label className="field"><span>Search</span><input placeholder="Project number, client or checklist" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        {(role === 'GM' || role === 'ADMIN') && <label className="field"><span>Project Manager</span><select value={pm} onChange={(e) => setPm(e.target.value)}><option value="">All</option>{managers.map(([e, n]: Any) => <option key={e} value={e}>{n}</option>)}</select></label>}
        <button className="secondary" onClick={() => run()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div className="site-tabs small">
        {[['ONGOING', 'Ongoing', groups.ONGOING.length], ['FAILED', 'Re-site visit needed', groups.FAILED.length], ['COMPLETED', 'Completed', groups.COMPLETED.length], ['DAY_WISE', 'Daily reports', days.length]].map(([id, label, n]) => (
          <button key={id} className={status === id ? 'active' : ''} onClick={() => setStatus(String(id))}>{label} ({n})</button>
        ))}
      </div>
      <Notice error={error} message={message} />
      {action && <section className="panel">
        {action.kind === 'cancel' && <ReasonForm title={'Cancel booking ' + action.row.qualityCode} label="Reason for cancelling" button="Cancel booking" onClose={() => setAction(null)}
          onSubmit={async (reason: string) => { await siteCall('cancelQcBooking', { bookingId: action.row.activeBookingId, reason }); done('Booking cancelled. The QC engineer\'s days are free again.'); }} />}
        {action.kind === 'delete' && <ReasonForm title={'Delete checklist "' + action.row.heading + '"'} label="Reason for deleting" button="Delete checklist" onClose={() => setAction(null)}
          onSubmit={async (reason: string) => { await siteCall('deleteProjectChecklist', { projectChecklistId: action.row.projectChecklistId, reason }); done('Checklist deleted. Any open booking for it was cancelled.'); }} />}
        {action.kind === 'resite' && <ResiteForm row={action.row} onClose={() => setAction(null)} onDone={done} />}
        {action.kind === 'booking' && <BookingEditor bookingId={action.row.activeBookingId} onClose={() => setAction(null)} onDone={done} />}
      </section>}
      {!busy && data && !shown.length && <div className="panel empty"><h3>Nothing here</h3><p>{status === 'ONGOING' && canBuild ? 'Publish a checklist from "New checklist" to start.' : 'No record matches.'}</p></div>}
      {Object.keys(byProject).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((name) => (
        <section key={name} className="panel">
          <h3>{name} <span className="tag">{byProject[name].length}</span></h3>
          {status === 'DAY_WISE'
            ? <div className="scroll-x"><table className="site-table"><thead><tr><th>Work date</th><th>Status</th><th>Workforce</th><th>Activities</th><th>Achieved</th><th>Remarks</th></tr></thead>
              <tbody>{byProject[name].map((r: Any) => <tr key={r.dprId}><td>{niceDate(r.workDate)}</td><td>{titleCase(r.reportStatus)}</td><td>{r.workforce}</td><td>{r.resultCount} of {r.targetCount}</td><td>{r.averageAchievement === '' ? '—' : r.averageAchievement + '%'}</td><td>{r.eveningRemarks}</td></tr>)}</tbody></table></div>
            : <div className="scroll-x"><table className="site-table"><thead><tr><th>Checklist</th><th>Planned</th><th>QC visit</th><th>State</th><th></th></tr></thead>
              <tbody>{byProject[name].sort((a: Any, b: Any) => String(a.plannedDate).localeCompare(String(b.plannedDate))).map((r: Any) => <RegisterRow key={r.projectChecklistId} r={r} open={openId === r.projectChecklistId}
                toggle={() => setOpenId(openId === r.projectChecklistId ? '' : r.projectChecklistId)} canBuild={canBuild} canBook={canBook} onBook={onBook} onEdit={onEdit} setAction={setAction} />)}</tbody></table></div>}
        </section>
      ))}
    </>
  );
}

function RegisterRow({ r, open, toggle, canBuild, canBook, onBook, onEdit, setAction }: Any) {
  const state = r.completed ? <><span className="tag green">{titleCase(r.latestResult)}</span><small>{r.latestInspectionVersion}</small></>
    : r.reinspectionRequired ? <><span className={'tag ' + resultTone(r.latestResult)}>{titleCase(r.latestResult)}</span><small>Next: {r.nextInspectionVersion}{r.activeBookingId ? ' · booked' : ''}</small></>
    : r.bookingStatus ? <span className={'tag ' + (/PENDING/.test(r.bookingStatus) ? 'amber' : /REJECTED|CANCELLED/.test(r.bookingStatus) ? 'red' : '')}>{titleCase(r.bookingStatus)}</span>
    : <span className="tag amber">QC visit not booked</span>;
  return (
    <>
      <tr>
        <td><b>{r.heading}</b><small>{r.stage} · {r.revision}{r.qualityCode ? ' · ' + r.qualityCode : ''}</small></td>
        <td>{niceDate(r.plannedDate)}{r.plannedEndDate && r.plannedEndDate !== r.plannedDate ? ' – ' + niceDate(r.plannedEndDate) : ''}</td>
        <td>{r.bookingDates.length ? r.bookingDates.map(niceDate).join(', ') : '—'}<small>{r.qcEmail}</small></td>
        <td>{state}</td>
        <td className="qc-actions">
          <button className="textbutton" onClick={toggle}>{open ? 'Hide' : 'View'}</button>
          {canBook && !r.hasInspection && !r.hasBooking && <button className="primary" onClick={() => onBook(r.projectId, r.projectChecklistId, r.suggestedQcEmail, r.plannedDate, r.plannedEndDate)}>Book QC visit</button>}
          {canBook && !r.hasInspection && r.hasBooking && !r.activeBookingId && <button className="secondary" onClick={() => onBook(r.projectId, r.projectChecklistId, r.suggestedQcEmail)}>Book again</button>}
          {canBuild && r.editable && <button className="secondary" onClick={() => onEdit(r.projectChecklistId)}>Edit checklist</button>}
          {canBook && r.activeBookingId && <button className="secondary" onClick={() => setAction({ kind: 'booking', row: r })}>Edit booking</button>}
          {canBook && r.activeBookingId && <button className="secondary" onClick={() => setAction({ kind: 'cancel', row: r })}>Cancel booking</button>}
          {canBuild && r.canBookReinspection && <button className="primary" onClick={() => setAction({ kind: 'resite', row: r })}>Book re-site visit {r.nextInspectionVersion}</button>}
          {canBuild && !r.hasInspection && <button className="textbutton neg" onClick={() => setAction({ kind: 'delete', row: r })}>Delete</button>}
          {r.pdfUrl && <a className="textbutton" href={r.pdfUrl} target="_blank" rel="noopener">Signed report</a>}
        </td>
      </tr>
      {open && <tr className="qc-record-row"><td colSpan={5}><ChecklistRecord id={r.projectChecklistId} /></td></tr>}
    </>
  );
}

function ChecklistRecord({ id }: Any) {
  const { data: d, error } = useLoad(() => siteCall('getPmChecklistRecord', id), [id]);
  const [evidence, setEvidence] = useState('');
  if (error) return <p className="neg">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  const h = d.header;
  return (
    <div className="qc-record">
      <div className="site-facts">
        <span>Location <b>{h.Location_Floor_Grid || '—'}</b></span>
        <span>Assigned QC <b>{h.Assigned_QC_Email}</b></span>
        <span>Drawings <b>{[h.Architectural_Drawing_Revision_Text, h.Structural_Drawing_Revision_Text, h.MEP_Drawing_Revision_Text].filter(Boolean).join(' · ') || '—'}</b></span>
        {h.Specification_Link && <span>Specification <b><a href={h.Specification_Link} target="_blank" rel="noopener">Open</a></b></span>}
        {h.Special_Requirements && <span>Special requirements <b>{h.Special_Requirements}</b></span>}
      </div>
      {d.inspections.length === 0 && <>
        <p className="muted">Not inspected yet. Items:</p>
        <ol className="site-list">{d.items.filter((i: Any) => String(i.Applicable).toLowerCase() !== 'no').map((i: Any) => <li key={i.Project_Item_ID}><b>{i.Checkpoint_Snapshot}</b> — {i.Acceptance_Criteria_Snapshot}{i.Criticality === 'Critical' && <span className="tag red">Critical</span>}{i.Hold_Point === 'Yes' && <span className="tag amber">Hold point</span>}</li>)}</ol>
      </>}
      {d.inspections.map((v: Any) => (
        <div key={v.Inspection_Version_ID} className="qc-version">
          <div className="site-head"><b>{v.Inspection_Version_ID}</b><span className={'tag ' + resultTone(v.Overall_Result)}>{titleCase(v.Overall_Result)}</span></div>
          <small className="muted">By {v.QC_Name} · {String(v.Submitted_At || '').slice(0, 16).replace('T', ' ')} · {v.Passed_Count} passed · {v.Minor_Defect_Count} minor · {v.Major_Defect_Count} major{v.Evidence_Status && v.Evidence_Status !== 'COMPLETE' ? ' · evidence ' + titleCase(v.Evidence_Status) : ''}</small>
          <div className="scroll-x"><table className="site-table"><thead><tr><th>#</th><th>Checkpoint</th><th>Actual</th><th>Assessment</th><th>Observation</th><th>Photos</th></tr></thead>
            <tbody>{d.results.filter((x: Any) => x.Inspection_Version_ID === v.Inspection_Version_ID).sort((a: Any, b: Any) => Number(a.Sequence) - Number(b.Sequence)).map((x: Any) => (
              <tr key={x.Project_Item_ID}><td>{x.Sequence}</td><td>{x.Checkpoint_Snapshot}<small>{x.Acceptance_Criteria_Snapshot}</small></td><td>{x.Actual_Value} {x.Unit}</td>
                <td><span className={'tag ' + (x.Assessment === 'SATISFACTORY' ? 'green' : x.Assessment === 'NA' ? '' : x.Assessment === 'MINOR DEFECT' ? 'amber' : 'red')}>{titleCase(x.Assessment)}</span>{x.Carried_From_Version_ID && <small>Carried from {x.Carried_From_Version_ID}</small>}</td>
                <td>{x.Observation}</td><td>{String(x.Photo_Links || '').split(',').map((u: string) => u.trim()).filter(Boolean).map((u: string, i: number) => <a key={u} href={u} target="_blank" rel="noopener">{i + 1} </a>)}</td></tr>))}</tbody></table></div>
          <div className="site-actions">
            {v.PDF_Link && <a className="textbutton" href={v.PDF_Link} target="_blank" rel="noopener">Signed report</a>}
            {v.Evidence_Archive_Folder_URL && <button className="textbutton" onClick={() => setEvidence(evidence === v.Inspection_Version_ID ? '' : v.Inspection_Version_ID)}>{evidence === v.Inspection_Version_ID ? 'Hide evidence' : 'Locked evidence'}</button>}
          </div>
          {evidence === v.Inspection_Version_ID && <FileList url={v.Evidence_Archive_Folder_URL} title="Locked evidence" />}
        </div>
      ))}
    </div>
  );
}

function ReasonForm({ title, label, button, onSubmit, onClose }: Any) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return (
    <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await onSubmit(reason.trim()); } catch (x) { setError((x as Error).message); setBusy(false); } }}>
      <h3>{title}</h3>
      <Txt label={label} value={reason} onChange={setReason} required area max={500} />
      {error && <p className="neg">{error}</p>}
      <div className="site-actions"><button className="primary" disabled={busy || !reason.trim()}>{busy ? 'Saving…' : button}</button><button type="button" className="secondary" onClick={onClose}>Close</button></div>
    </form>
  );
}

function DateRange({ start, end, setStart, setEnd }: Any) {
  return <>
    <label className="field"><span>Visit start date *</span><input type="date" min={istToday()} required value={start} onChange={(e) => { setStart(e.target.value); if (end && end < e.target.value) setEnd(''); }} /></label>
    <label className="field"><span>Visit end date (optional)</span><input type="date" min={start || istToday()} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
  </>;
}

function ResiteForm({ row, onClose, onDone }: Any) {
  const { data: c, error: loadError } = useLoad(() => siteCall('getReinspectionBookingContext', row.projectChecklistId), [row.projectChecklistId]);
  const [qc, setQc] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [rid] = useState(() => requestId('BKG-WEB'));
  useEffect(() => { if (c && !qc) setQc(c.suggestedQcEmail); }, [c]);
  if (loadError) return <><p className="neg">{loadError}</p><button className="secondary" onClick={onClose}>Close</button></>;
  if (!c) return <p className="muted">Loading…</p>;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError('');
      try { const r = await siteCall('createReinspectionBooking', { projectChecklistId: row.projectChecklistId, qcEmail: qc, dates: datesBetween(start, end), notes, clientRequestId: rid }); onDone(`Re-site visit ${c.nextInspectionVersion} booked (${r.qualityCheckCode}). It waits for the QC engineer to accept.`); }
      catch (x) { setError((x as Error).message); setBusy(false); }
    }}>
      <h3>Re-site visit for "{c.heading}" — {c.nextInspectionVersion}</h3>
      <p className="muted">The last inspection ({c.latestInspectionVersion}) was {titleCase(c.latestResult).toLowerCase()}. A different QC engineer must check it again; items already satisfactory carry forward.</p>
      <div className="formgrid site-grid">
        <Sel label="QC engineer" required value={qc} onChange={setQc} options={c.qcUsers.map((q: Any) => [q.email, q.name])} />
        <DateRange start={start} end={end} setStart={setStart} setEnd={setEnd} />
        <Txt label="Notes" value={notes} onChange={setNotes} max={500} />
      </div>
      {error && <p className="neg">{error}</p>}
      <div className="site-actions"><button className="primary" disabled={busy}>{busy ? 'Booking…' : 'Book re-site visit'}</button><button type="button" className="secondary" onClick={onClose}>Close</button></div>
    </form>
  );
}

function BookingEditor({ bookingId, onClose, onDone }: Any) {
  const { data: d, error: loadError } = useLoad(() => siteCall('getBookingForEditing', bookingId), [bookingId]);
  const [qc, setQc] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (d) { setQc(String(d.booking.QC_Email || '').toLowerCase()); setStart(d.dates[0] || ''); setEnd(d.dates[d.dates.length - 1] || ''); setNotes(d.booking.Notes || ''); } }, [d]);
  if (loadError) return <><p className="neg">{loadError}</p><button className="secondary" onClick={onClose}>Close</button></>;
  if (!d) return <p className="muted">Loading…</p>;
  if (!d.editable) return <><p className="muted">This booking can no longer be edited.</p><button className="secondary" onClick={onClose}>Close</button></>;
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError('');
      try { const r = await siteCall('updateQcBooking', { bookingId, qcEmail: qc, dates: datesBetween(start, end), notes }); onDone(r.status === 'PENDING ACCEPTANCE' ? 'Booking changed. The QC engineer must accept the new dates.' : 'Booking notes saved.'); }
      catch (x) { setError((x as Error).message); setBusy(false); }
    }}>
      <h3>Edit booking {d.booking.Quality_Check_Code}</h3>
      <p className="muted">Changing the QC engineer or the dates sends the booking back for acceptance.</p>
      <div className="formgrid site-grid">
        <Sel label="QC engineer" required value={qc} onChange={setQc} options={d.qcUsers.map((q: Any) => [q.email, q.name])} />
        <DateRange start={start} end={end} setStart={setStart} setEnd={setEnd} />
        <Txt label="Notes" value={notes} onChange={setNotes} max={500} />
      </div>
      {error && <p className="neg">{error}</p>}
      <div className="site-actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save booking'}</button><button type="button" className="secondary" onClick={onClose}>Close</button></div>
    </form>
  );
}

// ---------- checklist builder ----------

const blankItem = () => ({ Template_Item_ID: '', Checkpoint: '', Acceptance_Criteria: '', Criticality: 'Normal', Hold_Point: 'No', Photo_Required: 'On failure', Response_Type: 'Assessment + observation', Unit: '', Mandatory_Class: 'Project-specific', Applicable: 'Yes', PM_Notes: '' });

function Builder({ boot, editId, onBook, onDone }: Any) {
  const projects: Any[] = boot?.projects || [];
  const [projectId, setProjectId] = useState(''), [ws, setWs] = useState<Any>(null);
  const [f, setF] = useState<Any>({ heading: '', stage: '', customStage: '', qc: '', plannedDate: '', plannedEndDate: '', location: '', revision: 'R01', arch: '', structural: '', mep: '', spec: '', special: '' });
  const [items, setItems] = useState<Any[] | null>(null), [stageLoaded, setStageLoaded] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [published, setPublished] = useState<Any>(null);
  const [rid] = useState(() => requestId('PCQ'));
  const set = (k: string) => (v: any) => setF((x: Any) => ({ ...x, [k]: v }));

  useEffect(() => { if (!editId && !projectId && projects.length === 1) setProjectId(String(projects[0].Project_ID)); }, [projects.length]);
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const c = await siteCall('getChecklistForEditing', editId);
        if (!c.editable) throw new Error('This checklist is locked: its planned start date has come or it has been inspected.');
        const h = c.header;
        setProjectId(String(h.Project_ID));
        setF({ heading: h.Inspection_Heading || '', stage: h.Stage || '', customStage: '', qc: String(h.Assigned_QC_Email || '').toLowerCase(), plannedDate: String(h.Planned_Date || '').slice(0, 10),
          plannedEndDate: String(h.Planned_End_Date || '').slice(0, 10), location: h.Location_Floor_Grid || '', revision: h.Checklist_Revision || 'R01', arch: h.Architectural_Drawing_Revision_Text || '',
          structural: h.Structural_Drawing_Revision_Text || '', mep: h.MEP_Drawing_Revision_Text || '', spec: h.Specification_Link || '', special: h.Special_Requirements || '' });
        setItems(c.items.map((i: Any) => ({ ...blankItem(), ...i, Checkpoint: i.Checkpoint_Snapshot, Acceptance_Criteria: i.Acceptance_Criteria_Snapshot })));
        setStageLoaded(h.Stage);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [editId]);
  useEffect(() => { if (projectId) siteCall('getPmWorkspace', projectId).then(setWs).catch((e) => setError(e.message)); else setWs(null); }, [projectId]);

  const stage = f.stage === '__OTHER__' ? f.customStage.trim() : f.stage;
  async function loadItems() {
    setError('');
    try {
      if (!stage) throw new Error(f.stage === '__OTHER__' ? 'Enter the custom stage name.' : 'Select a stage.');
      const t = f.stage === '__OTHER__' ? [] : await siteCall('getTemplateItems', stage);
      setItems(t.length ? t.map((i: Any) => ({ ...blankItem(), ...i, Acceptance_Criteria: i.Default_Acceptance_Criteria, PM_Notes: '' })) : [blankItem()]);
      setStageLoaded(stage);
    } catch (e) { setError((e as Error).message); }
  }
  const setItem = (n: number, k: string, v: any) => setItems((list) => (list || []).map((x, i) => (i === n ? { ...x, [k]: v } : x)));
  async function publish(e: any) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!items?.length) throw new Error('Add at least one checklist item.');
      const bad = items.findIndex((i) => !String(i.Checkpoint).trim() || !String(i.Acceptance_Criteria).trim());
      if (bad >= 0) throw new Error(`Item ${bad + 1} needs a heading and acceptance criteria.`);
      const common = { heading: f.heading.trim(), assignedQcEmail: f.qc, plannedDate: f.plannedDate, plannedEndDate: f.plannedEndDate, location: f.location, checklistRevision: f.revision,
        archDrawingRevision: f.arch, structuralDrawingRevision: f.structural, mepDrawingRevision: f.mep, specificationLink: f.spec, specialRequirements: f.special, items };
      const r = editId
        ? await siteCall('updatePublishedChecklist', { projectChecklistId: editId, ...common })
        : await siteCall('saveAndPublishProjectChecklist', { projectId, stage: stageLoaded, clientRequestId: rid, ...common });
      setPublished({ ...r, projectId });
      window.scrollTo?.({ top: 0, behavior: 'smooth' });
    } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  }
  if (published) return (
    <div className="panel">
      <p className="alert green">{editId ? 'Checklist changes saved.' : 'Checklist published and assigned. Book the QC engineer\'s visit next.'}</p>
      <div className="site-actions">
        {!editId && <button className="primary" onClick={() => onBook(published.projectId, published.projectChecklistId, f.qc, f.plannedDate, f.plannedEndDate)}>Book QC visit</button>}
        <button className="secondary" onClick={onDone}>Back to checklists</button>
      </div>
    </div>
  );
  const drawings = (ws?.drawings || []).map((d: Any) => `${d.Drawing_Number} / ${d.Revision}`);
  return (
    <form onSubmit={publish}>
      <Notice error={error} />
      <section className="panel">
        <h3>{editId ? 'Edit published checklist' : 'Checklist for a project'}</h3>
        <div className="formgrid site-grid">
          <label className="field"><span>Project *</span>
            <select value={projectId} disabled={Boolean(editId)} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">{projects.length ? 'Select project…' : 'No ongoing project is assigned to you'}</option>
              {projects.map((p: Any) => <option key={p.Project_ID} value={p.Project_ID}>{projLabel(p)}</option>)}
            </select></label>
          <Txt label="Inspection heading" required value={f.heading} onChange={set('heading')} placeholder="GF slab reinforcement and MEP pre-pour" />
          <label className="field"><span>Stage / template *</span>
            <select value={f.stage} disabled={Boolean(editId)} required onChange={(e) => { set('stage')(e.target.value); setItems(null); }}>
              <option value="">Select…</option>
              {editId && <option value={f.stage}>{f.stage}</option>}
              {(ws?.stages || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
              <option value="__OTHER__">Other / custom checklist</option>
            </select></label>
          {f.stage === '__OTHER__' && <Txt label="Custom stage name" required value={f.customStage} onChange={set('customStage')} max={80} />}
          <Sel label="QC engineer" required value={f.qc} onChange={set('qc')} options={[['', 'Select QC engineer…'], ...(ws?.qcUsers || []).map((q: Any) => [q.email, q.name])]} />
          <label className="field"><span>Planned start date *</span><input type="date" required min={istToday()} value={f.plannedDate} onChange={(e) => set('plannedDate')(e.target.value)} /></label>
          <label className="field"><span>Planned end date (optional)</span><input type="date" min={f.plannedDate || istToday()} value={f.plannedEndDate} onChange={(e) => set('plannedEndDate')(e.target.value)} /></label>
          <Txt label="Floor / grid / room" value={f.location} onChange={set('location')} />
          <Sel label="Checklist revision" value={f.revision} onChange={set('revision')} options={REVISIONS.map((r) => [r, r])} />
          {[['arch', 'Architectural drawing revision', 'A-105 Rev 03'], ['structural', 'Structural drawing revision', 'S-204 Rev 02'], ['mep', 'MEP drawing revision', 'MEP Rev 01']].map(([k, label, ph]) => (
            <label key={k} className="field"><span>{label}</span><input list="qc-drawings" placeholder={'Example: ' + ph} value={f[k]} onChange={(e) => set(k)(e.target.value)} /></label>
          ))}
          <datalist id="qc-drawings">{drawings.map((d: string) => <option key={d} value={d} />)}</datalist>
          <Txt label="Specification / drawing folder link" value={f.spec} onChange={set('spec')} max={500} />
          <div className="site-span-2"><Txt label="Special project requirements" value={f.special} onChange={set('special')} area max={1000} /></div>
        </div>
        {!editId && <div className="site-actions"><button type="button" className="secondary" disabled={!projectId || !stage} onClick={loadItems}>{items ? 'Reload items from template' : 'Load checklist items'}</button></div>}
      </section>
      {items && <section className="panel">
        <h3>{stageLoaded} — {items.length} item{items.length === 1 ? '' : 's'}</h3>
        <p className="muted">Edit headings and acceptance criteria, or add items for this project. Publishing fixes this version; you can still change it until the planned start date.</p>
        {items.map((i, n) => (
          <div key={n} className={'qc-item' + (i.Criticality === 'Critical' ? ' critical' : '')}>
            <div className="site-head"><b>Item {n + 1}</b><button type="button" className="textbutton" onClick={() => setItems(items.filter((_, k) => k !== n))}>Remove</button></div>
            <div className="formgrid site-grid">
              <div className="site-span-2"><Txt label="Checklist heading" required value={i.Checkpoint} onChange={(v: string) => setItem(n, 'Checkpoint', v)} max={300} /></div>
              <Sel label="Criticality" value={i.Criticality} onChange={(v: string) => setItem(n, 'Criticality', v)} options={[['Normal', 'Normal'], ['Critical', 'Critical']]} />
              <Sel label="Hold point" value={i.Hold_Point} onChange={(v: string) => setItem(n, 'Hold_Point', v)} options={[['No', 'No'], ['Yes', 'Yes']]} />
              <Sel label="Photo" value={i.Photo_Required} onChange={(v: string) => setItem(n, 'Photo_Required', v)} options={[['On failure', 'On failure'], ['Yes', 'Required for a major defect'], ['No', 'Not needed']]} />
              <Txt label="Unit (if measured)" value={i.Unit} onChange={(v: string) => setItem(n, 'Unit', v)} max={20} />
              <div className="site-span-2"><Txt label="Acceptance criteria" required area value={i.Acceptance_Criteria} onChange={(v: string) => setItem(n, 'Acceptance_Criteria', v)} max={1000} /></div>
              <div className="site-span-2"><Txt label="PM notes" value={i.PM_Notes} onChange={(v: string) => setItem(n, 'PM_Notes', v)} max={500} /></div>
            </div>
          </div>
        ))}
        <div className="site-actions">
          <button type="button" className="secondary" onClick={() => setItems([...items, blankItem()])}>+ Add checklist item</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : editId ? 'Save changes' : 'Save, publish and assign'}</button>
          {editId && <button type="button" className="secondary" onClick={onDone}>Cancel</button>}
        </div>
      </section>}
    </form>
  );
}

// ---------- QC visit calendar (PM / GM / Admin book; QC sees own and blocks dates) ----------

const isCapacity = (s: string) => ['BOOKED', 'PENDING ACCEPTANCE', 'ACCEPTED'].includes(String(s).toUpperCase());

function MonthGrid({ year, month, qcEmail, bookings, unavailable, capacity, selected, onPick }: Any) {
  const first = new Date(Date.UTC(year, month - 1, 1)), days = new Date(Date.UTC(year, month, 0)).getUTCDate(), offset = (first.getUTCDay() + 6) % 7, today = istToday();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(<div key={'e' + i} className="qc-day empty" />);
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const events = bookings.filter((b: Any) => b.qcEmail === qcEmail && b.visitDate === date);
    const block = unavailable.find((u: Any) => u.qcEmail === qcEmail && u.date === date);
    const full = events.filter((e: Any) => isCapacity(e.status)).length >= capacity;
    const pickable = onPick && !block && !full && date >= today;
    const chosen = selected?.includes(date);
    cells.push(
      <div key={date} className={'qc-day' + (pickable ? ' selectable' : '') + (chosen ? ' chosen' : '') + (full ? ' full' : '') + (date === today ? ' today' : '')}
        onClick={pickable ? () => onPick(date) : undefined} role={pickable ? 'button' : undefined} aria-label={pickable ? 'Select ' + date : undefined} data-date={date}>
        <span className="num">{d}</span>
        {events.map((e: Any, i: number) => <span key={i} className={'qc-ev' + (String(e.status).toUpperCase() === 'COMPLETED' ? ' done' : String(e.status).toUpperCase() === 'PENDING ACCEPTANCE' ? ' pending' : '')} title={[e.projectNumber, e.purpose === 'OTHER' ? e.otherReason : e.projectName, titleCase(e.status)].filter(Boolean).join(' · ')}>
          <b>{e.projectNumber || 'Busy'}</b>{e.daySequence > 1 ? ' · day ' + e.daySequence : ''}</span>)}
        {block && <span className="qc-ev blocked">{block.type}</span>}
        {chosen && <span className="qc-ev chosen">Selected</span>}
      </div>,
    );
  }
  return <div className="qc-cal">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="qc-wd">{w}</div>)}{cells}</div>;
}

export function QcCalendar({ boot, prefill }: Any) {
  const role = boot?.user?.role;
  const canBook = ['PM', 'GM', 'ADMIN'].includes(role), canBlock = ['QC', 'GM', 'ADMIN'].includes(role);
  const now = istToday();
  const [ym, setYm] = useState(() => { const d = prefill?.plannedDate || now; return { y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) }; });
  const { data: s, error, busy, run } = useLoad(() => siteCall('getSchedulingWorkspace', ym.y, ym.m), [ym.y, ym.m]);
  const [b, setB] = useState<Any>({ projectId: '', purpose: 'CHECKLIST', checklistId: '', base: '', qc: '', otherReason: '', notes: '' });
  const [dates, setDates] = useState<string[]>([]), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [rid, setRid] = useState(() => requestId('BKG-WEB')), [saving, setSaving] = useState(false), [formError, setFormError] = useState(''), [message, setMessage] = useState('');
  const [showQc, setShowQc] = useState(''), [action, setAction] = useState<Any>(null);
  const [un, setUn] = useState({ date: '', type: 'Leave', notes: '', qc: '' });
  const setF = (k: string) => (v: any) => setB((x: Any) => ({ ...x, [k]: v }));

  // Coming from a checklist: its project, the QC named on it and its planned days are filled in.
  useEffect(() => {
    if (!prefill) return;
    setB((x: Any) => ({ ...x, projectId: prefill.projectId, checklistId: prefill.projectChecklistId, purpose: 'CHECKLIST', base: '', qc: prefill.qcEmail || '' }));
    setDates(datesBetween(prefill.plannedDate, prefill.plannedEndDate).filter((d) => d >= now));
  }, [prefill?.at]);
  useEffect(() => {
    if (!s) return;
    if (!b.projectId && s.projects.length === 1) setF('projectId')(s.projects[0].projectId);
    if (role === 'QC') setShowQc(boot.user.email);
  }, [s]);

  const project = s?.projects.find((p: Any) => p.projectId === b.projectId);
  const qcs = (s?.qcUsers || []).filter((q: Any) => {
    const allowed = String(q.allowedProjects || '').split(',').map((x) => x.trim()).filter(Boolean);
    return !project || !allowed.length || allowed.includes('ALL') || allowed.includes(project.projectId) || allowed.includes(project.projectNumber);
  });
  const checklists = (s?.checklists || []).filter((c: Any) => c.projectId === b.projectId);
  const bases = (s?.reinspections || []).filter((r: Any) => r.projectChecklistId === b.checklistId && !/PASSED/i.test(r.result));
  const calendarQc = canBook ? (b.qc || showQc || qcs[0]?.email || '') : showQc || boot?.user?.email;
  const pick = canBook && b.qc && calendarQc === b.qc ? (d: string) => setDates((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())) : null;
  const move = (n: number) => { const m = ym.m + n; setYm({ y: ym.y + Math.floor((m - 1) / 12), m: ((m - 1) % 12 + 12) % 12 + 1 }); };

  async function book(e: any) {
    e.preventDefault(); setFormError(''); setMessage(''); setSaving(true);
    try {
      if (!dates.length) throw new Error('Select at least one visit day on the calendar or add a date range.');
      const r = await siteCall('createQcBooking', { projectId: b.projectId, projectChecklistId: b.purpose === 'OTHER' ? '' : b.checklistId, qcEmail: b.qc, dates, notes: b.notes,
        baseInspectionId: b.purpose === 'OTHER' ? '' : b.base, bookingPurpose: b.purpose, otherReason: b.otherReason, clientRequestId: rid });
      setMessage(`Booked ${r.qualityCheckCode} for ${r.dates.map(niceDate).join(', ')}. It waits for the QC engineer to accept.`);
      setDates([]); setStart(''); setEnd(''); setRid(requestId('BKG-WEB')); setB((x: Any) => ({ ...x, checklistId: '', base: '', otherReason: '', notes: '' }));
      run();
    } catch (x) { setFormError((x as Error).message); } finally { setSaving(false); }
  }
  async function block(e: any) {
    e.preventDefault(); setFormError(''); setMessage('');
    try {
      if (un.type === 'Other' && !un.notes.trim()) throw new Error('Enter the reason for Other.');
      await siteCall('addQcUnavailability', { date: un.date, type: un.type, notes: un.notes, qcEmail: role === 'QC' ? '' : un.qc || calendarQc });
      setMessage('Date blocked on the QC calendar.'); setUn({ ...un, date: '', notes: '' }); run();
    } catch (x) { setFormError((x as Error).message); }
  }
  const register = useMemo(() => {
    const g: Record<string, Any> = {};
    (s?.bookings || []).filter((x: Any) => x.qualityCode !== 'BUSY').forEach((x: Any) => { (g[x.bookingId] ||= { ...x, dates: [] }).dates.push(x.visitDate); });
    return Object.values(g);
  }, [s]);
  const monthName = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <Notice error={error || formError} message={message} />
      {canBook && s && <form className="panel" onSubmit={book}>
        <h3>Book a QC site visit</h3>
        <p className="muted">Pick the QC engineer, then tap the days on their calendar below (or add a date range). The QC engineer accepts or rejects the booking.</p>
        <div className="formgrid site-grid">
          <Sel label="Project" required value={b.projectId} onChange={(v: string) => { setB({ ...b, projectId: v, checklistId: '', base: '' }); }} options={[['', 'Select project…'], ...s.projects.map((p: Any) => [p.projectId, projLabel(p)])]} />
          <Sel label="Purpose" value={b.purpose} onChange={setF('purpose')} options={[['CHECKLIST', 'Quality checklist inspection'], ['OTHER', 'Other site visit']]} />
          {b.purpose === 'CHECKLIST' && <Sel label="Published checklist" required value={b.checklistId} onChange={(v: string) => setB({ ...b, checklistId: v, base: '' })}
            options={[['', checklists.length ? 'Select checklist…' : 'No published checklist for this project'], ...checklists.map((c: Any) => [c.projectChecklistId, `${c.heading} (${c.stage}, from ${niceDate(c.plannedDate)})`])]} />}
          {b.purpose === 'CHECKLIST' && bases.length > 0 && <Sel label="Inspection" value={b.base} onChange={setF('base')} options={[['', 'First inspection'], ...bases.map((r: Any) => [r.baseInspectionId, `Re-site visit after ${r.inspectionVersionId} (${titleCase(r.result)})`])]} />}
          <Sel label="QC engineer" required value={b.qc} onChange={(v: string) => { setF('qc')(v); setDates([]); }} options={[['', 'Select QC engineer…'], ...qcs.map((q: Any) => [q.email, q.name])]} />
          {b.purpose === 'OTHER' && <div className="site-span-2"><Txt label="Reason for the visit" required area value={b.otherReason} onChange={setF('otherReason')} placeholder="Material inspection, client meeting, technical investigation" max={500} /></div>}
          <label className="field"><span>Add days from</span><input type="date" min={now} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span>to (optional)</span><input type="date" min={start || now} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <div className="site-actions"><button type="button" className="secondary" disabled={!start} onClick={() => { setDates(Array.from(new Set([...dates, ...datesBetween(start, end)])).sort()); setStart(''); setEnd(''); }}>Add dates</button></div>
          <div className="site-span-2"><Txt label="Notes" value={b.notes} onChange={setF('notes')} max={500} /></div>
        </div>
        <p className="muted">{dates.length ? 'Selected: ' + dates.map(niceDate).join(', ') + ' ' : 'No day selected. '}{dates.length > 0 && <button type="button" className="textbutton" onClick={() => setDates([])}>Clear</button>}</p>
        <button className="primary" disabled={saving}>{saving ? 'Booking…' : 'Confirm selected days'}</button>
      </form>}
      <section className="panel">
        <div className="site-head">
          <h3>{monthName}</h3>
          <div className="site-actions">
            <button className="secondary" onClick={() => move(-1)} aria-label="Previous month">‹</button>
            <button className="secondary" onClick={() => setYm({ y: Number(now.slice(0, 4)), m: Number(now.slice(5, 7)) })}>This month</button>
            <button className="secondary" onClick={() => move(1)} aria-label="Next month">›</button>
          </div>
        </div>
        {s && role !== 'QC' && <label className="field qc-who"><span>Calendar of</span>
          <select value={calendarQc} onChange={(e) => { if (canBook && b.qc && e.target.value !== b.qc) setDates([]); if (canBook) setF('qc')(e.target.value); setShowQc(e.target.value); }}>
            {(canBook ? qcs : s.qcUsers).map((q: Any) => <option key={q.email} value={q.email}>{q.name}</option>)}
          </select></label>}
        <p className="muted qc-legend"><span className="qc-ev">Booked</span> <span className="qc-ev pending">Waiting for QC</span> <span className="qc-ev done">Completed</span> <span className="qc-ev blocked">Unavailable</span>{pick && <> <span className="qc-ev chosen">Selected</span></>}</p>
        {busy && !s && <p className="muted">Loading…</p>}
        {s && (s.qcUsers.length
          ? <MonthGrid year={s.year} month={s.month} qcEmail={calendarQc} bookings={s.bookings} unavailable={s.unavailable} capacity={s.dailyCapacity} selected={pick ? dates : []} onPick={pick} />
          : <p className="muted">No active QC engineer. Give someone the QC role in Users & roles.</p>)}
      </section>
      {canBlock && s && <form className="panel site-picker" onSubmit={block}>
        <h3 className="full">Block a day when {role === 'QC' ? 'you are' : 'the QC engineer is'} not available</h3>
        <label className="field"><span>Date *</span><input type="date" required value={un.date} onChange={(e) => setUn({ ...un, date: e.target.value })} /></label>
        <label className="field"><span>Reason</span><select value={un.type} onChange={(e) => setUn({ ...un, type: e.target.value })}>{UNAVAILABLE.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="field"><span>Notes{un.type === 'Other' ? ' *' : ''}</span><input maxLength={300} value={un.notes} onChange={(e) => setUn({ ...un, notes: e.target.value })} /></label>
        <button className="secondary">Block date</button>
      </form>}
      {canBook && s && <section className="panel">
        <h3>Bookings this month</h3>
        {action && <div className="qc-inline">
          {action.kind === 'edit' && <BookingEditor bookingId={action.id} onClose={() => setAction(null)} onDone={(t: string) => { setAction(null); setMessage(t); run(); }} />}
          {action.kind === 'cancel' && <ReasonForm title={'Cancel booking ' + action.code} label="Reason for cancelling" button="Cancel booking" onClose={() => setAction(null)}
            onSubmit={async (reason: string) => { await siteCall('cancelQcBooking', { bookingId: action.id, reason }); setAction(null); setMessage('Booking cancelled.'); run(); }} />}
        </div>}
        {register.length
          ? <div className="scroll-x"><table className="site-table"><thead><tr><th>Reference</th><th>Project</th><th>Purpose</th><th>QC</th><th>Dates</th><th>Status</th><th></th></tr></thead>
            <tbody>{register.map((x: Any) => <tr key={x.bookingId}><td><b>{x.qualityCode}</b></td><td>{x.projectNumber}<small>{x.projectName}</small></td><td>{x.purpose === 'OTHER' ? 'Other — ' + x.otherReason : 'Checklist'}</td><td>{x.qcEmail}</td>
              <td>{x.dates.sort().map(niceDate).join(', ')}</td><td><span className={'tag ' + (/PENDING/i.test(x.bookingStatus) ? 'amber' : /COMPLETED/i.test(x.bookingStatus) ? 'green' : /REJECT|CANCEL/i.test(x.bookingStatus) ? 'red' : '')}>{titleCase(x.bookingStatus)}</span>{x.notes && <small>{x.notes}</small>}</td>
              <td className="qc-actions">{x.canManage && !/COMPLETED|CANCELLED/i.test(x.bookingStatus) && <>
                <button className="textbutton" onClick={() => setAction({ kind: 'edit', id: x.bookingId })}>Edit</button>
                <button className="textbutton" onClick={() => setAction({ kind: 'cancel', id: x.bookingId, code: x.qualityCode })}>Cancel</button></>}</td></tr>)}</tbody></table></div>
          : <p className="muted">No bookings in this month.</p>}
      </section>}
    </>
  );
}

// ---------- template library and drawings ----------

const TEMPLATE_COLUMNS: [string, string, number][] = [['Stage', 'Stage', 140], ['Template_Revision', 'Revision', 70], ['Sequence', '#', 50], ['Checkpoint', 'Checkpoint', 220], ['Default_Acceptance_Criteria', 'Acceptance criteria', 260],
  ['Criticality', 'Criticality', 90], ['Hold_Point', 'Hold point', 70], ['Photo_Required', 'Photo', 90], ['Unit', 'Unit', 60], ['Active', 'Active', 60]];

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function Templates() {
  const { data, error, busy, run } = useLoad(() => siteCall('getTemplateLibrary'), []);
  const [rows, setRows] = useState<Any[]>([]), [stage, setStage] = useState(''), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { if (data) setRows(data.rows.map((r: Any) => ({ ...r }))); }, [data]);
  const stages = Array.from(new Set(rows.map((r) => String(r.Stage || '')).filter(Boolean))).sort();
  const visible = rows.map((r, i) => [r, i] as [Any, number]).filter(([r]) => !stage || r.Stage === stage);
  const set = (i: number, k: string, v: string) => setRows(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  async function save() {
    setSaving(true); setSaveError(''); setMessage('');
    try { const r = await siteCall('saveTemplateLibrary', { rows }); setMessage(`Saved ${r.rowCount} template rows (${r.activeCount} active).`); run(); } catch (e) { setSaveError((e as Error).message); } finally { setSaving(false); }
  }
  async function importCsv(file: File) {
    setSaveError('');
    const [head, ...body] = parseCsv(await file.text());
    const keys = (head || []).map((h) => h.replace(/^﻿/, '').trim().replace(/ /g, '_'));
    if (!keys.includes('Stage') || !keys.includes('Checkpoint')) { setSaveError('The CSV needs a header row with at least Stage and Checkpoint columns (same column names as the template sheet).'); return; }
    setRows(body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()]))));
    setMessage('CSV loaded. Check the rows, then Save template library to replace the current library.');
  }
  function exportCsv() {
    const headers = data?.headers || TEMPLATE_COLUMNS.map((c) => c[0]);
    const cell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [headers.join(','), ...rows.map((r) => headers.map((h: string) => cell(r[h])).join(','))].join('\r\n')], { type: 'text/csv' }));
    a.download = 'checklist-templates.csv'; a.click();
  }
  return (
    <>
      <Notice error={error || saveError} message={message} />
      <section className="panel">
        <h3>Checklist templates</h3>
        <p className="muted">Shared by all PMs. Each stage keeps one active revision (R01, R02…). New checklists load the active items of their stage. {data?.syncedAt ? 'Last saved ' + String(data.syncedAt).slice(0, 16).replace('T', ' ') + '.' : ''}</p>
        <div className="site-picker">
          <label className="field"><span>Stage</span><select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages ({rows.length} rows)</option>{stages.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Import from CSV</span><input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }} /></label>
          <button className="secondary" type="button" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
        </div>
        {busy && <p className="muted">Loading…</p>}
        <div className="scroll-x"><table className="site-table qc-templates"><thead><tr>{TEMPLATE_COLUMNS.map(([, label]) => <th key={label}>{label}</th>)}<th></th></tr></thead>
          <tbody>{visible.map(([r, i]) => <tr key={i}>{TEMPLATE_COLUMNS.map(([k, label, w]) => <td key={k}>
            {k === 'Default_Acceptance_Criteria' || k === 'Checkpoint'
              ? <textarea className="plan-input" style={{ minWidth: w }} rows={2} aria-label={label} value={r[k] ?? ''} onChange={(e) => set(i, k, e.target.value)} />
              : <input className="plan-input" style={{ width: w }} aria-label={label} value={r[k] ?? ''} onChange={(e) => set(i, k, e.target.value)} />}</td>)}
            <td><button className="textbutton" onClick={() => setRows(rows.filter((_, n) => n !== i))}>Remove</button></td></tr>)}</tbody></table></div>
        <div className="site-actions">
          <button className="secondary" onClick={() => {
            const same = rows.filter((r) => r.Stage === stage);
            setRows([...rows, { Stage: stage, Template_Revision: same[0]?.Template_Revision || 'R01', Sequence: String(same.reduce((m, r) => Math.max(m, Number(r.Sequence) || 0), 0) + 1), Criticality: 'Normal', Hold_Point: 'No', Photo_Required: 'On failure', Active: 'Yes' }]);
          }}>+ Add row</button>
          <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template library'}</button>
        </div>
      </section>
    </>
  );
}

function Drawings({ boot }: Any) {
  const projects: Any[] = boot?.projects || [];
  const [projectId, setProjectId] = useState(projects.length === 1 ? String(projects[0].Project_ID) : '');
  const { data: ws, error, run } = useLoad(() => (projectId ? siteCall('getPmWorkspace', projectId) : Promise.resolve(null)), [projectId]);
  const blank = { drawingRecordId: '', discipline: 'Architectural', drawingNumber: '', title: '', revision: '', current: true };
  const [f, setF] = useState<Any>(blank), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  return (
    <>
      <Notice error={error || saveError} message={message} />
      <section className="panel site-picker">
        <label className="field"><span>Project</span><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Select project…</option>{projects.map((p: Any) => <option key={p.Project_ID} value={p.Project_ID}>{projLabel(p)}</option>)}</select></label>
      </section>
      {ws && <section className="panel">
        <h3>Current drawings</h3>
        {ws.drawings.length
          ? <div className="scroll-x"><table className="site-table"><thead><tr><th>Discipline</th><th>Drawing</th><th>Title</th><th>Revision</th><th></th></tr></thead>
            <tbody>{ws.drawings.map((d: Any) => <tr key={d.Drawing_Record_ID}><td>{d.Discipline}</td><td><b>{d.Drawing_Number}</b></td><td>{d.Title}</td><td>{d.Revision}</td>
              <td><button className="textbutton" onClick={() => setF({ drawingRecordId: d.Drawing_Record_ID, discipline: d.Discipline, drawingNumber: d.Drawing_Number, title: d.Title, revision: d.Revision, current: true })}>Change</button></td></tr>)}</tbody></table></div>
          : <p className="muted">No drawing recorded for this project.</p>}
        <form onSubmit={async (e) => {
          e.preventDefault(); setSaveError(''); setMessage('');
          try { await siteCall('saveDrawingRecord', { ...f, projectId }); setMessage('Drawing saved. It appears in the checklist builder\'s drawing revisions.'); setF(blank); run(); } catch (x) { setSaveError((x as Error).message); }
        }}>
          <h3>{f.drawingRecordId ? 'Change drawing' : 'Add a drawing'}</h3>
          <div className="formgrid site-grid">
            <Sel label="Discipline" value={f.discipline} onChange={(v: string) => setF({ ...f, discipline: v })} options={['Architectural', 'Structural', 'MEP', 'Other'].map((x) => [x, x])} />
            <Txt label="Drawing number" required value={f.drawingNumber} onChange={(v: string) => setF({ ...f, drawingNumber: v })} max={60} />
            <Txt label="Title" value={f.title} onChange={(v: string) => setF({ ...f, title: v })} />
            <Txt label="Revision" required value={f.revision} onChange={(v: string) => setF({ ...f, revision: v })} max={20} placeholder="Rev 03" />
            {f.drawingRecordId && <label className="site-check"><input type="checkbox" checked={!f.current} onChange={(e) => setF({ ...f, current: !e.target.checked })} /> Superseded (no longer current)</label>}
          </div>
          <div className="site-actions"><button className="primary">Save drawing</button>{f.drawingRecordId && <button type="button" className="secondary" onClick={() => setF(blank)}>Cancel</button>}</div>
        </form>
      </section>}
    </>
  );
}

// ======================= QC engineer: My QC visits =======================

export function SiteQcVisits({ boot }: Any) {
  const [view, setView] = useState('visits');
  const [assignments, setAssignments] = useState<Any[]>(boot?.assignments || []);
  const [open, setOpen] = useState<Any>(null), [reject, setReject] = useState<Any>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState('');
  const reload = async () => { try { setAssignments((await siteCall('bootstrap')).assignments || []); } catch (e) { setError((e as Error).message); } };
  async function respond(a: Any, response: string, reason = '') {
    setBusy(a.Booking_ID); setError(''); setMessage('');
    try { await siteCall('respondToQcBooking', { bookingId: a.Booking_ID, response, reason }); setMessage(response === 'ACCEPTED' ? `Accepted ${a.Quality_Check_Code}. Open it on the visit day.` : `Rejected ${a.Quality_Check_Code}. The PM will rebook.`); setReject(null); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  if (open) return <section className="site-page"><Inspection a={open} user={boot.user} onClose={async (text?: string) => { setOpen(null); if (text) setMessage(text); await reload(); }} /></section>;
  return (
    <section className="site-page">
      <div className="site-tabs" role="tablist">
        <button className={view === 'visits' ? 'active' : ''} onClick={() => setView('visits')}>My inspections ({assignments.length})</button>
        <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>My calendar</button>
      </div>
      <Notice error={error} message={message} />
      {view === 'calendar' && <QcCalendar boot={boot} />}
      {view === 'visits' && (assignments.length === 0
        ? <div className="panel empty"><h3>No inspection booked for you</h3><p>When a PM books your visit it appears here to accept.</p></div>
        : assignments.map((a) => {
          const status = String(a.Booking_Status || '').toUpperCase(), pending = status === 'PENDING ACCEPTANCE', ready = ['BOOKED', 'ACCEPTED', 'IN PROGRESS'].includes(status);
          return (
            <div key={a.Booking_ID} className="panel qc-visit">
              <div className="site-head"><b>{a.Project_Number} · {a.Inspection_Heading}</b><span className={'tag ' + (pending ? 'amber' : 'green')}>{pending ? 'Waiting for you' : titleCase(status)}</span></div>
              <small className="muted">{a.Quality_Check_Code} · {a.Stage}{a.Location_Floor_Grid ? ' · ' + a.Location_Floor_Grid : ''}{a.Base_Inspection_ID ? ' · re-site visit' : ''}</small>
              <p>Visit: <b>{(a.Booking_Dates || []).map(niceDate).join(', ') || niceDate(a.Due_Date)}</b></p>
              {a.Notes && <p className="muted">{a.Notes}</p>}
              {reject?.Booking_ID === a.Booking_ID
                ? <ReasonForm title="Reject this booking" label="Reason" button="Reject booking" onClose={() => setReject(null)} onSubmit={(r: string) => respond(a, 'REJECTED', r)} />
                : <div className="site-actions">
                  {pending && <><button className="primary" disabled={busy === a.Booking_ID} onClick={() => respond(a, 'ACCEPTED')}>Accept</button><button className="secondary" onClick={() => setReject(a)}>Reject</button></>}
                  {ready && <button className="primary" onClick={() => setOpen(a)}>Open inspection</button>}
                </div>}
            </div>
          );
        }))}
    </section>
  );
}

type Answer = { assessment: string; actualValue: string; observation: string; files: File[] };
type EvidenceJob = { versionId: string; queue: { projectItemId: string; index: number; file: File }[]; uploaded: number };

function Inspection({ a, user, onClose }: Any) {
  const draftKey = 'bilara-qc-draft-' + a.Booking_ID;
  const [d, setD] = useState<Any>(null), [error, setError] = useState(''), [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [declared, setDeclared] = useState(false), [busy, setBusy] = useState(false), [progress, setProgress] = useState('');
  const [job, setJob] = useState<EvidenceJob | null>(null), [evidenceFiles, setEvidenceFiles] = useState<File[]>([]), [uploads, setUploads] = useState<Any[]>([]);
  const [requestKey] = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey) || '{}').clientRequestId || requestId('QCI-WEB'); } catch { return requestId('QCI-WEB'); } });
  useEffect(() => {
    siteCall('getInspectionForExecution', a.Project_Checklist_ID, a.Base_Inspection_ID || null, a.Booking_ID).then((x) => {
      setD(x); setUploads(x.uploads || []);
      let draft: Any = {};
      try { draft = JSON.parse(localStorage.getItem(draftKey) || '{}').answers || {}; } catch {}
      const prior: Record<string, Any> = {};
      (x.priorResults || []).forEach((r: Any) => { prior[r.Project_Item_ID] = r; });
      const init: Record<string, Answer> = {};
      x.items.forEach((i: Any) => {
        const p = prior[i.Project_Item_ID], carry = p && ['SATISFACTORY', 'NA'].includes(String(p.Assessment).toUpperCase());
        init[i.Project_Item_ID] = { assessment: carry ? String(p.Assessment).toUpperCase() : '', actualValue: carry ? String(p.Actual_Value || '') : '', observation: carry ? String(p.Observation || '') : '', ...(draft[i.Project_Item_ID] || {}), files: [] };
      });
      setAnswers(init);
    }).catch((e) => setError(e.message));
  }, []);
  // Keep typed answers on this phone until submitted (photos must be chosen again after a reload).
  useEffect(() => {
    if (!d) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ clientRequestId: requestKey, answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { assessment: v.assessment, actualValue: v.actualValue, observation: v.observation }])) })); } catch {}
  }, [answers]);
  const setA = (id: string, k: keyof Answer, v: any) => setAnswers((x) => ({ ...x, [id]: { ...x[id], [k]: v } }));

  async function uploadEvidence() {
    setError(''); setBusy(true);
    try {
      for (let i = 0; i < evidenceFiles.length; i += 5) {
        const r = await siteCall('uploadQcEvidence', { bookingId: a.Booking_ID, files: await photoData(evidenceFiles.slice(i, i + 5)) });
        setUploads(r.files);
      }
      setEvidenceFiles([]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function finish(j: EvidenceJob) {
    setJob(j);
    try {
      for (let n = j.uploaded; n < j.queue.length; n++) {
        const q = j.queue[n];
        setProgress(`Inspection ${j.versionId} saved. Uploading photo ${n + 1} of ${j.queue.length}…`);
        await siteCall('uploadInspectionPhotoBatch', { inspectionVersionId: j.versionId, projectItemId: q.projectItemId, photoIndex: q.index, photos: await photoData([q.file]) });
        j = { ...j, uploaded: n + 1 }; setJob(j);
      }
      setProgress(`Inspection ${j.versionId} saved. Locking the evidence and signing the report…`);
      const r = await siteCall('finalizeInspectionEvidence', { inspectionVersionId: j.versionId, photoGroups: [] });
      try { localStorage.removeItem(draftKey); } catch {}
      setJob(null);
      onClose(`Submitted ${r.inspectionVersionId}: ${titleCase(r.overallResult)}. The PM has been told.`);
    } catch (e) {
      setProgress('');
      setError(`The answers are saved as ${j.versionId}, but the evidence is not finished: ${(e as Error).message} Keep this page open and press Retry evidence.`);
    }
  }
  async function submit(e: any) {
    e.preventDefault(); setError('');
    try {
      for (const i of d.items) {
        const x = answers[i.Project_Item_ID];
        if (!x.assessment) throw new Error(`Select an assessment for item ${i.Sequence}.`);
        if (['MINOR DEFECT', 'MAJOR DEFECT'].includes(x.assessment) && !x.observation.trim()) throw new Error(`Enter remarks for defect item ${i.Sequence}.`);
        if (x.assessment === 'MAJOR DEFECT' && String(i.Photo_Required).toLowerCase() === 'yes' && !x.files.length) throw new Error(`Add the required photograph for item ${i.Sequence}.`);
      }
      if (!declared) throw new Error('Accept the signed QC declaration before submitting.');
      setBusy(true); setProgress('Saving the inspection answers…');
      const saved = await siteCall('submitInspection', {
        fastCommit: true, clientRequestId: requestKey, projectChecklistId: a.Project_Checklist_ID, baseInspectionId: a.Base_Inspection_ID || '', bookingId: a.Booking_ID, qualityCheckCode: a.Quality_Check_Code,
        answers: d.items.map((i: Any) => { const x = answers[i.Project_Item_ID]; return { projectItemId: i.Project_Item_ID, actualValue: x.actualValue, assessment: x.assessment, observation: x.observation, pendingPhotoCount: x.files.length }; }),
        signatureName: user.name, declarationAccepted: true, startedAt: new Date().toISOString(),
      });
      if (saved.evidenceStatus === 'COMPLETE') { try { localStorage.removeItem(draftKey); } catch {} onClose(`${saved.inspectionVersionId} was already submitted.`); return; }
      const queue = d.items.flatMap((i: Any) => answers[i.Project_Item_ID].files.map((file, index) => ({ projectItemId: i.Project_Item_ID, index, file })));
      await finish({ versionId: saved.inspectionVersionId, queue, uploaded: 0 });
    } catch (x) { setError((x as Error).message); setProgress(''); } finally { setBusy(false); }
  }
  if (!d) return error ? <><Notice error={error} /><button className="secondary" onClick={() => onClose()}>Back</button></> : <p className="muted">Opening inspection…</p>;
  const h = d.header;
  return (
    <form onSubmit={submit}>
      <div className="panel">
        <div className="site-head"><h3>{h.Inspection_Heading}</h3><button type="button" className="secondary" onClick={() => onClose()}>Back</button></div>
        <p><span className="tag">{a.Quality_Check_Code}</span> <span className="tag">{h.Stage}</span> {h.Location_Floor_Grid}</p>
        <div className="site-facts">
          <span>Drawings <b>{[h.Architectural_Drawing_Revision_Text, h.Structural_Drawing_Revision_Text, h.MEP_Drawing_Revision_Text].filter(Boolean).join(' · ') || '—'}</b></span>
          {h.Specification_Link && <span>Specification <b><a href={h.Specification_Link} target="_blank" rel="noopener">Open</a></b></span>}
          {h.Special_Requirements && <span>Special requirements <b>{h.Special_Requirements}</b></span>}
        </div>
        {d.prior && <p className="alert">Re-site visit after {d.prior.Inspection_Version_ID}. Items already satisfactory are filled in; change them only if you reopen them.</p>}
      </div>
      <Notice error={error} message={progress} />
      {job && !busy && <div className="panel"><button type="button" className="primary" onClick={() => { setBusy(true); finish(job).finally(() => setBusy(false)); }}>Retry evidence</button></div>}
      <section className="panel">
        <h3>Evidence folder</h3>
        <p className="muted">Large photos, videos and test reports for this visit. Everything here is locked into the record when you submit.</p>
        {uploads.length > 0 && <ul className="site-list">{uploads.map((f: Any) => <li key={f.key}><a href={f.url} target="_blank" rel="noopener">{f.name}</a></li>)}</ul>}
        <div className="site-picker">
          <label className="field"><span>Add files (photos or PDF)</span><input type="file" multiple accept="image/*,application/pdf" onChange={(e) => { setEvidenceFiles([...evidenceFiles, ...Array.from(e.target.files || [])]); e.target.value = ''; }} /></label>
          <button type="button" className="secondary" disabled={!evidenceFiles.length || busy} onClick={uploadEvidence}>Upload {evidenceFiles.length || ''} file{evidenceFiles.length === 1 ? '' : 's'}</button>
        </div>
      </section>
      {d.items.map((i: Any) => {
        const x = answers[i.Project_Item_ID] || ({} as Answer);
        return (
          <section key={i.Project_Item_ID} className={'panel qc-item' + (i.Criticality === 'Critical' ? ' critical' : '')}>
            <div className="site-head"><b>{i.Sequence}. {i.Checkpoint_Snapshot}</b><span>{i.Criticality === 'Critical' && <span className="tag red">Critical</span>} {i.Hold_Point === 'Yes' && <span className="tag amber">Hold point</span>}</span></div>
            <p className="qc-req"><b>Requirement:</b> {i.Acceptance_Criteria_Snapshot}</p>
            {i.PM_Notes && <p className="muted">PM note: {i.PM_Notes}</p>}
            <div className="formgrid site-grid">
              <Sel id={'qcAssess-' + i.Sequence} label="Assessment" required value={x.assessment} onChange={(v: string) => setA(i.Project_Item_ID, 'assessment', v)} options={ASSESSMENTS} />
              <Txt label={'Actual measurement / result' + (i.Unit ? ' (' + i.Unit + ')' : '')} value={x.actualValue} onChange={(v: string) => setA(i.Project_Item_ID, 'actualValue', v)} />
              <div className="site-span-2"><Txt id={'qcObserve-' + i.Sequence} label="Observation / remarks" area required={['MINOR DEFECT', 'MAJOR DEFECT'].includes(x.assessment)} value={x.observation} onChange={(v: string) => setA(i.Project_Item_ID, 'observation', v)} max={2000} /></div>
            </div>
            <Photos label="Photographs" id={'qcPhotos-' + i.Sequence} files={x.files || []} setFiles={(f: File[]) => setA(i.Project_Item_ID, 'files', f)}
              need={x.assessment === 'MAJOR DEFECT' && String(i.Photo_Required).toLowerCase() === 'yes' && !(x.files || []).length ? 1 : 0} />
          </section>
        );
      })}
      <section className="panel">
        <label className="field"><span>QC signatory</span><input value={user.name + ' (' + user.email + ')'} readOnly /></label>
        <label className="site-check"><input id="qcDeclaration" type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} /> I confirm that I personally conducted this inspection and that the observations recorded are accurate.</label>
        <button className="primary" disabled={busy || Boolean(job)}>{busy ? 'Submitting…' : 'Sign and submit inspection'}</button>
      </section>
    </form>
  );
}
