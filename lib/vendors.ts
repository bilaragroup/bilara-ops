// Vendor / brand / price list kept by Purchase (project configuration). A line is for one project
// or for all projects (project ''). Requests pick their vendor from it; Purchase's plan uses its
// price as the starting vendor rate. Prices are shown to purchasing and approvers only.
export type VendorLine = {
  id: string;
  project: string; // '' = all projects
  item: string;
  category: string;
  brand: string;
  vendor: string;
  phone: string;
  unit: string;
  price: number | '';
  updatedBy?: string;
  updatedAt?: string;
};
const clean = (v: any) => String(v ?? '').trim();
const key = (v: any) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Vendors for an item on a project: the project's own lines first, then lines for all projects. */
export function vendorsFor(list: VendorLine[], project: any, item: any): VendorLine[] {
  const p = clean(project), k = key(item);
  const hits = (list || []).filter((v) => key(v.item) === k && (!v.project || v.project === p));
  return [...hits.filter((v) => v.project), ...hits.filter((v) => !v.project)];
}

export function validateVendors(input: any): VendorLine[] {
  if (!Array.isArray(input)) throw Error('Send the vendor list.');
  if (input.length > 3000) throw Error('Too many vendor lines (3000 at most).');
  const seen = new Set<string>();
  return input.map((r: any, i: number) => {
    const line: VendorLine = {
      id: clean(r.id) || crypto.randomUUID(),
      project: clean(r.project).replace(/\.0+$/, ''),
      item: clean(r.item),
      category: clean(r.category) || 'Materials',
      brand: clean(r.brand),
      vendor: clean(r.vendor),
      phone: clean(r.phone),
      unit: clean(r.unit),
      price: r.price === '' || r.price == null ? '' : Number(r.price),
      updatedBy: clean(r.updatedBy),
      updatedAt: clean(r.updatedAt),
    };
    const row = `Line ${i + 1}`;
    if (!line.item) throw Error(`${row}: enter the item.`);
    if (!line.vendor) throw Error(`${row}: enter the vendor.`);
    if (line.project && !/^[1-9][0-9]{2}$/.test(line.project)) throw Error(`${row}: project must be a number from 100 to 999, or blank for all projects.`);
    if (line.price !== '' && !(Number.isFinite(line.price) && line.price >= 0)) throw Error(`${row}: price must be a number.`);
    for (const [k, max] of [['item', 200], ['brand', 120], ['vendor', 160], ['phone', 40], ['unit', 20], ['category', 60]] as const)
      if (String((line as any)[k]).length > max) throw Error(`${row}: ${k} is too long.`);
    const id = [line.project, key(line.item), key(line.brand), key(line.vendor)].join('|');
    if (seen.has(id)) throw Error(`${row}: ${line.item} · ${line.brand || 'no brand'} · ${line.vendor} is listed twice for the same project.`);
    seen.add(id);
    return line;
  });
}
