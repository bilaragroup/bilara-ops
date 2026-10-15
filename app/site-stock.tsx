'use client';
// Site stock, converted from the QC app's Site Materials screen. The ledger is append-only:
// opening stock + GRN + GIN − DPR use − wastage ± stock count = balance.
//  Site Engineer  balances, movements, accept material from another site (GIN), wastage, site assets
//  PM             the same view plus one-time opening stock, low-stock limits and stock counts
// Goods from a purchase order are received on "Receive goods (GRN)".
import { useEffect, useMemo, useState } from 'react';
import { siteCall, requestId, istToday, fmt, titleCase } from '@/lib/site-client';

type Any = any;
const statusTone: Record<string, string> = { OK: 'green', LOW: 'amber', 'OUT OF STOCK': 'red', NEGATIVE: 'red' };
const label = (m: Any) => m.materialName + (m.variant ? ' ' + m.variant : '');
const statusText = (s: string) => titleCase(s);

function Field({ label: l, children, wide }: Any) {
  return <label className={'field' + (wide ? ' site-span-2' : '')}><span>{l}</span>{children}</label>;
}
function Msg({ error, message }: Any) {
  return <>{error && <p className="alert red" role="alert">{error}</p>}{message && <p className="alert green" role="status">{message}</p>}</>;
}

