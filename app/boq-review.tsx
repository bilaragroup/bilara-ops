'use client';
// BOQ review of one request, and the waiting-for-me selection used in the Requests table.
// The BOQ team only confirms the approved activity quantity; the BOQ rate comes from the
// rate card (project → range → default) and can be replaced by a custom rate if needed.
import { useMemo, useState } from 'react';
import { findProjectRate, rateCardLabel } from '@/lib/settings';
import { has } from '@/lib/permissions';

type Any = Record<string, any>;
const num = (v: any) => (v === '' || v == null ? NaN : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const rateOf = (r: Any) => Number(r.kind === 'plan' ? r.boqRate : r.estimateRate);

/** What the signed-in person still has to do on this request, if anything. */
export function waitingOn(user: any, r: Any): '' | 'gm' | 'boq-qty' | 'boq-rate' | 'boq-release' {
  if (!['plan', 'request'].includes(r.kind) || r.closure?.state === 'Closed') return '';
  if (r.gmApproval?.state === 'Pending') return has(user, 'GM') ? 'gm' : '';
  if (r.stage !== 'Submitted' || !has(user, 'BOQ Team', 'GM')) return '';
  if (!(Number(r.activityBoqQty) > 0)) return has(user, 'BOQ Team') ? 'boq-qty' : '';
  if (!(rateOf(r) > 0) || !r.boqOwner) return has(user, 'BOQ Team') ? 'boq-rate' : '';
  return 'boq-release';
}
export const waitingText: Any = {
  gm: 'Needs your approval',
  'boq-qty': 'Enter approved BOQ qty',
  'boq-rate': 'No BOQ rate yet',
  'boq-release': 'Ready to release',
};

async function post(url: string, body: Any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save. Please retry.');
  return data;
}
async function latest(ids: string[]) {
  const res = await fetch('/api/records', { cache: 'no-store' });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not reload the requests.');
  return (data.records || []).filter((r: Any) => ids.includes(r.id));
}
/** Release (or reject) requests through the audited decision endpoint. */
export async function decide(ids: string[], decision: 'Approved' | 'Rejected', note: string) {
  const rows = await latest(ids);
  return post('/api/gm-approval', {
    ids: rows.map((r: Any) => r.id),
    versions: Object.fromEntries(rows.map((r: Any) => [r.id, r.version])),
    decision,
    note,
    confirmed: true,
  });
}

export default function BoqReview({ request: r, records, settings, refresh, onDone }: Any) {
  const card = useMemo(
    () => findProjectRate(settings, r.project, r.item, r.unit),
    [settings, r.project, r.item, r.unit],
  );
  const saved = num(r.boqOriginalRate) > 0 ? num(r.boqOriginalRate) : NaN;
  const fromCard = r.rateSource === 'Project rate catalogue';
  // Everything else the PM already requested for this activity and item counts towards the BOQ quantity.
  const earlier = records
    .filter(
      (x: Any) =>
        x.id !== r.id &&
        ['plan', 'request'].includes(x.kind) &&
        x.project === r.project &&
        String(x.activity) === String(r.activity) &&
        String(x.item).trim().toLowerCase() === String(r.item).trim().toLowerCase() &&
        !['Rejected', 'Cancelled'].includes(x.stage),
    )
    .reduce((n: number, x: Any) => n + Number(x.requestedQty || x.boqQty || x.qty || 0), 0);
  const requested = Number(r.requestedQty || r.boqQty || r.qty || 0);
  const [qty, setQty] = useState(Number(r.activityBoqQty) > 0 ? String(r.activityBoqQty) : '');
  const [custom, setCustom] = useState(!fromCard && Number.isFinite(saved) ? true : !card && !Number.isFinite(saved));
  const [rate, setRate] = useState(String(Number.isFinite(saved) ? saved : card?.originalRate ?? ''));
  const [reduction, setReduction] = useState(
    String([r.targetDiscountPercent, card?.discountPercent, 5].find((v) => v !== '' && v != null && Number.isFinite(Number(v)))),
  );
  const [notes, setNotes] = useState(r.notes || '');
  const [version, setVersion] = useState(r.version);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const baseRate = custom ? num(rate) : Number.isFinite(saved) ? saved : num(card?.originalRate);
  const red = num(reduction);
  const target = baseRate > 0 && red >= 0 && red <= 50 ? round2(baseRate * (1 - red / 100)) : NaN;
  const total = earlier + requested;
  const over = num(qty) > 0 && total > num(qty);

  async function save(release: boolean) {
    setError('');
    setMessage('');
    if (!(num(qty) > 0)) return setError('Enter the approved activity BOQ quantity.');
    if (!(baseRate > 0)) return setError('Enter a BOQ rate (no rate card has this item).');
    if (!(red >= 0 && red <= 50)) return setError('Target reduction must be from 0% to 50%.');
    setBusy(true);
    try {
      const body: Any = { id: r.id, version, activityBoqQty: num(qty), notes };
      // Send the rate only when it differs from what the request already carries.
      // A blank rate is filled from the rate card by the server.
      if (custom) body.boqOriginalRate = baseRate;
      if (String(r.targetDiscountPercent ?? '') !== String(red)) {
        body.targetDiscountPercent = red;
        if (!body.boqOriginalRate) body.boqOriginalRate = baseRate;
      }
      await post('/api/records', body);
      const [now] = await latest([r.id]);
      if (now) setVersion(now.version);
      if (release) {
        if (now?.gmApproval?.state === 'Pending') {
          setMessage('Saved. The requested quantity is above the approved BOQ quantity, so the GM approves it first.');
        } else {
          await decide([r.id], 'Approved', notes.trim() || 'BOQ baseline released');
          setMessage('Released to Purchase.');
        }
      } else setMessage('Saved.');
      await refresh();
      if (release) onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendBack() {
    setError('');
    if (!notes.trim()) return setError('Write in Notes why the request is returned to the PM.');
    setBusy(true);
    try {
      await decide([r.id], 'Rejected', notes.trim());
      await refresh();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel boq-review">
      <h3>BOQ review</h3>
      <p className="muted">
        Requested {requested} {r.unit}
        {earlier ? ` · ${earlier} ${r.unit} already requested for this activity (total ${total})` : ''} · delivery {r.due}
      </p>
      <div className="formgrid">
        <label className="field">
          <span>Approved activity BOQ quantity ({r.unit}) *</span>
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          <button type="button" className="textbutton" onClick={() => setQty(String(total))}>
            Same as requested ({total})
          </button>
        </label>
        <div className="field">
          <span>BOQ rate (₹ per {r.unit})</span>
          {custom ? (
            <>
              <input type="number" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Custom BOQ rate" />
              {(card || (fromCard && Number.isFinite(saved))) && (
                <button
                  type="button"
                  className="textbutton"
                  onClick={() => {
                    setCustom(false);
                    if (card) {
                      setRate(String(card.originalRate));
                      setReduction(String(card.discountPercent));
                    }
                  }}
                >
                  Use the rate card instead{card ? ` (₹${card.originalRate})` : ''}
                </button>
              )}
              {!card && !Number.isFinite(saved) && <small>No rate card has this item for project {r.project}.</small>}
            </>
          ) : (
            <>
              <p className="boq-rate">
                <b>₹{baseRate}</b>{' '}
                <small>
                  {Number.isFinite(saved)
                    ? r.rateCard
                      ? `from ${r.rateCard}`
                      : 'from the rate card'
                    : card
                      ? `from ${rateCardLabel(card)}`
                      : ''}
                </small>
              </p>
              <button type="button" className="textbutton" onClick={() => setCustom(true)}>
                Edit · use a custom BOQ rate
              </button>
            </>
          )}
        </div>
        <label className="field">
          <span>Target reduction %</span>
          <input type="number" min={0} max={50} step="any" value={reduction} onChange={(e) => setReduction(e.target.value)} />
        </label>
        <div className="field">
          <span>Purchase target rate</span>
          <p className="boq-rate">
            <b>{Number.isFinite(target) ? `₹${target}` : '—'}</b>
            <small>{Number.isFinite(target) ? ` · target value ₹${round2(target * requested).toLocaleString('en-IN')}` : ''}</small>
          </p>
        </div>
        <label className="field full">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional; required when returning to the PM" />
        </label>
      </div>
      {over && (
        <p className="alert amber">
          Requested {total} {r.unit} is above the approved {qty} {r.unit}. Saving sends the extra to the GM for approval.
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => save(true)}>
          Save and release to Purchase
        </button>
        <button className="secondary" disabled={busy} onClick={() => save(false)}>
          Save
        </button>
        <button className="secondary danger" disabled={busy} onClick={sendBack}>
          Return to PM
        </button>
      </div>
      {error && <p className="alert red" role="alert">{error}</p>}
      {message && <p className="alert green" role="status">{message}</p>}
    </section>
  );
}

/** Who acts next on a request, in plain words (shown on every request row and in the form). */
export function nextStep(r: Any, records: Any[]): { who: string; what: string } {
  if (r.closure?.state === 'Closed') return { who: '', what: 'Closed — nothing left to do' };
  if (r.stage === 'Cancelled') return { who: '', what: 'Cancelled' };
  if (r.stage === 'Rejected') return { who: '', what: 'Rejected — raise a new request if still needed' };
  if (r.gmApproval?.state === 'Pending') return { who: 'GM', what: 'approve the extra quantity (Requests list → tick → Approve)' };
  if (r.stage === 'Submitted')
    return Number(r.activityBoqQty) > 0
      ? { who: 'BOQ team', what: 'release to Purchase (Review BOQ → Save and release)' }
      : { who: 'BOQ team', what: 'enter approved quantity and rate (Review BOQ)' };
  if (r.stage === 'BOQ priced')
    return { who: 'Purchase', what: r.auditReturn ? 'renegotiate and send to Audit again (Purchase plan → Edit)' : 'enter vendor and rate, send to Audit (Purchase plan → Edit)' };
  if (r.stage === 'Vendors finalized') return { who: 'Audit', what: 'approve the vendor rate (Audit review → Approve)' };
  const pos = records.filter((p) => p.kind === 'purchase' && p.parent === r.id && p.status !== 'Cancelled');
  if (!pos.length) return { who: 'Purchase', what: 'create the purchase order (Purchase orders → Ready to order)' };
  const waiting = pos.some((p) => !p.shortClose && Number(p.qty || 0) - (Array.isArray(p.receipts) ? p.receipts : []).reduce((n: number, x: Any) => n + Number(x.accepted || 0), 0) > 1e-9);
  if (waiting) return { who: 'Site engineer', what: 'record the delivery (Receive goods (GRN))' };
  const pays = records.filter((x) => x.kind === 'payment' && pos.some((p) => p.id === x.parent) && x.status !== 'Cancelled');
  if (pays.some((x) => Number(x.paid || 0) < Number(x.total || 0)))
    return { who: 'Accounts', what: 'check the bill and pay (Payment forecast → Bills to check / Record payment)' };
  return { who: 'Purchase', what: 'close the request (open it → Completion & settlement)' };
}
