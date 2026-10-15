'use client';
// Daily Progress Report, converted from the QC app's Daily Targets (PM) and Daily DPR (Site
// Engineer) screens. One screen, driven by what the server allows the signed-in person:
//  PM            plans the day (or marks Site Off / Not Started) and approves a resubmission
//  Site Engineer morning manpower, end-of-day output with photos, material used, wastage,
//                quality sign-off, and asks the PM to reopen a submitted day
//  GM / Admin    read only
import { useEffect, useMemo, useState } from 'react';
import { milestoneLabel } from '@/lib/activities';
import { siteCall, requestId, istToday, addDays, niceDate, fmt, titleCase, photoData } from '@/lib/site-client';

type Any = any;
const FLOORS: [string, string][] = [
  ['GROUND_FLOOR', 'Ground floor'], ['FIRST_FLOOR', '1st floor'], ['SECOND_FLOOR', '2nd floor'], ['THIRD_FLOOR', '3rd floor'], ['FOURTH_FLOOR', '4th floor'],
];
const SHIFTS: [string, string][] = [['8', '8-hour shift'], ['9.5', '9.5-hour shift'], ['10', '10-hour shift']];
const PLASTER_TYPES: [string, string][] = [
  ['Plain plastering', 'Plain plastering'], ['Window & complicated-area plastering', 'Windows and complicated areas'],
  ['Design plastering', 'Design plastering'], ['Plastering with parapet', 'Plastering with parapet'],
];
const upper = (floor: string) => ['SECOND_FLOOR', 'THIRD_FLOOR', 'FOURTH_FLOOR'].includes(floor) ? 'FIRST_FLOOR' : floor;
/** Same activity numbers the server assigns (dprBrickActivity / dprPlasterActivity). */
function activityNumberOf(t: Any): string {
  if (t.activityCategory === 'BRICKWORK')
    return String(({ 'GROUND_FLOOR|UP_TO_LINTEL': 21, 'GROUND_FLOOR|ABOVE_LINTEL': 27, 'FIRST_FLOOR|UP_TO_LINTEL': 38, 'FIRST_FLOOR|ABOVE_LINTEL': 50 } as Any)[upper(t.floor) + '|' + t.workStage] || '');
  if (t.activityCategory === 'PLASTERING') {
    if (t.workStage === 'PARAPET' || t.plasterType === 'Plastering with parapet') return '75';
    return String(({ 'GROUND_FLOOR|EXTERIOR': 41, 'GROUND_FLOOR|TOILET': 48, 'GROUND_FLOOR|INTERIOR': 52, 'FIRST_FLOOR|EXTERIOR_1': 64, 'FIRST_FLOOR|TOILET': 68, 'FIRST_FLOOR|INTERIOR': 70, 'FIRST_FLOOR|EXTERIOR_2': 75 } as Any)[upper(t.floor) + '|' + t.workStage] || '');
  }
  return String(t.activityNumber || '');
}
const plasterFaces = (floor: string): [string, string][] => floor && floor !== 'GROUND_FLOOR'
  ? [['INTERIOR', 'Interior'], ['TOILET', 'Toilet'], ['EXTERIOR_1', 'Exterior - first phase'], ['EXTERIOR_2', 'Exterior wall - second phase'], ['PARAPET', 'Parapet']]
  : [['INTERIOR', 'Interior'], ['TOILET', 'Toilet'], ['EXTERIOR', 'Exterior'], ['PARAPET', 'Parapet']];

function newTarget(category: string): Any {
  return {
    activityCategory: category, activityNumber: '', materialType: category === 'BRICKWORK' ? 'Red brick' : '',
    floor: category === 'OTHER' ? '' : 'GROUND_FLOOR', workArea: '',
    workStage: category === 'BRICKWORK' ? 'UP_TO_LINTEL' : category === 'PLASTERING' ? 'INTERIOR' : '',
    plasterType: category === 'PLASTERING' ? 'Plain plastering' : '', measurementType: 'QUANTITY',
    unit: category === 'PLASTERING' ? 'sq ft' : category === 'BRICKWORK' ? 'nos' : '',
    plannedTarget: '', plannedHours: '', plannedActivityMasons: '', plannedActivityLabourers: '', pmRemarks: '',
  };
}