/** One receipt line for GIN: material, unit, quantity, or steel by bundles. */
function LineEditor({ line, set, materials, miscUnits, allowMisc }: Any) {
  const def = materials.find((m: Any) => m.code === line.materialCode) || {};
  const bundles = line.materialCode === 'STEEL' && line.inputUnit === 'BUNDLES';
  return (
    <div className="formgrid site-grid site-grid-4 site-line">
      <Field label="Material *">
        <select required value={line.materialCode} onChange={(e) => { const m = materials.find((x: Any) => x.code === e.target.value) || {}; set({ materialCode: e.target.value, variant: '', inputUnit: e.target.value === 'MISC' ? 'nos' : (m.inputUnits || [])[0] || '' }); }}>
          <option value="">Select…</option>
          {materials.map((m: Any) => <option key={m.code} value={m.code}>{m.name}</option>)}
          {allowMisc && <option value="MISC">Other item (type the name)</option>}
        </select>
      </Field>
      {line.materialCode === 'MISC' && <Field label="Item name *"><input required maxLength={120} value={line.materialName} onChange={(e) => set({ materialName: e.target.value })} /></Field>}
      {(def.variants || []).length > 0 && (
        <Field label="Diameter *"><select required value={line.variant} onChange={(e) => set({ variant: e.target.value })}><option value="">Select…</option>{def.variants.map((v: string) => <option key={v}>{v}</option>)}</select></Field>
      )}
      <Field label="Unit *">
        <select required value={line.inputUnit} onChange={(e) => set({ inputUnit: e.target.value })}>
          {(line.materialCode === 'MISC' ? miscUnits : def.inputUnits || []).map((u: string) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
        </select>
      </Field>
      {!bundles && <Field label={'Quantity *' + (def.stockUnit ? ' (' + def.stockUnit + ')' : '')}><input required type="number" min={0} step="any" value={line.quantity} onChange={(e) => set({ quantity: e.target.value })} /></Field>}
      {bundles && <>
        <Field label="Full bundles"><input type="number" min={0} step={1} value={line.fullBundles} onChange={(e) => set({ fullBundles: e.target.value })} /></Field>
        <Field label="Bars per bundle"><input type="number" min={0} step={1} value={line.barsPerBundle} onChange={(e) => set({ barsPerBundle: e.target.value })} /></Field>
        <Field label="Loose bars"><input type="number" min={0} step={1} value={line.looseBars} onChange={(e) => set({ looseBars: e.target.value })} /></Field>
        <Field label="Bar length *"><input required type="number" min={0} step="any" value={line.barLength} onChange={(e) => set({ barLength: e.target.value })} /></Field>
        <Field label="Length unit"><select value={line.barLengthUnit} onChange={(e) => set({ barLengthUnit: e.target.value })}><option value="M">metres</option><option value="FT">feet</option></select></Field>
        <p className="muted site-span-2">{steelKg(line)}</p>
      </>}
      <Field label="Remarks" wide><input maxLength={500} value={line.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
    </div>
  );
}
/** Same weight formula as the server: d²/162 per metre or d²/533 per foot. */
export function steelKg(line: Any) {
  const d = Number(String(line.variant || '').match(/[\d.]+/)?.[0] || 0);
  const bars = Number(line.fullBundles || 0) * Number(line.barsPerBundle || 0) + Number(line.looseBars || 0);
  const len = Number(line.barLength || 0);
  if (!d || !bars || !len) return 'Weight is worked out from diameter, bars and length.';
  const kg = (d * d / (line.barLengthUnit === 'FT' ? 533 : 162)) * bars * len;
  return `${bars} bars ≈ ${fmt(kg, 1)} kg`;
}
const blankLine = () => ({ materialCode: '', materialName: '', variant: '', inputUnit: '', quantity: '', fullBundles: '', barsPerBundle: '', looseBars: '', barLength: '', barLengthUnit: 'M', remarks: '' });

function GinForm({ ws, onSaved }: Any) {
  const [lines, setLines] = useState<Any[]>([blankLine()]);
  const [meta, setMeta] = useState({ receivedDate: istToday(), sourceSite: '', transferNoteNo: '', vehicleNo: '' });
  const [signed, setSigned] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [rid, setRid] = useState(() => requestId('GIN'));
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const v = await siteCall('recordMaterialGin', { projectId: ws.project.projectId, clientRequestId: rid, ...meta, lines, qualityDeclarationAccepted: signed });
      onSaved(v, `Recorded ${v.lastRecordedGin}. Stock is updated.`);
      setLines([blankLine()]); setMeta({ ...meta, sourceSite: '', transferNoteNo: '', vehicleNo: '' }); setSigned(false); setRid(requestId('GIN'));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h3>Accept material from another site (GIN)</h3>
      <p className="muted">Material, site assets or tools sent from another Bilara site. A GIN number is created when you save.</p>
      <div className="formgrid site-grid site-grid-4">
        <Field label="Received on *"><input type="date" required max={istToday()} value={meta.receivedDate} onChange={(e) => setMeta({ ...meta, receivedDate: e.target.value })} /></Field>
        <Field label="From site *"><input required maxLength={180} placeholder="e.g. 118 Riverside" value={meta.sourceSite} onChange={(e) => setMeta({ ...meta, sourceSite: e.target.value })} /></Field>
        <Field label="Transfer note no. *"><input required maxLength={100} value={meta.transferNoteNo} onChange={(e) => setMeta({ ...meta, transferNoteNo: e.target.value })} /></Field>
        <Field label="Vehicle no. *"><input required maxLength={60} value={meta.vehicleNo} onChange={(e) => setMeta({ ...meta, vehicleNo: e.target.value })} /></Field>
      </div>
      {lines.map((l, i) => (
        <div key={i}>
          <LineEditor line={l} set={(p: Any) => setLines(lines.map((x, n) => n === i ? { ...x, ...p } : x))} materials={ws.majorMaterials} miscUnits={ws.miscUnits} allowMisc />
          {lines.length > 1 && <button type="button" className="textbutton" onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove line</button>}
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => setLines([...lines, blankLine()])}>+ Add line</button>
      <label className="site-check"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} /> I received and checked this material and it meets Bilara standards.</label>
      <Msg error={error} />
      <button className="primary" disabled={busy || !signed}>{busy ? 'Saving…' : 'Save GIN'}</button>
    </form>
  );
}

function WastageForm({ ws, onSaved }: Any) {
  const materials = ws.majorMaterials.filter((m: Any) => !m.ginOnly);
  const blank = () => ({ materialCode: '', variant: '', inputUnit: '', quantity: '', pieceCount: '', lengthPerPiece: '', lengthUnit: 'M', materialName: '', reason: '', remarks: '' });
  const [lines, setLines] = useState<Any[]>([blank()]);
  const [date, setDate] = useState(istToday());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [rid, setRid] = useState(() => requestId('WASTE'));
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const v = await siteCall('recordDailyMaterialWastage', { projectId: ws.project.projectId, wasteDate: date, clientRequestId: rid, lines });
      onSaved(v, 'Wastage recorded and taken out of stock.'); setLines([blank()]); setRid(requestId('WASTE'));
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h3>Record wastage</h3>
      <p className="muted">Each line needs a reason. Steel is entered as pieces × length and turned into kg. You can also add wastage on the end-of-day DPR.</p>
      <Field label="Date *"><input type="date" required max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {lines.map((w, i) => {
        const def = materials.find((m: Any) => m.code === w.materialCode) || {};
        const set = (p: Any) => setLines(lines.map((x, n) => n === i ? { ...x, ...p } : x));
        const steel = w.materialCode === 'STEEL', misc = w.materialCode === 'MISC';
        return (
          <div key={i} className="formgrid site-grid site-grid-4 site-line">
            <Field label="Material *">
              <select required value={w.materialCode} onChange={(e) => { const m = materials.find((x: Any) => x.code === e.target.value) || {}; set({ materialCode: e.target.value, variant: '', inputUnit: e.target.value === 'MISC' ? 'nos' : (m.inputUnits || [])[0] || '' }); }}>
                <option value="">Select…</option>{materials.map((m: Any) => <option key={m.code} value={m.code}>{m.name}</option>)}<option value="MISC">Other material</option>
              </select>
            </Field>
            {steel && <>
              <Field label="Diameter *"><select required value={w.variant} onChange={(e) => set({ variant: e.target.value })}><option value="">Select…</option>{(def.variants || []).map((v: string) => <option key={v}>{v}</option>)}</select></Field>
              <Field label="Pieces *"><input required type="number" min={1} step={1} value={w.pieceCount} onChange={(e) => set({ pieceCount: e.target.value })} /></Field>
              <Field label="Length per piece *"><input required type="number" min={0} step="any" value={w.lengthPerPiece} onChange={(e) => set({ lengthPerPiece: e.target.value })} /></Field>
              <Field label="Length unit"><select value={w.lengthUnit} onChange={(e) => set({ lengthUnit: e.target.value })}><option value="M">metres</option><option value="FT">feet</option></select></Field>
            </>}
            {misc && <>
              <Field label="Material name *"><input required maxLength={120} value={w.materialName} onChange={(e) => set({ materialName: e.target.value })} /></Field>
              <Field label="Unit *"><select required value={w.inputUnit} onChange={(e) => set({ inputUnit: e.target.value })}>{ws.miscUnits.map((u: string) => <option key={u}>{u}</option>)}</select></Field>
            </>}
            {!steel && <Field label={'Quantity *' + (def.stockUnit ? ' (' + def.stockUnit + ')' : '')}><input required type="number" min={0} step="any" value={w.quantity} onChange={(e) => set({ quantity: e.target.value })} /></Field>}
            <Field label="Reason *" wide><input required maxLength={500} placeholder="Broken in unloading, rain, cut pieces…" value={w.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
            {lines.length > 1 && <button type="button" className="textbutton" onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove</button>}
          </div>
        );
      })}
      <button type="button" className="secondary" onClick={() => setLines([...lines, blank()])}>+ Add line</button>
      <Msg error={error} />
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save wastage'}</button>
    </form>
  );
}

function AssetsForm({ ws, onSaved }: Any) {
  const blank = () => ({ assetType: 'COLUMN_BOX', itemName: 'Column box', pieceCount: '', length: '', width: '', dimensionUnit: 'FT', remarks: '' });
  const [rows, setRows] = useState<Any[]>(() => ws.assets?.length
    ? ws.assets.map((a: Any) => ({ assetType: a.assetType, itemName: a.itemName, pieceCount: String(a.pieceCount), length: a.lengthFt === '' ? '' : String(a.lengthFt), width: a.widthFt === '' ? '' : String(a.widthFt), dimensionUnit: 'FT', remarks: a.remarks }))
    : [blank()]);
  const [date, setDate] = useState(istToday());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const types: [string, string][] = [['COLUMN_BOX', 'Column box'], ['WOOD_RUNNER', 'Wood runner'], ['WOODEN_PLANK', 'Wooden plank'], ['MOBILIZATION_KIT', 'Mobilization kit'], ['OTHER', 'Other']];
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try { onSaved(await siteCall('recordSiteAssetSnapshot', { projectId: ws.project.projectId, asOfDate: date, assets: rows }), 'Site asset count saved.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h3>Count site assets</h3>
      <p className="muted">Shuttering, runners and planks on site. Each save is a full count that replaces the last one{ws.assets?.length ? ` (last count ${ws.assets[0].asOfDate})` : ''}.</p>
      <Field label="Counted on *"><input type="date" required max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {rows.map((r, i) => {
        const set = (p: Any) => setRows(rows.map((x, n) => n === i ? { ...x, ...p } : x));
        const needsLength = ['COLUMN_BOX', 'WOOD_RUNNER', 'WOODEN_PLANK'].includes(r.assetType), needsWidth = ['COLUMN_BOX', 'WOODEN_PLANK'].includes(r.assetType);
        return (
          <div key={i} className="formgrid site-grid site-grid-4 site-line">
            <Field label="Type *"><select value={r.assetType} onChange={(e) => set({ assetType: e.target.value, itemName: types.find((t) => t[0] === e.target.value)?.[1] || '' })}>{types.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}</select></Field>
            <Field label="Item *"><input required maxLength={120} value={r.itemName} onChange={(e) => set({ itemName: e.target.value })} /></Field>
            <Field label="Pieces *"><input required type="number" min={1} step={1} value={r.pieceCount} onChange={(e) => set({ pieceCount: e.target.value })} /></Field>
            {needsLength && <Field label="Length *"><input required type="number" min={0} step="any" value={r.length} onChange={(e) => set({ length: e.target.value })} /></Field>}
            {needsWidth && <Field label="Width *"><input required type="number" min={0} step="any" value={r.width} onChange={(e) => set({ width: e.target.value })} /></Field>}
            {needsLength && <Field label="Unit"><select value={r.dimensionUnit} onChange={(e) => set({ dimensionUnit: e.target.value })}><option value="FT">feet</option><option value="M">metres</option></select></Field>}
            {rows.length > 1 && <button type="button" className="textbutton" onClick={() => setRows(rows.filter((_, n) => n !== i))}>Remove</button>}
          </div>
        );
      })}
      <button type="button" className="secondary" onClick={() => setRows([...rows, blank()])}>+ Add item</button>
      <Msg error={error} />
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save count'}</button>
    </form>
  );
}

// ---------------- PM ----------------

function OpeningStock({ ws, onSaved }: Any) {
  const untouched = ws.balances.filter((b: Any) => !b.openingQuantity && !b.totalReceived && !b.totalConsumed && !b.totalAdjusted && !b.balanceQuantity);
  const [lines, setLines] = useState<Any[]>([{ key: '', quantity: '', threshold: '' }]);
  const [verifiedBy, setVerifiedBy] = useState(ws.project.siteEngineerName || ''), [notes, setNotes] = useState(''), [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [rid] = useState(() => requestId('OPEN'));
  if (!untouched.length) return null;
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const payload = lines.filter((l) => l.key).map((l) => {
        const b = untouched.find((x: Any) => x.materialKey === l.key);
        return { materialCode: b.materialCode, variant: b.variant, quantity: l.quantity, threshold: l.threshold || 0 };
      });
      onSaved(await siteCall('recordInitialSiteStock', { projectId: ws.project.projectId, clientRequestId: rid, siteEngineerVerified: ok, verifiedBy, notes, lines: payload }), 'Opening stock recorded.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h3>Opening stock (once per material)</h3>
      <p className="muted">Material already on site before the app was used, counted with the Site Engineer. Once a material has any movement, use a stock count below instead.</p>
      {lines.map((l, i) => (
        <div key={i} className="formgrid site-grid site-grid-4 site-line">
          <Field label="Material *"><select required value={l.key} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, key: e.target.value } : x))}>
            <option value="">Select…</option>{untouched.map((b: Any) => <option key={b.materialKey} value={b.materialKey}>{label(b)} ({b.stockUnit})</option>)}</select></Field>
          <Field label="Counted quantity *"><input required type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, quantity: e.target.value } : x))} /></Field>
          <Field label="Low-stock limit"><input type="number" min={0} step="any" value={l.threshold} onChange={(e) => setLines(lines.map((x, n) => n === i ? { ...x, threshold: e.target.value } : x))} /></Field>
          {lines.length > 1 && <button type="button" className="textbutton" onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove</button>}
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => setLines([...lines, { key: '', quantity: '', threshold: '' }])}>+ Add material</button>
      <div className="formgrid site-grid">
        <Field label="Counted with (site engineer) *"><input required maxLength={150} value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} /></Field>
        <Field label="Notes *"><input required maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <label className="site-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I physically verified these quantities with the site engineer.</label>
      <Msg error={error} />
      <button className="primary" disabled={busy || !ok}>{busy ? 'Saving…' : 'Save opening stock'}</button>
    </form>
  );
}

