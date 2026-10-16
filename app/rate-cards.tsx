'use client';
// Rate cards: the BOQ rates the app uses to set the purchasing target (BOQ rate less the reduction).
// Three kinds, most specific wins: one project → a range of projects (e.g. 120–150) → default.
// BOQ Team and Super Admin add or change them through "+ Add rate card":
//   1. how: type the rates in, or upload an Excel sheet
//   2. for whom: default card, one project, a range of projects (Excel also: several projects at once)
//   3. the rates
// GM and Audit read.
import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { rateCardKey, rateCardLabel, scopeOf, rateAppliesTo, purchaseTarget } from '@/lib/settings';
import { parseRateSheet, sheetLinesFor, RATE_CARD_ITEMS, RATE_CARD_ITEM_DEFAULTS, RATE_CARD_EXPORT_URL } from '@/lib/rate-card';

type Any = any;
const inr = (n: any) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const unitText = (u: string) => (u === '*' || !u ? 'Any unit' : u);
const order = (k: string) => (k === 'default' ? 0 : k.startsWith('range:') ? 1 : 2);
const cardSort = (a: Any, b: Any) => order(a.key) - order(b.key) || Number(a.first.fromProject || a.first.project) - Number(b.first.fromProject || b.first.project);
const blankLine = () => ({ item: '', unit: '', originalRate: '', discountPercent: '5' });
const keyOfScope = (s: Any) => (!s ? '' : s.type === 'default' ? 'default' : s.type === 'range' ? `range:${s.from}-${s.to}` : `project:${s.project}`);
const labelOfScope = (s: Any) => rateCardLabel(s.type === 'default' ? { scope: 'default' } : s.type === 'range' ? { scope: 'range', fromProject: s.from, toProject: s.to } : { project: s.project });
const scopeOfCard = (c: Any) => { const s = scopeOf(c.first); return s === 'default' ? { type: 'default' } : s === 'range' ? { type: 'range', from: c.first.fromProject, to: c.first.toProject } : { type: 'project', project: c.first.project }; };
const cellOf = (c: Any) => { const s = scopeOf(c.first); return s === 'default' ? 'Default' : s === 'range' ? `${c.first.fromProject}-${c.first.toProject}` : Number(c.first.project); };

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
/** Rate cards in the BOQ Team's sheet layout: Project Number (or a range, or Default), then one column per item. */
async function downloadCards(cards: Any[], name = 'Rate cards') {
  const ExcelJS: any = await import('exceljs');
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('RateCard');
  const items = [...new Set(cards.flatMap((c) => c.lines.map((l: Any) => l.item)))];
  sheet.addRow(['Project Number', ...items]).font = { bold: true };
  cards.forEach((c) => sheet.addRow([cellOf(c), ...items.map((i) => c.lines.find((l: Any) => l.item === i)?.originalRate ?? null)]));
  sheet.columns.forEach((col: Any, i: number) => { col.width = i ? 14 : 16; });
  const blob = new Blob([await book.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.replace(/[^\w –-]+/g, '') + '.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
          <p className="muted">The BOQ rate per item. The purchasing target is the BOQ rate less the reduction (5% unless set). A project uses <b>its own card</b> first, then <b>its range</b> (e.g. 120–150), then the <b>default card</b>. BOQ rates stay hidden from Purchase.</p>
        </div>
        <div className="actions">
          {cards.length > 0 && <button className="secondary" onClick={() => downloadCards(cards)}>Download rate cards</button>}
          {canEdit && <button className="primary" onClick={() => setOpen({})}>+ Add rate card</button>}
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
      {!cards.length && <div className="panel empty"><h3>No rate cards yet</h3><p>{canEdit ? 'Start with the default rate card: every project uses it until it gets a range or its own card.' : 'The BOQ Team has not added rate cards yet.'}</p>{canEdit && <button className="primary" onClick={() => setOpen({})}>+ Add rate card</button>}</div>}
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
              {canEdit && <button className="secondary" onClick={() => setOpen({ scope: scopeOfCard(c), how: 'manual' })}>Change rates</button>}
              {canEdit && <button className="secondary" onClick={() => setOpen({ scope: scopeOfCard(c), how: 'excel' })}>Update from Excel</button>}
              <button className="textbutton" onClick={() => downloadCards([c], rateCardLabel(c.first))}>Download as Excel</button>
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

// ---------- "+ Add rate card": how → for whom → rates ----------

const SCOPES: [string, string, string][] = [
  ['default', 'Default rate card', 'Every project, until it has a range or its own card. Add or update it here.'],
  ['project', 'One project', 'Only this project. It wins over the range and default cards.'],
  ['range', 'A range of projects', 'For example projects 120 to 150.'],
];

function AddRateCard({ start, cards, projects, onClose, onDone, post }: Any) {
  const [how, setHow] = useState<string>(start.how || '');
  const [scope, setScope] = useState<Any>(start.scope || null);
  const [type, setType] = useState<string>(start.scope?.type || '');
  const [project, setProject] = useState(start.scope?.project || ''), [from, setFrom] = useState(start.scope?.from || ''), [to, setTo] = useState(start.scope?.to || '');
  const linesOf = (s: Any) => {
    const card = cards.find((c: Any) => c.key === keyOfScope(s));
    return card ? card.lines.map((l: Any) => ({ item: l.item, unit: l.unit === '*' ? '' : l.unit, originalRate: String(l.originalRate), discountPercent: String(l.discountPercent) })) : [blankLine()];
  };
  const [lines, setLines] = useState<Any[]>(() => (start.scope ? linesOf(start.scope) : [blankLine()]));
  const [file, setFile] = useState(''), [sheet, setSheet] = useState<Any>(null), [rows, setRows] = useState<any[][] | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const step = !how ? 1 : !scope ? 2 : 3;
  const many = scope?.type === 'many';
  const existing = scope && !many ? cards.find((c: Any) => c.key === keyOfScope(scope)) : null;
  const label = scope && !many ? labelOfScope(scope) : '';
  const items = [...new Set([...RATE_CARD_ITEMS, ...cards.flatMap((c: Any) => c.lines.map((l: Any) => l.item))])];

  function chooseScope(e: any) {
    e.preventDefault(); setError('');
    const ok = (p: string) => /^[1-9]\d{2}$/.test(String(p).trim());
    if (type === 'project' && !ok(project)) return setError('Enter a project number from 100 to 999.');
    if (type === 'range' && (!ok(from) || !ok(to) || Number(from) >= Number(to))) return setError('Enter two project numbers from 100 to 999, the first smaller (e.g. 120 to 150).');
    if (type === 'range') {
      const clash = cards.find((c: Any) => c.key.startsWith('range:') && c.key !== `range:${String(from).trim()}-${String(to).trim()}` && Number(c.first.fromProject) <= Number(to) && Number(from) <= Number(c.first.toProject));
      if (clash) return setError(`Projects ${from}–${to} overlap the existing ${rateCardLabel(clash.first)}. Change that card, or choose a range that does not share projects.`);
    }
    const s = type === 'default' || type === 'many' ? { type } : type === 'range' ? { type, from: String(from).trim(), to: String(to).trim() } : { type, project: String(project).trim() };
    setScope(s);
    if (type !== 'many') setLines(linesOf(s));
  }
  async function pick(f?: File) {
    if (!f) return;
    setError(''); setSheet(null); setRows(null); setFile(f.name);
    try {
      const values = await readSheet(f);
      if (many) setSheet({ many: parseRateSheet(values) });
      else {
        const got = sheetLinesFor(values, scope);
        // A blank reduction keeps the item's current reduction (5% for a new item).
        const keep = (l: Any) => existing?.lines.find((o: Any) => o.item.toLowerCase() === l.item.toLowerCase() && (l.unit ? o.unit.toLowerCase() === l.unit.toLowerCase() : true))?.discountPercent;
        setSheet({ ...got, lines: got.lines.map((l: Any) => ({ ...l, discountPercent: l.discountPercent === '' ? keep(l) ?? 5 : l.discountPercent })) });
      }
      setRows(values);
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      let d: Any;
      if (many) d = await post({ action: 'uploadSheet', values: rows, file });
      else {
        const list = how === 'excel' ? sheet?.lines || [] : lines.filter((l) => String(l.item).trim() || String(l.originalRate).trim());
        if (!list.length) throw Error(how === 'excel' ? 'Choose the Excel sheet first.' : 'Add at least one item with a BOQ rate.');
        const bad = list.find((l: Any) => !String(l.item).trim() || !(Number(l.originalRate) > 0));
        if (bad) throw Error(`${String(bad.item).trim() || 'A line'} needs an item name and a BOQ rate above zero.`);
        d = await post({ action: 'save', scope, lines: list, replace: true, source: how === 'excel' ? 'Excel: ' + file : 'Manual' });
      }
      onDone(d.summary);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const back = () => { setError(''); setSheet(null); setRows(null); setFile(''); if (step === 3 && !start.scope) setScope(null); else if (step === 2 && !start.how) setHow(''); };
  const status = (c: Any) => {
    const key = c.scope === 'default' ? 'default' : c.scope === 'range' ? `range:${c.fromProject}-${c.toProject}` : `project:${c.project}`;
    const old = cards.find((x: Any) => x.key === key);
    if (!old) return ['New', 'green'];
    const same = old.lines.length === c.lines.length && c.lines.every((l: Any) => old.lines.some((o: Any) => o.item === l.item && o.originalRate === l.originalRate));
    return same ? ['No change', ''] : ['Updated', 'amber'];
  };
  const diff = () => {
    if (!existing || !sheet?.lines) return '';
    const k = (l: Any) => l.item.trim().toLowerCase();
    const have = new Set(existing.lines.map(k)), give = new Set(sheet.lines.map(k));
    const added = sheet.lines.filter((l: Any) => !have.has(k(l))).length, gone = existing.lines.filter((l: Any) => !give.has(k(l))).length;
    return ` ${sheet.lines.length - added} update current items, ${added} new${gone ? `; ${gone} item${gone === 1 ? '' : 's'} not in the sheet will be removed` : ''}.`;
  };
  const title = step === 3 && !many ? (existing ? 'Update' : 'New') + (scope.type === 'default' ? ' default rate card' : ' rate card · ' + label) : step === 3 ? 'Rate cards for several projects' : 'Add rate card';
  const fixed = Boolean(start.scope);
  const total = fixed ? 1 : start.how ? 2 : 3, at = fixed ? 1 : start.how ? step - 1 : step;

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="wide-dialog rate-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{total > 1 ? `Step ${at} of ${total} · ` : ''}{step === 1 ? 'How do you want to add the rates?' : step === 2 ? 'Which projects is this rate card for?' : how === 'excel' ? 'Upload the Excel sheet' : 'Enter the rates'}</DialogDescription>

        {step === 1 && <div className="rate-choices two">
          <button className="rate-choice" onClick={() => setHow('manual')}><b>Add manually</b><small>Type the items and rates here. Best for a few items or a quick change.</small></button>
          <button className="rate-choice" onClick={() => setHow('excel')}><b>Add Excel sheet</b><small>Upload your rate-card sheet. Best for many items or many projects.</small></button>
        </div>}

        {step === 2 && <form onSubmit={chooseScope}>
          <div className="rate-choices">
            {[...SCOPES, ...(how === 'excel' ? [['many', 'Several projects from the sheet', 'Each row of your sheet is a project, a range (120-150) or Default.']] : [])].map(([v, t, d]) => (
              <label key={v} className={'rate-choice' + (type === v ? ' chosen' : '')}><input type="radio" name="rateScope" value={v} checked={type === v} onChange={() => { setType(v); setError(''); }} /><b>{t}</b><small>{d}</small>
                {v === 'default' && cards.some((c: Any) => c.key === 'default') && <small className="tag">Exists · you will update it</small>}
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
          {type && type !== 'many' && cards.some((c: Any) => c.key === keyOfScope(type === 'default' ? { type } : type === 'range' ? { type, from: String(from).trim(), to: String(to).trim() } : { type, project: String(project).trim() })) && type !== 'default' &&
            <p className="muted">This card exists; you will update it.</p>}
          {error && <p className="alert red" role="alert">{error}</p>}
          <div className="formfooter">{!start.how && <button type="button" className="secondary" onClick={back}>Back</button>}<button className="primary" disabled={!type}>Next</button></div>
        </form>}

        {step === 3 && how === 'manual' && <>
          {existing && <p className="alert">This card has {existing.lines.length} item{existing.lines.length === 1 ? '' : 's'}, listed below. Change a rate, add an item, or remove a line.</p>}
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
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="rate-pick">
            <button type="button" className={sheet ? 'secondary' : 'primary'} onClick={() => input.current?.click()}>{file ? 'Upload another spreadsheet' : 'Upload spreadsheet'}</button>
            {file && <span className="muted">{file}</span>}
          </div>
          <p className="muted">{many
            ? <>Use the rate-card spreadsheet you already have: <b>Project Number</b> in the first column, then one column per item. Each row replaces that card. A row can be a range such as <b>120-150</b>, or <b>Default</b>.</>
            : <>Use the rate-card spreadsheet you already have (<b>Project Number</b>, then one column per item); the row for {scope.type === 'default' ? <b>Default</b> : <b>{scope.type === 'range' ? `${scope.from}-${scope.to}` : scope.project}</b>} is used. A list with <b>Item</b>, <b>Unit</b>, <b>BOQ rate</b>, <b>Reduction %</b> also works. The sheet replaces this card's items.</>}</p>
          <p className="muted rate-sources">
            <a className="textbutton inline" href={RATE_CARD_EXPORT_URL} target="_blank" rel="noreferrer">Download the BilaraRateCard sheet</a> (the Google sheet linked in the app){existing && <> · <button type="button" className="textbutton inline" onClick={() => downloadCards([existing], label)}>Download this card's current rates</button></>}
          </p>
          {sheet?.lines && <>
            <p className="alert green">{sheet.lines.length} rates read.{diff()}{sheet.others ? ` The other ${sheet.others} row${sheet.others === 1 ? ' is' : 's are'} ignored.` : ''}</p>
            {sheet.warnings?.map((w: string) => <p key={w} className="alert amber">{w}</p>)}
            <div className="scroll-x rate-preview"><table className="site-table"><thead><tr><th>Item</th><th>Unit</th><th>BOQ rate</th><th>Reduction</th></tr></thead>
              <tbody>{sheet.lines.map((l: Any, i: number) => <tr key={i}><td>{l.item}</td><td>{unitText(l.unit)}</td><td>{inr(l.originalRate)}</td><td>{l.discountPercent}%</td></tr>)}</tbody></table></div>
          </>}
          {sheet?.many && <>
            <p className="alert green">{sheet.many.cards.length} rate card{sheet.many.cards.length === 1 ? '' : 's'} · {sheet.many.rateCount} rates read.</p>
            {sheet.many.warnings.map((w: string) => <p key={w} className="alert amber">{w}</p>)}
            <div className="scroll-x rate-preview"><table className="site-table"><thead><tr><th>Row</th><th>Projects</th><th>Items</th><th>Rates</th><th></th></tr></thead>
              <tbody>{sheet.many.cards.map((c: Any) => { const [t, tone] = status(c); return (
                <tr key={c.row}><td>{c.row + 1}</td><td><b>{c.scope === 'default' ? 'Default' : c.scope === 'range' ? `${c.fromProject}–${c.toProject}` : c.project}</b></td><td>{c.lines.length}</td>
                  <td><small>{c.lines.map((l: Any) => `${l.item} ${inr(l.originalRate)}`).join(' · ')}</small></td><td><span className={'tag ' + tone}>{t}</span></td></tr>
              ); })}</tbody></table></div>
          </>}
        </>}

        {step === 3 && <>
          {error && <p className="alert red" role="alert">{error}</p>}
          <div className="formfooter">
            {!fixed && <button type="button" className="secondary" onClick={back} disabled={busy}>Back</button>}
            <button className="primary" onClick={save} disabled={busy || (how === 'excel' && !sheet)}>{busy ? 'Saving…' : many ? (sheet?.many ? `Save ${sheet.many.cards.length} rate card${sheet.many.cards.length === 1 ? '' : 's'}` : 'Save') : existing ? 'Save changes' : 'Save rate card'}</button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
