'use client';
// Cancel one purchase request line (Audit, GM, the project's PM). Shown in the request's details.
import { useState } from 'react';
import { acceptedQty } from '@/lib/grn';

export default function CancelRequest({ request, records, refresh, canCancel }: any) {
  const r = records.find((x: any) => x.id === request.id) || request;
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (r.stage === 'Cancelled') {
    const c = r.requestCancellation || {};
    return (
      <section className="panel cancel-request done">
        <h3>Cancelled</h3>
        <p>By {c.by} ({c.role}) · {c.at ? new Date(c.at).toLocaleString('en-IN') : ''}</p>
        <p>Reason: {c.reason}</p>
        {c.keptQty > 0 && <p className="muted">{c.keptQty} {r.unit} had been delivered and stays on the PO; {c.cancelledQty} {r.unit} cancelled.</p>}
      </section>
    );
  }
  if (!canCancel || r.stage === 'Rejected' || r.closure?.state === 'Closed') return null;
  const pos = records.filter((p: any) => p.kind === 'purchase' && p.parent === r.id && p.status !== 'Cancelled');
  const effect = pos.map((p: any) => {
    const acc = acceptedQty(p);
    if (p.shortClose || acc >= Number(p.qty)) return `${p.po}: fully delivered, stays as it is.`;
    if (acc > 0) return `${p.po}: ${acc} of ${p.qty} ${p.unit} received. The PO line closes at ${acc} ${p.unit}; ${Number(p.qty) - acc} ${p.unit} cancelled with the vendor.`;
    return `${p.po}: nothing received yet. The PO line and its unpaid payment schedule are cancelled — tell the vendor.`;
  });
  async function save(e: any) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/cancel-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, version: r.version, reason, confirmed }) });
      const d: any = await res.json();
      if (!res.ok) throw Error(d.error);
      setOpen(false); await refresh();
    } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
  }
  if (!open) return <div className="actions cancel-request"><button type="button" className="secondary danger" onClick={() => { setOpen(true); setError(''); setConfirmed(false); }}>Cancel this line</button></div>;
  return (
    <form className="panel cancel-request" onSubmit={save}>
      <h3>Cancel {r.item}</h3>
      {pos.length ? <ul>{effect.map((t: string) => <li key={t}>{t}</li>)}</ul> : <p className="muted">No PO has been issued for this line yet.</p>}
      <label className="field"><span>Reason *</span><input required minLength={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Design changed, item not needed" /></label>
      <label className="site-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Cancel this line. It cannot be reopened; raise a new request if it is needed later.</label>
      {error && <p className="alert red" role="alert">{error}</p>}
      <div className="actions"><button className="primary" disabled={busy || !confirmed || reason.trim().length < 3}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Keep the line</button></div>
    </form>
  );
}