export function Sel({ label, value, onChange, options, required, id }: Any) {
  return (
    <label className="field">
      <span>{label}{required ? ' *' : ''}</span>
      <select id={id} value={value} required={required} onChange={(e) => onChange(e.target.value)}>
        {options.map((o: Any) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : o)}
      </select>
    </label>
  );
}
export function Num({ label, value, onChange, required, step = 'any', min = 0, max, id, hint }: Any) {
  return (
    <label className="field">
      <span>{label}{required ? ' *' : ''}</span>
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} required={required} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
export function Txt({ label, value, onChange, required, max = 200, id, placeholder, area }: Any) {
  return (
    <label className="field">
      <span>{label}{required ? ' *' : ''}</span>
      {area
        ? <textarea id={id} rows={2} maxLength={max} required={required} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} maxLength={max} required={required} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
export function Photos({ label, files, setFiles, id, need }: Any) {
  return (
    <div className="site-photos">
      <label className="field">
        <span>{label}</span>
        <input id={id} type="file" accept="image/*" multiple onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
      </label>
      <label className="field">
        <span>Take a photo</span>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = ''; }} />
      </label>
      <p className={'full muted' + (need > 0 ? ' neg' : '')}>
        {files.length ? `${files.length} photo${files.length === 1 ? '' : 's'} ready to upload. ` : 'No new photos selected. '}
        {need > 0 ? `Add at least ${need} more.` : ''}
        {files.length > 0 && <button type="button" className="textbutton" onClick={() => setFiles([])}>Clear</button>}
      </p>
    </div>
  );
}

// ---------------- PM: plan the day ----------------

function PlanEditor({ ws, onSaved, onCancel }: Any) {
  const d = ws.daily || {};
  const [status, setStatus] = useState(d.isSiteOff ? 'SITE OFF' : d.isNotStarted ? 'NOT STARTED' : 'PLANNED');
  const [siteOffCategory, setSiteOffCategory] = useState(d.siteOffCategory || '');
  const [siteOffReason, setSiteOffReason] = useState(d.siteOffReason || '');
  const [notStartedReason, setNotStartedReason] = useState(d.notStartedReason || '');
  const [masons, setMasons] = useState(d.plannedMasons ? String(d.plannedMasons) : '');
  const [labourers, setLabourers] = useState(d.plannedLabourers ? String(d.plannedLabourers) : '');
  const [shift, setShift] = useState(d.plannedShiftCode || '8');
  const [vendor, setVendor] = useState(d.plannedVendor || '');
  const [targets, setTargets] = useState<Any[]>(() => (ws.targets || []).map((t: Any) => ({
    activityCategory: t.activityCategory || 'OTHER', activityNumber: t.activityNumber, materialType: t.materialType, floor: t.floor,
    workArea: t.workArea, workStage: t.workStage, plasterType: t.plasterType, measurementType: t.measurementType, unit: t.unit,
    plannedTarget: String(t.plannedTarget || ''), plannedHours: String(t.plannedHours || ''), plannedActivityMasons: String(t.plannedActivityMasons ?? ''),
    plannedActivityLabourers: String(t.plannedActivityLabourers ?? ''), pmRemarks: t.pmRemarks, activityName: t.activityName,
  })));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const exempt = status !== 'PLANNED';
  const set = (i: number, patch: Any) => setTargets((ts) => ts.map((t, n) => {
    if (n !== i) return t;
    const next = { ...t, ...patch };
    if ('measurementType' in patch) {
      if (patch.measurementType === 'PERCENTAGE') { next.unit = '%'; if (!next.plannedTarget) next.plannedTarget = '100'; }
      else if (next.unit === '%') next.unit = '';
    }
    if (next.activityCategory === 'PLASTERING') {
      const faces = plasterFaces(next.floor).map((f) => f[0]);
      if (!faces.includes(next.workStage)) next.workStage = 'INTERIOR';
      if ('plasterType' in patch) next.workStage = patch.plasterType === 'Plastering with parapet' ? 'PARAPET' : next.workStage === 'PARAPET' ? 'INTERIOR' : next.workStage;
    }
    return next;
  }));
  const allocated = targets.reduce((s, t) => s + (Number(t.plannedActivityMasons || 0) + Number(t.plannedActivityLabourers || 0)) * Number(t.plannedHours || 0), 0);
  const capacity = (Number(masons || 0) + Number(labourers || 0)) * Number(shift || 8);
  const groups = useMemo(() => {
    const g: Record<string, Any[]> = {};
    (ws.activityCatalogue || []).forEach((a: Any) => (g[a.milestone] ||= []).push(a));
    return g;
  }, [ws.activityCatalogue]);

  async function save(e: Any) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const value = await siteCall('saveDprPlan', {
        projectId: ws.project.projectId, workDate: ws.workDate, clientRequestId: requestId('PLAN'), expectedPlanVersion: d.planVersion || 0,
        siteOff: status === 'SITE OFF', notStarted: status === 'NOT STARTED', siteOffCategory, siteOffReason, notStartedReason,
        plannedMasons: masons, plannedLabourers: labourers, plannedShiftCode: shift, plannedVendor: vendor,
        targets: exempt ? [] : targets,
      });
      onSaved(value, status === 'PLANNED' ? 'Daily target saved. The Site Engineer can start the DPR on the work date.' : `Marked ${titleCase(status)}. No DPR is required for this date.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="panel site-plan" onSubmit={save}>
      <h2>{d.dprId ? 'Edit' : 'Set'} the target for {niceDate(ws.workDate)}</h2>
      <p className="muted">Saving creates a new plan version. The plan locks as soon as the Site Engineer starts this day's DPR.</p>
      <div className="formgrid site-grid">
        <Sel label="Daily work status" required id="dprDayStatus" value={status} onChange={setStatus}
          options={[['PLANNED', 'PM planned — Site Engineer DPR required'], ['SITE OFF', 'Site Off — DPR not required'], ['NOT STARTED', 'Not Started — DPR not required']]} />
        {status === 'SITE OFF' && <>
          <Sel label="Site Off category" required value={siteOffCategory} onChange={setSiteOffCategory}
            options={[['', 'Select reason category…'], ...(ws.siteOffCategories || []).map((c: string) => [c, titleCase(c)])]} />
          <Txt label="Details / reason" area required={siteOffCategory === 'MISCELLANEOUS / OTHER'} max={1500} value={siteOffReason} onChange={setSiteOffReason} />
        </>}
        {status === 'NOT STARTED' && <Txt label="Why work has not started" area required max={1500} value={notStartedReason} onChange={setNotStartedReason} />}
      </div>
      {!exempt && <>
        <div className="formgrid site-grid site-grid-4">
          <Num label="Planned masons" required step={1} id="dprPlannedMasons" value={masons} onChange={setMasons} />
          <Num label="Planned labourers" required step={1} id="dprPlannedLabourers" value={labourers} onChange={setLabourers} />
          <Sel label="Planned shift" required value={shift} onChange={setShift} options={SHIFTS} />
          <Txt label="Labour vendor" required max={160} id="dprPlannedVendor" value={vendor} onChange={setVendor} />
        </div>
        <p className={'site-capacity ' + (allocated > capacity + 0.001 ? 'neg' : 'muted')}>
          Workforce {Number(masons || 0) + Number(labourers || 0)} · mason–labourer pairs {Math.min(Number(masons || 0), Number(labourers || 0))} ·
          activities use {fmt(allocated)} of {fmt(capacity)} worker-hours
        </p>
        {targets.map((t, i) => {
          const number = activityNumberOf(t);
          const pct = t.measurementType === 'PERCENTAGE';
          return (
            <fieldset key={i} className="site-target">
              <legend>Activity {i + 1}{number && <span className="tag">No. {number}</span>}</legend>
              <button type="button" className="textbutton site-remove" onClick={() => setTargets(targets.filter((_, n) => n !== i))}>Remove</button>
              <div className="formgrid site-grid site-grid-4">
                <Sel label="Category" required value={t.activityCategory}
                  onChange={(v: string) => setTargets(targets.map((x, n) => n === i ? { ...newTarget(v), plannedTarget: x.plannedTarget, plannedHours: x.plannedHours, plannedActivityMasons: x.plannedActivityMasons, plannedActivityLabourers: x.plannedActivityLabourers, pmRemarks: x.pmRemarks } : x))}
                  options={[['BRICKWORK', 'Brickwork'], ['PLASTERING', 'Plastering'], ['OTHER', 'Other activity'], ...(t.activityCategory === 'LEGACY' ? [['LEGACY', 'Earlier activity']] : [])]} />
                {t.activityCategory === 'BRICKWORK' && <>
                  <Sel label="Masonry material" required value={t.materialType} onChange={(v: string) => set(i, { materialType: v })} options={(ws.masonryMaterials || []).map((m: string) => [m, m])} />
                  <Sel label="Floor" required value={t.floor} onChange={(v: string) => set(i, { floor: v })} options={FLOORS} />
                  <Sel label="Brickwork stage" required value={t.workStage} onChange={(v: string) => set(i, { workStage: v })} options={[['UP_TO_LINTEL', 'Up to lintel'], ['ABOVE_LINTEL', 'Above lintel']]} />
                </>}
                {t.activityCategory === 'PLASTERING' && <>
                  <Sel label="Floor" required value={t.floor} onChange={(v: string) => set(i, { floor: v })} options={FLOORS} />
                  <Sel label="Work face" required value={t.workStage} onChange={(v: string) => set(i, { workStage: v })} options={plasterFaces(t.floor)} />
                  <Sel label="Plastering type" required value={t.plasterType} onChange={(v: string) => set(i, { plasterType: v })} options={PLASTER_TYPES} />
                </>}
                {t.activityCategory === 'OTHER' && <>
                  <label className="field site-span-2">
                    <span>Milestone activity *</span>
                    <select required value={t.activityNumber} onChange={(e) => set(i, { activityNumber: e.target.value })}>
                      <option value="">Select an activity…</option>
                      {Object.keys(groups).sort((a, b) => Number(a) - Number(b)).map((m) => (
                        <optgroup key={m} label={milestoneLabel(m)}>
                          {groups[m].map((a: Any) => <option key={a.number} value={a.number}>{a.number} — {a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <Sel label="Floor" value={t.floor} onChange={(v: string) => set(i, { floor: v })} options={[['', 'Not floor-specific'], ...FLOORS]} />
                </>}
                {t.activityCategory === 'LEGACY' && <p className="site-span-3 muted">{t.activityName}</p>}
                <Txt label="Room / work area" required value={t.workArea} onChange={(v: string) => set(i, { workArea: v })} />
                <Sel label="Measured as" required value={t.measurementType} onChange={(v: string) => set(i, { measurementType: v })} options={[['QUANTITY', 'Quantity'], ['PERCENTAGE', 'Percentage complete']]} />
                {!pct && <Txt label="Unit" required max={30} value={t.unit} onChange={(v: string) => set(i, { unit: v })} placeholder="sq ft, nos, CFT…" />}
                <Num label={pct ? 'Planned completion %' : 'Planned target'} required max={pct ? 100 : undefined} value={t.plannedTarget} onChange={(v: string) => set(i, { plannedTarget: v })} />
                <Num label="Planned hours" required max={Number(shift)} value={t.plannedHours} onChange={(v: string) => set(i, { plannedHours: v })} />
                <Num label="Masons on this activity" required step={1} value={t.plannedActivityMasons} onChange={(v: string) => set(i, { plannedActivityMasons: v })} />
                <Num label="Helpers on this activity" required step={1} value={t.plannedActivityLabourers} onChange={(v: string) => set(i, { plannedActivityLabourers: v })} />
                <div className="full"><Txt label="Photo angles the site must shoot / instructions" area required max={1500} value={t.pmRemarks} onChange={(v: string) => set(i, { pmRemarks: v })} /></div>
              </div>
            </fieldset>
          );
        })}
        <div className="site-actions">
          <button type="button" className="secondary" onClick={() => setTargets([...targets, newTarget('BRICKWORK')])}>+ Brickwork</button>
          <button type="button" className="secondary" onClick={() => setTargets([...targets, newTarget('PLASTERING')])}>+ Plastering</button>
          <button type="button" className="secondary" onClick={() => setTargets([...targets, newTarget('OTHER')])}>+ Other activity</button>
        </div>
      </>}
      {error && <p className="alert red" role="alert">{error}</p>}
      <div className="site-actions">
        <button className="primary" disabled={busy || (!exempt && !targets.length)}>{busy ? 'Saving…' : 'Save target'}</button>
        {onCancel && <button type="button" className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

// ---------------- Site Engineer: morning ----------------

function MorningForm({ ws, onSaved }: Any) {
  const d = ws.daily;
  const [masons, setMasons] = useState(d.morningMasons === '' ? '' : String(d.morningMasons));
  const [labourers, setLabourers] = useState(d.morningLabourers === '' ? '' : String(d.morningLabourers));
  const [shift, setShift] = useState(d.actualShiftCode || '8');
  const [vendor, setVendor] = useState(d.actualVendor || '');
  const [remarks, setRemarks] = useState(d.morningRemarks || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      onSaved(await siteCall('saveDprMorning', { projectId: ws.project.projectId, workDate: ws.workDate, masons, labourers, actualShiftCode: shift, actualVendor: vendor, remarks }),
        'Morning manpower saved. Enter the end-of-day output when work stops.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h2>Morning — who is on site</h2>
      <p className="muted">PM planned {d.plannedMasons} masons and {d.plannedLabourers} helpers on a {d.plannedShiftCode}-hour shift with {d.plannedVendor || 'the planned vendor'}.</p>
      <div className="formgrid site-grid site-grid-4">
        <Num label="Masons present" required step={1} id="dprMorningMasons" value={masons} onChange={setMasons} />
        <Num label="Helpers present" required step={1} id="dprMorningLabourers" value={labourers} onChange={setLabourers} />
        <Sel label="Shift" required value={shift} onChange={setShift} options={SHIFTS} />
        <Txt label="Labour vendor" required max={160} value={vendor} onChange={setVendor} />
        <div className="full"><Txt label="Remarks (deliveries, constraints)" area max={2000} value={remarks} onChange={setRemarks} /></div>
      </div>
      {error && <p className="alert red" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : d.morningUpdatedAt ? 'Update morning manpower' : 'Save morning manpower'}</button>
    </form>
  );
}

// ---------------- Site Engineer: end of day ----------------

type Job = { clientRequestId: string; projectId: string; workDate: string; groups: { targetId: string; files: File[] }[]; materialFiles: File[]; expected: number };

function wasteDefaults(materials: Any[]) {
  const m = materials[0] || { code: '', inputUnits: [] };
  return { materialCode: m.code, variant: '', inputUnit: (m.inputUnits || [])[0] || '', quantity: '', pieceCount: '', lengthPerPiece: '', lengthUnit: 'M', materialName: '', reason: '', remarks: '' };
}

function EveningForm({ ws, onSubmitted, startUpload }: Any) {
  const d = ws.daily;
  const prior = Object.fromEntries((ws.results || []).map((r: Any) => [r.targetId, r]));
  const [rows, setRows] = useState<Record<string, Any>>(() => Object.fromEntries(ws.targets.map((t: Any) => {
    const r = prior[t.targetId] || {};
    return [t.targetId, {
      actualActivityMasons: r.actualActivityMasons === undefined || r.actualActivityMasons === '' ? String(t.plannedActivityMasons) : String(r.actualActivityMasons),
      actualActivityLabourers: r.actualActivityLabourers === undefined || r.actualActivityLabourers === '' ? String(t.plannedActivityLabourers) : String(r.actualActivityLabourers),
      hoursPerWorker: r.hoursPerWorker === undefined || r.hoursPerWorker === '' ? String(t.plannedHours) : String(r.hoursPerWorker),
      actualQuantity: r.actualQuantity === undefined ? '' : String(r.actualQuantity), completionPercent: r.completionPercent === undefined ? '' : String(r.completionPercent),
      outputDescription: r.outputDescription || '', shortfallReason: r.shortfallReason || '', reducedHoursReason: r.reducedHoursReason || '', files: [] as File[],
    }];
  })));
  const [used, setUsed] = useState<Record<string, Any>>(() => Object.fromEntries((ws.materials || []).map((m: Any) => [m.materialKey, { usedQuantity: m.usedQuantity === '' ? '' : String(m.usedQuantity), remarks: m.remarks || '' }])));
  const [materialFiles, setMaterialFiles] = useState<File[]>([]);
  const [waste, setWaste] = useState<Any[]>([]);
  const [wasteRequest] = useState(() => requestId('WASTE'));
  const [wastageReviewed, setWastageReviewed] = useState(false), [qa, setQa] = useState(false);
  const [remarks, setRemarks] = useState(d.eveningRemarks || '');
  const [showAllMaterials, setShowAllMaterials] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const minimum = ws.targets.length === 1 ? 3 : 2;
  const setRow = (id: string, patch: Any) => setRows((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  const wasteMaterials = ws.wasteMaterials || [];
  const materials = (ws.materials || []).filter((m: Any) => showAllMaterials || m.balanceQuantity > 0 || m.availableBeforeDay > 0 || Number(used[m.materialKey]?.usedQuantity) > 0);

  async function submit(e: Any) {
    e.preventDefault(); setError('');
    for (const t of ws.targets) {
      if (rows[t.targetId].files.length + (t.evidencePhotoCount || 0) < minimum) {
        setError(`Add at least ${minimum} photos for activity ${t.sequence}: ${t.activityName}.`); return;
      }
    }
    if (!materialFiles.length && !d.materialPhotoCount) { setError('Add at least one photo of the material on site.'); return; }
    setBusy(true);
    try {
      // Wastage entered here is saved against this DPR before the report itself (as the QC app did).
      const lines = waste.filter((w) => w.materialCode);
      if (lines.length) await siteCall('recordDailyMaterialWastage', { projectId: ws.project.projectId, wasteDate: ws.workDate, sourceDprId: d.dprId, clientRequestId: wasteRequest, lines });
      const clientRequestId = requestId('EOD');
      const groups = ws.targets.map((t: Any) => ({ targetId: t.targetId, files: rows[t.targetId].files }));
      const saved = await siteCall('saveDprEvening', {
        clientRequestId, projectId: ws.project.projectId, workDate: ws.workDate,
        results: ws.targets.map((t: Any) => {
          const r = rows[t.targetId];
          return { targetId: t.targetId, actualActivityMasons: r.actualActivityMasons, actualActivityLabourers: r.actualActivityLabourers, hoursPerWorker: r.hoursPerWorker,
            actualQuantity: r.actualQuantity, completionPercent: r.completionPercent, outputDescription: r.outputDescription, shortfallReason: r.shortfallReason, reducedHoursReason: r.reducedHoursReason };
        }),
        materials: Object.entries(used).filter(([, v]: Any) => v.usedQuantity !== '' || v.remarks).map(([materialKey, v]: Any) => ({ materialKey, usedQuantity: v.usedQuantity || 0, remarks: v.remarks })),
        deferredEvidenceManifest: { activities: groups.map((g: Any) => ({ targetId: g.targetId, count: g.files.length })), materialCount: materialFiles.length },
        wastageReviewed, qualityAssuranceAccepted: qa, eveningRemarks: remarks,
      });
      const job: Job = { clientRequestId, projectId: ws.project.projectId, workDate: ws.workDate, groups, materialFiles, expected: saved.evidenceExpectedCount || 0 };
      onSubmitted();
      startUpload(job);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="panel site-eod" onSubmit={submit}>
      <h2>End of day — work done</h2>
      <p className="muted">Achievement is worked out against the PM target. {minimum} photos are needed for every activity, plus at least one photo of the material on site.</p>
      {ws.targets.map((t: Any) => {
        const r = rows[t.targetId];
        const pct = t.measurementType === 'PERCENTAGE';
        const hours = Number(r.hoursPerWorker || 0);
        const adjusted = t.plannedHours > 0 ? Math.round(t.plannedTarget * hours / t.plannedHours * 100) / 100 : 0;
        const output = Number(pct ? r.completionPercent : r.actualQuantity || 0);
        const achievement = t.plannedTarget > 0 ? Math.round(output / t.plannedTarget * 10000) / 100 : 0;
        return (
          <fieldset key={t.targetId} className="site-target">
            <legend>{t.activityNumber ? t.activityNumber + '. ' : ''}{t.activityName} <small>{t.locationRoom}</small></legend>
            <p className="site-target-meta">PM target <b>{fmt(t.plannedTarget)} {t.unit}</b> in {fmt(t.plannedHours)} h with {t.plannedActivityMasons} masons, {t.plannedActivityLabourers} helpers
              {t.pmRemarks && <><br />Photo angle: {t.pmRemarks}</>}</p>
            <div className="formgrid site-grid site-grid-4">
              <Num label="Masons on this activity" required step={1} max={d.morningMasons} value={r.actualActivityMasons} onChange={(v: string) => setRow(t.targetId, { actualActivityMasons: v })} />
              <Num label="Helpers on this activity" required step={1} max={d.morningLabourers} value={r.actualActivityLabourers} onChange={(v: string) => setRow(t.targetId, { actualActivityLabourers: v })} />
              <Num label="Hours worked per worker" required value={r.hoursPerWorker} onChange={(v: string) => setRow(t.targetId, { hoursPerWorker: v })}
                hint={`Hours used ${t.plannedHours ? fmt(hours / t.plannedHours * 100) : 0}% · time-adjusted target ${fmt(adjusted)} ${t.unit}`} />
              {pct
                ? <Num label="Completion %" required max={100} value={r.completionPercent} onChange={(v: string) => setRow(t.targetId, { completionPercent: v })} hint={`Achievement ${fmt(achievement)}%`} />
                : <Num label={`Actual output (${t.unit})`} required value={r.actualQuantity} onChange={(v: string) => setRow(t.targetId, { actualQuantity: v })} hint={`Achievement ${fmt(achievement)}%`} />}
              {hours < t.plannedHours && <div className="full"><Txt label="Why fewer hours" required max={1500} placeholder="Rain, power failure, material delay…" value={r.reducedHoursReason} onChange={(v: string) => setRow(t.targetId, { reducedHoursReason: v })} /></div>}
              <div className="site-span-2"><Txt label="What was done" required={pct} max={1500} value={r.outputDescription} onChange={(v: string) => setRow(t.targetId, { outputDescription: v })} /></div>
              <div className="site-span-2"><Txt label="Shortfall reason" required={achievement < 100} max={1500} value={r.shortfallReason} onChange={(v: string) => setRow(t.targetId, { shortfallReason: v })} /></div>
            </div>
            <Photos label="Photos of this activity" id={'dprActivityPhotos-' + t.sequence} files={r.files} setFiles={(f: File[]) => setRow(t.targetId, { files: f })}
              need={Math.max(0, minimum - r.files.length - (t.evidencePhotoCount || 0))} />
          </fieldset>
        );
      })}

      <h3>Material used today</h3>
      <p className="muted">Stock goes down by what you enter; you can't use more than is on site. Record a GRN first if material arrived today.</p>
      <div className="scroll-x">
        <table className="site-table">
          <thead><tr><th>Material</th><th>On site before today</th><th>Used today</th><th>Left</th><th>Remarks</th></tr></thead>
          <tbody>
            {materials.map((m: Any) => {
              const v = used[m.materialKey] || { usedQuantity: '', remarks: '' };
              const left = Math.round((m.availableBeforeDay - Number(v.usedQuantity || 0)) * 1000) / 1000;
              return (
                <tr key={m.materialKey} className={left < 0 ? 'row-warn' : ''}>
                  <td><b>{m.materialName}</b>{m.variant ? ' ' + m.variant : ''}</td>
                  <td className="nw">{fmt(m.availableBeforeDay, 3)} {m.unit}</td>
                  <td><input className="plan-input num" type="number" min={0} step="any" aria-label={'Used today, ' + m.materialName + ' ' + m.variant} value={v.usedQuantity}
                    onChange={(e) => setUsed({ ...used, [m.materialKey]: { ...v, usedQuantity: e.target.value } })} /></td>
                  <td className={'nw' + (left < 0 ? ' neg' : '')}>{fmt(left, 3)} {m.unit}</td>
                  <td><input className="plan-input" maxLength={500} aria-label={'Remarks, ' + m.materialName} value={v.remarks} onChange={(e) => setUsed({ ...used, [m.materialKey]: { ...v, remarks: e.target.value } })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="textbutton" onClick={() => setShowAllMaterials(!showAllMaterials)}>{showAllMaterials ? 'Show only materials on site' : 'Show all materials'}</button>
      <Photos label="Photo of material on site" id="dprMaterialPhotos" files={materialFiles} setFiles={setMaterialFiles} need={d.materialPhotoCount ? 0 : Math.max(0, 1 - materialFiles.length)} />

      <h3>Wastage today</h3>
      {(ws.dailyWastage || []).length > 0 && (
        <ul className="site-list">{ws.dailyWastage.map((w: Any, i: number) => <li key={i}>{w.materialName} {w.variant} · {fmt(w.wasteQuantity, 3)} {w.stockUnit} · {w.reason}</li>)}</ul>
      )}
      {waste.map((w, i) => {
        const def = wasteMaterials.find((m: Any) => m.code === w.materialCode) || {};
        const steel = w.materialCode === 'STEEL', misc = w.materialCode === 'MISC';
        const setW = (patch: Any) => setWaste(waste.map((x, n) => n === i ? { ...x, ...patch } : x));
        return (
          <div key={i} className="formgrid site-grid site-grid-4 site-waste">
            <Sel label="Material" required value={w.materialCode} onChange={(v: string) => { const m = wasteMaterials.find((x: Any) => x.code === v) || {}; setW({ materialCode: v, variant: '', inputUnit: v === 'MISC' ? 'nos' : (m.inputUnits || [])[0] || '' }); }}
              options={[...wasteMaterials.map((m: Any) => [m.code, m.name]), ['MISC', 'Other material']]} />
            {steel && <>
              <Sel label="Diameter" required value={w.variant} onChange={(v: string) => setW({ variant: v })} options={[['', 'Select…'], ...(def.variants || []).map((x: string) => [x, x])]} />
              <Num label="Pieces" required step={1} value={w.pieceCount} onChange={(v: string) => setW({ pieceCount: v })} />
              <Num label="Length per piece" required value={w.lengthPerPiece} onChange={(v: string) => setW({ lengthPerPiece: v })} />
              <Sel label="Length unit" required value={w.lengthUnit} onChange={(v: string) => setW({ lengthUnit: v })} options={[['M', 'metres'], ['FT', 'feet']]} />
            </>}
            {misc && <>
              <Txt label="Material name" required max={120} value={w.materialName} onChange={(v: string) => setW({ materialName: v })} />
              <Sel label="Unit" required value={w.inputUnit} onChange={(v: string) => setW({ inputUnit: v })} options={(ws.wasteMiscUnits || []).map((u: string) => [u, u])} />
            </>}
            {!steel && <Num label={'Quantity' + (!misc && def.stockUnit ? ' (' + def.stockUnit + ')' : '')} required value={w.quantity} onChange={(v: string) => setW({ quantity: v })} />}
            <Txt label="Reason" required max={500} value={w.reason} onChange={(v: string) => setW({ reason: v })} placeholder="Broken in unloading, rain, cut pieces…" />
            <button type="button" className="textbutton" onClick={() => setWaste(waste.filter((_, n) => n !== i))}>Remove</button>
          </div>
        );
      })}
      <button type="button" className="secondary" onClick={() => setWaste([...waste, wasteDefaults(wasteMaterials)])}>+ Add wastage</button>

      <h3>Sign-off</h3>
      <Txt label="End-of-day remarks" area max={2000} value={remarks} onChange={setRemarks} />
      <label className="site-check"><input type="checkbox" checked={wastageReviewed} onChange={(e) => setWastageReviewed(e.target.checked)} /> I have reviewed today's material wastage and recorded every known loss above, or there was none.</label>
      <label className="site-check"><input type="checkbox" checked={qa} onChange={(e) => setQa(e.target.checked)} /> I confirm that I inspected the construction work recorded in this DPR and verified that it was executed as per the applicable drawings and Bilara quality standards.</label>
      {error && <p className="alert red" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !wastageReviewed || !qa}>{busy ? 'Submitting…' : d.isSubmitted ? 'Submit corrected DPR' : 'Submit DPR'}</button>
    </form>
  );
}

// ---------------- read-only views ----------------

function PlanSummary({ ws }: Any) {
  const d = ws.daily;
  if (!d) return null;
  if (d.isSiteOff || d.isNotStarted)
    return (
      <section className="panel">
        <h2>{d.isSiteOff ? 'Site Off' : 'Not Started'}</h2>
        <p>{d.isSiteOff ? titleCase(d.siteOffCategory) + (d.siteOffReason ? ' — ' + d.siteOffReason : '') : d.notStartedReason}</p>
        <p className="muted">Marked by the Project Manager. No DPR is required for this date.</p>
      </section>
    );
  const results = Object.fromEntries((ws.results || []).map((r: Any) => [r.targetId, r]));
  return (
    <section className="panel">
      <div className="site-head">
        <h2>{d.isSubmitted ? `Daily report — submitted version ${d.submissionVersion}` : 'Plan for the day'}</h2>
        <span className={'tag ' + (d.isSubmitted ? 'green' : 'amber')}>{titleCase(d.reportStatus)}</span>
      </div>
      <div className="site-facts">
        <div><span>Planned</span><b>{d.plannedMasons} masons · {d.plannedLabourers} helpers</b><small>{d.plannedShiftCode} h shift · {d.plannedVendor}</small></div>
        <div><span>On site</span><b>{d.morningUpdatedAt ? `${d.morningMasons} masons · ${d.morningLabourers} helpers` : 'Not entered yet'}</b><small>{d.morningRemarks}</small></div>
        {d.isSubmitted && <div><span>Photos</span><b>{d.workPhotoCount} work · {d.materialPhotoCount} material</b>
          <small>{d.evidenceUploadStatus === 'COMPLETE' ? 'Uploaded' : d.evidenceUploadStatus}{d.dayFolderUrl && <> · <a href={d.dayFolderUrl} target="_blank" rel="noreferrer">Open</a></>}</small></div>}
      </div>
      <div className="scroll-x">
        <table className="site-table">
          <thead><tr><th>No.</th><th>Activity</th><th>Target</th><th>Done</th><th>Achieved</th><th>Hours</th><th>Notes</th></tr></thead>
          <tbody>
            {ws.targets.map((t: Any) => {
              const r = results[t.targetId];
              const pct = t.measurementType === 'PERCENTAGE';
              return (
                <tr key={t.targetId}>
                  <td>{t.activityNumber}</td>
                  <td><b>{t.activityName}</b><small>{t.locationRoom}</small>{t.pmRemarks && <small>Photo angle: {t.pmRemarks}</small>}</td>
                  <td className="nw">{fmt(t.plannedTarget)} {t.unit}<small>{fmt(t.plannedHours)} h · {t.plannedActivityMasons}+{t.plannedActivityLabourers}</small></td>
                  <td className="nw">{r ? (pct ? fmt(r.completionPercent) + ' %' : fmt(r.actualQuantity) + ' ' + t.unit) : '—'}</td>
                  <td className="nw">{r ? <span className={'tag ' + (Number(r.achievementPercent) >= 100 ? 'green' : 'amber')}>{fmt(r.achievementPercent)}%</span> : '—'}</td>
                  <td className="nw">{r ? `${fmt(r.hoursPerWorker)} of ${fmt(t.plannedHours)} h` : '—'}</td>
                  <td>{r?.outputDescription && <small>{r.outputDescription}</small>}{r?.shortfallReason && <small className="neg">Shortfall: {r.shortfallReason}</small>}
                    {t.evidenceFolderUrl && <small><a href={t.evidenceFolderUrl} target="_blank" rel="noreferrer">{t.evidencePhotoCount} photos</a></small>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {d.isSubmitted && (ws.materials || []).some((m: Any) => Number(m.usedQuantity) > 0) && (
        <p className="muted">Material used: {ws.materials.filter((m: Any) => Number(m.usedQuantity) > 0).map((m: Any) => `${m.materialName}${m.variant ? ' ' + m.variant : ''} ${fmt(m.usedQuantity, 3)} ${m.unit}`).join(' · ')}</p>
      )}
      {d.isSubmitted && <p className="muted">Signed by {d.qualityAssuranceSignedName || d.submittedBy} · {String(d.submittedAt).slice(0, 16).replace('T', ' ')}</p>}
    </section>
  );
}

// ---------------- the page ----------------

export default function SiteDpr({ boot }: Any) {
  const role = boot?.user?.role;
  const projects: Any[] = (role === 'SITE_ENGINEER' || role === 'QC' ? boot?.siteOperationProjects : boot?.projects) || [];
  const [projectId, setProjectId] = useState('');
  const [workDate, setWorkDate] = useState(() => role === 'PM' ? addDays(istToday(), 1) : istToday());
  const [ws, setWs] = useState<Any>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [editingPlan, setEditingPlan] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [upload, setUpload] = useState<{ state: string; text: string } | null>(null);
  const [resubmitReason, setResubmitReason] = useState('');

  useEffect(() => { if (!projectId && projects.length === 1) setProjectId(String(projects[0].Project_ID)); }, [projects.length]);
  useEffect(() => { if (projectId) open(projectId, workDate); }, [projectId]);

  async function open(p = projectId, date = workDate) {
    if (!p) return;
    setLoading(true); setError(''); setEditingPlan(false);
    try { setWs(await siteCall('getDprWorkspace', p, date)); } catch (e) { setWs(null); setError((e as Error).message); } finally { setLoading(false); }
  }
  const saved = (value: Any, text: string) => { setWs(value); setMessage(text); setEditingPlan(false); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };

  async function runUpload(j: Job) {
    setJob(j);
    setUpload({ state: 'busy', text: 'DPR saved. Uploading photos…' });
    try {
      const activityPhotos = [];
      for (const g of j.groups) activityPhotos.push({ targetId: g.targetId, photos: await photoData(g.files) });
      const materialPhotos = await photoData(j.materialFiles);
      const r = await siteCall('uploadDeferredDprEvidence', { clientRequestId: j.clientRequestId, projectId: j.projectId, workDate: j.workDate, activityPhotos, materialPhotos });
      setUpload({ state: 'done', text: `Photo upload complete: ${r.uploadedCount} photos archived.` });
      setJob(null);
      if (j.projectId === projectId) open(j.projectId, j.workDate);
    } catch (e) {
      setUpload({ state: 'failed', text: 'The DPR is saved, but the photos did not upload: ' + (e as Error).message + ' Keep this page open and retry.' });
    }
  }

  async function act(action: string, payload: Any, text: string) {
    setError('');
    try { saved(await siteCall(action, { projectId: ws.project.projectId, workDate: ws.workDate, ...payload }), text); } catch (e) { setError((e as Error).message); }
  }

  const p = ws?.permissions || {};
  const d = ws?.daily;
  const engineer = role === 'SITE_ENGINEER' || role === 'QC';
  return (
    <section className="site-page">
      <form className="panel site-picker" onSubmit={(e) => { e.preventDefault(); open(); }}>
        <label className="field">
          <span>Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{projects.length ? 'Select project…' : 'No ongoing project is assigned to you'}</option>
            {projects.map((x: Any) => <option key={x.Project_ID} value={x.Project_ID}>{x.Project_ID} — {x.Client}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Work date</span>
          <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </label>
        <div className="site-actions">
          <button className="primary" disabled={!projectId || loading}>{loading ? 'Opening…' : 'Open day'}</button>
          {engineer && <button type="button" className="secondary" onClick={() => { const t = istToday(); setWorkDate(t); open(projectId, t); }}>Today</button>}
          {engineer && <button type="button" className="secondary" onClick={() => { const t = addDays(istToday(), -1); setWorkDate(t); open(projectId, t); }}>Yesterday</button>}
          {role === 'PM' && <button type="button" className="secondary" onClick={() => { const t = addDays(istToday(), 1); setWorkDate(t); open(projectId, t); }}>Tomorrow</button>}
        </div>
      </form>
      {upload && <p className={'alert ' + (upload.state === 'failed' ? 'red' : upload.state === 'done' ? 'green' : 'amber')} role="status">
        {upload.text}
        {upload.state === 'failed' && job && <button className="secondary" onClick={() => runUpload(job)}>Retry photo upload</button>}
        {upload.state !== 'busy' && <button className="textbutton" onClick={() => setUpload(null)}>Dismiss</button>}
      </p>}
      {message && <p className="alert green" role="status">{message} <button className="textbutton" onClick={() => setMessage('')}>Dismiss</button></p>}
      {error && <p className="alert red" role="alert">{error}</p>}
      {ws && <>
        <section className="panel site-project">
          <div><span>Project</span><b>{ws.project.projectId} — {ws.project.client}</b><small>{ws.project.location}</small></div>
          <div><span>Project Manager</span><b>{ws.project.pmName || ws.project.pmEmail}</b></div>
          <div><span>Site Engineer</span><b>{ws.project.siteEngineerName || '—'}</b></div>
          <div><span>Work date</span><b>{niceDate(ws.workDate)}</b><small>{engineer ? `Site entry open until end of ${niceDate(ws.engineerEntryDeadline)}` : ''}</small></div>
        </section>
        {p.lockReason && <p className="alert">{p.lockReason}</p>}
        {!d && !p.canEditPlan && <div className="panel empty"><h3>No target for this day</h3><p>{engineer ? 'The Project Manager has not set a target for this project and date yet.' : 'No target was set for this date.'}</p></div>}
        {p.canEditPlan && (!d || editingPlan) && <PlanEditor ws={ws} onSaved={saved} onCancel={d ? () => setEditingPlan(false) : null} />}
        {d && !editingPlan && <PlanSummary ws={ws} />}
        {p.canEditPlan && d && !editingPlan && <button className="secondary site-edit" onClick={() => setEditingPlan(true)}>Edit target</button>}
        {p.canEditMorning && <MorningForm ws={ws} onSaved={saved} />}
        {p.canEditEvening && d?.morningUpdatedAt && <EveningForm key={d.lastEodRequestId + d.resubmitStatus} ws={ws} onSubmitted={() => setMessage('DPR submitted and locked. Stock is updated.')} startUpload={runUpload} />}
        {p.canEditEvening && d && !d.morningUpdatedAt && <p className="alert">Save the morning manpower first; the end-of-day form opens after that.</p>}
        {d?.isSubmitted && d.evidenceUploadStatus && d.evidenceUploadStatus !== 'COMPLETE' && !job && (
          <p className="alert amber">Photos for this DPR were not uploaded ({d.evidenceUploadStatus.toLowerCase()}{d.evidenceUploadLastError ? ': ' + d.evidenceUploadLastError : ''}). Ask the Project Manager to approve a resubmission and add them again.</p>
        )}
        {p.canRequestResubmit && (
          <form className="panel" onSubmit={(e) => { e.preventDefault(); act('requestDprResubmission', { reason: resubmitReason }, 'Resubmission requested. The Project Manager must approve it before you can correct the DPR.'); }}>
            <h3>Need to correct this DPR?</h3>
            <Txt label="What needs correcting" required max={1000} value={resubmitReason} onChange={setResubmitReason} />
            <button className="secondary" disabled={!resubmitReason.trim()}>Ask the PM to reopen it</button>
          </form>
        )}
        {d?.resubmitStatus === 'REQUESTED' && (
          <section className="panel">
            <h3>Resubmission requested</h3>
            <p>{d.resubmitRequestReason} <small className="muted">— {d.resubmitRequestedBy}</small></p>
            {p.canApproveResubmit
              ? <button className="primary" onClick={() => act('approveDprResubmission', {}, 'Resubmission approved. The Site Engineer can submit one corrected DPR.')}>Approve one resubmission</button>
              : <p className="muted">Waiting for the Project Manager.</p>}
          </section>
        )}
      </>}
      {!ws && !loading && !error && projects.length > 1 && <div className="panel empty"><h3>Choose a project and date</h3></div>}
    </section>
  );
}
