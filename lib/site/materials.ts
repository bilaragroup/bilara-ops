// Site stock: GRN item master, receipts, append-only stock ledger, balances, thresholds,
// opening stock, reconciliation, GIN, site assets and wastage.
// Converted from the QC app's MaterialInventory.gs, GrnItemMaster.gs,
// PurchaseMaterialIncoming.gs (GRN numbering) and SiteAssetsWasteGin.gs.
//
// The separate "Bilara Site Purchase" Google workbook is not needed any more: Purchase sees
// the same tabs live in the app (see purchase-view.ts), and edits the GRN item master there.
import {Site, Row, SiteError, dateKey, parseDateKey, isValidDateKey, clientSafe, storedDate} from './core';
import {assertProjectAccess, assertSiteOperationsProjectAccess} from './access';
import {dprNumber, dprText, dprClientProject, materialRound, shortId} from './util';

// ---------- definitions ----------

export type MaterialDefinition = {
  code: string; name: string; category: string; subcategory?: string; stockUnit: string;
  inputUnits: string[]; variants?: string[]; ginOnly?: boolean; preseedBalance?: boolean;
};

export const MATERIAL_MAJOR_DEFINITIONS: MaterialDefinition[] = [
  {code: 'CEMENT', name: 'Cement', category: 'MAJOR', stockUnit: 'bags', inputUnits: ['BAGS']},
  {code: 'AGGREGATE', name: 'Aggregate', category: 'MAJOR', stockUnit: 'CFT', inputUnits: ['CFT']},
  {code: 'RIVER_SAND', name: 'Sand', category: 'MAJOR', stockUnit: 'CFT', inputUnits: ['CFT']},
  {code: 'M_SAND', name: 'M-sand', category: 'MAJOR', stockUnit: 'CFT', inputUnits: ['CFT']},
  {code: 'P_SAND', name: 'P-sand', category: 'MAJOR', stockUnit: 'CFT', inputUnits: ['CFT']},
  {code: 'RED_BRICK', name: 'Red brick', category: 'MASONRY', stockUnit: 'nos', inputUnits: ['NOS']},
  {code: 'LATERITE_STONE', name: 'Laterite stone', category: 'MASONRY', stockUnit: 'nos', inputUnits: ['NOS']},
  {code: 'CEMENT_BLOCK_6_INCH', name: '6-inch cement blocks', category: 'MASONRY', stockUnit: 'nos', inputUnits: ['NOS']},
  {code: 'CEMENT_BLOCK_4_INCH', name: '4-inch cement blocks', category: 'MASONRY', stockUnit: 'nos', inputUnits: ['NOS']},
  {code: 'STEEL', name: 'Steel', category: 'MAJOR', stockUnit: 'kg', inputUnits: ['KG', 'BUNDLES'], variants: ['6 mm', '8 mm', '10 mm', '12 mm', '16 mm', '20 mm', '25 mm', '32 mm']},
  // Common site assets: valid only for site-side GIN acceptance; a balance row is created on first receipt.
  {code: 'COLUMN_BOX', name: 'Column boxes', category: 'SITE_ASSET', stockUnit: 'nos', inputUnits: ['NOS'], ginOnly: true},
  {code: 'WOOD_RUNNER', name: 'Wood runners', category: 'SITE_ASSET', stockUnit: 'pieces', inputUnits: ['PIECES'], ginOnly: true},
  {code: 'WOODEN_PLANK', name: 'Wooden planks', category: 'SITE_ASSET', stockUnit: 'pieces', inputUnits: ['PIECES'], ginOnly: true},
  {code: 'SHUTTERING_PLYWOOD', name: 'Shuttering plywood', category: 'SITE_ASSET', stockUnit: 'sheets', inputUnits: ['SHEETS'], ginOnly: true},
  {code: 'SCAFFOLDING', name: 'Scaffolding', category: 'SITE_ASSET', stockUnit: 'sets', inputUnits: ['SETS'], ginOnly: true},
  {code: 'POWER_TOOLS', name: 'Power tools', category: 'SITE_ASSET', stockUnit: 'nos', inputUnits: ['NOS'], ginOnly: true},
  {code: 'HAND_TOOLS', name: 'Hand tools', category: 'SITE_ASSET', stockUnit: 'nos', inputUnits: ['NOS'], ginOnly: true},
  {code: 'MOBILIZATION_KIT', name: 'Mobilization kit', category: 'SITE_ASSET', stockUnit: 'sets', inputUnits: ['SETS'], ginOnly: true},
];

export const MATERIAL_MISC_UNITS = ['nos', 'pieces', 'bags', 'bundles', 'kg', 'tonnes', 'litres', 'metres', 'running ft', 'sq ft', 'sq m', 'CFT', 'cubic m', 'loads', 'sets', 'boxes'];

// ---------- GRN item master (kept by Purchase) ----------

const GRN_ITEM_MASTER_SCHEMA_VERSION = '2026-08-08-v1';
export const GRN_ITEM_MASTER_HEADERS = ['Item_Code', 'Category', 'Subcategory', 'Item_Name', 'Stock_Unit', 'Input_Units', 'Variants', 'Active', 'Purchase_Notes', 'Validation_Status', 'Validation_Message', 'Last_Imported_At'];
export const GRN_ITEM_CATEGORIES = ['CONSTRUCTION MATERIAL', 'RENTAL'];
export const GRN_CONSTRUCTION_SUBCATEGORIES = ['CIVIL', 'SANITARY', 'PLUMBING', 'ELECTRICAL'];