function Reconcile({ ws, onSaved }: Any) {
  const [key, setKey] = useState(''), [actual, setActual] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const b = ws.balances.find((x: Any) => x.materialKey === key);
  async function save(e: Any) {
    e.preventDefault(); setBusy(true); setError('');
    try { onSaved(await siteCall('reconcileMaterialBalance', { projectId: ws.project.projectId, clientRequestId: requestId('COUNT'), materialKey: key, actualBalance: actual, reason }), 'Stock count recorded.'); setKey(''); setActual(''); setReason(''); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h3>Stock count correction</h3>
      <p className="muted">After a physical count, post the difference with a reason. Earlier movements are never changed.</p>
      <div className="formgrid site-grid site-grid-4">
        <Field label="Material *"><select required value={key} onChange={(e) => setKey(e.target.value)}><option value="">Select…</option>{ws.balances.map((x: Any) => <option key={x.materialKey} value={x.materialKey}>{label(x)}</option>)}</select></Field>
        <Field label={'Counted on site *' + (b ? ` (book: ${fmt(b.balanceQuantity, 3)} ${b.stockUnit})` : '')}><input required type="number" min={0} step="any" value={actual} onChange={(e) => setActual(e.target.value)} /></Field>
        <Field label="Reason *" wide><input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      {b && actual !== '' && <p className="muted">Difference {fmt(Number(actual) - b.balanceQuantity, 3)} {b.stockUnit}</p>}
      <Msg error={error} />
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save count'}</button>
    </form>
  );
}

// ---------------- the page ----------------

export default function SiteStock({ boot }: Any) {
  const role = boot?.user?.role;
  const projects: Any[] = (role === 'SITE_ENGINEER' || role === 'QC' ? boot?.siteOperationProjects : boot?.projects) || [];
  const [projectId, setProjectId] = useState('');
  const [ws, setWs] = useState<Any>(null);
  const [view, setView] = useState('stock');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [ledgerFor, setLedgerFor] = useState('');
  useEffect(() => { if (!projectId && projects.length === 1) setProjectId(String(projects[0].Project_ID)); }, [projects.length]);
  useEffect(() => { if (projectId) load(); }, [projectId]);
  async function load() {
    setBusy(true); setError('');
    try { const v = await siteCall('getMaterialInventoryWorkspace', projectId); setWs(v); setThresholds({}); } catch (e) { setWs(null); setError((e as Error).message); } finally { setBusy(false); }
  }
  const saved = (v: Any, text: string) => { setWs(v); setMessage(text); setError(''); };
  const perm = ws?.permissions || {};
  const balances = useMemo(() => (ws?.balances || []).filter((b: Any) => b.balanceQuantity || b.totalReceived || b.openingQuantity || b.lowStockThreshold || b.totalConsumed), [ws]);
  const low = balances.filter((b: Any) => ['LOW', 'OUT OF STOCK', 'NEGATIVE'].includes(b.status));
  async function saveThresholds() {
    setError('');
    try {
      saved(await siteCall('saveMaterialThresholds', { projectId, thresholds: Object.entries(thresholds).map(([materialKey, threshold]) => ({ materialKey, threshold })) }), 'Low-stock limits saved.');
    } catch (e) { setError((e as Error).message); }
  }
  const tabs: [string, string][] = [
    ['stock', 'Balances'], ['movements', 'Movements'],
    ...(perm.canReceive ? [['gin', 'From another site'], ['wastage', 'Wastage'], ['assets', 'Site assets']] as [string, string][] : [['assets', 'Site assets']] as [string, string][]),
    ...(perm.canReconcile ? [['count', 'Opening stock & counts']] as [string, string][] : []),
  ];
  return (
    <section className="site-page">
      <div className="panel site-picker">
        <label className="field"><span>Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{projects.length ? 'Select project…' : 'No ongoing project is assigned to you'}</option>
            {projects.map((x: Any) => <option key={x.Project_ID} value={x.Project_ID}>{x.Project_ID} — {x.Client}</option>)}
          </select>
        </label>
        {ws && <button className="secondary" onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>}
      </div>
      <Msg error={error} message={message} />
      {ws && <>
        <div className="site-tabs" role="tablist">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'active' : ''} onClick={() => { setView(k); setMessage(''); }}>{l}</button>)}
        </div>
        {view === 'stock' && <section className="panel">
          <div className="site-head"><h2>Stock on site · {ws.project.projectId} {ws.project.client}</h2>{low.length > 0 && <span className="tag amber">{low.length} low</span>}</div>
          <p className="muted">Opening + received − used − wasted ± counted. Goods against a purchase order are received on Receive goods (GRN); they show here once saved.</p>
          <div className="scroll-x"><table className="site-table">
            <thead><tr><th>Material</th><th>Balance</th><th>Status</th><th>Opening + received</th><th>Used & wasted</th><th>Low-stock limit</th></tr></thead>
            <tbody>
              {balances.map((b: Any) => (
                <tr key={b.materialKey}>
                  <td><button className="textbutton" onClick={() => { setLedgerFor(b.materialKey); setView('movements'); }}>{label(b)}</button></td>
                  <td className="nw"><b>{fmt(b.balanceQuantity, 3)} {b.stockUnit}</b></td>
                  <td><span className={'tag ' + (statusTone[b.status] || '')}>{statusText(b.status)}</span></td>
                  <td className="nw">{fmt(b.totalReceived + b.openingQuantity, 3)}</td>
                  <td className="nw">{fmt(b.totalConsumed, 3)}</td>
                  <td>{perm.canSetThresholds
                    ? <input className="plan-input num" type="number" min={0} step="any" aria-label={'Low-stock limit, ' + label(b)} value={thresholds[b.materialKey] ?? String(b.lowStockThreshold || '')} onChange={(e) => setThresholds({ ...thresholds, [b.materialKey]: e.target.value })} />
                    : (b.lowStockThreshold ? fmt(b.lowStockThreshold, 3) : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {!balances.length && <p className="muted">No stock recorded yet. {perm.canSetOpeningStock ? 'Record the opening stock under "Opening stock & counts".' : 'Stock appears after the first GRN, GIN or opening count.'}</p>}
          {perm.canSetThresholds && Object.keys(thresholds).length > 0 && <button className="primary" onClick={saveThresholds}>Save low-stock limits</button>}
        </section>}
        {view === 'movements' && <section className="panel">
          <div className="site-head"><h2>Stock movements</h2>
            <select aria-label="Material" value={ledgerFor} onChange={(e) => setLedgerFor(e.target.value)}><option value="">All materials</option>{balances.map((b: Any) => <option key={b.materialKey} value={b.materialKey}>{label(b)}</option>)}</select></div>
          <div className="scroll-x"><table className="site-table">
            <thead><tr><th>Date</th><th>Material</th><th>Movement</th><th>Change</th><th>Balance after</th><th>Note</th></tr></thead>
            <tbody>
              {ws.ledger.filter((l: Any) => !ledgerFor || l.materialKey === ledgerFor).map((l: Any) => {
                const b = ws.balances.find((x: Any) => x.materialKey === l.materialKey) || {};
                return <tr key={l.transactionId}><td className="nw">{l.transactionDate}</td><td>{label(b)}</td><td>{titleCase(l.transactionType)}</td>
                  <td className={'nw ' + (l.quantityChange < 0 ? 'neg' : 'pos')}>{l.quantityChange > 0 ? '+' : ''}{fmt(l.quantityChange, 3)} {l.unit}</td><td className="nw">{fmt(l.balanceAfter, 3)}</td><td><small>{l.remarks}</small></td></tr>;
              })}
            </tbody>
          </table></div>
          <h3>Recent receipts</h3>
          <div className="scroll-x"><table className="site-table">
            <thead><tr><th>GRN / GIN</th><th>Date</th><th>From</th><th>Material</th><th>Quantity</th><th>PO</th></tr></thead>
            <tbody>
              {ws.receipts.map((r: Any) => <tr key={r.receiptId}><td className="nw"><b>{r.grnNo}</b>{r.siteGrnBookNo && <small>Book {r.siteGrnBookNo}</small>}</td><td className="nw">{r.receivedDate}</td><td>{r.supplier}</td><td>{r.materialName} {r.variant}</td><td className="nw">{fmt(r.stockQuantity, 3)} {r.stockUnit}</td>
                <td>{r.poLinked || r.poNo ? r.poNo : <span className="tag amber">Awaiting PO</span>}</td></tr>)}
              {ws.ginReceipts.map((r: Any, i: number) => <tr key={'g' + i}><td className="nw"><b>{r.ginNo}</b></td><td className="nw">{r.receivedDate}</td><td>{r.sourceSite}</td><td>{r.materialName} {r.variant}</td><td className="nw">{fmt(r.stockQuantity, 3)} {r.stockUnit}</td><td>—</td></tr>)}
            </tbody>
          </table></div>
          {ws.materialWastage.length > 0 && <>
            <h3>Recent wastage</h3>
            <ul className="site-list">{ws.materialWastage.slice(0, 30).map((w: Any, i: number) => <li key={i}>{w.wasteDate} · {w.materialName} {w.variant} · {fmt(w.wasteQuantity, 3)} {w.stockUnit} · {w.reason}{w.entrySource === 'DPR' ? ' (from DPR)' : ''}</li>)}</ul>
          </>}
        </section>}
        {view === 'gin' && perm.canReceive && <GinForm ws={ws} onSaved={saved} />}
        {view === 'wastage' && perm.canReceive && <WastageForm ws={ws} onSaved={saved} />}
        {view === 'assets' && <>
          <section className="panel">
            <h3>Last asset count{ws.assets[0] ? ' · ' + ws.assets[0].asOfDate : ''}</h3>
            {ws.assets.length ? <ul className="site-list">{ws.assets.map((a: Any, i: number) => <li key={i}>{a.itemName}: {a.pieceCount} pcs{a.totalRft !== '' ? ` · ${fmt(a.totalRft)} rft` : ''}{a.totalSqFt !== '' ? ` · ${fmt(a.totalSqFt)} sq ft` : ''}</li>)}</ul> : <p className="muted">No count yet.</p>}
          </section>
          {perm.canReceive && <AssetsForm key={ws.assets[0]?.snapshotId || 'none'} ws={ws} onSaved={saved} />}
        </>}
        {view === 'count' && perm.canReconcile && <><OpeningStock ws={ws} onSaved={saved} /><Reconcile ws={ws} onSaved={saved} /></>}
      </>}
    </section>
  );
}
