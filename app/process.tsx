'use client';
// "Process" on a request row: only the step that is waiting for the signed-in person, in one
// short window — BOQ review, GM approval, Purchase vendor selection, Audit decision, or the PM
// correcting a quantity Audit sent back. "View" (the full record) stays read only.
import { useState } from 'react';
import { has } from '@/lib/permissions';
import { vendorsFor } from '@/lib/vendors';
import BoqReview, { AuditDecision, decide } from './boq-review';

type Any = Record<string, any>;

/** What the signed-in person can do on this request now ('' = nothing). */
export function processStep(user: any, r: Any): '' | 'boq' | 'gm' | 'purchase' | 'audit' | 'pm-qty' | 'order' {
  if (!['plan', 'request'].includes(r.kind) || r.closure?.state === 'Closed') return '';
  if (r.gmApproval?.state === 'Pending') return has(user, 'GM') ? 'gm' : '';
  if (r.stage === 'Submitted' && r.auditReturn?.reason === 'quantity' && !r.auditReturn.fixedAt)
    return has(user, 'Project Manager') && !user.roles.includes('Super Admin') ? 'pm-qty' : '';
  if (r.stage === 'Submitted') return has(user, 'BOQ Team') ? 'boq' : '';
  if (r.stage === 'BOQ priced') return has(user, 'Purchase Manager', 'Purchase Team') ? 'purchase' : '';
  if (r.stage === 'Vendors finalized') return has(user, 'Audit') ? 'audit' : '';
  if (r.stage === 'Audit approved') return has(user, 'Purchase Manager', 'Purchase Team') ? 'order' : '';
  return '';
}

async function post(body: Any) {
  const res = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'Could not save.');
  return d;
}

