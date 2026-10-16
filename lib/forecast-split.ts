// Payment forecast for one Thursday week, split into normal (planned) requests, ad hoc requests
// and variations (quantity requested above the approved activity BOQ), plus the reconciliation
// of forecast and actual money per PO line. All amounts in paise.
import {forecastRequests} from './forecast-requests';
import {recordWindow} from './weekly';
import {acceptedValue, billedAmount, billStatus, orderedValue} from './grn';

export type ForecastClass = 'normal' | 'adhoc' | 'variation' | 'other';
export const CLASS_LABEL: Record<ForecastClass, string> = {
  normal: 'Normal purchase requests',
  adhoc: 'Ad hoc requests',
  variation: 'Variations (above approved BOQ)',
  other: 'Other payments (no request)',
};
type Totals = {estimate: number; scheduled: number; paid: number; due: number};
const zero = (): Totals => ({estimate: 0, scheduled: 0, paid: 0, due: 0});

/** Share of a request's quantity that is above the approved activity BOQ (0–1). */
export function variationShare(r: any) {
  const excess = Number(r?.quantityControl?.excess || 0), current = Number(r?.quantityControl?.currentRequested || 0);
  if (!(excess > 0) || !(current > 0)) return 0;
  return Math.min(1, excess / current);
}
const requestOf = (s: any, records: any[]) => {
  const p = records.find((x) => x.id === s.parent && x.kind === 'purchase');
  const r = p ? records.find((x) => x.id === p.parent && ['plan', 'request'].includes(x.kind)) : s.parent ? records.find((x) => x.id === s.parent && ['plan', 'request'].includes(x.kind)) : null;
  return {p, r};
};

export function forecastSplit(records: any[], window: string, project = 'all') {
  const classes: Record<ForecastClass, Totals> = {normal: zero(), adhoc: zero(), variation: zero(), other: zero()};
  const variations: any[] = [];
  const add = (r: any, field: keyof Totals, amount: number) => {
    if (!amount) return;
    if (!r) { classes.other[field] += amount; return; }
    const v = Math.round(amount * variationShare(r));
    classes[r.kind === 'request' ? 'adhoc' : 'normal'][field] += amount - v;
    classes.variation[field] += v;
  };
  for (const s of records.filter((x) => x.kind === 'payment' && x.status !== 'Cancelled' && recordWindow(x, records) === window && (project === 'all' || x.project === project))) {
    const {r} = requestOf(s, records);
    add(r, 'scheduled', s.total); add(r, 'paid', s.paid); add(r, 'due', s.total - s.paid);
  }
  for (const f of forecastRequests(records, window, project)) {
    if (f.estimate) add(f.request, 'estimate', f.estimate);
    // A PO not yet fully scheduled is also money to come this cycle.
    for (const p of f.unscheduled) add(f.request, 'estimate', p.remaining);
  }
  // Variation lines of this week, listed separately.
  for (const r of records.filter((x) => ['plan', 'request'].includes(x.kind) && !['Rejected', 'Cancelled'].includes(x.stage) && recordWindow(x, records) === window && (project === 'all' || x.project === project) && variationShare(x) > 0)) {
    const rate = Number(r.quoteRate || (r.kind === 'request' ? r.estimateRate : r.boqRate) || 0);
    const qty = Math.min(Number(r.quantityControl.excess), Number(r.quantityControl.currentRequested));
    variations.push({id: r.id, project: r.project, item: r.item, unit: r.unit, kind: r.kind, activity: r.activityRequestCode || r.activity, activityName: r.activityName,
      baseline: r.quantityControl.baseline, cumulative: r.quantityControl.cumulative, qty, value: rate ? Math.round(qty * rate * 100) : null, gm: r.gmApproval?.state || ''});
  }
  const total = (['normal', 'adhoc', 'variation', 'other'] as ForecastClass[]).reduce((t, k) => {
    (Object.keys(t) as (keyof Totals)[]).forEach((f) => { t[f] += classes[k][f]; }); return t;
  }, zero());
  return {classes, total, variations};
}

/** Forecast vs actual per PO line: ordered → accepted (GRN) → billed → paid. */
export function reconciliation(records: any[], window: string, project = 'all') {
  // PO lines executed this week, plus any PO line with a payment falling in this week.
  const paidThisWeek = new Set(records.filter((s) => s.kind === 'payment' && recordWindow(s, records) === window).map((s) => s.parent));
  const rows = records.filter((p) => p.kind === 'purchase' && (recordWindow(p, records) === window || paidThisWeek.has(p.id)) && (project === 'all' || p.project === project)).map((p) => {
    const r = records.find((x) => x.id === p.parent);
    const pays = records.filter((s) => s.kind === 'payment' && s.parent === p.id && s.status !== 'Cancelled');
    const ordered = p.status === 'Cancelled' ? 0 : orderedValue(p), poValue = p.status === 'Cancelled' ? 0 : p.total;
    const accepted = acceptedValue(p), billed = billedAmount(p), paid = pays.reduce((n, s) => n + s.paid, 0), scheduled = pays.reduce((n, s) => n + s.total, 0);
    const notes: string[] = [];
    if (p.status === 'Cancelled') notes.push('PO line cancelled');
    if (p.shortClose) notes.push(`Closed at ${p.shortClose.acceptedQty} of ${p.shortClose.orderedQty} ${p.unit}`);
    if (scheduled !== poValue && p.status !== 'Cancelled') notes.push('Payment schedule differs from PO value');
    if (billStatus(p) === 'Mismatch') notes.push('Bill does not match PO / GRN');
    if (paid > billed && billed > 0) notes.push('Paid more than billed');
    return {id: p.id, project: p.project, vendor: p.vendor, po: p.po, item: p.item, unit: p.unit, type: r?.kind === 'request' ? 'Ad hoc' : 'Normal', variation: variationShare(r) > 0,
      ordered, poValue, accepted, billed, scheduled, paid,
      toReceive: Math.max(0, poValue - accepted), toBill: Math.max(0, accepted - billed), toPay: Math.max(0, Math.max(billed, accepted) - paid), billStatus: billStatus(p), notes};
  }).sort((a, b) => String(a.vendor).localeCompare(String(b.vendor)) || Number(a.project) - Number(b.project));
  const sum = (k: string) => rows.reduce((n, x: any) => n + x[k], 0);
  return {rows, totals: {ordered: sum('ordered'), poValue: sum('poValue'), accepted: sum('accepted'), billed: sum('billed'), scheduled: sum('scheduled'), paid: sum('paid'), toReceive: sum('toReceive'), toBill: sum('toBill'), toPay: sum('toPay')}};
}
