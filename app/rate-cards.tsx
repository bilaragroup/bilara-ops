'use client';
// Rate cards: the BOQ rates the app uses to set the purchasing target (BOQ rate less the reduction).
// Three kinds, most specific wins: one project → a range of projects (e.g. 120–150) → default.
// BOQ Team and Super Admin add or change them, by typing or from an Excel sheet; GM and Audit read.
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { rateCardKey, rateCardLabel, scopeOf, rateAppliesTo, purchaseTarget } from '@/lib/settings';
import { RATE_CARD_ITEMS, RATE_CARD_ITEM_DEFAULTS } from '@/lib/rate-card';

type Any = any;
const inr = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const TEMPLATE_HEADERS = ['Item', 'Unit', 'BOQ rate', 'Reduction %'];
const unitText = (u: string) => (u === '*' || !u ? 'Any unit' : u);
const order = (k: string) => (k === 'default' ? 0 : k.startsWith('range:') ? 1 : 2);
const cardSort = (a: Any, b: Any) => order(a.key) - order(b.key) || Number(a.first.fromProject || a.first.project) - Number(b.first.fromProject || b.first.project);
const blankLine = () => ({ item: '', unit: '', originalRate: '', discountPercent: '5' });

async function readSheet(file: File): Promise<any[][]> {
  if (file.size > 5 * 1024 * 1024) throw Error('Use an Excel file under 5 MB.');
  const ExcelJS: any = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());
  const sheet = book.getWorksheet('RateCard') || book.worksheets[0];
  if (!sheet) throw Error('The workbook has no sheet.');
  const rows: any[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row: any) => {
    rows.push(Array.from({ length: Math.max(17, row.cellCount) }, (_, i) => {
      const c = row.getCell(i + 1);
      return typeof c.value === 'object' && c.value && 'result' in c.value ? c.value.result : c.text;
    }));
  });
  return rows;
}
async function downloadTemplate(name: string, lines: Any[]) {
  const ExcelJS: any = await import('exceljs');
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Rates');
  sheet.addRow(TEMPLATE_HEADERS).font = { bold: true };
  (lines.length ? lines : RATE_CARD_ITEMS.map((item) => ({ item, unit: RATE_CARD_ITEM_DEFAULTS[item]?.unit || '', originalRate: '', discountPercent: 5 })))
    .forEach((l: Any) => sheet.addRow([l.item, l.unit === '*' ? '' : l.unit, l.originalRate === '' ? null : Number(l.originalRate), Number(l.discountPercent ?? 5)]));
  sheet.columns = [{ width: 34 }, { width: 10 }, { width: 12 }, { width: 13 }];
  sheet.addRow([]);
  sheet.addRow(['Leave Unit blank for any unit. Reduction % is how far below the BOQ rate Purchase must buy (5 if blank).']).font = { italic: true, color: { argb: 'FF667788' } };
  const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.replace(/[^\w –-]+/g, '') + '.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Rows of the simple template (Item, Unit, BOQ rate, Reduction %) as rate lines. */
function linesFromSheet(rows: any[][]) {
  const head = (rows[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = col(['item']), cu = col(['unit']), cr = col(['boq rate', 'rate']), cd = col(['reduction %', 'reduction', 'target reduction %']);
  if (ci < 0 || cr < 0) throw Error('Use the template headings: Item, Unit, BOQ rate, Reduction %.');
  const lines: Any[] = [];
  rows.slice(1).forEach((r, n) => {
    const item = String(r[ci] ?? '').trim(), raw = String(r[cr] ?? '').replace(/[₹,\s]/g, '');
    if (!item || item.startsWith('Leave Unit blank')) return;
    if (!raw) return; // a template row without a rate is skipped
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate <= 0) throw Error(`Row ${n + 2}: ${item} needs a positive BOQ rate.`);
    const d = cd >= 0 && String(r[cd] ?? '').trim() !== '' ? Number(String(r[cd]).replace('%', '')) : 5;
    if (!Number.isFinite(d) || d < 0 || d > 50) throw Error(`Row ${n + 2}: reduction must be 0–50%.`);
    lines.push({ item, unit: cu >= 0 ? String(r[cu] ?? '').trim() : '', originalRate: rate, discountPercent: d });
  });
  if (!lines.length) throw Error('No rates were found in the sheet. Fill the BOQ rate column, then upload again.');
  return lines;
}

export default function RateCards({ settings, onSaved, canEdit, projects = [] }: Any) {
  const rates: Any[] = settings.values.projectRates || [];
  const cards = useMemo(() => {
    const m = new Map<string, Any>();
    rates.forEach((r) => { const k = rateCardKey(r); if (!m.has(k)) m.set(k, { key: k, first: r, lines: [] }); m.get(k).lines.push(r); });
    return [...m.values()].sort(cardSort);
  }, [rates]);
  const [find, setFind] = useState(''), [check, setCheck] = useState(''), [open, setOpen] = useState<Any>(null);
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
          <p className="muted">The BOQ rate per item. The purchasing target is the BOQ rate less the reduction (5% unless set). When a project has more than one card, the most specific is used: <b>its own card</b>, then <b>its range</b>, then the <b>default card</b>. BOQ rates stay hidden from Purchase.</p>
        </div>
        {canEdit && <button className="primary" onClick={() => setOpen({})}>+ Add rate card</button>}
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
      {!cards.length && <div className="panel empty"><h3>No rate cards yet</h3><p>{canEdit ? 'Start with the default rate card, which every project uses until it gets its own.' : 'The BOQ Team has not added rate cards yet.'}</p>{canEdit && <button className="primary" onClick={() => setOpen({ scope: { type: 'default' } })}>Add the default rate card</button>}</div>}
      {shown.map((c) => {
        const last = c.lines.map((l: Any) => l.updatedAt || '').sort().pop();
        const by = c.lines.find((l: Any) => l.updatedAt === last)?.updatedBy;
        const scope = scopeOf(c.first);
        const scopeArg = scope === 'default' ? { type: 'default' } : scope === 'range' ? { type: 'range', from: c.first.fromProject, to: c.first.toProject } : { type: 'project', project: c.first.project };
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
              {canEdit && <button className="secondary" onClick={() => setOpen({ scope: scopeArg, how: 'manual' })}>Add or change items</button>}
              {canEdit && <button className="secondary" onClick={() => setOpen({ scope: scopeArg, how: 'excel' })}>Update from Excel</button>}
              <button className="textbutton" onClick={() => downloadTemplate(rateCardLabel(c.first), c.lines)}>Download as Excel</button>
              {canEdit && <button className="textbutton neg" disabled={!!busy} onClick={() => remove({ action: 'removeCard', cardKey: c.key }, `Remove the whole ${rateCardLabel(c.first)} (${c.lines.length} items)? Projects then use the next card that covers them.`)}>Remove card</button>}
            </div>
          </details>
        );
      })}
      {open && <AddRateCard start={open} cards={cards} projects={projects} onClose={() => setOpen(null)} post={post}
        onDone={(summary: string) => { setOpen(null); setError(''); setMessage(summary + '.'); }} />}
    </section>
  );
}

