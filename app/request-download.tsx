'use client';
// BOQ Team (also GM, Audit): download purchase requests for all Project Managers or chosen ones
// into one Excel workbook — a Requests sheet with every line and a Summary per PM.
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { inPeriod, periodLabel, recordWindow, type Period } from '@/lib/weekly';
import { milestoneLabel } from '@/lib/activities';

type Any = any;
const stageText = (r: Any) => r.stage === 'Cancelled' ? 'Cancelled' : r.stage === 'Rejected' ? 'Rejected' : r.closure?.state === 'Closed' ? 'Closed'
  : r.gmApproval?.state === 'Pending' ? 'Awaiting GM approval' : r.stage === 'Submitted' ? 'Waiting for BOQ' : r.stage === 'BOQ priced' ? 'With Purchase'
  : r.stage === 'Vendors finalized' ? 'With Audit' : r.stage === 'Audit approved' ? 'Audit approved' : r.stage;

export default function RequestDownload({ records, period }: { records: Any[]; period: Period }) {
  const [open, setOpen] = useState(false), [managers, setManagers] = useState<Any[] | null>(null), [chosen, setChosen] = useState<string[]>([]);
  const [weeks, setWeeks] = useState('shown'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function show() {
    setOpen(true); setError('');
    if (!managers) {
      try { const r = await fetch('/api/managers'); const d: Any = await r.json(); if (!r.ok) throw Error(d.error); setManagers(d.managers); }
      catch (e) { setError((e as Error).message); }
    }
  }
  const list: Any[] = managers || [];
  const all = chosen.length === 0;
  const pmOf = (project: string) => list.find((m) => m.projects.some((p: Any) => p.project === String(project)));
  async function download() {
    setBusy(true); setError('');
    try {
      const wanted = all ? list : list.filter((m) => chosen.includes(m.email));
      const projects = new Set(wanted.flatMap((m) => m.projects.map((p: Any) => p.project)));
      const purchases = records.filter((r) => r.kind === 'purchase');
      const rows = records.filter((r) => ['plan', 'request'].includes(r.kind) && (all ? true : projects.has(String(r.project)))
        && (weeks === 'all' || inPeriod(recordWindow(r, records), period)))
        .sort((a, b) => (pmOf(a.project)?.name || '').localeCompare(pmOf(b.project)?.name || '') || Number(a.project) - Number(b.project) || String(a.window).localeCompare(String(b.window)) || Number(a.activity) - Number(b.activity));
      if (!rows.length) throw Error('No purchase requests match. Choose other Project Managers or all weeks.');
      const ExcelJS: Any = await import('exceljs');
      const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Requests');
      const cols: [string, number, (r: Any) => any][] = [
        ['Project Manager', 22, (r) => pmOf(r.project)?.name || ''], ['Project', 9, (r) => Number(r.project)], ['Type', 10, (r) => (r.kind === 'plan' ? 'Planned' : 'Ad hoc')],
        ['Trade', 11, (r) => r.trade || 'Structural'], ['Request no.', 11, (r) => r.activityRequestCode || ''], ['Milestone', 28, (r) => milestoneLabel(r.milestone)],
        ['Activity', 9, (r) => Number(r.activity) || r.activity], ['Activity name', 28, (r) => r.activityName || ''], ['Item', 28, (r) => r.item], ['Unit', 8, (r) => r.unit],
        ['Requested qty', 12, (r) => Number(r.requestedQty || r.demandQty || r.boqQty || r.qty || 0)], ['Approved activity BOQ qty', 14, (r) => Number(r.activityBoqQty) || null],
        ['Requested so far (activity)', 14, (r) => Number(r.quantityControl?.cumulative) || null], ['Variation (above BOQ)', 12, (r) => Number(r.quantityControl?.excess) || 0],
        ['Execution week (Thu)', 13, (r) => r.window || ''], ['Required on', 12, (r) => r.due || ''], ['Status', 18, stageText],
        ['BOQ rate', 11, (r) => Number(r.boqOriginalRate) || null], ['Purchase target', 12, (r) => Number(r.kind === 'plan' ? r.boqRate : r.estimateRate) || null],
        ['Vendor', 20, (r) => r.vendor || ''], ['Vendor rate', 11, (r) => Number(r.quoteRate) || null],
        ['PO', 16, (r) => purchases.filter((p) => p.parent === r.id).map((p) => p.po).filter(Boolean).join(', ')],
        ['Owner', 12, (r) => r.owner || ''], ['Category', 14, (r) => r.itemCategory || ''], ['Submitted', 12, (r) => String(r.submittedAt || '').slice(0, 10)],
        ['Cancelled / rejected reason', 30, (r) => r.requestCancellation?.reason || (r.stage === 'Rejected' ? r.reviewNote || r.gmApproval?.note || '' : '')],
      ];
      sheet.columns = cols.map(([header, width]) => ({ header, width }));
      rows.forEach((r) => sheet.addRow(cols.map(([, , f]) => f(r))));
      sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      const sum = book.addWorksheet('Summary');
      sum.columns = [{ header: 'Project Manager', width: 24 }, { header: 'Projects', width: 30 }, { header: 'Lines', width: 8 }, { header: 'Waiting for BOQ', width: 15 }, { header: 'Audit approved', width: 14 }, { header: 'Lines above BOQ', width: 15 }, { header: 'Cancelled / rejected', width: 18 }];
      const groups = new Map<string, Any[]>();
      rows.forEach((r) => { const k = pmOf(r.project)?.name || 'No PM assigned'; groups.set(k, [...(groups.get(k) || []), r]); });
      for (const [name, rs] of groups) sum.addRow([name, [...new Set(rs.map((r) => r.project))].join(', '), rs.length, rs.filter((r) => r.stage === 'Submitted').length,
        rs.filter((r) => r.stage === 'Audit approved').length, rs.filter((r) => Number(r.quantityControl?.excess) > 0).length, rs.filter((r) => ['Cancelled', 'Rejected'].includes(r.stage)).length]);
      sum.getRow(1).font = { bold: true };
      sum.addRow([]); sum.addRow([`Weeks: ${weeks === 'all' ? 'all weeks' : periodLabel(period)} · Downloaded ${new Date().toLocaleString('en-IN')}`]);
      const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Purchase requests - ${all ? 'all PMs' : wanted.map((m) => m.name).join(', ').slice(0, 60)}.xlsx`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <button className="secondary" onClick={show}>Download requests</button>
      <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
        <DialogContent className="wide-dialog">
          <DialogTitle>Download purchase requests</DialogTitle>
          <DialogDescription>One Excel workbook: every request line with its status and rates, and a summary per Project Manager.</DialogDescription>
          <div className="download-pms">
            <label className="site-check"><input type="checkbox" checked={all} onChange={() => setChosen([])} /> <b>All Project Managers</b></label>
            {!managers && !error && <p className="muted">Loading Project Managers…</p>}
            {list.map((m) => (
              <label key={m.email} className="site-check"><input type="checkbox" checked={chosen.includes(m.email)} onChange={(e) => setChosen(e.target.checked ? [...chosen, m.email] : chosen.filter((x) => x !== m.email))} />
                {m.name} <small className="muted">· projects {m.projects.map((p: Any) => p.project).join(', ')}</small></label>
            ))}
          </div>
          <div className="view-switch download-weeks">
            <button type="button" className={weeks === 'shown' ? 'chosen' : ''} onClick={() => setWeeks('shown')}>{periodLabel(period)}</button>
            <button type="button" className={weeks === 'all' ? 'chosen' : ''} onClick={() => setWeeks('all')}>All weeks</button>
          </div>
          {error && <p className="alert red" role="alert">{error}</p>}
          <div className="formfooter"><button className="primary" onClick={download} disabled={busy || !managers}>{busy ? 'Preparing…' : 'Download Excel'}</button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
