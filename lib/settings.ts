export type ProjectRate = {
  id: string;
  project: string;
  item: string;
  unit: string;
  originalRate: number;
  discountPercent: number;
  active: boolean;
  source?: string;
};
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
  itemCategories: ['Materials', 'Tools & Equipment', 'Services'],
  milestones: ['1', '2', '3', '4', '5', '6'],
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
    cleanProject = (v: any) => clean(v).replace(/\.0+$/, ''),
    cleanItem = (v: any) => clean(v).replace(/[^a-z0-9]/g, ''),
    matches = settings.projectRates.filter(
      (r) =>
        r.active &&
        cleanProject(r.project) === cleanProject(project) &&
        cleanItem(r.item) === cleanItem(item),
    );
  return (
    matches.find((r) => clean(r.unit) === clean(unit)) ||
    matches.find((r) => clean(r.unit) === '*')
  );
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
      value[key].length > (key === 'milestones' ? 10 : 200)
    )
      throw Error(
        key === 'milestones'
          ? 'Configure between 1 and 10 milestones.'
          : 'Each list needs 1–200 entries.',
      );
    const names = value[key].map((s: any) =>
      typeof s === 'string' ? s.trim() : '',
    );
    if (names.some((s: string) => !s || s.length > 100 || /[\r\n]/.test(s)))
      throw Error('Use one name per line, up to 100 characters.');
    if (
      key === 'milestones' &&
      names.some((s: string) => !/^([1-9]|10)$/.test(s))
    )
      throw Error('Milestones must be whole numbers from 1 to 10.');
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
  if (rates.length > 2000)
    throw Error('Configure at most 2,000 project item rates.');
  result.projectRates = rates.map((r: any) => {
    const project = String(r?.project || '').trim(),
      item = String(r?.item || '').trim(),
      unit = String(r?.unit || '').trim(),
      originalRate = Number(r?.originalRate),
      discountPercent = Number(r?.discountPercent ?? discount);
    if (
      !/^[1-9][0-9]{2}$/.test(project) ||
      !item ||
      item.length > 200 ||
      !unit ||
      unit.length > 30 ||
      !Number.isFinite(originalRate) ||
      originalRate <= 0 ||
      originalRate > 1e9 ||
      !Number.isFinite(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > 50
    )
      throw Error(
        'Each project rate needs project 100–999, item, unit, positive BOQ rate and a 0%–50% reduction.',
      );
    return {
      id: String(r.id || crypto.randomUUID()),
      project,
      item,
      unit,
      originalRate,
      discountPercent,
      active: r.active !== false,
      ...(r.source ? { source: String(r.source).slice(0, 100) } : {}),
    };
  });
  const keys = result.projectRates.map((r: ProjectRate) =>
    [r.project, r.item.toLowerCase(), r.unit.toLowerCase()].join('|'),
  );
  if (new Set(keys).size !== keys.length)
    throw Error('Remove duplicate project, item and unit rates.');
  result.rateCardImportedAt =
    typeof value?.rateCardImportedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value.rateCardImportedAt)
      ? value.rateCardImportedAt
      : '';
  result.rateCardImportedFile =
    typeof value?.rateCardImportedFile === 'string'
      ? value.rateCardImportedFile.slice(0, 200)
      : '';
  return result;
}