const GRN_ITEM_MASTER_SEEDS: string[][] = [
  ['CEMENT', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Cement', 'bags', 'BAGS', '', 'Yes', ''],
  ['AGGREGATE', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Aggregate', 'CFT', 'CFT', '', 'Yes', 'Measured from lorry dimensions'],
  ['RIVER_SAND', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Sand', 'CFT', 'CFT', '', 'Yes', ''],
  ['M_SAND', 'CONSTRUCTION MATERIAL', 'CIVIL', 'M-sand', 'CFT', 'CFT', '', 'Yes', 'Measured from lorry dimensions'],
  ['P_SAND', 'CONSTRUCTION MATERIAL', 'CIVIL', 'P-sand', 'CFT', 'CFT', '', 'Yes', 'Measured from lorry dimensions'],
  ['RED_BRICK', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Red brick', 'nos', 'NOS', '', 'Yes', ''],
  ['LATERITE_STONE', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Laterite stone', 'nos', 'NOS', '', 'Yes', ''],
  ['CEMENT_BLOCK_6_INCH', 'CONSTRUCTION MATERIAL', 'CIVIL', '6-inch cement blocks', 'nos', 'NOS', '', 'Yes', ''],
  ['CEMENT_BLOCK_4_INCH', 'CONSTRUCTION MATERIAL', 'CIVIL', '4-inch cement blocks', 'nos', 'NOS', '', 'Yes', ''],
  ['STEEL', 'CONSTRUCTION MATERIAL', 'CIVIL', 'Steel', 'kg', 'KG, BUNDLES', '6 mm, 8 mm, 10 mm, 12 mm, 16 mm, 20 mm, 25 mm, 32 mm', 'Yes', ''],
  ['RENTAL_JACKY_1_5_M', 'RENTAL', '', 'Jacky (1.5 m)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_1_M', 'RENTAL', '', 'Jacky (1 m)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_2_10_M_7_FT', 'RENTAL', '', 'Jacky (2.10 m / 7 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_3_6_M_12_FT', 'RENTAL', '', 'Jacky (3.6 m / 12 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_3_9_M_13_FT', 'RENTAL', '', 'Jacky (3.9 m / 13 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_5_M_15_FT', 'RENTAL', '', 'Jacky (5 m / 15 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACKY_6_M_18_FT', 'RENTAL', '', 'Jacky (6 m / 18 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SPAN_8_FT_14_FT', 'RENTAL', '', 'Span (8 ft / 14 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SPAN_6_FT_11_FT', 'RENTAL', '', 'Span (6 ft / 11 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SPAN_5_FT_9_FT', 'RENTAL', '', 'Span (5 ft / 9 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SPAN_4_FT', 'RENTAL', '', 'Span (4 ft)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_COLUMN_BOX', 'RENTAL', '', 'Column box', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_ADJUSTER_115', 'RENTAL', '', 'Adjuster (115)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_ADJUSTER_90', 'RENTAL', '', 'Adjuster (90)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_ADJUSTER_30', 'RENTAL', '', 'Adjuster (30)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SHUTTER_115', 'RENTAL', '', 'Shutter (115)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SHUTTER_90', 'RENTAL', '', 'Shutter (90)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SHUTTER_40_HALF', 'RENTAL', '', 'Shutter (40 / half sheet)', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_WOODEN_PLANK_8_FT', 'RENTAL', '', '8 ft wooden plank', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_WOODEN_PLANK_4_FT', 'RENTAL', '', '4 ft wooden plank', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_H_FRAME', 'RENTAL', '', 'H-frame', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_COUPLER', 'RENTAL', '', 'Coupler', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_CLAMP', 'RENTAL', '', 'Clamp', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_PIPE_7_FT', 'RENTAL', '', '7 ft pipe', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_PIPE_8_FT', 'RENTAL', '', '8 ft pipe', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_PIPE_10_FT', 'RENTAL', '', '10 ft pipe', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_PIPE_20_FT', 'RENTAL', '', '20 ft pipe', 'pieces', 'PIECES', '', 'Yes', ''],
  ['RENTAL_CUTTING_MACHINE', 'RENTAL', '', 'Cutting machine', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_GENERATOR', 'RENTAL', '', 'Generator', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_TARPAULIN_SHEET', 'RENTAL', '', 'Tarpaulin sheet', 'sheets', 'SHEETS', '', 'Yes', ''],
  ['RENTAL_PUTTY_MIXER', 'RENTAL', '', 'Putty mixer machine', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_VIBRATOR', 'RENTAL', '', 'Vibrator', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_CONCRETE_MIXER', 'RENTAL', '', 'Concrete mixer machine', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_DRILLING_MACHINE', 'RENTAL', '', 'Drilling machine', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_JACK_HAMMER', 'RENTAL', '', 'Jack hammer', 'nos', 'NOS', '', 'Yes', ''],
  ['RENTAL_SCAFFOLDING_SET', 'RENTAL', '', 'Scaffolding set', 'sets', 'SETS', '', 'Yes', ''],
];

function grnItemSeedRecords(s: Site): Row[] {
  return GRN_ITEM_MASTER_SEEDS.map((r) => ({
    Item_Code: r[0], Category: r[1], Subcategory: r[2], Item_Name: r[3], Stock_Unit: r[4], Input_Units: r[5],
    Variants: r[6], Active: r[7], Purchase_Notes: r[8], Validation_Status: 'VALID', Validation_Message: '', Last_Imported_At: s.now(),
  }));
}

/** First use: add the standard items that Purchase started from. */
export async function ensureGrnItemMaster(s: Site) {
  if ((await s.property('GRN_ITEM_MASTER_SCHEMA_VERSION')) === GRN_ITEM_MASTER_SCHEMA_VERSION) return;
  const byCode: Record<string, boolean> = {};
  (await s.read('GRN_Item_Master')).forEach((row) => { byCode[String(row.Item_Code || '').trim().toUpperCase()] = true; });
  const missing = grnItemSeedRecords(s).filter((row) => !byCode[row.Item_Code]);
  if (missing.length) await s.appendMany('GRN_Item_Master', missing);
  s.setProperty('GRN_ITEM_MASTER_SCHEMA_VERSION', GRN_ITEM_MASTER_SCHEMA_VERSION);
  (s as any)._grnDefs = null;
}

export function normalizeMasterToken(value: any): string {
  return String(value || '').trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toUpperCase();
}
export function normalizeMasterList(value: any): string[] {
  return String(value || '').split(',').map((item) => String(item || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
}
function grnItemNaturalKey(category: any, subcategory: any, name: any) {
  return [normalizeMasterToken(category), normalizeMasterToken(subcategory), normalizeMasterToken(name)].join('|');
}
function generatedGrnItemCode(category: any, name: any, usedCodes: Record<string, string>) {
  const prefix = normalizeMasterToken(category) === 'RENTAL' ? 'RENTAL_' : 'MATERIAL_';
  let slug = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  if (!slug) slug = 'ITEM';
  let code = prefix + slug, suffix = 2;
  while (usedCodes[code]) { code = (prefix + slug).slice(0, 58) + '_' + suffix; suffix++; }
  return code;
}
function validatePurchaseMasterRow(s: Site, record: Row, rowNumber: number, usedNaturalKeys: Record<string, number>, usedCodes: Record<string, string>): Row {
  const result: Row = {...record};
  result.Category = normalizeMasterToken(record.Category);
  result.Subcategory = normalizeMasterToken(record.Subcategory);
  result.Item_Name = String(record.Item_Name || '').trim().replace(/\s+/g, ' ');
  result.Stock_Unit = String(record.Stock_Unit || '').trim().replace(/\s+/g, ' ');
  result.Input_Units = normalizeMasterList(record.Input_Units).map((u) => u.toUpperCase()).join(', ');
  result.Variants = normalizeMasterList(record.Variants).join(', ');
  const active = String(record.Active ?? '').trim();
  result.Active = /^(YES|Y|TRUE|ACTIVE|1)$/i.test(active) ? 'Yes' : (/^(NO|N|FALSE|INACTIVE|0)$/i.test(active) ? 'No' : '');
  result.Purchase_Notes = String(record.Purchase_Notes || '').trim().slice(0, 500);
  const errors: string[] = [];
  if (GRN_ITEM_CATEGORIES.indexOf(result.Category) < 0) errors.push('Category must be Construction Material or Rental.');
  if (result.Category === 'CONSTRUCTION MATERIAL' && GRN_CONSTRUCTION_SUBCATEGORIES.indexOf(result.Subcategory) < 0) errors.push('Select Civil, Sanitary, Plumbing or Electrical.');
  if (result.Category === 'RENTAL') result.Subcategory = '';
  if (!result.Item_Name || result.Item_Name.length > 120) errors.push('Item name is required and must be 120 characters or fewer.');
  if (!result.Stock_Unit || result.Stock_Unit.length > 30) errors.push('Stock unit is required.');
  const inputUnits = normalizeMasterList(result.Input_Units);
  if (!inputUnits.length || inputUnits.length > 10) errors.push('Enter one or more comma-separated input units.');
  if (!result.Active) errors.push('Active must be Yes or No.');
  const naturalKey = grnItemNaturalKey(result.Category, result.Subcategory, result.Item_Name);
  if (usedNaturalKeys[naturalKey]) errors.push('Duplicate of row ' + usedNaturalKeys[naturalKey] + '.');
  else if (result.Item_Name) usedNaturalKeys[naturalKey] = rowNumber;
  let code = String(record.Item_Code || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!code) code = generatedGrnItemCode(result.Category, result.Item_Name, usedCodes);
  if (code.length > 64) errors.push('Generated item code is too long; shorten the item name.');
  if (usedCodes[code] && usedCodes[code] !== naturalKey) errors.push('Item code duplicates another item.');
  else usedCodes[code] = naturalKey;
  result.Item_Code = code;
  result.Validation_Status = errors.length ? 'INVALID' : 'VALID';
  result.Validation_Message = errors.join(' ');
  result.Last_Imported_At = s.now();
  return result;
}

/** Purchase's item list as the GRN Item Master page shows it (was the Purchase workbook tab). */
export async function getGrnItemMaster(s: Site) {
  const user = s.requireRole(['PURCHASE', 'ADMIN']);
  await ensureGrnItemMaster(s);
  const rows = await s.read('GRN_Item_Master');
  return clientSafe({
    canEdit: user.role === 'PURCHASE' || user.role === 'ADMIN',
    categories: GRN_ITEM_CATEGORIES, subcategories: GRN_CONSTRUCTION_SUBCATEGORIES,
    items: rows.map((r) => {
      const o: Row = {rowId: r._row};
      GRN_ITEM_MASTER_HEADERS.forEach((h) => { o[h] = r[h] instanceof Date ? storedDate(r[h]) : r[h]; });
      return o;
    }),
  });
}

/**
 * Save Purchase's edits to the item list (was: edit the Purchase workbook tab, then import).
 * Every row is validated together exactly as the import did; invalid rows are kept but marked
 * INVALID with the reason, and only VALID active rows are offered on GRN forms.
 */
export async function saveGrnItemMaster(s: Site, payload: any) {
  const user = s.requireRole(['PURCHASE', 'ADMIN']);
  await ensureGrnItemMaster(s);
  const input: Row[] = Array.isArray(payload?.items) ? payload.items : [];
  if (!input.length || input.length > 2000) throw new SiteError('The item list is empty or too long.');
  const existing = await s.read('GRN_Item_Master');
  const byRow = new Map(existing.map((r) => [Number(r._row), r]));
  const usedNaturalKeys: Record<string, number> = {}, usedCodes: Record<string, string> = {};
  const validated = input.map((record, index) => {
    if (!String(record.Item_Name || '').trim() && !String(record.Category || '').trim()) return null;
    const previous = record.rowId ? byRow.get(Number(record.rowId)) : null;
    // Item codes are system-generated and stable: a saved item keeps its code.
    const clean: Row = {...record, Item_Code: previous ? previous.Item_Code : (record.Item_Code || '')};
    return {previous, row: validatePurchaseMasterRow(s, clean, index + 2, usedNaturalKeys, usedCodes)};
  }).filter(Boolean) as Array<{previous: Row | null | undefined; row: Row}>;
  const kept = new Set<number>();
  for (const {previous, row} of validated) {
    const payloadRow: Row = {};
    GRN_ITEM_MASTER_HEADERS.forEach((h) => { payloadRow[h] = row[h]; });
    if (previous) { kept.add(Number(previous._row)); await s.updateBatch('GRN_Item_Master', [{record: previous, changes: payloadRow}]); }
    else await s.append('GRN_Item_Master', payloadRow);
  }
  // An item already used must be switched to Active = No rather than deleted; rows missing from
  // the save are therefore marked inactive, never removed.
  for (const r of existing) {
    if (!kept.has(Number(r._row)) && String(r.Active) !== 'No') await s.updateBatch('GRN_Item_Master', [{record: r, changes: {Active: 'No', Last_Imported_At: s.now()}}]);
  }
  const invalid = validated.filter((v) => v.row.Validation_Status !== 'VALID').length;
  s.setProperty('GRN_ITEM_MASTER_LAST_AUTO_IMPORT_MS', Date.now());
  s.setProperty('GRN_ITEM_MASTER_LAST_IMPORTED_COUNT', validated.length - invalid);
  s.setProperty('GRN_ITEM_MASTER_LAST_INVALID_COUNT', invalid);
  await s.audit('GRN_ITEM_MASTER_IMPORTED', 'SYSTEM', 'GRN_Item_Master', '', 'SYNCED', {runBy: user.email, imported: validated.length - invalid, invalid});
  (s as any)._grnDefs = null;
  const out = await getGrnItemMaster(s);
  return {...out, imported: validated.length - invalid, invalid};
}

/** The item list is live in the app, so "refresh from Purchase" only reports the counts. */
async function refreshGrnItemMasterFromPurchase(s: Site) {
  await ensureGrnItemMaster(s);
  const rows = await s.read('GRN_Item_Master');
  return {imported: rows.filter((r) => String(r.Validation_Status || 'VALID').toUpperCase() === 'VALID').length,
    invalid: rows.filter((r) => String(r.Validation_Status || 'VALID').toUpperCase() !== 'VALID').length, warning: ''};
}

export async function activeGrnMaterialDefinitions(s: Site): Promise<MaterialDefinition[]> {
  const cached: MaterialDefinition[] | null = (s as any)._grnDefs;
  if (cached) return cached.map((item) => ({...item, inputUnits: item.inputUnits.slice(), variants: (item.variants || []).slice()}));
  await ensureGrnItemMaster(s);
  const originalSeedCodes: Record<string, boolean> = {};
  MATERIAL_MAJOR_DEFINITIONS.forEach((item) => { originalSeedCodes[item.code] = true; });
  const definitions: MaterialDefinition[] = (await s.read('GRN_Item_Master')).filter((row) =>
    String(row.Validation_Status || 'VALID').toUpperCase() === 'VALID' && /^(YES|Y|TRUE|ACTIVE|1)$/i.test(String(row.Active ?? '')),
  ).map((row) => ({
    code: String(row.Item_Code || '').trim().toUpperCase(), name: String(row.Item_Name || '').trim(),
    category: normalizeMasterToken(row.Category), subcategory: normalizeMasterToken(row.Subcategory),
    stockUnit: String(row.Stock_Unit || '').trim(), inputUnits: normalizeMasterList(row.Input_Units).map((u) => u.toUpperCase()),
    variants: normalizeMasterList(row.Variants), ginOnly: false, preseedBalance: Boolean(originalSeedCodes[String(row.Item_Code || '').trim().toUpperCase()]),
  }));
  MATERIAL_MAJOR_DEFINITIONS.filter((item) => item.ginOnly).forEach((item) => {
    definitions.push({...item, subcategory: '', preseedBalance: false, inputUnits: item.inputUnits.slice(), variants: (item.variants || []).slice()});
  });
  (s as any)._grnDefs = definitions;
  return activeGrnMaterialDefinitions(s);
}

export async function materialDefinition(s: Site, code: any): Promise<MaterialDefinition | null> {
  const wanted = String(code || '').trim().toUpperCase();
  return (await activeGrnMaterialDefinitions(s)).find((d) => d.code === wanted) || null;
}

// ---------- calculations ----------

export function steelDiameterMm(variant: any): number {
  const match = String(variant || '').match(/([0-9]+(?:\.[0-9]+)?)/);
  const diameter = match ? Number(match[1]) : 0;
  if (!(diameter > 0)) throw new SiteError('Select a valid steel diameter.');
  return diameter;
}

export function steelReceiptCalculation(input: any, variant: any, index: number) {
  const label = 'Receipt line ' + (index + 1);
  const diameter = steelDiameterMm(variant);
  const fullBundles = dprNumber(input.fullBundles || 0, label + ' full bundles', false);
  const barsPerBundle = dprNumber(input.barsPerBundle || 0, label + ' bars per bundle', false);
  const looseBars = dprNumber(input.looseBars || 0, label + ' loose bars', false);
  const length = dprNumber(input.barLength, label + ' bar length', false);
  const unit = String(input.barLengthUnit || '').trim().toUpperCase();
  if (!Number.isInteger(fullBundles) || fullBundles < 0) throw new SiteError(label + ' full bundles must be a whole number of zero or more.');
  if (!Number.isInteger(barsPerBundle) || barsPerBundle < 0) throw new SiteError(label + ' bars per bundle must be a whole number of zero or more.');
  if (!Number.isInteger(looseBars) || looseBars < 0) throw new SiteError(label + ' loose bars must be a whole number of zero or more.');
  if (fullBundles > 0 && barsPerBundle <= 0) throw new SiteError(label + ' bars per bundle is required when full bundles are received.');
  if (length <= 0) throw new SiteError(label + ' bar length must be greater than 0.');
  if (unit !== 'M' && unit !== 'FT') throw new SiteError(label + ' bar length unit must be metres or feet.');
  const totalBars = fullBundles * barsPerBundle + looseBars;
  if (totalBars <= 0) throw new SiteError(label + ' must include at least one bundled or loose bar.');
  const totalLengthInput = totalBars * length;
  const totalLengthM = totalLengthInput * (unit === 'FT' ? 0.3048 : 1);
  const kg = materialRound(unit === 'FT' ? (diameter * diameter / 533) * totalLengthInput : (diameter * diameter / 162) * totalLengthInput);
  return {diameterMm: diameter, fullBundles, barsPerBundle, looseBars, barLength: length, barLengthUnit: unit, totalBars, totalLengthM: materialRound(totalLengthM), kg};
}

export function lorryVolumeCalculation(input: any, index: number) {
  const label = 'Receipt line ' + (index + 1);
  const unit = String(input.dimensionUnit || 'FT').trim().toUpperCase();
  if (['FT', 'M'].indexOf(unit) < 0) throw new SiteError(label + ' lorry dimension unit must be feet or metres.');
  const length = dprNumber(input.lorryLength, label + ' lorry length', false);
  const width = dprNumber(input.lorryWidth, label + ' lorry width', false);
  const readings = (Array.isArray(input.depthReadings) ? input.depthReadings : []).map((v: any, i: number) => dprNumber(v, label + ' depth reading ' + (i + 1), false));
  if (length <= 0 || width <= 0) throw new SiteError(label + ' lorry length and width must be greater than 0.');
  if (readings.length < 2 || readings.length > 10 || readings.some((v: number) => v <= 0)) throw new SiteError(label + ' requires between 2 and 10 positive depth readings.');
  const toFeet = unit === 'M' ? 3.280839895013123 : 1;
  const lengthFt = length * toFeet, widthFt = width * toFeet;
  const averageInput = readings.reduce((sum: number, v: number) => sum + v, 0) / readings.length;
  const averageFt = averageInput * toFeet;
  if (lengthFt > 100 || widthFt > 30 || averageFt > 20) throw new SiteError(label + ' lorry dimensions are outside the allowed safety range. Check feet/metres selection.');
  const volumeCft = materialRound(lengthFt * widthFt * averageFt);
  if (!isFinite(volumeCft) || volumeCft <= 0 || volumeCft > 60000) throw new SiteError(label + ' calculated CFT is invalid. Check all lorry measurements.');
  return {method: 'LORRY_DIMENSIONS_AVERAGE_DEPTH', dimensionUnit: unit, lengthInput: length, widthInput: width, depthReadings: readings,
    averageDepthInput: materialRound(averageInput), lengthFt: materialRound(lengthFt), widthFt: materialRound(widthFt), averageDepthFt: materialRound(averageFt), volumeCft};
}

export function materialKey(code: any, name: any, variant: any, unit: any): string {
  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanName = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return [cleanCode === 'MISC' ? ('MISC:' + cleanName) : cleanCode, String(variant || '').trim().toUpperCase(), String(unit || '').trim().toUpperCase()].join('|');
}

export function materialStatus(balance: any, threshold: any): string {
  const quantity = materialRound(balance), low = materialRound(threshold);
  if (quantity < 0) return 'NEGATIVE';
  if (quantity === 0) return 'OUT OF STOCK';
  if (low > 0 && quantity <= low) return 'LOW';
  return 'OK';
}

async function materialLegacyKey(s: Site, row: Row): Promise<string> {
  let code = String(row.Material_Code || '').trim().toUpperCase();
  let variant = '';
  if (/^STEEL_\d+MM$/.test(code)) { variant = code.replace(/^STEEL_/, '').replace(/MM$/, ' mm'); code = 'STEEL'; }
  else if (code === 'SAND') code = 'RIVER_SAND';
  const definition = await materialDefinition(s, code);
  return materialKey(code, definition ? definition.name : row.Material_Name, variant, definition ? definition.stockUnit : row.Unit);
}

// ---------- balances ----------

export async function materialBalanceRows(s: Site, projectId: any): Promise<Row[]> {
  return s.filter('Material_Balances', (row) => String(row.Project_ID || '') === String(projectId || ''));
}

async function latestLegacyDprBalances(s: Site, projectId: any) {
  const latest: Record<string, {date: string; row: Row}> = {};
  const rows = await s.filter('DPR_Materials', (row) => String(row.Project_ID || '') === String(projectId || '') && row.Balance_Quantity !== '');
  for (const row of rows) {
    const key = await materialLegacyKey(s, row);
    const current = latest[key];
    const date = dateKey(row.Work_Date);
    if (!current || date > current.date || (date === current.date && Number(row._row || 0) > Number(current.row._row || 0))) latest[key] = {date, row};
  }
  return latest;
}

export function materialBalanceRecord(s: Site, project: Row, definition: Partial<MaterialDefinition> & {code: string; name: string; stockUnit: string; category: string}, variant: any, opening: any, baselineSource: string): Row {
  const key = materialKey(definition.code, definition.name, variant, definition.stockUnit);
  const quantity = materialRound(opening);
  return {
    Balance_ID: shortId('MB-'), Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
    Material_Key: key, Material_Code: definition.code, Material_Name: definition.name,
    Material_Category: definition.category, Material_Subcategory: definition.subcategory || '', Variant: variant || '', Stock_Unit: definition.stockUnit,
    Opening_Quantity: quantity, Total_Received: 0, Total_Consumed: 0, Total_Adjusted: 0,
    Balance_Quantity: quantity, Low_Stock_Threshold: 0, Status: materialStatus(quantity, 0),
    Last_Transaction_ID: '', Last_Transaction_At: '', Updated_At: s.now(), Updated_By: 'SYSTEM',
    Baseline_Source: baselineSource || 'NEW ZERO BALANCE',
  };
}

/** Every project starts with a zero balance row for each standard item (or its last DPR figure). */
export async function ensureProjectMaterialBalances(s: Site, project: Row): Promise<Row[]> {
  const existing = await materialBalanceRows(s, project.Project_ID);
  const byKey: Record<string, Row> = {};
  existing.forEach((row) => { byKey[String(row.Material_Key || '')] = row; });
  const balanceDefinitions = (await activeGrnMaterialDefinitions(s)).filter((d) => d.preseedBalance);
  const requiredKeys: string[] = [];
  balanceDefinitions.forEach((d) => (d.variants && d.variants.length ? d.variants : ['']).forEach((v) => requiredKeys.push(materialKey(d.code, d.name, v, d.stockUnit))));
  if (requiredKeys.every((key) => Boolean(byKey[key]))) return existing;
  const legacy = await latestLegacyDprBalances(s, project.Project_ID);
  const additions: Row[] = [];
  balanceDefinitions.forEach((d) => {
    (d.variants && d.variants.length ? d.variants : ['']).forEach((variant) => {
      const key = materialKey(d.code, d.name, variant, d.stockUnit);
      if (byKey[key]) return;
      const legacyRow = legacy[key] && legacy[key].row;
      const opening = legacyRow ? Number(legacyRow.Balance_Quantity || 0) : 0;
      const source = legacyRow ? ('DPR baseline ' + dateKey(legacyRow.Work_Date)) : 'NEW ZERO BALANCE';
      additions.push(materialBalanceRecord(s, project, d, variant, opening, source));
    });
  });
  if (!additions.length) return existing;
  await s.appendMany('Material_Balances', additions);
  const openingLedger = additions.map((row) => {
    const transactionId = shortId('MTX-');
    row.Last_Transaction_ID = transactionId;
    return {
      Transaction_ID: transactionId, Request_ID: '', Project_ID: project.Project_ID, Transaction_Date: s.now(), Transaction_Type: 'OPENING',
      Source_Type: 'MIGRATION', Source_ID: row.Balance_ID, Material_Key: row.Material_Key, Material_Code: row.Material_Code,
      Material_Name: row.Material_Name, Variant: row.Variant, Quantity_Change: row.Opening_Quantity, Stock_Unit: row.Stock_Unit,
      Balance_After: row.Balance_Quantity, Remarks: row.Baseline_Source, Created_At: s.now(), Created_By: 'SYSTEM',
    };
  });
  await s.appendMany('Material_Ledger', openingLedger);
  for (let i = 0; i < additions.length; i++) {
    await s.update('Material_Balances', 'Balance_ID', additions[i].Balance_ID, {Last_Transaction_ID: openingLedger[i].Transaction_ID, Last_Transaction_At: openingLedger[i].Created_At});
  }
  return materialBalanceRows(s, project.Project_ID);
}

// ---------- shapes sent to the page ----------

export function materialClientBalance(row: Row) {
  return {
    balanceId: String(row.Balance_ID || ''), materialKey: String(row.Material_Key || ''),
    materialCode: String(row.Material_Code || ''), materialName: String(row.Material_Name || ''),
    category: String(row.Material_Category || ''), subcategory: String(row.Material_Subcategory || ''), variant: String(row.Variant || ''),
    stockUnit: String(row.Stock_Unit || ''), openingQuantity: Number(row.Opening_Quantity || 0),
    totalReceived: Number(row.Total_Received || 0), totalConsumed: Number(row.Total_Consumed || 0),
    totalAdjusted: Number(row.Total_Adjusted || 0), balanceQuantity: Number(row.Balance_Quantity || 0),
    lowStockThreshold: Number(row.Low_Stock_Threshold || 0), status: String(row.Status || ''),
    updatedAt: row.Updated_At || '', baselineSource: String(row.Baseline_Source || ''),
    openingVerifiedBy: String(row.Opening_Verified_By || ''), openingVerifiedAt: row.Opening_Verified_At || '',
    openingSetBy: String(row.Opening_Set_By || ''), openingSetAt: row.Opening_Set_At || '',
  };
}

export function materialClientReceipt(row: Row) {
  return {
    receiptId: String(row.Receipt_ID || ''), grnNo: String(row.GRN_No || ''), receivedDate: dateKey(row.Received_Date),
    supplier: String(row.Supplier || ''), deliveryNoteNo: String(row.Delivery_Note_No || ''),
    materialKey: String(row.Material_Key || ''), materialName: String(row.Material_Name || ''),
    variant: String(row.Variant || ''), enteredQuantity: Number(row.Entered_Quantity || 0),
    enteredUnit: String(row.Entered_Unit || ''), conversionFactor: Number(row.Conversion_Factor || 1),
    stockQuantity: Number(row.Stock_Quantity || 0), stockUnit: String(row.Stock_Unit || ''),
    measurementMethod: String(row.Measurement_Method || ''), dimensionUnit: String(row.Dimension_Unit || ''),
    lorryLengthInput: row.Lorry_Length_Input || '', lorryWidthInput: row.Lorry_Width_Input || '',
    depthReadingsInput: String(row.Depth_Readings_Input || ''), averageDepthInput: row.Average_Depth_Input || '',
    lorryLengthFt: row.Lorry_Length_ft || '', lorryWidthFt: row.Lorry_Width_ft || '',
    averageDepthFt: row.Average_Depth_ft || '', calculatedVolumeCft: row.Calculated_Volume_CFT || '',
    remarks: String(row.Remarks || ''), createdBy: String(row.Created_By || ''), createdAt: row.Created_At || '',
    poLinked: String(row.PO_Line_ID || '') !== '', poNo: String(row.PO_No || ''), siteGrnBookNo: String(row.Site_GRN_Book_No || ''),
  };
}

function ledgerClient(row: Row) {
  return {
    transactionId: String(row.Transaction_ID || ''), materialKey: String(row.Material_Key || ''),
    transactionDate: dateKey(row.Transaction_Date || row.Created_At), transactionType: String(row.Transaction_Type || ''),
    quantityChange: Number(row.Quantity_Change || 0), balanceAfter: Number(row.Balance_After || 0),
    unit: String(row.Stock_Unit || ''), remarks: String(row.Remarks || ''),
  };
}

// ---------- the Site Materials page ----------

export async function getMaterialInventoryWorkspace(s: Site, projectId: any) {
  const user = s.requireRole(['PM', 'SITE_ENGINEER', 'QC', 'ADMIN', 'GM']);
  await assertSiteOperationsProjectAccess(s, user, projectId);
  const masterSync = await refreshGrnItemMasterFromPurchase(s);
  const project = await s.find('Projects', 'Project_ID', projectId);
  if (!project) throw new SiteError('Project not found.');
  const balances = (await ensureProjectMaterialBalances(s, project)).sort((a, b) =>
    String(a.Material_Category).localeCompare(String(b.Material_Category)) || String(a.Material_Name).localeCompare(String(b.Material_Name)) || String(a.Variant).localeCompare(String(b.Variant)));
  const keys: Record<string, boolean> = {};
  balances.forEach((row) => { keys[String(row.Material_Key)] = true; });
  const receipts = (await s.recentProjectRows('Material_Receipts', projectId, 100)).filter((row) => String(row.Status || 'COMMITTED').toUpperCase() === 'COMMITTED');
  const ledger = (await s.recentProjectRows('Material_Ledger', projectId, 750)).filter((row) => keys[String(row.Material_Key || '')]).reverse();
  const siteOps = await siteOpsWorkspace(s, projectId);
  const definitions = await activeGrnMaterialDefinitions(s);
  return clientSafe({
    project: dprClientProject(project), balances: balances.map(materialClientBalance),
    receipts: receipts.map(materialClientReceipt), ledger: ledger.map(ledgerClient),
    majorMaterials: definitions.map((d) => ({code: d.code, name: d.name, category: d.category, subcategory: d.subcategory || '', stockUnit: d.stockUnit, inputUnits: d.inputUnits, variants: d.variants || [], ginOnly: Boolean(d.ginOnly)})),
    itemMaster: {imported: Number(masterSync.imported || 0), invalid: Number(masterSync.invalid || 0), warning: String(masterSync.warning || '')},
    miscUnits: MATERIAL_MISC_UNITS.slice(),
    permissions: {
      canReceive: user.role === 'SITE_ENGINEER' || user.role === 'QC' || user.role === 'ADMIN',
      canSetThresholds: user.role === 'PM' || user.role === 'ADMIN',
      canSetOpeningStock: user.role === 'PM' || user.role === 'ADMIN',
      canReconcile: user.role === 'PM' || user.role === 'ADMIN',
      canReverse: user.role === 'ADMIN', role: user.role,
    },
    ginReceipts: siteOps.ginReceipts, assets: siteOps.assets, steelWastage: siteOps.steelWastage, materialWastage: siteOps.materialWastage,
  });
}

// ---------- receipt lines (GRN and GIN) ----------

export type PreparedLine = {
  materialCode: string; materialName: string; category: string; subcategory: string; variant: string;
  enteredQuantity: number; enteredUnit: string; conversionFactor: number; stockQuantity: number; stockUnit: string;
  materialKey: string; remarks: string; steel?: ReturnType<typeof steelReceiptCalculation> | null; lorry?: ReturnType<typeof lorryVolumeCalculation> | null;
};

export async function prepareReceiptLine(s: Site, input: any, index: number, allowGinOnly: boolean): Promise<PreparedLine> {
  const code = String(input.materialCode || '').trim().toUpperCase();
  const lorryMeasured = allowGinOnly !== true && ['AGGREGATE', 'M_SAND', 'P_SAND'].indexOf(code) >= 0;
  const quantity = (code === 'STEEL' && String(input.inputUnit || '').trim().toUpperCase() === 'BUNDLES') || lorryMeasured
    ? 1 : dprNumber(input.quantity, 'Receipt line ' + (index + 1) + ' quantity', false);
  if (quantity <= 0) throw new SiteError('Receipt line ' + (index + 1) + ' quantity must be greater than 0.');
  if (code === 'MISC') {
    if (allowGinOnly !== true) throw new SiteError('Other items cannot be typed directly into a GRN. Ask Purchase to add the item to the GRN Item Master, refresh, and select the approved name.');
    const name = dprText(input.materialName, 'Receipt line ' + (index + 1) + ' miscellaneous material name', 120, true);
    const unit = String(input.inputUnit || '').trim();
    if (MATERIAL_MISC_UNITS.indexOf(unit) < 0) throw new SiteError('Receipt line ' + (index + 1) + ' has an invalid unit.');
    return {materialCode: 'MISC', materialName: name, category: 'MISCELLANEOUS', subcategory: '', variant: '', enteredQuantity: quantity, enteredUnit: unit,
      conversionFactor: 1, stockQuantity: quantity, stockUnit: unit, materialKey: materialKey('MISC', name, '', unit),
      remarks: dprText(input.remarks, 'Receipt line ' + (index + 1) + ' remarks', 500, false)};
  }
  const definition = await materialDefinition(s, code);
  if (!definition) throw new SiteError('Receipt line ' + (index + 1) + ' has an invalid material.');
  if (definition.ginOnly && allowGinOnly !== true) throw new SiteError('Receipt line ' + (index + 1) + ' is available only for site-side GIN acceptance.');
  const enteredUnit = String(input.inputUnit || '').trim().toUpperCase();
  if (definition.inputUnits.indexOf(enteredUnit) < 0) throw new SiteError('Receipt line ' + (index + 1) + ' has an invalid input unit.');
  let variant = String(input.variant || '').trim();
  if (definition.variants && definition.variants.length && definition.variants.indexOf(variant) < 0) throw new SiteError('Select the steel diameter for receipt line ' + (index + 1) + '.');
  if (!definition.variants || !definition.variants.length) variant = '';
  let factor = 1, steel = null as PreparedLine['steel'], lorry = null as PreparedLine['lorry'];
  if (definition.code === 'STEEL' && enteredUnit === 'BUNDLES') { steel = steelReceiptCalculation(input, variant, index); factor = steel.kg; }
  if (lorryMeasured) {
    if (enteredUnit !== 'CFT') throw new SiteError('Receipt line ' + (index + 1) + ' bulk material must be stored in CFT.');
    lorry = lorryVolumeCalculation(input, index);
  }
  return {
    materialCode: definition.code, materialName: definition.name, category: definition.category, subcategory: definition.subcategory || '',
    variant, enteredQuantity: steel ? steel.totalBars : (lorry ? lorry.volumeCft : quantity),
    enteredUnit: steel ? 'bars' : (lorry ? 'CFT' : enteredUnit.toLowerCase()),
    conversionFactor: steel ? materialRound(steel.kg / steel.totalBars) : factor,
    stockQuantity: steel ? steel.kg : (lorry ? lorry.volumeCft : materialRound(quantity * factor)), stockUnit: definition.stockUnit,
    materialKey: materialKey(definition.code, definition.name, variant, definition.stockUnit),
    remarks: dprText(input.remarks, 'Receipt line ' + (index + 1) + ' remarks', 500, false), steel, lorry,
  };
}

// ---------- company-wide GRN numbers ----------

export function grnProjectCode(project: Row): string {
  const raw = String(project.Project_Number || project.Project_ID || 'PROJECT').trim().toUpperCase();
  return raw.replace(/[^A-Z0-9]+/g, '').slice(0, 18) || 'PROJECT';
}

export async function findGrnByRequest(s: Site, requestId: any): Promise<Row | null> {
  return (await s.find('GRN_Register', 'Request_ID', String(requestId || ''))) || null;
}

/** A reserved number is never reused: GRN-<project>-<company-wide sequence>. */
export async function reserveCompanyGrn(s: Site, project: Row, requestId: string, receivedDate: string, meta: Row, lineCount: number, userEmail: string): Promise<Row> {
  const existing = await findGrnByRequest(s, requestId);
  if (existing) return existing;
  const register = await s.read('GRN_Register');
  const lastSequence = register.length ? Number(register[register.length - 1].GRN_Sequence || 0) : 0;
  const sequence = Math.max(lastSequence, Number((await s.property('GRN_COMPANY_SEQUENCE')) || 0)) + 1;
  s.setProperty('GRN_COMPANY_SEQUENCE', sequence);
  const grnNo = 'GRN-' + grnProjectCode(project) + '-' + String(sequence).padStart(6, '0');
  const row: Row = {
    GRN_No: grnNo, GRN_Sequence: sequence, Request_ID: requestId, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
    Received_Date: parseDateKey(receivedDate), Received_At: s.now(), Supplier: meta.supplier, Delivery_Note_No: meta.deliveryNoteNo, Invoice_No: meta.invoiceNo,
    Vehicle_No: meta.vehicleNo, Line_Count: lineCount, Status: 'PENDING', Created_At: s.now(), Created_By: userEmail, Committed_At: '',
    Purchase_Mirror_Status: 'PENDING', Purchase_Mirror_Synced_At: '', Quality_Declaration: 'ACCEPTED', Signed_By: userEmail, Signed_At: s.now(),
    Purchase_Notification_Status: 'PENDING', Purchase_Notification_Recipients: '', Purchase_Notified_At: '',
    PO_No: meta.poNo || '', PO_Link_Status: meta.poNo ? 'LINKED' : 'AWAITING PO', Site_GRN_Book_No: meta.siteGrnBookNo || '',
  };
  row._row = await s.append('GRN_Register', row);
  return row;
}

function materialIncomingRows(grn: Row, receiptRows: Row[]): Row[] {
  return (receiptRows || []).map((row) => ({
    GRN_No: grn.GRN_No, GRN_Sequence: grn.GRN_Sequence, Receipt_ID: row.Receipt_ID, Project_ID: row.Project_ID, Project_Number: row.Project_Number, Client: row.Client,
    Received_Date: row.Received_Date, Received_At: grn.Received_At || row.Created_At, Supplier: row.Supplier, Delivery_Note_No: row.Delivery_Note_No,
    Invoice_No: row.Invoice_No, Vehicle_No: row.Vehicle_No, Material_Code: row.Material_Code, Material_Name: row.Material_Name,
    Material_Category: row.Material_Category, Material_Subcategory: row.Material_Subcategory, Variant: row.Variant, Entered_Quantity: row.Entered_Quantity,
    Entered_Unit: row.Entered_Unit, Conversion_Factor: row.Conversion_Factor, Stock_Quantity: row.Stock_Quantity, Stock_Unit: row.Stock_Unit,
    Remarks: row.Remarks, Recorded_By: row.Created_By, Recorded_At: row.Created_At, Steel_Diameter_mm: row.Steel_Diameter_mm,
    Full_Bundles: row.Full_Bundles, Bars_Per_Bundle: row.Bars_Per_Bundle, Loose_Bars: row.Loose_Bars, Bar_Length_Input: row.Bar_Length_Input,
    Bar_Length_Unit: row.Bar_Length_Unit, Total_Bars: row.Total_Bars, Total_Length_m: row.Total_Length_m, Calculated_Steel_kg: row.Calculated_Steel_kg,
    Measurement_Method: row.Measurement_Method, Dimension_Unit: row.Dimension_Unit, Lorry_Length_Input: row.Lorry_Length_Input,
    Lorry_Width_Input: row.Lorry_Width_Input, Depth_Readings_Input: row.Depth_Readings_Input, Average_Depth_Input: row.Average_Depth_Input,
    Lorry_Length_ft: row.Lorry_Length_ft, Lorry_Width_ft: row.Lorry_Width_ft, Average_Depth_ft: row.Average_Depth_ft,
    Calculated_Volume_CFT: row.Calculated_Volume_CFT, Quality_Declaration: row.Quality_Declaration, Signed_By: row.Signed_By, Signed_At: row.Signed_At,
  }));
}

export async function ensureMaterialIncomingForGrn(s: Site, grn: Row, receiptRows: Row[], knownNew?: boolean): Promise<number> {
  if (knownNew === true) {
    const rows = materialIncomingRows(grn, receiptRows);
    if (rows.length) await s.appendMany('Material_Incoming', rows);
    return rows.length;
  }
  const existing = await s.filter('Material_Incoming', (row) => String(row.GRN_No || '') === String(grn.GRN_No || ''));
  const existingReceipts: Record<string, boolean> = {};
  existing.forEach((row) => { existingReceipts[String(row.Receipt_ID || '')] = true; });
  const missing = materialIncomingRows(grn, receiptRows).filter((row) => !existingReceipts[String(row.Receipt_ID || '')]);
  if (missing.length) await s.appendMany('Material_Incoming', missing);
  return missing.length;
}

/** Queue a GRN for the single consolidated same-day Purchase digest. */
export async function notifyPurchaseOfGrn(s: Site, grn: Row) {
  if (!grn || !grn.GRN_No) return {status: 'SKIPPED'};
  await s.update('GRN_Register', 'GRN_No', grn.GRN_No, {Purchase_Notification_Status: 'PENDING DAILY DIGEST', Purchase_Notification_Recipients: '', Purchase_Notified_At: ''});
  return {status: 'QUEUED'};
}

/**
 * Post receipt lines to the stock ledger under a reserved GRN (shared by the plain GRN and the
 * PO-linked GRN in grn.ts). Returns the rows written.
 */
export async function postGrnStock(s: Site, project: Row, grn: Row, requestId: string, receivedDate: string, meta: Row, lines: Array<PreparedLine & {poLineId?: string; poNo?: string}>, userEmail: string) {
  const balances = await materialBalanceRows(s, project.Project_ID);
  const byKey: Record<string, Row> = {};
  balances.forEach((row) => { byKey[String(row.Material_Key || '')] = row; });
  const newBalanceRows: Row[] = [];
  lines.forEach((line) => {
    if (byKey[line.materialKey]) return;
    const definition = {code: line.materialCode, name: line.materialName, category: line.category, subcategory: line.subcategory || '', stockUnit: line.stockUnit};
    const row = materialBalanceRecord(s, project, definition, line.variant, 0, 'CREATED BY FIRST GRN');
    newBalanceRows.push(row); byKey[line.materialKey] = row;
  });
  for (const row of newBalanceRows) row._row = await s.append('Material_Balances', row);
  const receiptRows: Row[] = [], ledgerRows: Row[] = [], running: Record<string, number> = {};
  lines.forEach((line) => {
    const balance = byKey[line.materialKey];
    const before = Object.prototype.hasOwnProperty.call(running, line.materialKey) ? running[line.materialKey] : Number(balance.Balance_Quantity || 0);
    const after = materialRound(before + line.stockQuantity);
    running[line.materialKey] = after;
    const receiptId = shortId('MR-'), transactionId = shortId('MTX-');
    receiptRows.push({
      Receipt_ID: receiptId, Request_ID: requestId, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
      Received_Date: parseDateKey(receivedDate), Supplier: meta.supplier, Delivery_Note_No: meta.deliveryNoteNo, Invoice_No: meta.invoiceNo, Vehicle_No: meta.vehicleNo,
      Material_Key: line.materialKey, Material_Code: line.materialCode, Material_Name: line.materialName, Material_Category: line.category,
      Material_Subcategory: line.subcategory || '', Variant: line.variant, Entered_Quantity: line.enteredQuantity, Entered_Unit: line.enteredUnit,
      Conversion_Factor: line.conversionFactor, Stock_Quantity: line.stockQuantity, Stock_Unit: line.stockUnit, Remarks: line.remarks,
      Status: 'PENDING', Created_At: s.now(), Created_By: userEmail, Reversed_At: '', Reversed_By: '', Reversal_Reason: '',
      GRN_No: grn.GRN_No, GRN_Sequence: grn.GRN_Sequence,
      Steel_Diameter_mm: line.steel ? line.steel.diameterMm : '', Full_Bundles: line.steel ? line.steel.fullBundles : '',
      Bars_Per_Bundle: line.steel ? line.steel.barsPerBundle : '', Loose_Bars: line.steel ? line.steel.looseBars : '',
      Bar_Length_Input: line.steel ? line.steel.barLength : '', Bar_Length_Unit: line.steel ? line.steel.barLengthUnit : '',
      Total_Bars: line.steel ? line.steel.totalBars : '', Total_Length_m: line.steel ? line.steel.totalLengthM : '',
      Calculated_Steel_kg: line.steel ? line.steel.kg : '', Measurement_Method: line.lorry ? line.lorry.method : '',
      Dimension_Unit: line.lorry ? line.lorry.dimensionUnit : '', Lorry_Length_Input: line.lorry ? line.lorry.lengthInput : '',
      Lorry_Width_Input: line.lorry ? line.lorry.widthInput : '', Depth_Readings_Input: line.lorry ? line.lorry.depthReadings.join(', ') : '',
      Average_Depth_Input: line.lorry ? line.lorry.averageDepthInput : '', Lorry_Length_ft: line.lorry ? line.lorry.lengthFt : '',
      Lorry_Width_ft: line.lorry ? line.lorry.widthFt : '', Average_Depth_ft: line.lorry ? line.lorry.averageDepthFt : '',
      Calculated_Volume_CFT: line.lorry ? line.lorry.volumeCft : '', Quality_Declaration: 'ACCEPTED', Signed_By: userEmail, Signed_At: s.now(),
      PO_Line_ID: line.poLineId || '', PO_No: line.poNo || '', Site_GRN_Book_No: meta.siteGrnBookNo || '',
    });
    ledgerRows.push({
      Transaction_ID: transactionId, Request_ID: requestId, Project_ID: project.Project_ID, Transaction_Date: parseDateKey(receivedDate),
      Transaction_Type: 'RECEIPT', Source_Type: 'GRN', Source_ID: receiptId, Material_Key: line.materialKey, Material_Code: line.materialCode,
      Material_Name: line.materialName, Variant: line.variant, Quantity_Change: line.stockQuantity, Stock_Unit: line.stockUnit,
      Balance_After: after, Remarks: meta.deliveryNoteNo || line.remarks, Created_At: s.now(), Created_By: userEmail,
    });
  });
  for (const row of receiptRows) row._row = await s.append('Material_Receipts', row);
  for (const row of ledgerRows) row._row = await s.append('Material_Ledger', row);
  const balanceUpdates: Array<{record: Row; changes: Row}> = [];
  Object.keys(running).forEach((key) => {
    const balance = byKey[key];
    const received = lines.filter((l) => l.materialKey === key).reduce((sum, l) => sum + l.stockQuantity, 0);
    const last = ledgerRows.filter((row) => row.Material_Key === key).slice(-1)[0];
    const changes = {
      Total_Received: materialRound(Number(balance.Total_Received || 0) + received), Balance_Quantity: running[key],
      Status: materialStatus(running[key], balance.Low_Stock_Threshold), Last_Transaction_ID: last.Transaction_ID, Last_Transaction_At: last.Created_At,
      Updated_At: s.now(), Updated_By: userEmail,
    };
    balanceUpdates.push({record: balance, changes});
    Object.assign(balance, changes);
  });
  await s.updateBatch('Material_Balances', balanceUpdates);
  await s.updateBatch('Material_Receipts', receiptRows.map((row) => ({record: row, changes: {Status: 'COMMITTED'}})));
  receiptRows.forEach((row) => { row.Status = 'COMMITTED'; });
  await ensureMaterialIncomingForGrn(s, grn, receiptRows, true);
  const grnChanges = {Status: 'COMMITTED', Committed_At: s.now(), Purchase_Mirror_Status: 'SYNCED', Purchase_Mirror_Synced_At: s.now(), Purchase_Notification_Status: 'PENDING DAILY DIGEST'};
  await s.updateBatch('GRN_Register', [{record: grn, changes: grnChanges}]);
  Object.assign(grn, grnChanges);
  return {receiptRows, ledgerRows, balanceRows: Object.keys(running).map((key) => byKey[key])};
}

/**
 * Goods received without a purchase order (the QC app's GRN). Purchase must link it to a PO
 * before anything is paid (see grn.ts linkGrnToPo).
 */
export async function recordMaterialReceipt(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  await ensureProjectMaterialBalances(s, project);
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid GRN request. Reload and retry.');
  const receivedDate = dateKey(payload.receivedDate);
  if (!isValidDateKey(receivedDate) || receivedDate > s.todayKey()) throw new SiteError('Received date must be today or an earlier valid date.');
  const inputs = Array.isArray(payload.lines) ? payload.lines : [];
  if (!inputs.length || inputs.length > 30) throw new SiteError('Add between 1 and 30 GRN material lines.');
  const lines: PreparedLine[] = [];
  for (let i = 0; i < inputs.length; i++) lines.push(await prepareReceiptLine(s, inputs[i], i, false));
  if (payload.qualityDeclarationAccepted !== true) throw new SiteError('Digital signing is required. Confirm that you verified the received quality and Bilara standards.');
  const meta = {
    supplier: dprText(payload.supplier, 'Supplier / vendor', 160, true),
    deliveryNoteNo: dprText(payload.deliveryNoteNo, 'Vendor delivery note number', 100, false),
    invoiceNo: dprText(payload.invoiceNo, 'Invoice number', 100, false),
    vehicleNo: dprText(payload.vehicleNo, 'Vehicle number', 60, true),
    siteGrnBookNo: dprText(payload.siteGrnBookNo, 'Site GRN book number', 60, false),
  };
  const duplicateRows = await s.filter('Material_Receipts', (row) => String(row.Request_ID || '') === requestId);
  if (duplicateRows.length) {
    const existingGrn = (await findGrnByRequest(s, requestId)) || {GRN_No: duplicateRows[0].GRN_No, GRN_Sequence: duplicateRows[0].GRN_Sequence};
    if (payload.fastResponse === true) return clientSafe({committed: true, duplicate: true, requiresRefresh: true, lastRecordedGrn: String(existingGrn.GRN_No || ''), purchaseMirrorStatus: 'SYNCED'});
    const duplicateWorkspace: any = await getMaterialInventoryWorkspace(s, payload.projectId);
    duplicateWorkspace.lastRecordedGrn = String(existingGrn.GRN_No || '');
    return duplicateWorkspace;
  }
  const grn = await reserveCompanyGrn(s, project, requestId, receivedDate, meta, lines.length, user.email);
  const posted = await postGrnStock(s, project, grn, requestId, receivedDate, meta, lines, user.email);
  await s.audit('MATERIAL_GRN_RECORDED', 'PROJECT', project.Project_ID, '', requestId, {
    grnNo: grn.GRN_No, lineCount: lines.length, receivedDate, supplier: meta.supplier, deliveryNoteNo: meta.deliveryNoteNo,
    recordedBy: user.email, digitallySigned: true, purchaseOrder: 'AWAITING PO',
  });
  await notifyPurchaseOfGrn(s, grn);
  if (payload.fastResponse === true) {
    return clientSafe({
      committed: true, lastRecordedGrn: String(grn.GRN_No || ''), purchaseMirrorStatus: 'SYNCED',
      receipts: posted.receiptRows.map(materialClientReceipt), balances: posted.balanceRows.map(materialClientBalance), ledger: posted.ledgerRows.map(ledgerClient),
    });
  }
  const workspace: any = await getMaterialInventoryWorkspace(s, payload.projectId);
  workspace.lastRecordedGrn = String(grn.GRN_No || '');
  return workspace;
}

// ---------- thresholds, opening stock, reconciliation ----------

export async function saveMaterialThresholds(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertProjectAccess(s, user, payload.projectId);
  const thresholds = Array.isArray(payload.thresholds) ? payload.thresholds : [];
  if (!thresholds.length || thresholds.length > 100) throw new SiteError('No material thresholds were supplied.');
  const map: Record<string, Row> = {};
  (await materialBalanceRows(s, payload.projectId)).forEach((row) => { map[String(row.Material_Key || '')] = row; });
  const prepared = thresholds.map((item: any) => {
    const row = map[String(item.materialKey || '')];
    if (!row) throw new SiteError('A material threshold refers to an unknown project material. Reload and retry.');
    return {row, threshold: dprNumber(item.threshold, row.Material_Name + ' low-stock threshold', false)};
  });
  for (const item of prepared) {
    await s.update('Material_Balances', 'Balance_ID', item.row.Balance_ID, {
      Low_Stock_Threshold: item.threshold, Status: materialStatus(item.row.Balance_Quantity, item.threshold), Updated_At: s.now(), Updated_By: user.email,
    });
  }
  await s.audit('MATERIAL_THRESHOLDS_UPDATED', 'PROJECT', payload.projectId, '', 'UPDATED', {count: prepared.length});
  return getMaterialInventoryWorkspace(s, payload.projectId);
}

async function prepareOpeningStockLine(s: Site, input: any, index: number) {
  const label = 'Opening stock line ' + (index + 1);
  const code = String(input.materialCode || '').trim().toUpperCase();
  let definition: any = null;
  if (code === 'MISC') {
    const name = dprText(input.materialName, label + ' material name', 150, true);
    const unit = dprText(input.stockUnit, label + ' stock unit', 40, true);
    if (MATERIAL_MISC_UNITS.indexOf(unit) < 0) throw new SiteError(label + ' has an unsupported stock unit.');
    definition = {code: 'MISC', name, category: 'OTHER', subcategory: '', stockUnit: unit, variants: []};
  } else {
    definition = await materialDefinition(s, code);
    if (!definition) throw new SiteError(label + ' refers to an unknown material. Reload and retry.');
  }
  const variant = String(input.variant || '').trim();
  const variants = definition.variants || [];
  if (variants.length && variants.indexOf(variant) < 0) throw new SiteError(label + ' requires a valid variant or steel diameter.');
  if (!variants.length && variant) throw new SiteError(label + ' cannot have a variant.');
  const quantity = dprNumber(input.quantity, label + ' verified quantity', false);
  if (!(quantity > 0)) throw new SiteError(label + ' verified quantity must be greater than zero.');
  const threshold = dprNumber(input.threshold || 0, label + ' low-stock threshold', false);
  return {definition, variant, quantity: materialRound(quantity), threshold: materialRound(threshold), key: materialKey(definition.code, definition.name, variant, definition.stockUnit)};
}

/** PM/Admin-only one-time physical baseline for material already present on site. */
export async function recordInitialSiteStock(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid initial stock request.');
  if (payload.siteEngineerVerified !== true) throw new SiteError('Confirm that the opening stock was physically verified with the site engineer.');
  const verifiedBy = dprText(payload.verifiedBy, 'Site engineer verifier name', 150, true);
  const notes = dprText(payload.notes, 'Opening stock verification notes', 500, true);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length || lines.length > 100) throw new SiteError('Add at least one and no more than 100 opening-stock lines.');
  const prepared = [];
  for (let i = 0; i < lines.length; i++) prepared.push(await prepareOpeningStockLine(s, lines[i], i));
  const uniqueKeys: Record<string, boolean> = {};
  prepared.forEach((line) => {
    if (uniqueKeys[line.key]) throw new SiteError('The same material appears more than once in the opening-stock list.');
    uniqueKeys[line.key] = true;
  });
  const duplicate = (await s.filter('Material_Ledger', (row) => String(row.Project_ID || '') === String(payload.projectId) && String(row.Request_ID || '') === requestId)).length > 0;
  if (!duplicate) {
    const balanceMap: Record<string, Row> = {};
    (await materialBalanceRows(s, payload.projectId)).forEach((row) => { balanceMap[String(row.Material_Key || '')] = row; });
    const additions: Row[] = [];
    prepared.forEach((line) => {
      const balance = balanceMap[line.key];
      if (balance) {
        const hasMovement = Math.abs(Number(balance.Opening_Quantity || 0)) > 0 || Math.abs(Number(balance.Total_Received || 0)) > 0 ||
          Math.abs(Number(balance.Total_Consumed || 0)) > 0 || Math.abs(Number(balance.Total_Adjusted || 0)) > 0 || Math.abs(Number(balance.Balance_Quantity || 0)) > 0;
        if (hasMovement) throw new SiteError(line.definition.name + (line.variant ? ' ' + line.variant : '') + ' already has stock history. Use Stock reconciliation after a physical count instead of resetting its opening baseline.');
      } else additions.push(materialBalanceRecord(s, project, line.definition, line.variant, 0, 'NEW ZERO BALANCE'));
    });
    if (additions.length) await s.appendMany('Material_Balances', additions);
    additions.forEach((b) => { balanceMap[String(b.Material_Key || '')] = b; });
    const verifiedAt = s.now();
    for (const line of prepared) {
      const balance = balanceMap[line.key];
      const transactionId = shortId('MTX-');
      const remarks = 'Verified opening site stock — checked with ' + verifiedBy + '. ' + notes;
      await s.append('Material_Ledger', {
        Transaction_ID: transactionId, Request_ID: requestId, Project_ID: payload.projectId, Transaction_Date: verifiedAt, Transaction_Type: 'OPENING',
        Source_Type: 'PM VERIFIED BASELINE', Source_ID: balance.Balance_ID, Material_Key: balance.Material_Key, Material_Code: balance.Material_Code,
        Material_Name: balance.Material_Name, Variant: balance.Variant, Quantity_Change: line.quantity, Stock_Unit: balance.Stock_Unit,
        Balance_After: line.quantity, Remarks: remarks, Created_At: verifiedAt, Created_By: user.email,
      });
      await s.update('Material_Balances', 'Balance_ID', balance.Balance_ID, {
        Opening_Quantity: line.quantity, Balance_Quantity: line.quantity, Low_Stock_Threshold: line.threshold, Status: materialStatus(line.quantity, line.threshold),
        Last_Transaction_ID: transactionId, Last_Transaction_At: verifiedAt, Updated_At: verifiedAt, Updated_By: user.email,
        Baseline_Source: 'PM VERIFIED SITE COUNT', Opening_Verified_By: verifiedBy, Opening_Verified_At: verifiedAt, Opening_Set_By: user.email, Opening_Set_At: verifiedAt,
      });
    }
    await s.audit('INITIAL_SITE_STOCK_RECORDED', 'PROJECT', payload.projectId, '', '', {
      lineCount: prepared.length, verifiedBy, notes, requestId,
      materials: prepared.map((line) => ({materialKey: line.key, quantity: line.quantity, unit: line.definition.stockUnit, threshold: line.threshold})),
    });
  }
  return getMaterialInventoryWorkspace(s, payload.projectId);
}

export async function reconcileMaterialBalance(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertProjectAccess(s, user, payload.projectId);
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid stock reconciliation request.');
  const actual = dprNumber(payload.actualBalance, 'Actual stock count', false);
  const reason = dprText(payload.reason, 'Stock reconciliation reason', 500, true);
  const duplicate = (await s.filter('Material_Ledger', (row) => String(row.Project_ID || '') === String(payload.projectId) && String(row.Request_ID || '') === requestId)).length > 0;
  if (duplicate) return getMaterialInventoryWorkspace(s, payload.projectId);
  const balance = (await materialBalanceRows(s, payload.projectId)).find((row) => String(row.Material_Key || '') === String(payload.materialKey || ''));
  if (!balance) throw new SiteError('Material balance not found. Reload and retry.');
  const delta = materialRound(actual - Number(balance.Balance_Quantity || 0));
  const transactionId = shortId('MTX-');
  await s.append('Material_Ledger', {
    Transaction_ID: transactionId, Request_ID: requestId, Project_ID: payload.projectId, Transaction_Date: s.now(), Transaction_Type: 'STOCK RECONCILIATION',
    Source_Type: 'STOCKTAKE', Source_ID: balance.Balance_ID, Material_Key: balance.Material_Key, Material_Code: balance.Material_Code,
    Material_Name: balance.Material_Name, Variant: balance.Variant, Quantity_Change: delta, Stock_Unit: balance.Stock_Unit,
    Balance_After: actual, Remarks: reason, Created_At: s.now(), Created_By: user.email,
  });
  await s.update('Material_Balances', 'Balance_ID', balance.Balance_ID, {
    Total_Adjusted: materialRound(Number(balance.Total_Adjusted || 0) + delta), Balance_Quantity: actual,
    Status: materialStatus(actual, balance.Low_Stock_Threshold), Last_Transaction_ID: transactionId,
    Last_Transaction_At: s.now(), Updated_At: s.now(), Updated_By: user.email,
  });
  await s.audit('MATERIAL_STOCK_RECONCILED', 'PROJECT', payload.projectId, balance.Balance_Quantity, actual, {materialKey: balance.Material_Key, reason});
  return getMaterialInventoryWorkspace(s, payload.projectId);
}

// ---------- DPR material usage ----------

export async function materialRowsForDpr(s: Site, project: Row) {
  return (await ensureProjectMaterialBalances(s, project)).map((row) => ({
    code: String(row.Material_Code || ''), name: String(row.Material_Name || ''), variant: String(row.Variant || ''),
    sizeMm: /^\d+\s*mm$/i.test(String(row.Variant || '')) ? Number(String(row.Variant).match(/\d+/)![0]) : '',
    unit: String(row.Stock_Unit || ''), materialKey: String(row.Material_Key || ''),
    balanceQuantity: Number(row.Balance_Quantity || 0), threshold: Number(row.Low_Stock_Threshold || 0), status: String(row.Status || ''),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.variant.localeCompare(b.variant));
}

/**
 * Deduct a DPR's material usage. The whole submission is checked before the first movement;
 * usage above the balance is refused. (Because a site action is saved all-or-nothing, a later
 * failure leaves no movement behind, so the old rollback rows are no longer needed.)
 */
export async function applyDprMaterialConsumption(s: Site, project: Row, dprId: string, workDate: string, preparedMaterials: any[], existingByKey: Record<string, Row>, userEmail: string, requestId: string) {
  const byKey: Record<string, Row> = {};
  (await materialBalanceRows(s, project.Project_ID)).forEach((row) => { byKey[String(row.Material_Key || '')] = row; });
  const applied: any[] = [];
  const changes = preparedMaterials.map((material) => {
    const balance = byKey[material.definition.materialKey];
    if (!balance) throw new SiteError('Inventory balance is missing for ' + material.definition.name + '. Reload and retry.');
    const previous = existingByKey[material.definition.materialKey];
    const previousUsed = previous ? Number(previous.Used_Quantity || 0) : 0;
    const deltaUsed = materialRound(material.usedQuantity - previousUsed);
    const newBalance = materialRound(Number(balance.Balance_Quantity || 0) - deltaUsed);
    if (newBalance < 0) {
      throw new SiteError(material.definition.name + (material.definition.variant ? ' ' + material.definition.variant : '') +
        ' usage exceeds available stock by ' + Math.abs(newBalance) + ' ' + balance.Stock_Unit + '. Record the GRN or reconcile the stock count first.');
    }
    material.balanceBefore = materialRound(Number(balance.Balance_Quantity || 0) + previousUsed);
    material.balanceAfter = newBalance;
    return {material, balance, deltaUsed, newBalance};
  });
  for (const change of changes) {
    const {material, balance, deltaUsed, newBalance} = change;
    if (deltaUsed === 0) continue;
    const transactionId = shortId('MTX-');
    await s.append('Material_Ledger', {
      Transaction_ID: transactionId, Request_ID: requestId, Project_ID: project.Project_ID, Transaction_Date: parseDateKey(workDate),
      Transaction_Type: deltaUsed > 0 ? 'CONSUMPTION' : 'CONSUMPTION CORRECTION', Source_Type: 'DPR', Source_ID: dprId,
      Material_Key: balance.Material_Key, Material_Code: balance.Material_Code, Material_Name: balance.Material_Name, Variant: balance.Variant,
      Quantity_Change: -deltaUsed, Stock_Unit: balance.Stock_Unit, Balance_After: newBalance,
      Remarks: 'DPR material usage for ' + workDate, Created_At: s.now(), Created_By: userEmail,
    });
    applied.push({balanceId: balance.Balance_ID, materialKey: balance.Material_Key, deltaUsed, transactionId, balanceUpdated: true});
    await s.update('Material_Balances', 'Balance_ID', balance.Balance_ID, {
      Total_Consumed: materialRound(Number(balance.Total_Consumed || 0) + deltaUsed), Balance_Quantity: newBalance,
      Status: materialStatus(newBalance, balance.Low_Stock_Threshold), Last_Transaction_ID: transactionId, Last_Transaction_At: s.now(),
      Updated_At: s.now(), Updated_By: userEmail,
    });
    balance.Balance_Quantity = newBalance;
    balance.Total_Consumed = materialRound(Number(balance.Total_Consumed || 0) + deltaUsed);
    material.inventoryTransactionId = transactionId;
  }
  return applied;
}

// ---------- GIN (material sent from another site) ----------

export async function findGinByRequest(s: Site, requestId: any): Promise<Row | null> {
  return (await s.find('GIN_Register', 'Request_ID', String(requestId || ''))) || null;
}

async function reserveCompanyGin(s: Site, project: Row, requestId: string, receivedDate: string, meta: Row, lineCount: number, userEmail: string): Promise<Row> {
  const existing = await findGinByRequest(s, requestId);
  if (existing) return existing;
  const register = await s.read('GIN_Register');
  const lastSequence = register.length ? Number(register[register.length - 1].GIN_Sequence || 0) : 0;
  const sequence = Math.max(lastSequence, Number((await s.property('GIN_COMPANY_SEQUENCE')) || 0)) + 1;
  s.setProperty('GIN_COMPANY_SEQUENCE', sequence);
  const ginNo = 'GIN-' + grnProjectCode(project) + '-' + String(sequence).padStart(6, '0');
  const signedAt = s.now();
  const row: Row = {
    GIN_No: ginNo, GIN_Sequence: sequence, Request_ID: requestId, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
    Received_Date: parseDateKey(receivedDate), Received_At: signedAt, Source_Site: meta.sourceSite, Transfer_Note_No: meta.transferNoteNo, Vehicle_No: meta.vehicleNo,
    Line_Count: lineCount, Status: 'PENDING', Created_At: signedAt, Created_By: userEmail, Committed_At: '', Quality_Declaration: 'ACCEPTED', Signed_By: userEmail, Signed_At: signedAt,
  };
  row._row = await s.append('GIN_Register', row);
  return row;
}

export async function recordMaterialGin(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a receiving project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Receiving project not found.');
  await ensureProjectMaterialBalances(s, project);
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid GIN request. Reload and retry.');
  const receivedDate = dateKey(payload.receivedDate);
  if (!isValidDateKey(receivedDate) || receivedDate > s.todayKey()) throw new SiteError('Received date must be today or an earlier valid date.');
  if (payload.qualityDeclarationAccepted !== true) throw new SiteError('Digital signing is required. Confirm that you verified the transferred quality and Bilara standards.');
  const inputs = Array.isArray(payload.lines) ? payload.lines : [];
  if (!inputs.length || inputs.length > 30) throw new SiteError('Add between 1 and 30 GIN material lines.');
  const lines: PreparedLine[] = [];
  for (let i = 0; i < inputs.length; i++) lines.push(await prepareReceiptLine(s, inputs[i], i, true));
  const meta = {
    sourceSite: dprText(payload.sourceSite, 'Source site', 180, true),
    transferNoteNo: dprText(payload.transferNoteNo, 'Transfer note number', 100, true),
    vehicleNo: dprText(payload.vehicleNo, 'Vehicle number', 60, true),
  };
  let savedGin: Row | null = null, committedBalances: Row[] = [];
  const duplicate = await findGinByRequest(s, requestId);
  if (duplicate && String(duplicate.Status || '').toUpperCase() === 'COMMITTED') savedGin = duplicate;
  else {
    const gin = duplicate || await reserveCompanyGin(s, project, requestId, receivedDate, meta, lines.length, user.email);
    const byKey: Record<string, Row> = {};
    (await materialBalanceRows(s, payload.projectId)).forEach((row) => { byKey[String(row.Material_Key || '')] = row; });
    const additions: Row[] = [];
    lines.forEach((line) => {
      if (byKey[line.materialKey]) return;
      const balance = materialBalanceRecord(s, project, {code: line.materialCode, name: line.materialName, category: line.category, stockUnit: line.stockUnit}, line.variant, 0, 'CREATED BY FIRST GIN');
      additions.push(balance); byKey[line.materialKey] = balance;
    });
    for (const b of additions) b._row = await s.append('Material_Balances', b);
    const receipts: Row[] = [], ledger: Row[] = [], running: Record<string, number> = {}, signedAt = s.now();
    lines.forEach((line) => {
      const balance = byKey[line.materialKey];
      const before = Object.prototype.hasOwnProperty.call(running, line.materialKey) ? running[line.materialKey] : Number(balance.Balance_Quantity || 0);
      const after = materialRound(before + line.stockQuantity);
      running[line.materialKey] = after;
      const receiptId = shortId('GINR-'), transactionId = shortId('MTX-');
      receipts.push({
        GIN_Receipt_ID: receiptId, GIN_No: gin.GIN_No, GIN_Sequence: gin.GIN_Sequence, Request_ID: requestId, Project_ID: project.Project_ID,
        Project_Number: project.Project_Number, Client: project.Client, Received_Date: parseDateKey(receivedDate), Source_Site: meta.sourceSite,
        Transfer_Note_No: meta.transferNoteNo, Vehicle_No: meta.vehicleNo, Material_Key: line.materialKey, Material_Code: line.materialCode,
        Material_Name: line.materialName, Material_Category: line.category, Variant: line.variant, Entered_Quantity: line.enteredQuantity,
        Entered_Unit: line.enteredUnit, Conversion_Factor: line.conversionFactor, Stock_Quantity: line.stockQuantity, Stock_Unit: line.stockUnit,
        Remarks: line.remarks, Steel_Diameter_mm: line.steel ? line.steel.diameterMm : '', Full_Bundles: line.steel ? line.steel.fullBundles : '',
        Bars_Per_Bundle: line.steel ? line.steel.barsPerBundle : '', Loose_Bars: line.steel ? line.steel.looseBars : '',
        Bar_Length_Input: line.steel ? line.steel.barLength : '', Bar_Length_Unit: line.steel ? line.steel.barLengthUnit : '',
        Total_Bars: line.steel ? line.steel.totalBars : '', Total_Length_m: line.steel ? line.steel.totalLengthM : '', Calculated_Steel_kg: line.steel ? line.steel.kg : '',
        Quality_Declaration: 'ACCEPTED', Signed_By: user.email, Signed_At: signedAt, Status: 'PENDING', Created_At: signedAt, Created_By: user.email,
      });
      ledger.push({
        Transaction_ID: transactionId, Request_ID: requestId, Project_ID: project.Project_ID, Transaction_Date: parseDateKey(receivedDate),
        Transaction_Type: 'RECEIPT', Source_Type: 'GIN', Source_ID: receiptId, Material_Key: line.materialKey, Material_Code: line.materialCode,
        Material_Name: line.materialName, Variant: line.variant, Quantity_Change: line.stockQuantity, Stock_Unit: line.stockUnit, Balance_After: after,
        Remarks: 'From ' + meta.sourceSite + ' / ' + meta.transferNoteNo, Created_At: signedAt, Created_By: user.email,
      });
    });
    for (const r of receipts) r._row = await s.append('GIN_Receipts', r);
    await s.appendMany('Material_Ledger', ledger);
    const balanceUpdates: Array<{record: Row; changes: Row}> = [];
    Object.keys(running).forEach((key) => {
      const balance = byKey[key];
      const received = lines.filter((l) => l.materialKey === key).reduce((sum, l) => sum + l.stockQuantity, 0);
      const last = ledger.filter((row) => row.Material_Key === key).slice(-1)[0];
      const changes = {Total_Received: materialRound(Number(balance.Total_Received || 0) + received), Balance_Quantity: running[key],
        Status: materialStatus(running[key], balance.Low_Stock_Threshold), Last_Transaction_ID: last.Transaction_ID, Last_Transaction_At: last.Created_At,
        Updated_At: s.now(), Updated_By: user.email};
      balanceUpdates.push({record: balance, changes});
      Object.assign(balance, changes);
    });
    await s.updateBatch('Material_Balances', balanceUpdates);
    await s.updateBatch('GIN_Receipts', receipts.map((row) => ({record: row, changes: {Status: 'COMMITTED'}})));
    await s.update('GIN_Register', 'GIN_No', gin.GIN_No, {Status: 'COMMITTED', Committed_At: s.now()});
    await s.audit('MATERIAL_GIN_RECORDED', 'PROJECT', project.Project_ID, '', requestId, {ginNo: gin.GIN_No, sourceSite: meta.sourceSite, lineCount: lines.length, digitallySigned: true});
    savedGin = gin;
    committedBalances = Object.keys(running).map((key) => byKey[key]);
  }
  if (payload.fastResponse === true && savedGin) {
    return clientSafe({committed: true, lastRecordedGin: String(savedGin.GIN_No || ''), purchaseMirrorStatus: 'SYNCED', receipts: [], balances: committedBalances.map(materialClientBalance), ledger: []});
  }
  const workspace: any = await getMaterialInventoryWorkspace(s, payload.projectId);
  workspace.lastRecordedGin = String(savedGin && savedGin.GIN_No || '');
  return workspace;
}

// ---------- site assets ----------

function lengthToFeet(value: any, unit: any): number {
  const number = Number(value || 0);
  const normalized = String(unit || '').trim().toUpperCase();
  if (!(number >= 0)) throw new SiteError('Length must be zero or greater.');
  if (normalized === 'FT') return materialRound(number);
  if (normalized === 'M') return materialRound(number * 3.280839895);
  throw new SiteError('Length unit must be feet or metres.');
}

function prepareAssetRecord(input: any, index: number) {
  const label = 'Asset line ' + (index + 1);
  const type = String(input.assetType || '').trim().toUpperCase();
  if (['MOBILIZATION_KIT', 'COLUMN_BOX', 'WOOD_RUNNER', 'WOODEN_PLANK', 'OTHER'].indexOf(type) < 0) throw new SiteError(label + ' has an invalid asset type.');
  const name = dprText(input.itemName, label + ' item name', 120, true);
  const pieces = dprNumber(input.pieceCount, label + ' number of pieces', false);
  if (!Number.isInteger(pieces) || pieces <= 0) throw new SiteError(label + ' number of pieces must be a whole number greater than 0.');
  const unit = String(input.dimensionUnit || 'FT').trim().toUpperCase();
  let lengthInput = 0, widthInput = 0, lengthFt = 0, widthFt = 0;
  if (type === 'COLUMN_BOX' || type === 'WOOD_RUNNER' || type === 'WOODEN_PLANK') {
    lengthInput = dprNumber(input.length, label + ' length', false);
    if (lengthInput <= 0) throw new SiteError(label + ' length must be greater than 0.');
    lengthFt = lengthToFeet(lengthInput, unit);
  }
  if (type === 'COLUMN_BOX' || type === 'WOODEN_PLANK') {
    widthInput = dprNumber(input.width, label + ' width', false);
    if (widthInput <= 0) throw new SiteError(label + ' width must be greater than 0.');
    widthFt = lengthToFeet(widthInput, unit);
  }
  return {
    category: type === 'MOBILIZATION_KIT' ? 'MOBILIZATION KIT' : 'SITE ASSET', assetType: type, itemName: name, pieces,
    inputLength: lengthInput || '', inputWidth: widthInput || '', inputUnit: (lengthInput || widthInput) ? unit : '',
    lengthFt: lengthFt || '', widthFt: widthFt || '', totalRft: lengthFt ? materialRound(pieces * lengthFt) : '',
    totalSqFt: lengthFt && widthFt ? materialRound(pieces * lengthFt * widthFt) : '', remarks: dprText(input.remarks, label + ' remarks', 500, false),
  };
}

export async function recordSiteAssetSnapshot(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  const asOfDate = dateKey(payload.asOfDate);
  if (!isValidDateKey(asOfDate) || asOfDate > s.todayKey()) throw new SiteError('Asset date must be today or an earlier valid date.');
  const inputs = Array.isArray(payload.assets) ? payload.assets : [];
  if (!inputs.length || inputs.length > 100) throw new SiteError('Add between 1 and 100 asset lines.');
  const prepared = inputs.map(prepareAssetRecord);
  const snapshotId = shortId('AST-'), recordedAt = s.now();
  await s.appendMany('Site_Asset_Records', prepared.map((item: any) => ({
    Asset_Record_ID: shortId('ASR-'), Snapshot_ID: snapshotId, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
    As_Of_Date: parseDateKey(asOfDate), Category: item.category, Asset_Type: item.assetType, Item_Name: item.itemName, Piece_Count: item.pieces,
    Input_Length: item.inputLength, Input_Width: item.inputWidth, Input_Unit: item.inputUnit, Length_ft: item.lengthFt, Width_ft: item.widthFt,
    Total_RFT: item.totalRft, Total_SqFt: item.totalSqFt, Remarks: item.remarks, Recorded_At: recordedAt, Recorded_By: user.email,
  })));
  await s.audit('SITE_ASSET_SNAPSHOT_RECORDED', 'PROJECT', project.Project_ID, '', snapshotId, {lineCount: prepared.length, asOfDate});
  return getMaterialInventoryWorkspace(s, payload.projectId);
}

// ---------- wastage ----------

export function calculateSteelWasteLine(input: any, index: number) {
  const label = 'Steel wastage line ' + (index + 1);
  const diameter = dprNumber(input.diameterMm, label + ' diameter', false);
  const pieces = dprNumber(input.pieceCount, label + ' number of pieces', false);
  const length = dprNumber(input.lengthPerPiece, label + ' length per piece', false);
  const unit = String(input.lengthUnit || '').trim().toUpperCase();
  if (diameter <= 0) throw new SiteError(label + ' diameter must be greater than 0 mm.');
  if (!Number.isInteger(pieces) || pieces <= 0) throw new SiteError(label + ' number of pieces must be a whole number greater than 0.');
  if (length <= 0) throw new SiteError(label + ' length per piece must be greater than 0.');
  if (unit !== 'M' && unit !== 'FT') throw new SiteError(label + ' length unit must be metres or feet.');
  const totalInput = pieces * length;
  const totalM = unit === 'M' ? totalInput : totalInput * 0.3048;
  const totalFt = unit === 'FT' ? totalInput : totalInput * 3.280839895;
  const weight = unit === 'M' ? (diameter * diameter / 162) * totalInput : (diameter * diameter / 533) * totalInput;
  return {diameter, pieces, length, unit, totalInput: materialRound(totalInput), totalFt: materialRound(totalFt), totalM: materialRound(totalM),
    weightKg: materialRound(weight), formula: unit === 'M' ? 'd^2/162 × total metres' : 'd^2/533 × total feet', remarks: dprText(input.remarks, label + ' remarks', 500, false)};
}

/** Checks that a wastage entry made from a DPR belongs to that DPR's project and date. */
async function checkSourceDpr(s: Site, payload: any, wasteDate: string): Promise<string> {
  const sourceDprId = String(payload.sourceDprId || '').trim();
  if (sourceDprId) {
    const sourceDpr = await s.find('DPR_Daily', 'DPR_ID', sourceDprId);
    if (!sourceDpr || String(sourceDpr.Project_ID || '') !== String(payload.projectId) || dateKey(sourceDpr.Work_Date) !== wasteDate) {
      throw new SiteError('The wastage entry does not match this DPR project and work date. Reload and retry.');
    }
  }
  return sourceDprId;
}

export async function recordDailySteelWastage(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  const wasteDate = dateKey(payload.wasteDate);
  if (!isValidDateKey(wasteDate) || wasteDate > s.todayKey()) throw new SiteError('Wastage date must be today or an earlier valid date.');
  await checkSourceDpr(s, payload, wasteDate);
  const inputs = Array.isArray(payload.lines) ? payload.lines : [];
  if (!inputs.length || inputs.length > 100) throw new SiteError('Add between 1 and 100 steel-wastage lines.');
  const prepared = inputs.map(calculateSteelWasteLine);
  const batchId = shortId('WSB-'), recordedAt = s.now();
  await s.appendMany('Steel_Wastage_Daily', prepared.map((item: any) => ({
    Waste_Record_ID: shortId('WSR-'), Waste_Batch_ID: batchId, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client,
    Waste_Date: parseDateKey(wasteDate), Diameter_mm: item.diameter, Piece_Count: item.pieces, Length_Per_Piece_Input: item.length, Length_Unit: item.unit,
    Total_Length_Input: item.totalInput, Total_Length_ft: item.totalFt, Total_Length_m: item.totalM, Calculated_Weight_kg: item.weightKg,
    Formula_Used: item.formula, Remarks: item.remarks, Recorded_At: recordedAt, Recorded_By: user.email,
  })));
  await s.audit('STEEL_WASTAGE_RECORDED', 'PROJECT', project.Project_ID, '', batchId, {wasteDate, totalKg: materialRound(prepared.reduce((sum: number, item: any) => sum + item.weightKg, 0))});
  return getMaterialInventoryWorkspace(s, payload.projectId);
}

async function prepareMaterialWasteLine(s: Site, input: any, index: number) {
  const label = 'Wastage line ' + (index + 1);
  const code = String(input.materialCode || '').trim().toUpperCase();
  const reason = dprText(input.reason, label + ' reason', 500, true);
  const remarks = dprText(input.remarks, label + ' remarks', 500, false);
  if (code === 'STEEL') {
    const variant = String(input.variant || '').trim();
    const definition = await materialDefinition(s, code);
    if (!definition || (definition.variants || []).indexOf(variant) < 0) throw new SiteError('Select the steel diameter for ' + label.toLowerCase() + '.');
    const calculated = calculateSteelWasteLine({diameterMm: steelDiameterMm(variant), pieceCount: input.pieceCount, lengthPerPiece: input.lengthPerPiece, lengthUnit: input.lengthUnit, remarks}, index);
    return {materialCode: definition.code, materialName: definition.name, category: definition.category, variant,
      materialKey: materialKey(definition.code, definition.name, variant, definition.stockUnit), enteredQuantity: calculated.pieces, enteredUnit: 'pieces',
      wasteQuantity: calculated.weightKg, stockUnit: definition.stockUnit, reason, remarks, steel: calculated};
  }
  if (code === 'MISC') {
    const name = dprText(input.materialName, label + ' other material name', 120, true);
    const unit = String(input.inputUnit || '').trim();
    if (MATERIAL_MISC_UNITS.indexOf(unit) < 0) throw new SiteError(label + ' has an invalid unit.');
    const quantity = dprNumber(input.quantity, label + ' quantity', false);
    if (quantity <= 0) throw new SiteError(label + ' quantity must be greater than 0.');
    return {materialCode: 'MISC', materialName: name, category: 'MISCELLANEOUS', variant: '', materialKey: materialKey('MISC', name, '', unit),
      enteredQuantity: quantity, enteredUnit: unit, wasteQuantity: materialRound(quantity), stockUnit: unit, reason, remarks, steel: null};
  }
  const definition = await materialDefinition(s, code);
  if (!definition || definition.ginOnly) throw new SiteError(label + ' has an invalid material.');
  const unit = String(input.inputUnit || '').trim().toUpperCase();
  if (definition.inputUnits.indexOf(unit) < 0) throw new SiteError(label + ' has an invalid unit.');
  const quantity = dprNumber(input.quantity, label + ' quantity', false);
  if (quantity <= 0) throw new SiteError(label + ' quantity must be greater than 0.');
  return {materialCode: definition.code, materialName: definition.name, category: definition.category, variant: '',
    materialKey: materialKey(definition.code, definition.name, '', definition.stockUnit), enteredQuantity: quantity, enteredUnit: unit.toLowerCase(),
    wasteQuantity: materialRound(quantity), stockUnit: definition.stockUnit, reason, remarks, steel: null};
}

export async function recordDailyMaterialWastage(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC', 'ADMIN']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  await ensureProjectMaterialBalances(s, project);
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid wastage request. Reload and retry.');
  const wasteDate = dateKey(payload.wasteDate);
  if (!isValidDateKey(wasteDate) || wasteDate > s.todayKey()) throw new SiteError('Wastage date must be today or an earlier valid date.');
  // Fixed: the QC app referred to sourceDprId here without defining it, so every save failed.
  const sourceDprId = await checkSourceDpr(s, payload, wasteDate);
  const inputs = Array.isArray(payload.lines) ? payload.lines : [];
  if (!inputs.length || inputs.length > 100) throw new SiteError('Add between 1 and 100 wastage lines.');
  const prepared: any[] = [];
  for (let i = 0; i < inputs.length; i++) prepared.push(await prepareMaterialWasteLine(s, inputs[i], i));
  let batchId = '';
  const duplicates = await s.filter('Material_Wastage_Daily', (row) => String(row.Project_ID || '') === String(payload.projectId) && String(row.Request_ID || '') === requestId);
  if (duplicates.length) batchId = String(duplicates[0].Waste_Batch_ID || '');
  else {
    const byKey: Record<string, Row> = {};
    (await materialBalanceRows(s, payload.projectId)).forEach((row) => { byKey[String(row.Material_Key || '')] = row; });
    const running: Record<string, number> = {};
    prepared.forEach((item, index) => {
      const balance = byKey[item.materialKey];
      if (!balance) throw new SiteError('Wastage line ' + (index + 1) + ' is not in this site inventory. Record its GRN/GIN or reconcile opening stock first.');
      const available = Object.prototype.hasOwnProperty.call(running, item.materialKey) ? running[item.materialKey] : Number(balance.Balance_Quantity || 0);
      if (item.wasteQuantity > available + 0.0001) throw new SiteError('Wastage line ' + (index + 1) + ' exceeds available stock. Available: ' + materialRound(available) + ' ' + balance.Stock_Unit + '.');
      running[item.materialKey] = materialRound(available - item.wasteQuantity);
    });
    batchId = shortId('WST-');
    const recordedAt = s.now();
    const wasteRows: Row[] = prepared.map((item) => {
      const steel = item.steel;
      return {
        Waste_Record_ID: shortId('WSR-'), Waste_Batch_ID: batchId, Request_ID: requestId, Project_ID: project.Project_ID, Project_Number: project.Project_Number,
        Client: project.Client, Waste_Date: parseDateKey(wasteDate), Material_Key: item.materialKey, Material_Code: item.materialCode,
        Material_Name: item.materialName, Material_Category: item.category, Variant: item.variant, Entered_Quantity: item.enteredQuantity,
        Entered_Unit: item.enteredUnit, Waste_Quantity: item.wasteQuantity, Stock_Unit: item.stockUnit,
        Steel_Diameter_mm: steel ? steel.diameter : '', Steel_Piece_Count: steel ? steel.pieces : '', Steel_Length_Per_Piece: steel ? steel.length : '',
        Steel_Length_Unit: steel ? steel.unit : '', Steel_Total_Length_ft: steel ? steel.totalFt : '', Steel_Total_Length_m: steel ? steel.totalM : '',
        Steel_Formula: steel ? steel.formula : '', Reason: item.reason, Remarks: item.remarks, Status: 'PENDING', Recorded_At: recordedAt,
        Recorded_By: user.email, Committed_At: '', Source_DPR_ID: sourceDprId, Entry_Source: sourceDprId ? 'DPR' : 'SITE MATERIALS',
      };
    });
    await s.appendMany('Material_Wastage_Daily', wasteRows);
    const ledgerRunning: Record<string, number> = {};
    const ledgerRows = wasteRows.map((row) => {
      const before = Object.prototype.hasOwnProperty.call(ledgerRunning, row.Material_Key) ? ledgerRunning[row.Material_Key] : Number(byKey[row.Material_Key].Balance_Quantity || 0);
      const after = materialRound(before - Number(row.Waste_Quantity || 0));
      ledgerRunning[row.Material_Key] = after;
      return {
        Transaction_ID: shortId('MTX-'), Request_ID: requestId, Project_ID: project.Project_ID, Transaction_Date: parseDateKey(wasteDate), Transaction_Type: 'WASTAGE',
        Source_Type: 'DAILY WASTAGE', Source_ID: row.Waste_Record_ID, Material_Key: row.Material_Key, Material_Code: row.Material_Code,
        Material_Name: row.Material_Name, Variant: row.Variant, Quantity_Change: -Number(row.Waste_Quantity || 0), Stock_Unit: row.Stock_Unit,
        Balance_After: after, Remarks: row.Reason + (row.Remarks ? ' — ' + row.Remarks : ''), Created_At: recordedAt, Created_By: user.email,
      };
    });
    await s.appendMany('Material_Ledger', ledgerRows);
    for (const key of Object.keys(running)) {
      const balance = byKey[key];
      const wasted = prepared.filter((item) => item.materialKey === key).reduce((sum, item) => sum + item.wasteQuantity, 0);
      const last = ledgerRows.filter((row) => row.Material_Key === key).slice(-1)[0];
      await s.update('Material_Balances', 'Balance_ID', balance.Balance_ID, {
        Total_Consumed: materialRound(Number(balance.Total_Consumed || 0) + wasted), Balance_Quantity: running[key],
        Status: materialStatus(running[key], balance.Low_Stock_Threshold), Last_Transaction_ID: last.Transaction_ID, Last_Transaction_At: recordedAt,
        Updated_At: recordedAt, Updated_By: user.email,
      });
    }
    for (const row of wasteRows) await s.update('Material_Wastage_Daily', 'Waste_Record_ID', row.Waste_Record_ID, {Status: 'COMMITTED', Committed_At: s.now()});
    await s.audit('MATERIAL_WASTAGE_RECORDED', 'PROJECT', project.Project_ID, '', batchId, {
      wasteDate, lineCount: prepared.length, recordedBy: user.email, sourceDprId, entrySource: sourceDprId ? 'DPR' : 'SITE MATERIALS',
      quantities: prepared.map((item) => item.materialName + ' ' + item.variant + ': ' + item.wasteQuantity + ' ' + item.stockUnit),
    });
  }
  const workspace: any = await getMaterialInventoryWorkspace(s, payload.projectId);
  workspace.lastRecordedWasteBatch = batchId;
  return workspace;
}

export async function siteOpsWorkspace(s: Site, projectId: any) {
  const ginRows = await s.recentProjectRows('GIN_Receipts', projectId, 100);
  const assetRows = await s.recentProjectRows('Site_Asset_Records', projectId, 500);
  const latestSnapshot = assetRows.length ? String(assetRows[0].Snapshot_ID || '') : '';
  const wasteRows = await s.recentProjectRows('Steel_Wastage_Daily', projectId, 200);
  const materialWasteRows = (await s.recentProjectRows('Material_Wastage_Daily', projectId, 300)).filter((row) => String(row.Status || 'COMMITTED').toUpperCase() === 'COMMITTED');
  const num = (v: any) => (v === '' ? '' : Number(v));
  return {
    ginReceipts: ginRows.map((row) => ({ginNo: String(row.GIN_No || ''), receivedDate: dateKey(row.Received_Date), sourceSite: String(row.Source_Site || ''),
      transferNoteNo: String(row.Transfer_Note_No || ''), vehicleNo: String(row.Vehicle_No || ''), materialName: String(row.Material_Name || ''),
      variant: String(row.Variant || ''), stockQuantity: Number(row.Stock_Quantity || 0), stockUnit: String(row.Stock_Unit || ''), signedBy: String(row.Signed_By || '')})),
    assets: assetRows.filter((row) => String(row.Snapshot_ID || '') === latestSnapshot).reverse().map((row) => ({
      snapshotId: String(row.Snapshot_ID || ''), asOfDate: dateKey(row.As_Of_Date), category: String(row.Category || ''), assetType: String(row.Asset_Type || ''),
      itemName: String(row.Item_Name || ''), pieceCount: Number(row.Piece_Count || 0), lengthFt: num(row.Length_ft), widthFt: num(row.Width_ft),
      totalRft: num(row.Total_RFT), totalSqFt: num(row.Total_SqFt), remarks: String(row.Remarks || '')})),
    steelWastage: wasteRows.map((row) => ({wasteDate: dateKey(row.Waste_Date), diameterMm: Number(row.Diameter_mm || 0), pieceCount: Number(row.Piece_Count || 0),
      totalLengthFt: Number(row.Total_Length_ft || 0), totalLengthM: Number(row.Total_Length_m || 0), weightKg: Number(row.Calculated_Weight_kg || 0), remarks: String(row.Remarks || '')})),
    materialWastage: materialWasteRows.map((row) => ({batchId: String(row.Waste_Batch_ID || ''), wasteDate: dateKey(row.Waste_Date),
      materialName: String(row.Material_Name || ''), variant: String(row.Variant || ''), enteredQuantity: Number(row.Entered_Quantity || 0),
      enteredUnit: String(row.Entered_Unit || ''), wasteQuantity: Number(row.Waste_Quantity || 0), stockUnit: String(row.Stock_Unit || ''),
      diameterMm: num(row.Steel_Diameter_mm), pieceCount: num(row.Steel_Piece_Count), totalLengthFt: num(row.Steel_Total_Length_ft), totalLengthM: num(row.Steel_Total_Length_m),
      reason: String(row.Reason || ''), remarks: String(row.Remarks || ''), recordedBy: String(row.Recorded_By || ''),
      sourceDprId: String(row.Source_DPR_ID || ''), entrySource: String(row.Entry_Source || 'SITE MATERIALS')})),
  };
}

// ---------- admin: rebuild balances from the ledger ----------

export async function auditAndRepairMaterialInventory(s: Site) {
  const admin = s.requireRole(['ADMIN']);
  const ledger = await s.read('Material_Ledger');
  const balances = await s.read('Material_Balances');
  const summary: Record<string, any> = {};
  ledger.forEach((row) => {
    const key = String(row.Project_ID || '') + '||' + String(row.Material_Key || '');
    if (!summary[key]) summary[key] = {opening: 0, received: 0, consumedMovement: 0, adjusted: 0, balance: 0, last: row};
    const item = summary[key];
    const type = String(row.Transaction_Type || '').toUpperCase();
    const change = Number(row.Quantity_Change || 0);
    item.balance += change;
    if (type === 'OPENING') item.opening += change;
    else if (type === 'RECEIPT') item.received += change;
    else if (type === 'STOCK RECONCILIATION') item.adjusted += change;
    else if (['CONSUMPTION', 'CONSUMPTION CORRECTION', 'WASTAGE', 'ROLLBACK'].indexOf(type) >= 0) item.consumedMovement += change;
    if (Number(row._row || 0) > Number(item.last._row || 0)) item.last = row;
  });
  let repaired = 0;
  const findings: string[] = [];
  for (const row of balances) {
    const key = String(row.Project_ID || '') + '||' + String(row.Material_Key || '');
    const item = summary[key] || {opening: 0, received: 0, consumedMovement: 0, adjusted: 0, balance: 0, last: {}};
    const expected = materialRound(item.balance);
    if (Math.abs(expected - Number(row.Balance_Quantity || 0)) <= 0.001) continue;
    findings.push(String(row.Project_Number || row.Project_ID) + ' / ' + row.Material_Name + ' ' + row.Variant + ': ' + row.Balance_Quantity + ' -> ' + expected + ' ' + row.Stock_Unit);
    await s.update('Material_Balances', 'Balance_ID', row.Balance_ID, {
      Opening_Quantity: materialRound(item.opening), Total_Received: materialRound(item.received), Total_Consumed: materialRound(-item.consumedMovement),
      Total_Adjusted: materialRound(item.adjusted), Balance_Quantity: expected, Status: materialStatus(expected, row.Low_Stock_Threshold),
      Last_Transaction_ID: item.last.Transaction_ID || '', Last_Transaction_At: item.last.Created_At || '', Updated_At: s.now(), Updated_By: admin.email,
    });
    repaired++;
  }
  await s.audit('MATERIAL_INVENTORY_AUDIT', 'SYSTEM', 'Material_Balances', '', repaired ? 'REPAIRED' : 'PASSED', {repaired, findings, runBy: admin.email});
  return {repaired, findings, message: repaired
    ? 'Repaired ' + repaired + ' material balance row(s).'
    : 'Material inventory audit passed. ' + balances.length + ' balance row(s) agree with the append-only ledger.'};
}
