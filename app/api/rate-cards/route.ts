// Rate cards (BOQ Team and Super Admin): a default card for every project, cards for a range of
// projects (e.g. 120–150) and cards for one project. Lines live in settings.projectRates; every
// change is version-checked and kept in the settings history, like a Settings save.
import {protect} from '@/lib/access';
import type {Actor} from '@/lib/permissions';
import {database} from '@/lib/database';
import {defaultSettings, validateSettings, rateCardKey, rateCardLabel, type ProjectRate} from '@/lib/settings';
import {parseRateCard, parseRateSheet} from '@/lib/rate-card';

const fail = (error: string, status = 400) => Response.json({error}, {status});
const clean = (v: any) => String(v ?? '').trim();
const lineKey = (r: any) => [clean(r.item).toLowerCase(), (clean(r.unit) || '*').toLowerCase()].join('|');

function scopeFields(scope: any): Partial<ProjectRate> {
  const type = clean(scope?.type);
  if (type === 'default') return {scope: 'default', project: ''};
  if (type === 'range') return {scope: 'range', project: '', fromProject: clean(scope.from), toProject: clean(scope.to)};
  if (type === 'project') return {project: clean(scope.project)};
  throw Error('Choose who the rate card is for: all projects, a range of projects or one project.');
}

async function handlePOST(req: Request, a: Actor) {
  try {
    const b = await req.json() as any, db = database(), now = new Date().toISOString();
    if (!Number.isInteger(b.version) || b.version < 0) return fail('Refresh the rate cards before saving.');
    const row = await db.prepare("SELECT * FROM settings WHERE id='main'").first<any>();
    if ((row?.version || 0) !== b.version) return fail('Rate cards changed meanwhile. Reload and try again.', 409);
    const values: any = row ? {...defaultSettings, ...JSON.parse(row.data)} : {...defaultSettings};
    let rates: ProjectRate[] = (values.projectRates || []).slice(), summary = '';
    const stamp = {updatedAt: now, updatedBy: a.name || a.email};

    if (b.action === 'save') {
      const scope = scopeFields(b.scope), key = rateCardKey(scope);
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!lines.length) return fail('Add at least one item with a rate.');
      if (lines.length > 500) return fail('A rate card can have up to 500 items.');
      const seen = new Set<string>();
      for (const l of lines) { const k = lineKey(l); if (!clean(l.item)) return fail('Every line needs an item.'); if (seen.has(k)) return fail(`${clean(l.item)} (${clean(l.unit) || 'any unit'}) is listed twice.`); seen.add(k); }
      const card = rates.filter((r) => rateCardKey(r) === key), others = rates.filter((r) => rateCardKey(r) !== key);
      let added = 0, changed = 0;
      const next = (b.replace ? [] : card.filter((r) => !seen.has(lineKey(r)))).slice();
      for (const l of lines) {
        const old = card.find((r) => lineKey(r) === lineKey(l));
        const originalRate = Number(l.originalRate), discountPercent = l.discountPercent === '' || l.discountPercent == null ? (old?.discountPercent ?? 5) : Number(l.discountPercent);
        if (old && old.originalRate === originalRate && old.discountPercent === discountPercent && old.active !== false) { next.push(old); continue; }
        old ? changed++ : added++;
        next.push({...scope, id: old?.id || crypto.randomUUID(), item: clean(l.item), unit: clean(l.unit) || '*', originalRate, discountPercent, active: true,
          source: clean(b.source) || 'Manual', ...stamp} as ProjectRate);
      }
      const removed = b.replace ? card.filter((r) => !seen.has(lineKey(r))).length : 0;
      rates = [...others, ...next];
      summary = `${rateCardLabel(scope)}: ${added} added, ${changed} changed${removed ? `, ${removed} removed` : ''}`;
    } else if (b.action === 'removeLine') {
      const target = rates.find((r) => r.id === b.lineId && rateCardKey(r) === b.cardKey);
      if (!target) return fail('That rate was already removed. Reload the rate cards.');
      rates = rates.filter((r) => r !== target);
      summary = `${rateCardLabel(target)}: removed ${target.item}`;
    } else if (b.action === 'removeCard') {
      const card = rates.filter((r) => rateCardKey(r) === b.cardKey);
      if (!card.length) return fail('That rate card was already removed. Reload the rate cards.');
      rates = rates.filter((r) => rateCardKey(r) !== b.cardKey);
      summary = `${rateCardLabel(card[0])}: removed (${card.length} items)`;
    } else if (b.action === 'uploadSheet') {
      // The rate-card spreadsheet: one row per project (or range); each row replaces that card.
      if (!Array.isArray(b.values) || b.values.length > 1500) return fail('The spreadsheet could not be read.');
      const sheet = parseRateSheet(b.values);
      const file = clean(b.file).slice(0, 120), keys = new Set<string>();
      let added = 0, changed = 0;
      const next: ProjectRate[] = [];
      for (const c of sheet.cards) {
        const scope: Partial<ProjectRate> = c.scope === 'default' ? {scope: 'default', project: ''} : c.scope === 'range' ? {scope: 'range', project: '', fromProject: c.fromProject, toProject: c.toProject} : {project: c.project};
        const key = rateCardKey(scope);
        keys.add(key);
        const old = rates.filter((r) => rateCardKey(r) === key);
        old.length ? changed++ : added++;
        for (const l of c.lines) {
          const same = old.find((r) => lineKey(r) === lineKey({item: l.item, unit: '*'}));
          next.push(same && same.originalRate === l.originalRate ? same : {...scope, id: same?.id || crypto.randomUUID(), item: l.item, unit: '*', originalRate: l.originalRate,
            discountPercent: same?.discountPercent ?? 5, active: true, source: 'Excel: ' + file, ...stamp} as ProjectRate);
        }
      }
      rates = [...rates.filter((r) => !keys.has(rateCardKey(r))), ...next];
      values.rateCardImportedAt = now; values.rateCardImportedFile = file;
      summary = `${file || 'Spreadsheet'}: ${added} new and ${changed} updated rate cards, ${sheet.rateCount} rates`;
    } else if (b.action === 'importSheet') {
      // The BilaraRateCard Google sheet (Project Number + one column per item) → one card per project.
      if (!Array.isArray(b.values) || b.values.length > 1000) return fail('The rate-card sheet could not be read.');
      const result = parseRateCard(b.values, rates, 5);
      rates = result.rates.map((r) => (r.source === 'BilaraRateCard' && !r.updatedAt ? {...r, ...stamp} : r));
      values.rateCardImportedAt = now; values.rateCardImportedFile = clean(b.file).slice(0, 200);
      summary = `BilaraRateCard: ${result.rateCount} rates for ${result.projectCount} projects`;
    } else return fail('Unknown rate-card action.');

    const saved = validateSettings({...values, projectRates: rates});
    const event = crypto.randomUUID();
    const result = await db.batch([
      db.prepare("INSERT INTO history(id,record_id,action,data,at) SELECT ?,'settings','Rate cards updated',?,? WHERE COALESCE((SELECT version FROM settings WHERE id='main'),0)=?")
        .bind(event, JSON.stringify({by: a.email, summary, before: values.projectRates || [], after: saved.projectRates}), now, b.version),
      db.prepare("INSERT INTO settings(id,data,version,updated) SELECT 'main',?,?,? WHERE EXISTS(SELECT 1 FROM history WHERE id=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated")
        .bind(JSON.stringify(saved), b.version + 1, now, event),
    ]);
    if (!result[0].meta.changes) return fail('Rate cards changed meanwhile. Reload and try again.', 409);
    return Response.json({values: saved, version: b.version + 1, summary});
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The rate card could not be saved.');
  }
}

export async function POST(req: Request) { return protect(req, 'rateCards', handlePOST); }
