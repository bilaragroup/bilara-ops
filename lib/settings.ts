import { MILESTONE_NUMBERS } from './activities';
/**
 * One line of a rate card. A rate card is all lines with the same scope:
 *  - default  every project (unless a range or project card has the item)
 *  - range    projects fromProject..toProject, e.g. 120-150
 *  - project  one project (older lines have no scope and are project lines)
 * The most specific card wins: project, then range, then default.
 */
export type RateScope = 'default' | 'range' | 'project';
export type ProjectRate = {
  id: string;
  scope?: RateScope;
  project: string;
  fromProject?: string;
  toProject?: string;
  item: string;
  unit: string;
  originalRate: number;
  discountPercent: number;
  active: boolean;
  source?: string;
  updatedAt?: string;
  updatedBy?: string;
};
export const scopeOf = (r: Partial<ProjectRate>): RateScope => r.scope === 'default' || r.scope === 'range' ? r.scope : 'project';
/** "default", "range:120-150" or "project:120": lines with the same key form one rate card. */
export function rateCardKey(r: Partial<ProjectRate>) {
  const scope = scopeOf(r);
  return scope === 'default' ? 'default' : scope === 'range' ? `range:${r.fromProject}-${r.toProject}` : `project:${r.project}`;
}
export function rateCardLabel(r: Partial<ProjectRate>) {
  const scope = scopeOf(r);
  return scope === 'default' ? 'Default rate card (all projects)' : scope === 'range' ? `Projects ${r.fromProject}–${r.toProject}` : `Project ${r.project}`;
}
export function rateAppliesTo(r: Partial<ProjectRate>, project: any) {
  const p = Number(String(project ?? '').trim().replace(/\.0+$/, ''));
  const scope = scopeOf(r);
  if (scope === 'default') return true;
  if (scope === 'range') return p >= Number(r.fromProject) && p <= Number(r.toProject);
  return String(r.project).replace(/\.0+$/, '') === String(p);
}
/** Item categories (fixed list; subcategories come later). Rentals are not kept in site stock. */
export const ITEM_CATEGORIES = ['Materials', 'Rentals', 'Shuttering Items', 'Other Items'];
export type Settings = {
  owners: string[];
  boqPreparers: string[];
  itemCategories: string[];
  milestones: string[];
  targetDiscountPercent: number;
  projectRates: ProjectRate[];
  rateCardImportedAt?: string;
  rateCardImportedFile?: string;
};
export const defaultSettings: Settings = {
  owners: ['Jithin', 'Jiby', 'Rosmi', 'Sneha', 'Stevo'],
  boqPreparers: ['Subha', 'Shilpa', 'Sachin Surendran'],
  itemCategories: ITEM_CATEGORIES,
  milestones: ['1', '2', '3', '4', '5'],
  targetDiscountPercent: 5,
  projectRates: [],
  rateCardImportedAt: '',
  rateCardImportedFile: '',
};
export function findProjectRate(
  settings: Settings,
  project: any,
  item: any,
  unit: any,
) {
  const clean = (v: any) =>
      String(v ?? '')
        .trim()
        .toLowerCase(),
    cleanItem = (v: any) => clean(v).replace(/[^a-z0-9]/g, ''),
    matches = settings.projectRates.filter(
      (r) => r.active && cleanItem(r.item) === cleanItem(item) && rateAppliesTo(r, project),
    );
  // The most specific rate card wins; within a card an exact unit beats "any unit".
  for (const scope of ['project', 'range', 'default'] as RateScope[]) {
    const own = matches.filter((r) => scopeOf(r) === scope);
    const found = own.find((r) => clean(r.unit) === clean(unit)) || own.find((r) => clean(r.unit) === '*');
    if (found) return found;
  }
  return undefined;
}
export function purchaseTarget(rule: ProjectRate) {
  return (
    Math.round(rule.originalRate * (1 - rule.discountPercent / 100) * 100) / 100
  );
}
export function validateSettings(value: any): Settings {
  const result: any = {};
  for (const key of [
    'owners',
    'boqPreparers',
    'itemCategories',
    'milestones',
  ]) {
    if (
      !Array.isArray(value?.[key]) ||
      !value[key].length ||
      value[key].length > (key === 'milestones' ? MILESTONE_NUMBERS.length : 200)
    )
      throw Error(
        key === 'milestones'
          ? 'Milestones are 1 to ' + MILESTONE_NUMBERS.length + ' (the company milestone list).'
          : 'Each list needs 1–200 entries.',
      );
    const names = value[key].map((s: any) =>
      typeof s === 'string' ? s.trim() : '',
    );
    if (names.some((s: string) => !s || s.length > 100 || /[\r\n]/.test(s)))
      throw Error('Use one name per line, up to 100 characters.');
    if (
      key === 'milestones' &&
      names.some((s: string) => !MILESTONE_NUMBERS.includes(s))
    )
      throw Error('Milestones are 1 to ' + MILESTONE_NUMBERS.length + ' (the company milestone list).');
    if (
      new Set(names.map((s: string) => s.toLowerCase())).size !== names.length
    )
      throw Error('Remove duplicate entries.');
    result[key] =
      key === 'milestones'
        ? names.sort((a: string, b: string) => Number(a) - Number(b))
        : names;
  }
  const discount = 5;
  result.targetDiscountPercent = discount;
  const rates = Array.isArray(value?.projectRates) ? value.projectRates : [];
  if (rates.length > 5000)
    throw Error('Configure at most 5,000 rate-card lines.');
  const projectNo = (v: any) => String(v ?? '').trim().replace(/\.0+$/, '');
  result.projectRates = rates.map((r: any) => {
    const scope = scopeOf(r),
      project = scope === 'project' ? projectNo(r?.project) : '',
      fromProject = scope === 'range' ? projectNo(r?.fromProject) : '',
      toProject = scope === 'range' ? projectNo(r?.toProject) : '',
      item = String(r?.item || '').trim(),
      unit = String(r?.unit || '').trim() || '*',
      originalRate = Number(r?.originalRate),
      discountPercent = Number(r?.discountPercent ?? discount);
    const valid = (p: string) => /^[1-9][0-9]{2}$/.test(p);
    if (scope === 'project' && !valid(project))
      throw Error('A project rate card needs a project number from 100 to 999.');
    if (scope === 'range' && (!valid(fromProject) || !valid(toProject) || Number(fromProject) >= Number(toProject)))
      throw Error('A range rate card needs two project numbers from 100 to 999, the first smaller than the second.');
    if (
      !item ||
      item.length > 200 ||
      unit.length > 30 ||
      !Number.isFinite(originalRate) ||
      originalRate <= 0 ||
      originalRate > 1e9 ||
      !Number.isFinite(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > 50
    )
      throw Error(
        'Each rate needs an item, a positive BOQ rate and a 0%–50% reduction.',
      );
    return {
      id: String(r.id || crypto.randomUUID()),
      ...(scope === 'project' ? {} : { scope }),
      project,
      ...(scope === 'range' ? { fromProject, toProject } : {}),
      item,
      unit,
      originalRate,
      discountPercent,
      active: r.active !== false,
      ...(r.source ? { source: String(r.source).slice(0, 100) } : {}),
      ...(r.updatedAt ? { updatedAt: String(r.updatedAt).slice(0, 40) } : {}),
      ...(r.updatedBy ? { updatedBy: String(r.updatedBy).slice(0, 120) } : {}),
    };
  });
  const keys = result.projectRates.map((r: ProjectRate) =>
    [rateCardKey(r), r.item.toLowerCase(), r.unit.toLowerCase()].join('|'),
  );
  if (new Set(keys).size !== keys.length)
    throw Error('A rate card has the same item and unit twice.');
  // Two ranges may not share a project, so it is always clear which card applies.
  const ranges = [...new Map(result.projectRates.filter((r: ProjectRate) => scopeOf(r) === 'range').map((r: ProjectRate) => [rateCardKey(r), r])).values()] as ProjectRate[];
  ranges.forEach((a, i) => ranges.slice(i + 1).forEach((b) => {
    if (Number(a.fromProject) <= Number(b.toProject) && Number(b.fromProject) <= Number(a.toProject))
      throw Error(`${rateCardLabel(b)} overlaps ${rateCardLabel(a)}. Use ranges that do not share projects.`);
  }));
  result.rateCardImportedAt =
    typeof value?.rateCardImportedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value.rateCardImportedAt)
      ? value.rateCardImportedAt
      : '';
  result.rateCardImportedFile =
    typeof value?.rateCardImportedFile === 'string'
      ? value.rateCardImportedFile.slice(0, 200)
      : '';
  result.itemCategories = ITEM_CATEGORIES;
  return result;
}
