'use client';
// Payment forecast for the week, split into normal requests, ad hoc requests and variations,
// with the variation lines listed separately and a forecast-vs-actual reconciliation.
import { useMemo, useState } from 'react';
import { money } from '@/lib/calculations';
import { weekLabel } from '@/lib/weekly';
import { forecastSplit, reconciliation, CLASS_LABEL, type ForecastClass } from '@/lib/forecast-split';

type Any = any;
const ORDER: ForecastClass[] = ['normal', 'adhoc', 'variation', 'other'];

export default function ForecastSummary({ records, window, project }: Any) {
  const split = useMemo(() => forecastSplit(records, window, project), [records, window, project]);
  const rec = useMemo(() => reconciliation(records, window, project), [records, window, project]);
  const [view, setView] = useState('');
  const cash = (t: Any) => t.estimate + t.due;
  if (!split.total.scheduled && !split.total.estimate && !rec.rows.length) return null;
  async function download() {
    const ExcelJS: Any = await import('exceljs');
    const book = new ExcelJS.Workbook();
    const s1 = book.addWorksheet('Forecast split');
    s1.addRow([`Payment forecast · week ${weekLabel(window)}${project === 'all' ? '' : ' · project ' + project}`]).font = { bold: true };
    s1.addRow(['', 'Not ordered yet (estimate)', 'Scheduled payments', 'Paid', 'Still to pay', 'Cash needed']).font = { bold: true };
    for (const k of ORDER) { const t = (split.classes as Any)[k]; s1.addRow([CLASS_LABEL[k], t.estimate / 100, t.scheduled / 100, t.paid / 100, t.due / 100, cash(t) / 100]); }
    const T = split.total; s1.addRow(['Total', T.estimate / 100, T.scheduled / 100, T.paid / 100, T.due / 100, cash(T) / 100]).font = { bold: true };
    s1.columns = [{ width: 34 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
    if (split.variations.length) {
      const s2 = book.addWorksheet('Variations');
      s2.addRow(['Project', 'Type', 'Request', 'Activity', 'Item', 'Approved BOQ', 'Requested so far', 'Above BOQ (this line)', 'Unit', 'Value', 'GM decision']).font = { bold: true };
      split.variations.forEach((v: Any) => s2.addRow([v.project, v.kind === 'request' ? 'Ad hoc' : 'Normal', v.activity, v.activityName, v.item, v.baseline, v.cumulative, v.qty, v.unit, v.value == null ? null : v.value / 100, v.gm]));
    }
    const s3 = book.addWorksheet('Reconciliation');
    s3.addRow(['Vendor', 'Project', 'PO', 'Item', 'Type', 'PO value', 'Accepted at site (GRN)', 'Billed', 'Scheduled', 'Paid', 'Still to receive', 'Still to bill', 'Still to pay', 'Bill check', 'Notes']).font = { bold: true };
    rec.rows.forEach((r: Any) => s3.addRow([r.vendor, r.project, r.po, r.item, r.type + (r.variation ? ' (variation)' : ''), r.poValue / 100, r.accepted / 100, r.billed / 100, r.scheduled / 100, r.paid / 100, r.toReceive / 100, r.toBill / 100, r.toPay / 100, r.billStatus, r.notes.join('; ')]));
    const t = rec.totals; s3.addRow(['Total', '', '', '', '', t.poValue / 100, t.accepted / 100, t.billed / 100, t.scheduled / 100, t.paid / 100, t.toReceive / 100, t.toBill / 100, t.toPay / 100]).font = { bold: true };
    s3.columns.forEach((c: Any, i: number) => { c.width = i === 3 ? 28 : i === 14 ? 40 : 14; });
    const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Forecast and reconciliation ${window}.xlsx`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return (
    <section className="panel forecast-split">
      <div className="tablebar">
        <div><h2>Forecast by request type</h2><p>Week {weekLabel(window)} · variations are the share of a line above its approved activity BOQ, shown on their own.</p></div>
        <div className="actions">
          <div className="view-switch">
            <button className={view === '' ? 'chosen' : ''} onClick={() => setView('')}>Summary</button>
            <button className={view === 'variations' ? 'chosen' : ''} onClick={() => setView('variations')}>Variations <span>{split.variations.length}</span></button>
            <button className={view === 'reconcile' ? 'chosen' : ''} onClick={() => setView('reconcile')}>Reconciliation <span>{rec.rows.length}</span></button>
          </div>
          <button className="secondary" onClick={download}>Download Excel</button>
        </div>
      </div>
      {view === '' && <div className="scroll-x"><table className="site-table">
        <thead><tr><th></th><th>Not ordered yet (estimate)</th><th>Scheduled payments</th><th>Paid</th><th>Still to pay</th><th>Cash needed</th></tr></thead>
        <tbody>
          {ORDER.filter((k) => k !== 'other' || split.classes.other.scheduled).map((k) => { const t = (split.classes as Any)[k]; return (
            <tr key={k} className={k === 'variation' ? 'variation-row' : ''}><td><b>{CLASS_LABEL[k]}</b></td><td>{money(t.estimate)}</td><td>{money(t.scheduled)}</td><td>{money(t.paid)}</td><td>{money(t.due)}</td><td><b>{money(cash(t))}</b></td></tr>
          ); })}
          <tr className="total-row"><td><b>Total</b></td><td>{money(split.total.estimate)}</td><td>{money(split.total.scheduled)}</td><td>{money(split.total.paid)}</td><td>{money(split.total.due)}</td><td><b>{money(cash(split.total))}</b></td></tr>
        </tbody></table></div>}
      {view === 'variations' && (split.variations.length
        ? <div className="scroll-x"><table className="site-table"><thead><tr><th>Project</th><th>Request</th><th>Item</th><th>Approved BOQ</th><th>Requested so far</th><th>Above BOQ</th><th>Value</th><th>GM</th></tr></thead>
          <tbody>{split.variations.map((v: Any) => <tr key={v.id}><td>{v.project}</td><td>{v.kind === 'request' ? 'Ad hoc' : 'Normal'} · {v.activity}<small>{v.activityName}</small></td><td>{v.item}</td><td>{v.baseline} {v.unit}</td><td>{v.cumulative} {v.unit}</td><td className="neg">+{v.qty} {v.unit}</td><td>{v.value == null ? 'Rate pending' : money(v.value)}</td><td>{v.gm || '—'}</td></tr>)}</tbody></table></div>
        : <p className="muted">No line this week is above its approved activity BOQ.</p>)}
      {view === 'reconcile' && (rec.rows.length
        ? <div className="scroll-x"><table className="site-table"><thead><tr><th>Vendor · PO</th><th>Item</th><th>PO value</th><th>Accepted (GRN)</th><th>Billed</th><th>Paid</th><th>To receive</th><th>To bill</th><th>To pay</th><th>Check</th></tr></thead>
          <tbody>{rec.rows.map((r: Any) => <tr key={r.id}><td><b>{r.vendor}</b><small>{r.po} · project {r.project}</small></td><td>{r.item}<small>{r.type}{r.variation ? ' · variation' : ''}</small></td>
            <td>{money(r.poValue)}</td><td>{money(r.accepted)}</td><td>{money(r.billed)}</td><td>{money(r.paid)}</td>
            <td>{r.toReceive ? money(r.toReceive) : '—'}</td><td>{r.toBill ? money(r.toBill) : '—'}</td><td>{r.toPay ? money(r.toPay) : '—'}</td>
            <td>{r.notes.length ? <span className="tag amber">{r.notes.join(' · ')}</span> : <span className="tag green">OK</span>}</td></tr>)}
            <tr className="total-row"><td><b>Total</b></td><td></td><td>{money(rec.totals.poValue)}</td><td>{money(rec.totals.accepted)}</td><td>{money(rec.totals.billed)}</td><td>{money(rec.totals.paid)}</td><td>{money(rec.totals.toReceive)}</td><td>{money(rec.totals.toBill)}</td><td>{money(rec.totals.toPay)}</td><td></td></tr>
          </tbody></table></div>
        : <p className="muted">No purchase order for this week yet.</p>)}
    </section>
  );
}
