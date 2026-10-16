'use client';
// Rate cards: the BOQ rates the app uses to set the purchasing target (BOQ rate less the reduction).
// Kept by uploading the rate-card spreadsheet: one row per project (or range such as 120-150),
// one column per item. A project's own card wins over a range card. BOQ Team and Super Admin
// upload; GM and Audit read.
import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { rateCardKey, rateCardLabel, scopeOf, rateAppliesTo, purchaseTarget } from '@/lib/settings';
import { parseRateSheet } from '@/lib/rate-card';

type Any = any;
const inr = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const unitText = (u: string) => (u === '*' || !u ? 'Any unit' : u);
const order = (k: string) => (k === 'default' ? 0 : k.startsWith('range:') ? 1 : 2);
const cardSort = (a: Any, b: Any) => order(a.key) - order(b.key) || Number(a.first.fromProject || a.first.project) - Number(b.first.fromProject || b.first.project);

async function readSheet(file: File): Promise<any[][]> {
  if (file.size > 5 * 1024 * 1024) throw Error('Use an Excel file under 5 MB.');
  const ExcelJS: any = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.getWorksheet('RateCard') || book.worksheets[0];
  if (!sheet) throw Error('The workbook has no sheet.');
  const rows: any[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row: any) => {
    const cells = Array.from({ length: row.cellCount }, (_, i) => {
      const c = row.getCell(i + 1), v = typeof c.value === 'object' && c.value && 'result' in c.value ? c.value.result : c.text;
      return v === null || v === undefined ? '' : String(v).trim();
    });
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells);
  });
  return rows;
}
/** Today's project and range cards in the same layout as the upload: one row each, one column per item. */
async function downloadCards(cards: Any[]) {
  const ExcelJS: any = await import('exceljs');
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('RateCard');
  const list = cards.filter((c) => c.key !== 'default');
  const items = [...new Set(list.flatMap((c) => c.lines.map((l: Any) => l.item)))];
  sheet.addRow(['Project Number', ...items]).font = { bold: true };
  list.forEach((c) => sheet.addRow([c.first.fromProject ? `${c.first.fromProject}-${c.first.toProject}` : Number(c.first.project),
    ...items.map((i) => c.lines.find((l: Any) => l.item === i)?.originalRate ?? null)]));
  sheet.columns.forEach((col: Any, i: number) => { col.width = i ? 14 : 16; });
  const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'Rate cards.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function RateCards({ settings, onSaved, canEdit, projects = [] }: Any) {
  const rates: Any[] = settings.values.projectRates || [];
  const cards = useMemo(() => {
    const m = new Map<string, Any>();
    rates.forEach((r) => { const k = rateCardKey(r); if (!m.has(k)) m.set(k, { key: k, first: r, lines: [] }); m.get(k).lines.push(r); });
    return [...m.values()].sort(cardSort);
  }, [rates]);
  const [find, setFind] = useState(''), [check, setCheck] = useState(''), [open, setOpen] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const nameOf = (p: string) => projects.find((x: Any) => String(x.project) === String(p))?.name || '';

  async function post(body: Any) {
    const r = await fetch('/api/rate-cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: settings.version, ...body }) });
    const d: Any = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || 'The rate card could not be saved.');
    onSaved({ values: { ...settings.values, ...d.values }, version: d.version });
    return d;
  }
  async function remove(body: Any, ask: string) {
    if (!window.confirm(ask)) return;
    setBusy('remove'); setError(''); setMessage('');
    try { setMessage((await post(body)).summary + '.'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const q = find.trim();
  const shown = cards.filter((c) => !q || (/^\d{3}$/.test(q) ? rateAppliesTo(c.first, q)
    : rateCardLabel(c.first).toLowerCase().includes(q.toLowerCase()) || c.lines.some((l: Any) => l.item.toLowerCase().includes(q.toLowerCase()))));
  // For one project: each item and unit with the rate of the most specific card that covers it.
  const p = check.trim(), rank: Any = { project: 0, range: 1, default: 2 };
  const checkRates: Any[] = /^[1-9]\d{2}$/.test(p)
    ? [...rates.filter((r) => r.active !== false && rateAppliesTo(r, p))
        .sort((a, b) => rank[scopeOf(a)] - rank[scopeOf(b)])
        .reduce((m, r) => { const k = r.item.trim().toLowerCase() + '|' + String(r.unit).toLowerCase(); if (!m.has(k)) m.set(k, r); return m; }, new Map<string, Any>()).values()]
        .sort((a, b) => a.item.localeCompare(b.item))
    : [];

  return (
    <section className="rate-page">
      <div className="panel rate-intro">
        <div>
          <p className="muted">The BOQ rate per item for each project. The purchasing target is the BOQ rate less the reduction (5% unless set). Upload the spreadsheet again whenever rates change: each row replaces that project's card. A row for a range (e.g. 120-150) covers projects without their own row. BOQ rates stay hidden from Purchase.</p>
        </div>
        <div className="actions">
          {cards.length > 0 && <button className="secondary" onClick={() => downloadCards(cards)}>Download rate cards</button>}
          {canEdit && <button className="primary" onClick={() => setOpen(true)}>Upload rate cards</button>}
        </div>
      </div>
      {message && <p className="alert green" role="status">{message}</p>}
      {error && <p className="alert red" role="alert">{error}</p>}

      <div className="panel rate-check">
        <label className="field"><span>Which rates apply to a project?</span><input inputMode="numeric" maxLength={3} placeholder="Project number, e.g. 125" value={check} onChange={(e) => setCheck(e.target.value)} /></label>
        {check.trim() && !/^[1-9]\d{2}$/.test(check.trim()) && <p className="muted">Enter a project number from 100 to 999.</p>}
        {/^[1-9]\d{2}$/.test(check.trim()) && (checkRates.length
          ? <table className="site-table"><thead><tr><th>Item</th><th>Unit</th><th>BOQ rate</th><th>Purchase target</th><th>From</th></tr></thead>
            <tbody>{checkRates.map((rate: Any) => <tr key={rate.id}><td>{rate.item}</td><td>{unitText(rate.unit)}</td><td>{inr(rate.originalRate)}</td><td>{inr(purchaseTarget(rate))}</td><td><span className={'tag ' + (scopeOf(rate) === 'project' ? 'green' : scopeOf(rate) === 'range' ? 'amber' : '')}>{rateCardLabel(rate)}</span></td></tr>)}</tbody></table>
          : <p className="muted">No rate card covers project {check.trim()} yet.</p>)}
      </div>

      {cards.length > 3 && <label className="field rate-find"><span>Find a rate card</span><input placeholder="Project number or item" value={find} onChange={(e) => setFind(e.target.value)} /></label>}
      {!cards.length && <div className="panel empty"><h3>No rate cards yet</h3><p>{canEdit ? 'Upload your rate-card spreadsheet: Project Number in the first column, then one column per item with its BOQ rate.' : 'The BOQ Team has not uploaded rate cards yet.'}</p>{canEdit && <button className="primary" onClick={() => setOpen(true)}>Upload rate cards</button>}</div>}
      {shown.map((c) => {
        const last = c.lines.map((l: Any) => l.updatedAt || '').sort().pop();
        const by = c.lines.find((l: Any) => l.updatedAt === last)?.updatedBy;
        const scope = scopeOf(c.first);
        return (
          <details key={c.key} className="panel rate-card" open={cards.length <= 3}>
            <summary>
              <span className={'rate-kind ' + scope}>{scope === 'default' ? 'Default' : scope === 'range' ? 'Range' : 'Project'}</span>
              <b>{rateCardLabel(c.first)}</b>
              {scope === 'project' && nameOf(c.first.project) && <span className="muted"> · {nameOf(c.first.project)}</span>}
              <small>{c.lines.length} item{c.lines.length === 1 ? '' : 's'}{last ? ` · changed ${new Date(last).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${by ? ' by ' + by : ''}` : ''}</small>
            </summary>
            <div className="scroll-x"><table className="site-table">
              <thead><tr><th>Item</th><th>Unit</th><th>BOQ rate</th><th>Reduction</th><th>Purchase target</th><th>Source</th>{canEdit && <th></th>}</tr></thead>
              <tbody>{c.lines.slice().sort((a: Any, b: Any) => a.item.localeCompare(b.item)).map((l: Any) => <tr key={l.id}>
                <td>{l.item}</td><td>{unitText(l.unit)}</td><td>{inr(l.originalRate)}</td><td>{l.discountPercent}%</td><td>{inr(purchaseTarget(l))}</td><td><small>{l.source || 'Manual'}</small></td>
                {canEdit && <td><button className="textbutton" aria-label={'Remove ' + l.item} disabled={!!busy} onClick={() => remove({ action: 'removeLine', cardKey: c.key, lineId: l.id }, `Remove ${l.item} from ${rateCardLabel(c.first)}?`)}>Remove</button></td>}
              </tr>)}</tbody>
            </table></div>
            <div className="site-actions">
              {canEdit && <button className="textbutton neg" disabled={!!busy} onClick={() => remove({ action: 'removeCard', cardKey: c.key }, `Remove the whole ${rateCardLabel(c.first)} (${c.lines.length} items)? Projects then use the next card that covers them.`)}>Remove card</button>}
            </div>
          </details>
        );
      })}
      {open && <UploadSheet cards={cards} onClose={() => setOpen(false)} post={post}
        onDone={(summary: string) => { setOpen(false); setError(''); setMessage(summary + '.'); }} />}
    </section>
  );
}

// ---------- "Upload rate cards": choose the spreadsheet → check → save ----------

function UploadSheet({ cards, onClose, onDone, post }: Any) {
  const [file, setFile] = useState(''), [rows, setRows] = useState<any[][] | null>(null), [parsed, setParsed] = useState<Any>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function pick(f?: File) {
    if (!f) return;
    setError(''); setParsed(null); setRows(null); setFile(f.name);
    try { const values = await readSheet(f); setParsed(parseRateSheet(values)); setRows(values); }
    catch (e) { setError((e as Error).message); }
  }
  async function save() {
    setBusy(true); setError('');
    try { onDone((await post({ action: 'uploadSheet', values: rows, file })).summary); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const status = (c: Any) => {
    const key = c.scope === 'range' ? `range:${c.fromProject}-${c.toProject}` : `project:${c.project}`;
    const old = cards.find((x: Any) => x.key === key);
    if (!old) return ['New', 'green'];
    const same = old.lines.length === c.lines.length && c.lines.every((l: Any) => old.lines.some((o: Any) => o.item === l.item && o.originalRate === l.originalRate));
    return same ? ['No change', ''] : ['Updated', 'amber'];
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="wide-dialog rate-dialog">
        <DialogTitle>Upload rate cards</DialogTitle>
        <DialogDescription>Your rate-card spreadsheet: <b>Project Number</b> in the first column, then one column per item with its BOQ rate. Each row replaces that project's card. A row can also cover a range of projects, written like <b>120-150</b>.</DialogDescription>
        <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="rate-pick">
          <button type="button" className={parsed ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose spreadsheet'}</button>
          {file && <span className="muted">{file}</span>}
        </div>
        {parsed && <>
          <p className="alert green">{parsed.cards.length} rate card{parsed.cards.length === 1 ? '' : 's'} · {parsed.rateCount} rates read.</p>
          {parsed.warnings.map((w: string) => <p key={w} className="alert amber">{w}</p>)}
          <div className="scroll-x rate-preview"><table className="site-table"><thead><tr><th>Row</th><th>Projects</th><th>Items</th><th>Rates</th><th></th></tr></thead>
            <tbody>{parsed.cards.map((c: Any) => { const [t, tone] = status(c); return (
              <tr key={c.row}><td>{c.row + 1}</td><td><b>{c.scope === 'range' ? `${c.fromProject}–${c.toProject}` : c.project}</b></td><td>{c.lines.length}</td>
                <td><small>{c.lines.map((l: Any) => `${l.item} ${inr(l.originalRate)}`).join(' · ')}</small></td><td><span className={'tag ' + tone}>{t}</span></td></tr>
            ); })}</tbody></table></div>
        </>}
        {error && <p className="alert red" role="alert">{error}</p>}
        <div className="formfooter">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || !parsed}>{busy ? 'Saving…' : parsed ? `Save ${parsed.cards.length} rate card${parsed.cards.length === 1 ? '' : 's'}` : 'Save'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
