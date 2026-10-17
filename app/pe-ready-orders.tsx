'use client';
// Plumbing & electrical requests approved by Audit, shown on Purchase orders next to the
// material orders so Purchase issues every PO from one place. The PO itself is created by
// the same /api/quotes "order" action used in the Plumbing & electrical panel: one lump-sum
// line at the chosen quote, plus its payment forecast.
import { useState } from 'react';
import { money } from '@/lib/calculations';
import { inPeriod, weekLabel, type Period } from '@/lib/weekly';
import { orderFor, selectedQuote } from '@/lib/quotes';

export function peReady(records: any[], project: string, per: Period, query = '') {
  const q = query.trim().toLowerCase();
  return records.filter(
    (r: any) =>
      r.kind === 'quote' &&
      r.stage === 'Audit approved' &&
      !orderFor(r, records) &&
      (project === 'all' || r.project === project) &&
      inPeriod(r.window, per) &&
      (!q ||
        [r.trade, r.project, r.selection?.vendor, selectedQuote(r)?.vendor, r.activity, 'plumbing electrical']
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );
}

function Row({ r, canOrder, refresh, onIssued }: any) {
  const chosen = selectedQuote(r);
  const vendor = chosen?.vendor || r.selection?.vendor || 'Chosen vendor';
  const amount = chosen?.amount ?? r.selection?.amount;
  const [form, setForm] = useState({
    entity: r.entity || 'GROUP',
    creditDays: String(chosen?.creditDays ?? 0),
    expectedDelivery: r.neededBy || r.due || '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function issue(e: any) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'order',
          id: r.id,
          version: r.version,
          entity: form.entity,
          creditDays: Number(form.creditDays),
          expectedDelivery: form.expectedDelivery,
        }),
      });
      const d: any = await res.json();
      if (!res.ok) throw Error(d.error || 'Unable to issue the PO.');
      onIssued(`PO ${d.po} issued to ${vendor} for ${r.trade.toLowerCase()} (project ${r.project}). It is under Created orders; the site records delivery under Receive goods (GRN).`);
      await refresh();
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'TimeoutError' ? 'Timed out. Refresh and check before retrying.' : String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vendor-order-row pe-order-row">
      <div>
        <b>
          {r.trade} · {vendor}
        </b>
        <small>
          Project {r.project} · week {r.window ? weekLabel(r.window) : '—'} · needed by {r.neededBy || r.due}
          {amount != null ? ` · ${money(amount)} lump sum` : ''}
          {chosen?.brands ? ` · ${chosen.brands}` : ''}
        </small>
        {error && (
          <p className="alert red" role="alert">
            {error}
          </p>
        )}
      </div>
      {canOrder ? (
          <form className="quote-inline" onSubmit={issue}>
            <label className="field">
              <span>Buyer</span>
              <select value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })}>
                <option value="GROUP">Bilara Group</option>
                <option value="BUILDERS">Bilara Builders</option>
              </select>
            </label>
            <label className="field">
              <span>Credit days</span>
              <input
                type="number"
                min={0}
                max={365}
                required
                value={form.creditDays}
                onChange={(e) => setForm({ ...form, creditDays: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Expected delivery</span>
              <input
                type="date"
                required
                value={form.expectedDelivery}
                onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Issuing…' : 'Issue PO'}
            </button>
          </form>
        ) : (
          <span className="tag amber">Waiting for Purchase to issue the PO</span>
        )}
    </div>
  );
}

export default function PeReadyOrders({ records, project, period, query, canOrder, refresh }: any) {
  const items = peReady(records, project, period, query);
  // Kept here because an issued request leaves the list after the refresh.
  const [issued, setIssued] = useState<string[]>([]);
  if (!items.length && !issued.length) return null;
  return (
    <section className="panel">
      <h2>
        Plumbing &amp; electrical · ready for PO <span className="tag green">{items.length}</span>
      </h2>
      <p className="muted order-help">
        Approved by Audit. One lump-sum PO at the quote BOQ chose; the payment forecast is created with it.
        {canOrder ? '' : ' Purchase issues these POs; you can see them here.'}
      </p>
      {issued.map((m, i) => (
        <p key={i} className="alert green" role="status">
          {m}
        </p>
      ))}
      {items.map((r: any) => (
        <Row
          key={r.id + ':' + r.version}
          r={r}
          canOrder={canOrder}
          refresh={refresh}
          onIssued={(m: string) => setIssued((x) => [...x, m])}
        />
      ))}
      {!items.length && <p className="muted">Nothing else is waiting for a PO.</p>}
    </section>
  );
}
