'use client';
// Site oversight pages converted from the QC app: dashboards, labour productivity and payables,
// DPR compliance, QC office attendance, the Purchase site view (was the "Bilara Site Purchase"
// workbook) and email times. Every page shows only what the server returns for the role.
import { useEffect, useMemo, useState } from 'react';
import { siteCall, istToday, addDays, niceDate, fmt, titleCase } from '@/lib/site-client';

type Any = any;
const money = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct = (n: any) => (n === null || n === undefined || n === '' ? '—' : fmt(n) + '%');
const tone = (n: any, good = 95, ok = 80) => (n === null || n === undefined ? '' : Number(n) >= good ? 'green' : Number(n) >= ok ? 'amber' : 'red');

/** Download rows as a CSV file Excel opens directly. */
export function downloadCsv(name: string, headers: string[], rows: Any[]) {
  const cell = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [headers.map((h) => cell(h.replace(/_/g, ' '))).join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function useLoad(fn: () => Promise<Any>, deps: any[]) {
  const [data, setData] = useState<Any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const run = async (f = fn) => { setBusy(true); setError(''); try { setData(await f()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { run(); }, deps);
  return { data, setData, error, setError, busy, run };
}
function Tiles({ items }: Any) {
  return <div className="site-tiles">{items.filter(Boolean).map(([label, value, sub, t]: Any) => (
    <div key={label} className={'site-tile ' + (t || '')}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>
  ))}</div>;
}
function Table({ headers, rows, empty = 'Nothing to show.' }: Any) {
  return rows.length ? (
    <div className="scroll-x"><table className="site-table">
      <thead><tr>{headers.map((h: string) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r: Any[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  ) : <p className="muted">{empty}</p>;
}

// ---------------- dashboards ----------------

export function SiteDashboard({ boot }: Any) {
  const role = boot?.user?.role;
  const [preset, setPreset] = useState('WEEK'), [endDate, setEndDate] = useState(istToday()), [pm, setPm] = useState('');
  const { data: d, error, busy, run } = useLoad(() => siteCall('getOperationsDashboard', { preset, endDate, pmEmail: pm }), [preset, endDate, pm]);
  const e = d?.executive;
  const purchase = role === 'PURCHASE';
  return (
    <section className="site-page">
      <div className="panel site-picker">
        <label className="field"><span>Period</span>
          <select value={preset} onChange={(x) => setPreset(x.target.value)}>{(d?.presets || [{ id: 'DAY', label: 'Day' }, { id: 'WEEK', label: 'This week (Thu–Wed)' }, { id: 'MONTH', label: 'Last 30 days' }, { id: 'QUARTER', label: 'Last 90 days' }]).map((p: Any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <label className="field"><span>Up to</span><input type="date" max={istToday()} value={endDate} onChange={(x) => setEndDate(x.target.value)} /></label>
        {!purchase && role !== 'PM' && <label className="field"><span>Project Manager</span>
          <select value={pm} onChange={(x) => setPm(x.target.value)}><option value="">All</option>{(d?.projectManagers || []).map((p: Any) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></label>}
        <button className="secondary" onClick={() => run()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && <p className="alert red">{error}</p>}
      {d && <>
        <p className="muted">{d.range.label} · {niceDate(d.range.start)} to {niceDate(d.range.end)}</p>
        {e && <Tiles items={[
          ['Operations health', e.operationsHealth === null ? '—' : fmt(e.operationsHealth), `${e.healthCoverage} measures`, tone(e.operationsHealth, 85, 70)],
          ['DPRs filed', `${e.submittedDprs} of ${e.expectedDprs}`, pct(e.dprCoverage), tone(e.dprCoverage)],
          ['Work achieved', pct(e.deliveryEfficiency), 'against PM targets', tone(e.deliveryEfficiency, 95, 80)],
          ['QC passed', `${e.qualityPassed} of ${e.qualityChecks}`, `${e.majorDefects} major · ${e.minorDefects} minor defects`, tone(e.qualityPassRate)],
          ['Site Off / Not Started', `${e.siteOffDays} / ${e.notStartedDays} days`, ''],
          ['GRNs', e.grnCount, `${e.lowStockItems} low-stock items`, e.lowStockItems ? 'amber' : ''],
        ]} />}
        {(d.exceptions || []).length > 0 && <section className="panel"><h3>Needs attention</h3>
          <ul className="site-list">{d.exceptions.map((x: Any, i: number) => <li key={i}><span className={'tag ' + (x.severity === 'CRITICAL' ? 'red' : 'amber')}>{titleCase(x.severity)}</span> {x.projectNumber} · {x.message} <small className="muted">({x.owner})</small></li>)}</ul></section>}
        <section className="panel"><h3>Projects</h3>
          <Table headers={purchase ? ['Project', 'GRNs', 'Low stock', 'Wastage'] : ['Project', 'DPRs', 'Achieved', 'Hours used', 'QC', 'Wastage', 'Health']}
            rows={d.projects.map((p: Any) => purchase
              ? [<><b>{p.projectNumber}</b> {p.client}</>, p.grnCount, p.lowStockCount || '—', pct(p.wastagePercent)]
              : [<><b>{p.projectNumber}</b> {p.client}<small>{p.pmName}</small></>, `${p.submittedDprs} of ${p.expectedDprs}`, p.efficiencyPercent === null || p.efficiencyPercent === undefined ? '—' : <span className={'tag ' + tone(p.efficiencyPercent)}>{pct(p.efficiencyPercent)}</span>,
                pct(p.hourUsePercent), p.qualityChecks ? `${p.qualityPassed}/${p.qualityChecks}` : '—', <span className={p.highWastage ? 'neg' : ''}>{pct(p.wastagePercent)}</span>, p.operationsHealth === null ? '—' : fmt(p.operationsHealth)])} />
        </section>
        {(d.yesterdayReports || []).length > 0 && <section className="panel"><h3>Yesterday on site · {niceDate(d.yesterday)}</h3>
          {d.yesterdayReports.map((r: Any) => <div key={r.dprId} className="site-report">
            <div className="site-head"><b>{r.projectNumber} {r.client}</b><span className={'tag ' + tone(r.efficiencyPercent)}>{pct(r.efficiencyPercent)}</span></div>
            <small className="muted">{r.masons} masons · {r.labourers} helpers · {fmt(r.effectiveHours)} of {fmt(r.plannedHours)} h · signed {r.qualitySignedName}</small>
            <ul className="site-list">{r.activities.map((a: Any, i: number) => <li key={i}>{a.activity}: {pct(a.achievementPercent)}{a.output ? ' — ' + a.output : ''}{a.shortfallReason ? <span className="neg"> · {a.shortfallReason}</span> : null}</li>)}</ul>
            {r.materials.length > 0 && <small className="muted">Used: {r.materials.map((m: Any) => `${m.name} ${m.variant} ${fmt(m.quantity, 3)} ${m.unit}`).join(' · ')}</small>}
          </div>)}</section>}
        {!purchase && (d.pmScorecards || []).length > 0 && role !== 'PM' && <section className="panel"><h3>Project Managers</h3>
          <Table headers={['PM', 'Projects', 'Planned days', 'DPRs filed', 'Achieved', 'QC passed', 'Health']}
            rows={d.pmScorecards.map((p: Any) => [p.name, p.projectCount, p.plannedSiteDays, pct(p.dprCoverage), pct(p.deliveryEfficiency), pct(p.qualityPassRate), p.healthScore === null ? '—' : fmt(p.healthScore)])} /></section>}
        {!purchase && (d.qcScorecards || []).length > 0 && <section className="panel"><h3>Quality Coordinators</h3>
          <Table headers={['QC', 'Inspections', 'Passed', 'Failed', 'Major / minor', 'Open bookings']}
            rows={d.qcScorecards.map((q: Any) => [q.name, q.completedChecks, q.passed, q.failed, `${q.majorDefects} / ${q.minorDefects}`, q.activeBookings])} /></section>}
        <section className="panel"><h3>Low stock</h3>
          <Table headers={['Project', 'Material', 'Balance', 'Limit']} empty="No item is below its low-stock limit."
            rows={(d.lowStock || []).map((s: Any) => [s.projectNumber, `${s.materialName} ${s.variant}`, `${fmt(s.balanceQuantity, 3)} ${s.unit}`, fmt(s.threshold, 3)])} /></section>
        <section className="panel"><h3>GRNs in this period</h3>
          <Table headers={['GRN', 'Date', 'Project', 'Supplier', 'PO', 'Items']} empty="No goods received in this period."
            rows={(d.recentGrns || []).map((g: Any) => [<b key="g">{g.grnNo}</b>, g.receivedDate, g.projectNumber, g.supplier, g.poNo || <span className="tag amber">Awaiting PO</span>, <small key="i">{g.items.join(' · ')}</small>])} /></section>
        {(d.wastageTotals || []).length > 0 && <section className="panel"><h3>Wastage in this period</h3>
          <ul className="site-list">{d.wastageTotals.map((w: Any, i: number) => <li key={i}>{w.materialName} {w.variant}: {fmt(w.quantity, 3)} {w.unit}</li>)}</ul></section>}
      </>}
    </section>
  );
}

// ---------------- labour ----------------

function Leniency({ row, onSaved }: Any) {
  const [open, setOpen] = useState(false), [percent, setPercent] = useState(String(row.recoveryPercent || '')), [reason, setReason] = useState(row.gmReason || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!open) return <button className="textbutton" onClick={() => setOpen(true)}>{row.recoveryPercent ? 'Change' : 'Approve recovery'}</button>;
  return <form className="site-inline-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { onSaved(await siteCall('saveGmLaborLeniency', { payableKey: row.payableKey, recoveryPercent: percent, reason })); setOpen(false); } catch (x) { setError((x as Error).message); } finally { setBusy(false); } }}>
    <input className="plan-input num" type="number" min={0} max={100} step="any" aria-label="Recovery %" value={percent} onChange={(e) => setPercent(e.target.value)} />%
    <input className="plan-input" maxLength={1000} placeholder="Reason" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    <button className="primary" disabled={busy}>Save</button><button type="button" className="textbutton" onClick={() => setOpen(false)}>Cancel</button>
    {error && <span className="neg">{error}</span>}
  </form>;
}

export function SiteLabour({ boot }: Any) {
  const role = boot?.user?.role;
  const [view, setView] = useState('weekly');
  const [filters, setFilters] = useState({ cycleStart: '', vendor: '', projectId: '' });
  const { data: d, setData, error, busy } = useLoad(() => siteCall('getLaborPayablesWorkspace', filters), [filters.cycleStart, filters.vendor, filters.projectId]);
  const [records, setRecords] = useState<Any>(null);
  const canRecords = ['LABOR_MANAGER', 'AUDITOR', 'GM', 'ADMIN'].includes(role);
  useEffect(() => { if (view === 'records' && !records) siteCall('getLaborRecords', {}).then(setRecords).catch(() => setRecords({ rows: [], summary: [], headers: [] })); }, [view]);
  const amounts = d?.canViewAmounts;
  return (
    <section className="site-page">
      <div className="site-tabs" role="tablist">
        <button className={view === 'weekly' ? 'active' : ''} onClick={() => setView('weekly')}>{amounts ? 'Weekly payables' : 'Weekly productivity'}</button>
        <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>By day</button>
        {canRecords && <button className={view === 'records' ? 'active' : ''} onClick={() => setView('records')}>Labour register</button>}
      </div>
      {view !== 'records' && <div className="panel site-picker">
        <label className="field"><span>Week (Thu–Wed)</span><select value={filters.cycleStart} onChange={(e) => setFilters({ ...filters, cycleStart: e.target.value })}><option value="">All weeks</option>{(d?.cycles || []).map((c: string) => <option key={c} value={c}>From Thu {niceDate(c)}</option>)}</select></label>
        <label className="field"><span>Vendor</span><select value={filters.vendor} onChange={(e) => setFilters({ ...filters, vendor: e.target.value })}><option value="">All vendors</option>{(d?.vendors || []).map((v: string) => <option key={v}>{v}</option>)}</select></label>
        <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}><option value="">All projects</option>{(d?.projects || []).map((p: Any) => <option key={p.projectId} value={p.projectId}>{p.projectId} {p.client}</option>)}</select></label>
        {busy && <span className="muted">Loading…</span>}
      </div>}
      {error && <p className="alert red">{error}</p>}
      {d && view !== 'records' && <p className="muted">Current week {niceDate(d.currentCycle.start)} – {niceDate(d.currentCycle.end)}, paid Thursday {niceDate(d.currentCycle.payout)}. Productivity is weighted by worker-hours; {amounts ? 'the payable is the actual-hours amount × productivity, plus any recovery the GM approves.' : 'amounts are shown to the GM, Auditor and Labour manager.'}</p>}
      {d && view === 'weekly' && <section className="panel">
        <Table headers={amounts ? ['Week', 'Project', 'Vendor', 'Worker-hours', 'Productivity', 'Actual hours ₹', 'Withheld', 'GM recovery', 'Payable'] : ['Week', 'Project', 'Vendor', 'Planned h', 'Actual h', 'Overtime h', 'Productivity']}
          empty="No submitted DPRs in this selection yet."
          rows={d.weekly.map((r: Any) => amounts
            ? [<>{niceDate(r.cycleStart)}<small>paid {niceDate(r.payoutDate)}</small></>, `${r.projectNumber} ${r.client}`, r.vendor, fmt(r.actualWorkerHours), <span className={'tag ' + tone(r.productivityPercent)}>{pct(r.productivityPercent)}</span>,
              money(r.actualHoursPayable), money(r.withheld), <>{r.recoveryPercent ? `${fmt(r.recoveryPercent)}% (${money(r.recoveryAmount)})` : '—'}{r.gmReason && <small>{r.gmReason}</small>}{d.canApprove && r.withheld > 0 && <Leniency row={r} onSaved={setData} />}</>, <b>{money(r.finalApprovedPayable)}</b>]
            : [niceDate(r.cycleStart), `${r.projectNumber} ${r.client}`, r.vendor, fmt(r.plannedWorkerHours), fmt(r.actualWorkerHours), fmt(r.overtimeWorkerHours), <span className={'tag ' + tone(r.productivityPercent)}>{pct(r.productivityPercent)}</span>])} />
        {amounts && d.weekly.length > 0 && <button className="secondary" onClick={() => downloadCsv('labour-payables', ['cycleStart', 'cycleEnd', 'payoutDate', 'projectNumber', 'client', 'vendor', 'plannedWorkerHours', 'actualWorkerHours', 'overtimeWorkerHours', 'productivityPercent', 'projectedPayable', 'actualHoursPayable', 'targetAdjustedPayable', 'withheld', 'recoveryPercent', 'recoveryAmount', 'finalApprovedPayable', 'gmReason', 'gmApprovedBy'], d.weekly)}>Download for Excel</button>}
      </section>}
      {d && view === 'daily' && <section className="panel">
        <Table headers={['Date', 'Project', 'Vendor', 'Planned h', 'Actual h', 'Overtime h', 'Productivity', ...(amounts ? ['Payable'] : [])]} empty="No submitted DPRs in this selection yet."
          rows={d.daily.map((r: Any) => [niceDate(r.workDate), `${r.projectNumber} ${r.client}`, r.vendor, fmt(r.plannedWorkerHours), fmt(r.actualWorkerHours), fmt(r.overtimeWorkerHours), pct(r.productivityPercent), ...(amounts ? [money(r.targetAdjustedPayable)] : [])])} />
      </section>}
      {view === 'records' && records && <section className="panel">
        <h3>By project</h3>
        <Table headers={['Project', 'PM', 'DPR days', 'Activities', 'Hours used', 'Achieved', 'Time-adjusted']} rows={records.summary.map((s: Any) => [`${s.Project_Number} ${s.Client}`, s.Project_Manager, s.DPR_Days, s.Activity_Records, pct(s.Planned_Hours_Used_Percent), pct(s.Average_Raw_Target_Achievement_Percent), pct(s.Average_Time_Adjusted_Achievement_Percent)])} />
        <h3>Every activity ({records.rows.length})</h3>
        <button className="secondary" disabled={!records.rows.length} onClick={() => downloadCsv('labour-register', records.headers, records.rows)}>Download for Excel</button>
        <Table headers={['Date', 'Project', 'Activity', 'Target', 'Done', 'Achieved', 'Hours', 'Masons/helpers']} rows={records.rows.slice(-200).reverse().map((r: Any) => [r.Work_Date, r.Project_Number, r.Activity, `${fmt(r.Planned_Target)} ${r.Measurement_Unit}`, r.Actual_Achieved === '' ? '—' : fmt(r.Actual_Achieved), pct(r.Raw_Target_Achievement_Percent), `${fmt(r.Effective_Hours)} / ${fmt(r.Planned_Hours)}`, `${r.Actual_Masons}/${r.Actual_Labourers}`])} />
      </section>}
    </section>
  );
}

// ---------------- DPR compliance ----------------

const complianceTone: Record<string, string> = { 'FILED ON TIME': 'green', FILED: 'green', 'FILED LATE': 'amber', MISSING: 'red', 'PM PLAN MISSING': 'red', 'SITE OFF': '', 'NOT STARTED': '' };
export function DprCompliance() {
  const [workDate, setWorkDate] = useState(addDays(istToday(), -1));
  const { data: d, error, busy, run } = useLoad(() => siteCall('getDprComplianceWorkspace', { workDate }), [workDate]);
  const s = d?.stats;
  return (
    <section className="site-page">
      <div className="panel site-picker">
        <label className="field"><span>Work date</span><input type="date" max={istToday()} value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></label>
        <button className="secondary" disabled={busy} onClick={() => run(() => siteCall('getDprComplianceWorkspace', { workDate, refresh: true }))}>{busy ? 'Working…' : 'Rebuild for this date'}</button>
      </div>
      {error && <p className="alert red">{error}</p>}
      {d && <>
        <Tiles items={[
          ['On-time compliance', pct(s.onTimeRate), `${niceDate(d.workDate)}`, tone(s.onTimeRate)],
          ['Filed on time', s.onTime, `of ${s.workRequired} required`, s.onTime === s.workRequired ? 'green' : ''],
          ['Filed late', s.late, '', s.late ? 'amber' : ''],
          ['Not submitted', s.missing, '', s.missing ? 'red' : ''],
          ['PM target missing', s.pmPlanMissing, '', s.pmPlanMissing ? 'red' : ''],
          ['Site Off / Not Started', `${s.siteOff} / ${s.notStarted}`, ''],
        ]} />
        <section className="panel"><h3>{niceDate(d.workDate)}</h3>
          <Table headers={['Project', 'Site Engineer', 'PM', 'Status', 'PM plan', 'Planned work', 'Actual', 'Productivity']}
            rows={d.rows.map((r: Any) => [<><b>{r.Project_Number}</b> {r.Client}<small>{r.Location}</small></>, r.Site_Engineer, r.Project_Manager,
              <span className={'tag ' + (complianceTone[r.Compliance_Status] ?? '')}>{titleCase(r.Compliance_Status)}</span>, <small>{titleCase(r.Plan_Timing)}</small>,
              <small>{r.Planned_Work_Details}</small>, <small>{r.Actual_Work_Details}</small>, pct(r.Site_Productivity_Percent)])} />
        </section>
        <section className="panel"><h3>Week · {niceDate(d.week.start)} – {niceDate(d.week.end)}</h3>
          <Table headers={['Day', 'Required', 'On time', 'Late', 'Missing', 'PM target missing', 'Site Off', 'On-time %']}
            rows={[...d.week.days.map((x: Any) => [niceDate(x.date), x.stats.workRequired, x.stats.onTime, x.stats.late, x.stats.missing, x.stats.pmPlanMissing, x.stats.siteOff, pct(x.stats.onTimeRate)]),
              [<b key="w">Week</b>, d.week.stats.workRequired, d.week.stats.onTime, d.week.stats.late, d.week.stats.missing, d.week.stats.pmPlanMissing, d.week.stats.siteOff, <b key="p">{pct(d.week.stats.onTimeRate)}</b>]]} />
        </section>
      </>}
    </section>
  );
}

// ---------------- QC office attendance (GM) ----------------

export function QcAttendance() {
  const [ym, setYm] = useState(istToday().slice(0, 7));
  const { data: d, setData, error, busy } = useLoad(() => siteCall('getAdminAttendanceWorkspace', Number(ym.slice(0, 4)), Number(ym.slice(5, 7))), [ym]);
  const [rowError, setRowError] = useState('');
  async function save(r: Any, patch: Any) {
    setRowError('');
    try { setData(await siteCall('saveAttendanceDecision', { date: r.date, email: r.email, present: r.present, reason: r.reason, decision: r.decision, ...patch })); } catch (e) { setRowError((e as Error).message); }
  }
  return (
    <section className="site-page">
      <div className="panel site-picker"><label className="field"><span>Month</span><input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>{busy && <span className="muted">Loading…</span>}</div>
      {(error || rowError) && <p className="alert red">{error || rowError}</p>}
      {d && <>
        <p className="muted">A QC engineer without a site booking is expected in the office; Sunday is off. Absences need a GM decision; a rejected absence is loss of pay.</p>
        <section className="panel"><h3>Today</h3>
          <Table headers={['QC engineer', 'Present', 'Reason', 'Decision', 'Pay']} empty="No QC engineer is due in the office today."
            rows={d.todayRows.map((r: Any) => [r.name, <input key="p" type="checkbox" aria-label={'Present, ' + r.name} checked={r.present} onChange={(e) => save(r, { present: e.target.checked })} />,
              <input key="r" className="plan-input" aria-label={'Reason, ' + r.name} defaultValue={r.reason} onBlur={(e) => e.target.value !== r.reason && save(r, { reason: e.target.value })} />,
              <select key="d" aria-label={'Decision, ' + r.name} value={r.decision} onChange={(e) => save(r, { decision: e.target.value })}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select>,
              <span key="l" className={'tag ' + (r.lopStatus === 'LOP' ? 'red' : r.lopStatus === 'PRESENT' ? 'green' : 'amber')}>{titleCase(r.lopStatus)}</span>])} /></section>
        <section className="panel"><h3>Month summary</h3>
          <Table headers={['QC engineer', 'Absent days', 'Approved', 'Loss of pay']} rows={d.lopSummary.map((s: Any) => [s.name, s.absentDates.length, s.approvedDates.length, <b key="l" className={s.lopDays ? 'neg' : ''}>{s.lopDays}</b>])} />
          <button className="secondary" onClick={() => downloadCsv('qc-attendance-' + ym, ['date', 'name', 'email', 'present', 'reason', 'decision', 'lopStatus'], d.register)}>Download register for HR</button></section>
        <section className="panel"><h3>Site bookings this month</h3>
          <Table headers={['QC engineer', 'Bookings and leave']} rows={d.engineers.map((q: Any) => [q.name, <small key="s">{q.schedule.map((x: Any) => `${niceDate(x.date)} ${x.kind === 'BOOKED' ? x.projectNumber + ' ' + x.purpose : x.purpose}`).join(' · ') || '—'}</small>])} /></section>
      </>}
    </section>
  );
}

// ---------------- Purchase site view ----------------

function ItemMaster() {
  const { data: d, setData, error, setError, busy } = useLoad(() => siteCall('getGrnItemMaster'), []);
  const [items, setItems] = useState<Any[] | null>(null);
  const [message, setMessage] = useState('');
  const rows = items || d?.items || [];
  const set = (i: number, patch: Any) => setItems(rows.map((r: Any, n: number) => n === i ? { ...r, ...patch } : r));
  async function save() {
    setError(''); setMessage('');
    try { const v = await siteCall('saveGrnItemMaster', { items: rows }); setData(v); setItems(null); setMessage(`Saved ${v.imported} items${v.invalid ? `; ${v.invalid} need fixing (marked below)` : ''}.`); } catch (e) { setError((e as Error).message); }
  }
  if (!d) return <p className="muted">{busy ? 'Loading…' : error}</p>;
  return <section className="panel">
    <h3>GRN item list</h3>
    <p className="muted">Sites can only receive items on this list. Keep an item but set Active to No once it has been used; codes are created for you.</p>
    {message && <p className="alert green">{message}</p>}{error && <p className="alert red">{error}</p>}
    <div className="scroll-x"><table className="site-table">
      <thead><tr><th>Category</th><th>Subcategory</th><th>Item</th><th>Stock unit</th><th>Units on site</th><th>Sizes</th><th>Active</th><th></th></tr></thead>
      <tbody>{rows.map((r: Any, i: number) => <tr key={r.rowId || 'n' + i}>
        <td><select aria-label="Category" value={r.Category || ''} onChange={(e) => set(i, { Category: e.target.value })}><option value="">—</option>{d.categories.map((c: string) => <option key={c}>{c}</option>)}</select></td>
        <td><select aria-label="Subcategory" value={r.Subcategory || ''} onChange={(e) => set(i, { Subcategory: e.target.value })}><option value="">—</option>{d.subcategories.map((c: string) => <option key={c}>{c}</option>)}</select></td>
        <td><input className="plan-input" aria-label="Item name" value={r.Item_Name || ''} onChange={(e) => set(i, { Item_Name: e.target.value })} /><small>{r.Item_Code}</small></td>
        <td><input className="plan-input" aria-label="Stock unit" value={r.Stock_Unit || ''} onChange={(e) => set(i, { Stock_Unit: e.target.value })} /></td>
        <td><input className="plan-input" aria-label="Input units" value={r.Input_Units || ''} onChange={(e) => set(i, { Input_Units: e.target.value })} /></td>
        <td><input className="plan-input" aria-label="Variants" value={r.Variants || ''} onChange={(e) => set(i, { Variants: e.target.value })} /></td>
        <td><select aria-label="Active" value={r.Active || 'Yes'} onChange={(e) => set(i, { Active: e.target.value })}><option>Yes</option><option>No</option></select></td>
        <td>{r.Validation_Status && r.Validation_Status !== 'VALID' && <small className="neg">{r.Validation_Message}</small>}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="site-actions">
      <button className="secondary" onClick={() => setItems([...rows, { Category: 'CONSTRUCTION MATERIAL', Subcategory: 'CIVIL', Item_Name: '', Stock_Unit: 'nos', Input_Units: 'NOS', Variants: '', Active: 'Yes' }])}>+ Add item</button>
      <button className="primary" disabled={!items} onClick={save}>Save item list</button>
    </div>
  </section>;
}

function Followups({ d, setData }: Any) {
  const [error, setError] = useState('');
  async function save(f: Any, patch: Any) {
    setError('');
    try { setData(await siteCall('saveGrnFollowup', { grnNo: f.GRN_No, reviewStatus: f.Purchase_Review_Status, invoiceMatch: f.Invoice_Match, exceptionDetails: f.Exception_Details, remarks: f.Purchase_Remarks, ...patch })); } catch (e) { setError((e as Error).message); }
  }
  return <section className="panel">
    <h3>GRN follow-up</h3>
    <p className="muted">Every GRN from site, with its PO. Mark each one reviewed and whether the invoice matches.</p>
    {error && <p className="alert red">{error}</p>}
    <Table headers={['GRN', 'Project', 'Date', 'Supplier', 'PO', 'Review', 'Invoice', 'Remarks']} empty="No GRNs yet."
      rows={d.followups.map((f: Any) => [<b key="g">{f.GRN_No}</b>, `${f.Project_Number} ${f.Client}`, f.Received_Date, f.Supplier, f.Purchase_PO_No || <span key="a" className="tag amber">Awaiting PO</span>,
        <select key="r" aria-label={'Review, ' + f.GRN_No} value={f.Purchase_Review_Status || ''} onChange={(e) => save(f, { reviewStatus: e.target.value })}><option value="">—</option>{d.reviewStatuses.map((x: string) => <option key={x}>{x}</option>)}</select>,
        <select key="i" aria-label={'Invoice, ' + f.GRN_No} value={f.Invoice_Match || ''} onChange={(e) => save(f, { invoiceMatch: e.target.value })}><option value="">—</option>{d.invoiceMatch.map((x: string) => <option key={x}>{x}</option>)}</select>,
        <input key="m" className="plan-input" aria-label={'Remarks, ' + f.GRN_No} defaultValue={f.Purchase_Remarks} onBlur={(e) => e.target.value !== f.Purchase_Remarks && save(f, { remarks: e.target.value })} />])} />
  </section>;
}

export function SitePurchase() {
  const [view, setView] = useState('followups'), [projectId, setProjectId] = useState('');
  const { data: d, setData, error } = useLoad(() => siteCall('getSitePurchaseWorkspace', { projectId }), [projectId]);
  const tabs: [string, string][] = [['followups', 'GRN follow-up'], ['summary', 'Stock summary'], ['arrivals', 'Arrivals'], ['usage', 'Usage'], ['wastage', 'Wastage'], ['items', 'Item list']];
  const tables: Record<string, [string, Any[], string[]]> = d ? {
    summary: ['site-stock-summary', d.summary, d.headers.summary], usage: ['site-material-usage', d.usage, d.headers.usage], wastage: ['site-wastage', d.wastage, d.headers.wastage],
    arrivals: ['site-arrivals', d.arrivals, ['GRN_No', 'Received_Date', 'Project_Number', 'Client', 'Supplier', 'Delivery_Note_No', 'Invoice_No', 'Vehicle_No', 'Material_Name', 'Variant', 'Stock_Quantity', 'Stock_Unit', 'Recorded_By']],
  } : {};
  const cols: Record<string, string[]> = {
    summary: ['Project_Number', 'Material_Name', 'Variant', 'Total_Received', 'Total_Used', 'Total_Wasted', 'Wastage_Percent', 'Current_Balance', 'Stock_Unit', 'Stock_Status'],
    usage: ['Work_Date', 'Project_Number', 'Material_Name', 'Variant', 'Quantity_Used', 'Unit', 'Balance_After', 'Recorded_By'],
    wastage: ['Waste_Date', 'Project_Number', 'Material_Name', 'Variant', 'Waste_Quantity', 'Stock_Unit', 'Reason'],
    arrivals: ['GRN_No', 'Received_Date', 'Project_Number', 'Supplier', 'Material_Name', 'Variant', 'Stock_Quantity', 'Stock_Unit'],
  };
  return (
    <section className="site-page">
      <div className="site-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      {view !== 'items' && <div className="panel site-picker"><label className="field"><span>Project</span><select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{(d?.projects || []).map((p: Any) => <option key={p.projectId} value={p.projectId}>{p.projectId} {p.client}</option>)}</select></label></div>}
      {error && <p className="alert red">{error}</p>}
      {view === 'items' && <ItemMaster />}
      {d && view === 'followups' && <Followups d={d} setData={setData} />}
      {d && tables[view] && <section className="panel">
        <div className="site-head"><h3>{tabs.find((t) => t[0] === view)?.[1]} · {tables[view][1].length} rows</h3>
          <button className="secondary" disabled={!tables[view][1].length} onClick={() => downloadCsv(tables[view][0], tables[view][2], tables[view][1])}>Download for Excel</button></div>
        <Table headers={cols[view].map((h) => h.replace(/_/g, ' '))} rows={tables[view][1].slice(0, 300).map((r: Any) => cols[view].map((h) => typeof r[h] === 'number' ? fmt(r[h], 3) : String(r[h] ?? '')))} />
      </section>}
    </section>
  );
}

// ---------------- email times (Admin) ----------------

export function EmailTimes() {
  const { data: d, setData, error, setError } = useLoad(() => siteCall('getEmailSchedule'), []);
  const [form, setForm] = useState<Any>(null), [message, setMessage] = useState('');
  useEffect(() => { if (d) setForm({ ...Object.fromEntries(d.schedules.map((x: Any) => [x.id, x.time])), enabled: { ...d.enabled } }); }, [d]);
  if (!d || !form) return <p className="muted">{error || 'Loading…'}</p>;
  return <section className="site-page"><section className="panel">
    <h3>Daily emails (India time)</h3>
    <p className="muted">Sent by the app's scheduled job. Each runs once a day; nothing is sent twice.{!d.lastDispatcherRunAt && ' The scheduled job has not run yet: set SITE_CRON_SECRET and call /api/site-cron every 5 minutes.'}</p>
    {message && <p className="alert green">{message}</p>}{error && <p className="alert red">{error}</p>}
    <div className="formgrid site-grid">{d.schedules.map((x: Any) => <label key={x.id} className="field"><span>{x.label}</span><input type="time" value={form[x.id]} onChange={(e) => setForm({ ...form, [x.id]: e.target.value })} /></label>)}</div>
    {Object.entries({ dprCompliance: 'DPR warning and final report', grnDigest: 'GRN digest to Purchase', lowStock: 'Low-stock digest', officeDuty: 'QC office-duty notice' }).map(([k, l]) =>
      <label key={k} className="site-check"><input type="checkbox" checked={!!form.enabled[k]} onChange={(e) => setForm({ ...form, enabled: { ...form.enabled, [k]: e.target.checked } })} /> {l}</label>)}
    <button className="primary" onClick={async () => { setError(''); try { setData(await siteCall('saveEmailSchedule', form)); setMessage('Email times saved.'); } catch (e) { setError((e as Error).message); } }}>Save</button>
    <h3>Recent emails</h3>
    <Table headers={['When', 'Type', 'To', 'Status']} empty="No email sent yet." rows={d.recent.slice(0, 30).map((r: Any) => [String(r.Sent_At || r.Created_At || '').slice(0, 16).replace('T', ' '), titleCase(r.Event_Type || ''), <small key="t">{r.Recipient_Email}{r.Error_Message && <span className="neg"> · {r.Error_Message}</span>}</small>, <span key="s" className={'tag ' + (String(r.Status).toUpperCase() === 'FAILED' ? 'red' : 'green')}>{titleCase(r.Status || '')}</span>])} />
  </section></section>;
}