// ---------- the "Add rate card" window: how → which projects → rates ----------

function AddRateCard({ start, cards, projects, onClose, onDone, post }: Any) {
  const [how, setHow] = useState<string>(start.how || '');
  const [scope, setScope] = useState<Any>(start.scope || null);
  const [type, setType] = useState<string>(start.scope?.type || '');
  const [project, setProject] = useState(start.scope?.project || ''), [from, setFrom] = useState(start.scope?.from || ''), [to, setTo] = useState(start.scope?.to || '');
  const initial = (s: Any) => {
    const k = !s ? '' : s.type === 'default' ? 'default' : s.type === 'range' ? `range:${s.from}-${s.to}` : `project:${s.project}`;
    const card = cards.find((c: Any) => c.key === k);
    return card ? card.lines.map((l: Any) => ({ item: l.item, unit: l.unit === '*' ? '' : l.unit, originalRate: String(l.originalRate), discountPercent: String(l.discountPercent) })) : [blankLine()];
  };
  const [lines, setLines] = useState<Any[]>(() => initial(start.scope)), [replace, setReplace] = useState(false), [file, setFile] = useState(''), [sheet, setSheet] = useState<Any>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const step = !how ? 1 : !scope ? 2 : 3;
  const key = scope ? (scope.type === 'default' ? 'default' : scope.type === 'range' ? `range:${scope.from}-${scope.to}` : `project:${scope.project}`) : '';
  const existing = cards.find((c: Any) => c.key === key);
  const label = scope ? rateCardLabel(scope.type === 'default' ? { scope: 'default' } : scope.type === 'range' ? { scope: 'range', fromProject: scope.from, toProject: scope.to } : { project: scope.project }) : '';
  const items = [...new Set([...RATE_CARD_ITEMS, ...cards.flatMap((c: Any) => c.lines.map((l: Any) => l.item))])];

  function chooseScope(e: any) {
    e.preventDefault(); setError('');
    const ok = (p: string) => /^[1-9]\d{2}$/.test(p.trim());
    if (type === 'project' && !ok(project)) return setError('Enter a project number from 100 to 999.');
    if (type === 'range' && (!ok(from) || !ok(to) || Number(from) >= Number(to))) return setError('Enter two project numbers from 100 to 999, the first smaller (e.g. 120 to 150).');
    if (type === 'range') {
      const clash = cards.find((c: Any) => c.key.startsWith('range:') && c.key !== `range:${from.trim()}-${to.trim()}` && Number(c.first.fromProject) <= Number(to) && Number(from) <= Number(c.first.toProject));
      if (clash) return setError(`Projects ${from}–${to} overlap the existing ${rateCardLabel(clash.first)}. Change that card or choose a range that does not share projects.`);
    }
    const s = type === 'default' ? { type } : type === 'range' ? { type, from: from.trim(), to: to.trim() } : { type, project: project.trim() };
    setScope(s);
    setLines(initial(s));
  }
  async function pick(f?: File) {
    if (!f) return;
    setError(''); setSheet(null);
    try {
      const rows = await readSheet(f);
      setFile(f.name);
      if (String(rows[0]?.[0] ?? '').trim() === 'Project Number') setSheet({ legacy: true, rows, projects: rows.slice(1).filter((r) => String(r[0] ?? '').trim()).length });
      else setSheet({ lines: linesFromSheet(rows) });
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      let d: Any;
      if (sheet?.legacy) d = await post({ action: 'importSheet', values: sheet.rows, file });
      else {
        const list = how === 'excel' ? sheet?.lines || [] : lines.filter((l) => String(l.item).trim() || String(l.originalRate).trim());
        if (!list.length) throw Error(how === 'excel' ? 'Choose the filled-in Excel sheet first.' : 'Add at least one item with a BOQ rate.');
        const bad = list.find((l: Any) => !String(l.item).trim() || !(Number(l.originalRate) > 0));
        if (bad) throw Error(`${String(bad.item).trim() || 'A line'} needs an item name and a BOQ rate above zero.`);
        d = await post({ action: 'save', scope, lines: list, replace: how === 'manual' ? true : replace, source: how === 'excel' ? 'Excel: ' + file : 'Manual' });
      }
      onDone(d.summary);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const back = () => { setError(''); if (step === 3 && !start.scope) { setScope(null); setSheet(null); } else if (step === 2 && !start.how) setHow(''); };

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="wide-dialog rate-dialog">
        <DialogTitle>{step === 3 ? (existing ? 'Update ' : 'New ') + label.replace('Default rate card (all projects)', 'default rate card') : 'Add rate card'}</DialogTitle>
        <DialogDescription>{step === 1 ? 'Step 1 of 3 · How do you want to add the rates?' : step === 2 ? 'Step 2 of 3 · Which projects is this rate card for?' : `Step 3 of 3 · ${how === 'excel' ? 'Upload the sheet' : 'Enter the rates'}`}</DialogDescription>

        {step === 1 && <div className="rate-choices two">
          <button className="rate-choice" onClick={() => setHow('manual')}><b>Type them in</b><small>Enter items and rates here. Best for a few items.</small></button>
          <button className="rate-choice" onClick={() => setHow('excel')}><b>Upload an Excel sheet</b><small>Download the template, fill the rates, upload it. Best for many items.</small></button>
        </div>}

        {step === 2 && <form onSubmit={chooseScope}>
          <div className="rate-choices">
            {[['default', 'Default rate card', 'Every project, unless it has a range or its own card.'], ['range', 'A range of projects', 'For example projects 120 to 150.'], ['project', 'One project', 'Only this project. It wins over the range and default cards.']].map(([v, t, d]) => (
              <label key={v} className={'rate-choice' + (type === v ? ' chosen' : '')}><input type="radio" name="rateScope" value={v} checked={type === v} onChange={() => { setType(v); setError(''); }} /><b>{t}</b><small>{d}</small>
                {v === 'default' && type === v && cards.some((c: Any) => c.key === 'default') && <small className="tag">Exists · you will update it</small>}
              </label>
            ))}
          </div>
          {type === 'range' && <div className="formgrid rate-range">
            <label className="field"><span>From project *</span><input inputMode="numeric" maxLength={3} required value={from} onChange={(e) => setFrom(e.target.value)} placeholder="120" /></label>
            <label className="field"><span>To project *</span><input inputMode="numeric" maxLength={3} required value={to} onChange={(e) => setTo(e.target.value)} placeholder="150" /></label>
          </div>}
          {type === 'project' && <label className="field rate-range"><span>Project number *</span>
            <input list="rate-projects" inputMode="numeric" maxLength={3} required value={project} onChange={(e) => setProject(e.target.value)} placeholder="125" />
            <datalist id="rate-projects">{projects.map((p: Any) => <option key={p.project} value={p.project}>{p.name}</option>)}</datalist></label>}
          {error && <p className="alert red" role="alert">{error}</p>}
          <div className="formfooter">{!start.how && <button type="button" className="secondary" onClick={back}>Back</button>}<button className="primary" disabled={!type}>Next</button></div>
        </form>}

        {step === 3 && how === 'manual' && <>
          {existing && <p className="alert">This card already has {existing.lines.length} item{existing.lines.length === 1 ? '' : 's'}; they are listed below. Change a rate, add a line, or clear a line to remove it.</p>}
          <datalist id="rate-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
          <div className="rate-lines">
            <div className="rate-line head"><span>Item</span><span>Unit</span><span>BOQ rate (₹)</span><span>Reduction %</span><span></span></div>
            {lines.map((l, i) => <div key={i} className="rate-line">
              <input list="rate-items" aria-label="Item" placeholder="Cement" value={l.item} onChange={(e) => { const v = e.target.value; setLines(lines.map((x, n) => (n === i ? { ...x, item: v, unit: x.unit || (RATE_CARD_ITEM_DEFAULTS as Any)[v]?.unit || '' } : x))); }} />
              <input aria-label="Unit" placeholder="Any" value={l.unit} onChange={(e) => set(i, 'unit', e.target.value)} />
              <input aria-label="BOQ rate" type="number" min="0" step="any" value={l.originalRate} onChange={(e) => set(i, 'originalRate', e.target.value)} />
              <input aria-label="Reduction %" type="number" min="0" max="50" step="any" value={l.discountPercent} onChange={(e) => set(i, 'discountPercent', e.target.value)} />
              <button type="button" className="textbutton" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, n) => n !== i) : [blankLine()])}>✕</button>
            </div>)}
          </div>
          <div className="site-actions"><button type="button" className="secondary" onClick={() => setLines([...lines, blankLine()])}>+ Add item</button></div>
          <p className="muted">Leave Unit empty when the rate holds for any unit. Purchase must buy at least the reduction below the BOQ rate.</p>
        </>}

        {step === 3 && how === 'excel' && <>
          <ol className="rate-steps">
            <li><button type="button" className="textbutton" onClick={() => downloadTemplate(label, existing ? existing.lines : [])}>Download the template</button>{existing ? ' — it has this card\'s current rates.' : ' — the common items are listed; fill the BOQ rates.'}</li>
            <li>Fill the <b>BOQ rate</b> column (and Reduction % if not 5).</li>
            <li><label className="secondary file-button">Choose the filled sheet<input type="file" accept=".xlsx" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>{file && <small className="muted"> {file}</small>}</li>
          </ol>
          {sheet?.legacy && <p className="alert amber">This is the BilaraRateCard sheet (a column per item). It sets a card for each of its {sheet.projects} projects and leaves the default and range cards as they are.</p>}
          {sheet?.lines && <>
            <p className="alert green">{sheet.lines.length} rates read. {existing ? (() => { const keyOf = (l: Any) => l.item.trim().toLowerCase() + '|' + (l.unit || '*').toLowerCase(); const have = new Set(existing.lines.map((l: Any) => keyOf({ ...l, unit: l.unit === '*' ? '' : l.unit }))); const added = sheet.lines.filter((l: Any) => !have.has(keyOf(l))).length; return `${sheet.lines.length - added} update existing items, ${added} are new.`; })() : ''}</p>
            <div className="scroll-x"><table className="site-table"><thead><tr><th>Item</th><th>Unit</th><th>BOQ rate</th><th>Reduction</th></tr></thead>
              <tbody>{sheet.lines.slice(0, 50).map((l: Any, i: number) => <tr key={i}><td>{l.item}</td><td>{unitText(l.unit)}</td><td>{inr(l.originalRate)}</td><td>{l.discountPercent}%</td></tr>)}</tbody></table></div>
            {existing && <label className="site-check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Also remove items that are not in this sheet</label>}
          </>}
        </>}

        {step === 3 && <>
          {error && <p className="alert red" role="alert">{error}</p>}
          <div className="formfooter">
            {!start.scope && <button type="button" className="secondary" onClick={back} disabled={busy}>Back</button>}
            <button className="primary" onClick={save} disabled={busy || (how === 'excel' && !sheet)}>{busy ? 'Saving…' : existing && !sheet?.legacy ? 'Save changes' : 'Save rate card'}</button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