/** Purchase: choose the vendor (from Vendors & brands, or another), the vendor rate and entity; send for approval. */
function PurchaseProcess({ request: r, vendorList, refresh, onDone }: Any) {
  const vendors = vendorsFor(vendorList, r.project, r.item);
  const listed = vendors.find((v: Any) => v.vendor === r.vendor && (!r.brand || v.brand === r.brand));
  const [choice, setChoice] = useState(listed ? listed.id : r.vendor ? '__other' : vendors.length === 1 ? vendors[0].id : '');
  const pick = vendors.find((v: Any) => v.id === choice);
  const [vendor, setVendor] = useState(r.vendor || pick?.vendor || '');
  const [phone, setPhone] = useState(r.vendorPhone || pick?.phone || '');
  const [rate, setRate] = useState(r.quoteRate === '' || r.quoteRate == null ? (pick?.price ?? '') : String(r.quoteRate));
  const [entity, setEntity] = useState(r.entity || 'GROUP');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [msg, setMsg] = useState('');
  const target = Number(r.kind === 'plan' ? r.boqRate : r.estimateRate) || 0;
  const qty = Number(r.kind === 'plan' ? r.boqQty : r.qty) || 0;
  function choose(id: string) {
    setChoice(id);
    const v = vendors.find((x: Any) => x.id === id);
    if (v) { setVendor(v.vendor); setPhone(v.phone || ''); if (v.price !== '' && v.price != null) setRate(String(v.price)); }
    else if (id === '__other') { setVendor(''); setPhone(''); }
  }
  async function save(send: boolean) {
    setError(''); setMsg('');
    if (!vendor.trim()) return setError('Choose or type the vendor.');
    if (rate === '' || !(Number(rate) >= 0)) return setError('Enter the vendor unit rate.');
    setBusy(true);
    try {
      await post({ id: r.id, version: r.version, kind: r.kind, vendor: vendor.trim(), vendorPhone: phone.trim(), quoteRate: Number(rate), entity, ...(pick?.brand ? { brand: pick.brand } : {}), ...(send ? { stage: 'Vendors finalized' } : {}) });
      await refresh();
      if (send) onDone?.(); else setMsg('Saved. Send for approval when ready.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const over = target > 0 && Number(rate) > target;
  return (
    <section className="panel boq-review">
      <h3>Vendor selection</h3>
      <p className="muted">{qty} {r.unit} · purchase target ₹{target || '—'} per {r.unit}{r.auditReturn && r.stage === 'BOQ priced' ? ` · Audit sent back: "${r.auditReturn.note}"` : ''}</p>
      <div className="formgrid">
        <label className="field">
          <span>Vendor *</span>
          <select value={choice} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose vendor…</option>
            {vendors.map((v: Any) => <option key={v.id} value={v.id}>{v.vendor}{v.brand ? ' · ' + v.brand : ''}{v.price !== '' && v.price != null ? ' · ₹' + v.price : ''}</option>)}
            <option value="__other">Another vendor (type it)</option>
          </select>
        </label>
        {choice === '__other' && (
          <label className="field"><span>Vendor name *</span><input value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={160} /></label>
        )}
        <label className="field"><span>Vendor phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></label>
        <label className="field"><span>Vendor unit rate (₹) *</span><input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        <label className="field">
          <span>Purchasing entity</span>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="GROUP">Bilara Group</option>
            <option value="BUILDERS">Bilara Builders</option>
          </select>
        </label>
        <div className="field">
          <span>Value</span>
          <p className="boq-rate"><b>₹{(Number(rate || 0) * qty).toLocaleString('en-IN')}</b>{over && <span className="tag red">above target</span>}</p>
        </div>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => save(true)}>Send for approval</button>
        <button className="secondary" disabled={busy} onClick={() => save(false)}>Save</button>
      </div>
      {error && <p className="alert red" role="alert">{error}</p>}
      {msg && <p className="alert green" role="status">{msg}</p>}
    </section>
  );
}

/** GM: approve or reject the extra quantity above the approved BOQ. */
function GmProcess({ request: r, refresh, onDone }: Any) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function go(d: 'Approved' | 'Rejected') {
    setError('');
    if (d === 'Rejected' && !note.trim()) return setError('Write why it is rejected.');
    setBusy(true);
    try { await decide([r.id], d, note.trim() || 'Approved by GM'); await refresh(); onDone?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const q = r.quantityControl || r.gmApproval || {};
  return (
    <section className="panel boq-review">
      <h3>GM approval</h3>
      <p className="muted">{(r.gmApproval?.reasons || []).join(' · ')}{q.cumulative != null ? ` · requested ${q.cumulative} ${r.unit} against approved ${q.baseline} ${r.unit} (+${q.excess})` : ''}</p>
      <label className="field"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Optional to approve; required to reject" /></label>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => go('Approved')}>Approve</button>
        <button className="secondary danger" disabled={busy} onClick={() => go('Rejected')}>Reject</button>
      </div>
      {error && <p className="alert red" role="alert">{error}</p>}
    </section>
  );
}

/** PM: correct the quantity Audit sent back. */
function PmQuantity({ request: r, refresh, onDone }: Any) {
  const field = r.kind === 'plan' ? 'boqQty' : 'qty';
  const [qty, setQty] = useState(String(r[field] ?? '')), [notes, setNotes] = useState(r.notes || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { await post({ id: r.id, version: r.version, kind: r.kind, [field]: Number(qty), notes }); await refresh(); onDone?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <section className="panel boq-review">
      <h3>Correct the quantity</h3>
      <p className="muted">Audit sent this back: "{r.auditReturn?.note}"</p>
      <div className="formgrid">
        <label className="field"><span>Quantity ({r.unit}) *</span><input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></label>
      </div>
      <div className="actions"><button className="primary" disabled={busy || !(Number(qty) > 0)} onClick={save}>Save and send to BOQ</button></div>
      {error && <p className="alert red" role="alert">{error}</p>}
    </section>
  );
}

export default function Process({ user, request: r, records, settings, vendorList, refresh, onDone, goOrders }: Any) {
  const step = processStep(user, r);
  if (step === 'boq') return <BoqReview request={r} records={records} settings={settings} refresh={refresh} onDone={onDone} />;
  if (step === 'gm') return <GmProcess request={r} refresh={refresh} onDone={onDone} />;
  if (step === 'purchase') return <PurchaseProcess request={r} vendorList={vendorList} refresh={refresh} onDone={onDone} />;
  if (step === 'audit') return <AuditDecision request={r} refresh={refresh} onDone={onDone} />;
  if (step === 'pm-qty') return <PmQuantity request={r} refresh={refresh} onDone={onDone} />;
  if (step === 'order')
    return (
      <section className="panel boq-review">
        <h3>Create the purchase order</h3>
        <p className="muted">Approved by Audit: {r.vendor} at ₹{r.quoteRate} per {r.unit}.</p>
        <button className="primary" onClick={() => { onDone?.(); goOrders?.(); }}>Go to Purchase orders</button>
      </section>
    );
  return <p className="muted">Nothing is waiting for you on this request.</p>;
}
