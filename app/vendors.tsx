'use client';
// Vendors & brands (project configuration): for each item, which brand and vendor Purchase buys
// from, and at what price — for one project or for all projects. Requests pick their vendor from
// this list and the purchase plan starts from its price.
import { useEffect, useMemo, useState } from 'react';
import { ITEM_CATEGORIES } from '@/lib/settings';
import { RATE_CARD_ITEMS, RATE_CARD_ITEM_DEFAULTS } from '@/lib/rate-card';

type Any = Record<string, any>;
const blank = (): Any => ({ id: crypto.randomUUID(), project: '', category: 'Materials', item: '', brand: '', vendor: '', phone: '', unit: '', price: '' });

export default function Vendors({ projects = [], onSaved }: Any) {
  const [rows, setRows] = useState<Any[]>([]),
    [version, setVersion] = useState(0),
    [canEdit, setCanEdit] = useState(false),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [project, setProject] = useState('all'),
    [query, setQuery] = useState('');
  async function load() {
    const r = await fetch('/api/vendors', { cache: 'no-store' });
    const d: any = await r.json();
    if (!r.ok) throw Error(d.error);
    setRows(d.values);
    setVersion(d.version);
    setCanEdit(!!d.canEdit);
    return d;
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const seesPrice = rows.some((r) => 'price' in r) || canEdit;
  const shown = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i }))
        .filter(
          ({ r }) =>
            (project === 'all' || r.project === project || !r.project) &&
            (!query || [r.item, r.brand, r.vendor, r.category].join(' ').toLowerCase().includes(query.toLowerCase())),
        ),
    [rows, project, query],
  );
  const set = (i: number, patch: Any) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, values: rows }),
      });
      const d: any = await r.json();
      if (!r.ok) throw Error(d.error);
      setRows(d.values);
      setVersion(d.version);
      setEditing(false);
      setNotice('Vendor list saved.');
      onSaved?.(d.values);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const knownItems = [...new Set([...RATE_CARD_ITEMS, ...rows.map((r) => r.item).filter(Boolean)])];
  return (
    <section className="panel tablepanel vendors-page">
      <div className="tablebar">
        <div>
          <h2>Vendors & brands</h2>
          <p>
            Brand, vendor and price for each item — for one project or all projects. Requests pick their vendor from this list; the
            purchase plan starts from its price.
          </p>
        </div>
        <div className="actions">
          {canEdit && !editing && (
            <button className="primary" onClick={() => setEditing(true)}>
              Edit list
            </button>
          )}
          {editing && (
            <>
              <button className="secondary" onClick={() => setRows([...rows, { ...blank(), project: project === 'all' ? '' : project }])}>
                + Add vendor
              </button>
              <button className="secondary" disabled={busy} onClick={() => { setEditing(false); load().catch(() => null); }}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="filters vendor-filters">
        <label className="field">
          <span>Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((p: Any) => (
              <option key={p.project} value={p.project}>
                {p.project} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Item, brand or vendor" />
        </label>
      </div>
      {error && <p className="alert red" role="alert">{error}</p>}
      {notice && <p className="alert green" role="status">{notice}</p>}
      <datalist id="vendor-items">
        {knownItems.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <div className="plan-scroll">
        <table className="vendor-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Category</th>
              <th>Item</th>
              <th>Brand</th>
              <th>Vendor</th>
              <th>Phone</th>
              <th>Unit</th>
              {seesPrice && <th>Price (₹)</th>}
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i }) =>
              editing ? (
                <tr key={r.id}>
                  <td>
                    <input className="plan-input" style={{ width: 70 }} placeholder="All" value={r.project} onChange={(e) => set(i, { project: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })} />
                  </td>
                  <td>
                    <select className="plan-input" value={r.category} onChange={(e) => set(i, { category: e.target.value })}>
                      {ITEM_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="plan-input"
                      list="vendor-items"
                      value={r.item}
                      onChange={(e) => {
                        const d = (RATE_CARD_ITEM_DEFAULTS as Any)[e.target.value];
                        set(i, { item: e.target.value, ...(d ? { category: d.itemCategory, unit: r.unit || d.unit } : {}) });
                      }}
                    />
                  </td>
                  <td><input className="plan-input" value={r.brand} onChange={(e) => set(i, { brand: e.target.value })} /></td>
                  <td><input className="plan-input" value={r.vendor} onChange={(e) => set(i, { vendor: e.target.value })} /></td>
                  <td><input className="plan-input" value={r.phone} onChange={(e) => set(i, { phone: e.target.value })} /></td>
                  <td><input className="plan-input" style={{ width: 70 }} value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                  <td><input className="plan-input" style={{ width: 90 }} type="number" min={0} step="any" value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></td>
                  <td>
                    <button type="button" className="textbutton" onClick={() => setRows(rows.filter((_, n) => n !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td>{r.project || 'All'}</td>
                  <td>{r.category}</td>
                  <td><b>{r.item}</b></td>
                  <td>{r.brand || '—'}</td>
                  <td>{r.vendor}</td>
                  <td>{r.phone || '—'}</td>
                  <td>{r.unit || '—'}</td>
                  {seesPrice && <td>{r.price === '' || r.price == null ? '—' : '₹' + r.price}</td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <div className="empty">
          <h3>No vendors yet</h3>
          <p>{canEdit ? 'Press Edit list, then + Add vendor.' : 'Purchase adds vendors and brands here.'}</p>
        </div>
      )}
    </section>
  );
}
