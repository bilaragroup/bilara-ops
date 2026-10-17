// Goods received at site, joined with purchasing (decision 3, 15 Oct 2026):
//  - A GRN is normally recorded against the purchase order: the accepted quantity creates the
//    payment schedule exactly as before, and the same receipt is posted to site stock.
//  - Goods that arrive without a PO can still be received (the QC app's GRN). They go into
//    stock, but nothing is paid until Purchase links the GRN to a PO.
//  - Every GRN gets the company-wide number GRN-<project>-<sequence> (decision 5). The paper
//    GRN book number from site can be kept as an optional reference.
import {Actor, visible, inProject} from '@/lib/permissions';
import {decode} from '@/lib/database';
import {acceptedQty, pendingQty, receipts} from '@/lib/grn';
import {planGrn, grnStatements} from '@/lib/grn-plan';
import {Site, Row, SiteError, dateKey, isValidDateKey, clientSafe} from './core';
import {assertSiteOperationsProjectAccess} from './access';
import {dprText, dprNumber, materialRound} from './util';
import {
  ensureProjectMaterialBalances, prepareReceiptLine, reserveCompanyGrn, postGrnStock, notifyPurchaseOfGrn,
  getMaterialInventoryWorkspace, activeGrnMaterialDefinitions, PreparedLine,
} from './materials';

/** Who may record a GRN against a PO: the QC app's GRN roles plus those the purchasing app allowed. */
const PO_GRN_ROLES = ['SITE_ENGINEER', 'QC', 'ADMIN', 'PM', 'PURCHASE'];

const UNIT_ALIASES: Record<string, string> = {
  bag: 'bags', bags: 'bags', no: 'nos', nos: 'nos', 'no.': 'nos', 'nos.': 'nos', number: 'nos', numbers: 'nos', pcs: 'nos', piece: 'pieces', pieces: 'pieces',
  cft: 'cft', 'cu ft': 'cft', 'cu.ft': 'cft', kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  t: 'tonnes', ton: 'tonnes', tons: 'tonnes', tonne: 'tonnes', tonnes: 'tonnes', mt: 'tonnes', set: 'sets', sets: 'sets', sheet: 'sheets', sheets: 'sheets',
};
function normalUnit(u: any): string {
  const k = String(u || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return UNIT_ALIASES[k] || k;
}
/** Factor from a PO unit to a stock unit, or null when they cannot be converted. */
export function unitFactor(poUnit: any, stockUnit: any): number | null {
  const a = normalUnit(poUnit), b = normalUnit(stockUnit);
  if (a && a === b) return 1;
  if (a === 'tonnes' && b === 'kg') return 1000;
  if (a === 'kg' && b === 'tonnes') return 0.001;
  return null;
}

async function purchaseRecords(s: Site) {
  const r = await s.db.prepare('SELECT * FROM records').all();
  return (r.results || []).map(decode);
}

/** Item categories that are hired, not kept in site stock (no stock posting on GRN). */
const NOT_STOCKED = ['rentals', 'rental', 'services', 'tools & equipment'];
export function stockedCategory(category: any) { return !NOT_STOCKED.includes(String(category || '').trim().toLowerCase()); }
function categoryOf(records: any[], p: any) {
  const parent = records.find((r: any) => r.id === p.parent);
  return String(parent?.itemCategory || p.itemCategory || 'Materials');
}
const cleanName = (v: any) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
/** The site stock item a PO line goes into: same name in the item list, else added to it now. */
async function stockCodeFor(s: Site, p: any, category: string): Promise<string> {
  const defs = (await activeGrnMaterialDefinitions(s)).filter((d) => !d.ginOnly);
  const wanted = cleanName(p.item);
  const hit = defs.find((d) => cleanName(d.name) === wanted || cleanName(d.code) === wanted);
  if (hit) return hit.code;
  const slug = String(p.item || 'ITEM').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'ITEM';
  const prefix = /shutter/i.test(category) ? 'SHUTTERING_' : /other/i.test(category) ? 'OTHER_' : 'MATERIAL_';
  let code = prefix + slug, n = 2;
  const all = await s.read('GRN_Item_Master');
  while (all.some((r) => String(r.Item_Code || '').toUpperCase() === code)) code = prefix + slug + '_' + n++;
  const unit = String(p.unit || 'NOS').trim();
  await s.append('GRN_Item_Master', {
    Item_Code: code, Category: category.toUpperCase(), Subcategory: '', Item_Name: String(p.item || '').trim(), Stock_Unit: unit, Input_Units: unit.toUpperCase(),
    Variants: '', Active: 'Yes', Purchase_Notes: 'Added automatically from a GRN', Validation_Status: 'VALID', Validation_Message: '', Last_Imported_At: s.now(),
  });
  (s as any)._grnDefs = null;
  return code;
}

/** Open PO lines for a site, for the Receive goods page. */
export async function getReceiveGoodsWorkspace(s: Site, actor: Actor, projectId: any) {
  const user = s.requireRole(PO_GRN_ROLES);
  await assertSiteOperationsProjectAccess(s, user, projectId);
  const records = await purchaseRecords(s);
  const definitions = (await activeGrnMaterialDefinitions(s)).filter((d) => !d.ginOnly);
  const byName = new Map(definitions.map((d) => [d.name.trim().toLowerCase(), d.code]));
  const lines = records.filter((p: any) => p.kind === 'purchase' && String(p.project) === String(projectId) && visible(actor, p) && inProject(actor, p.project) &&
    p.status !== 'Cancelled' && !p.shortClose && pendingQty(p) > 1e-9)
    .map((p: any) => ({
      id: p.id, version: p.version, po: p.po || '', orderId: p.orderId || p.id, item: p.item, vendor: p.vendor || '', unit: p.unit || '',
      ordered: Number(p.qty || 0), accepted: acceptedQty(p), pending: pendingQty(p), delivery: p.delivery || '',
      suggestedMaterialCode: byName.get(String(p.item || '').trim().toLowerCase()) || '',
      itemCategory: categoryOf(records, p), stocked: stockedCategory(categoryOf(records, p)),
      receipts: receipts(p).map((x: any) => ({grnNo: x.grnNo, date: x.date, accepted: x.accepted, rejected: x.rejected})),
    }));
  const awaiting = (await s.filter('GRN_Register', (g) => String(g.Project_ID) === String(projectId) && String(g.PO_Link_Status || '') === 'AWAITING PO' && String(g.Status) === 'COMMITTED'))
    .map((g) => ({grnNo: String(g.GRN_No), receivedDate: dateKey(g.Received_Date), supplier: String(g.Supplier || ''), lineCount: Number(g.Line_Count || 0)}));
  return clientSafe({
    projectId: String(projectId), poLines: lines, awaitingPo: awaiting,
    materials: definitions.map((d) => ({code: d.code, name: d.name, category: d.category, subcategory: d.subcategory || '', stockUnit: d.stockUnit, inputUnits: d.inputUnits, variants: d.variants || []})),
    today: s.todayKey(),
  });
}

/**
 * Record goods received against a purchase order. One call = one GRN for one PO, saved
 * together with the purchasing receipt and payment schedule, or not at all.
 */
export async function receivePurchaseOrder(s: Site, actor: Actor, payload: any) {
  const user = s.requireRole(PO_GRN_ROLES);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  await ensureProjectMaterialBalances(s, project);
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid GRN request. Reload and retry.');
  const existing = await s.find('GRN_Register', 'Request_ID', requestId);
  if (existing) {
    const ws: any = await getMaterialInventoryWorkspace(s, payload.projectId).catch(() => ({}));
    return {...ws, lastRecordedGrn: String(existing.GRN_No), duplicate: true};
  }
  const receivedDate = dateKey(payload.receivedDate);
  if (!isValidDateKey(receivedDate) || receivedDate > s.todayKey()) throw new SiteError('Received date must be today or an earlier valid date.');
  if (payload.qualityDeclarationAccepted !== true) throw new SiteError('Digital signing is required. Confirm that you verified the received quality and Bilara standards.');
  const inputs: any[] = Array.isArray(payload.poLines) ? payload.poLines : [];
  if (!inputs.length || inputs.length > 30) throw new SiteError('Select between 1 and 30 PO lines.');
  const records = await purchaseRecords(s);
  const lines = inputs.map((input, index) => {
    const p = records.find((r: any) => r.id === input.id && r.kind === 'purchase');
    if (!p) throw new SiteError('PO line ' + (index + 1) + ' was not found. Refresh and try again.');
    if (String(p.project) !== String(payload.projectId)) throw new SiteError('All PO lines must belong to this project.');
    return {p, input};
  });
  const meta = {
    supplier: String(lines[0].p.vendor || '').trim() || dprText(payload.supplier, 'Supplier / vendor', 160, true),
    deliveryNoteNo: dprText(payload.deliveryNoteNo, 'Vendor delivery note number', 100, false),
    invoiceNo: dprText(payload.invoiceNo, 'Invoice number', 100, false),
    vehicleNo: dprText(payload.vehicleNo, 'Vehicle number', 60, true),
    siteGrnBookNo: dprText(payload.siteGrnBookNo, 'Site GRN book number', 60, false),
    poNo: String(lines[0].p.po || ''),
  };
  // Stock lines: the accepted quantity, converted to the stock unit (or measured by bundles / lorry).
  const stockLines: Array<PreparedLine & {poLineId: string; poNo: string}> = [];
  for (let i = 0; i < lines.length; i++) {
    const {p, input} = lines[i];
    const accepted = dprNumber(input.accepted ?? input.received, 'PO line ' + (i + 1) + ' accepted quantity', false);
    if (!(accepted > 0)) continue;
    // Rentals (and other hired items) are received for payment but never enter site stock.
    const category = categoryOf(records, p);
    if (!stockedCategory(category)) continue;
    // The stock item is found from the item name; a new item is added to the list automatically.
    const code = String(input.materialCode || '').trim().toUpperCase() || await stockCodeFor(s, p, category);
    const measured = (code === 'STEEL' && String(input.inputUnit || '').toUpperCase() === 'BUNDLES') || ['AGGREGATE', 'M_SAND', 'P_SAND'].includes(code);
    let quantity: number | undefined;
    if (!measured) {
      const defs = await activeGrnMaterialDefinitions(s);
      const d = defs.find((x) => x.code === code);
      if (!d) throw new SiteError(p.item + ': the chosen stock item is not in the GRN item master.');
      const factor = unitFactor(p.unit, d.stockUnit);
      if (factor === null) {
        quantity = dprNumber(input.stockQuantity, p.item + ': quantity in ' + d.stockUnit, false);
        if (!(quantity > 0)) throw new SiteError(p.item + ': the PO is in ' + p.unit + ' but stock is kept in ' + d.stockUnit + '. Enter the quantity in ' + d.stockUnit + '.');
      } else quantity = materialRound(accepted * factor);
    }
    const prepared = await prepareReceiptLine(s, {...input, materialCode: code, inputUnit: input.inputUnit || (code === 'STEEL' ? 'KG' : undefined) || '', quantity}, i, false)
      .catch(async (e) => {
        // A PO line may name its unit differently from the item master's input units; use the stock unit.
        if (!measured && /invalid input unit/.test(String(e.message))) {
          const d = (await activeGrnMaterialDefinitions(s)).find((x) => x.code === code)!;
          return prepareReceiptLine(s, {...input, materialCode: code, inputUnit: d.inputUnits[0], quantity}, i, false);
        }
        throw e;
      });
    stockLines.push({...prepared, poLineId: p.id, poNo: String(p.po || '')});
  }
  // Reserve the number, then let purchasing check and plan the receipt with it.
  const grn = await reserveCompanyGrn(s, project, requestId, receivedDate, meta, stockLines.length || lines.length, user.email);
  const body = {
    action: 'receive', items: lines.map(({p, input}) => ({id: p.id, version: Number(input.version ?? p.version), received: input.received, accepted: input.accepted ?? input.received, note: input.note || ''})),
    date: receivedDate, challan: meta.deliveryNoteNo, vehicle: meta.vehicleNo, remarks: String(payload.remarks || ''), siteGrnBookNo: meta.siteGrnBookNo,
  };
  const plan = await planGrn(actor, body, s.db, {generatedGrnNo: String(grn.GRN_No)});
  if (!plan.ok) throw new SiteError(plan.error);
  if (stockLines.length) await postGrnStock(s, project, grn, requestId, receivedDate, meta, stockLines, user.email);
  else await s.update('GRN_Register', 'GRN_No', grn.GRN_No, {Status: 'COMMITTED', Committed_At: s.now(), Purchase_Notification_Status: 'PENDING DAILY DIGEST'});
  await s.audit('MATERIAL_GRN_RECORDED', 'PROJECT', project.Project_ID, '', requestId, {
    grnNo: grn.GRN_No, lineCount: lines.length, receivedDate, supplier: meta.supplier, deliveryNoteNo: meta.deliveryNoteNo,
    recordedBy: user.email, digitallySigned: true, purchaseOrder: meta.poNo, siteGrnBookNo: meta.siteGrnBookNo,
  });
  await notifyPurchaseOfGrn(s, grn);
  // The purchasing marker row requires the site version we read; the site save requires that marker.
  const {statements, marker} = grnStatements(s.db, actor, body, plan, {sql: '(SELECT version FROM site_lock WHERE id=1)=?', binds: [await s.version()]});
  s.external = {statements, guard: {sql: 'EXISTS (SELECT 1 FROM history WHERE id=?)', binds: [marker]}};
  return {committed: true, lastRecordedGrn: String(grn.GRN_No), schedules: plan.inserts.length, stockLines: stockLines.length};
}

/**
 * Purchase links a GRN that arrived without a PO to the PO lines it belongs to. This creates the
 * purchasing receipt and the payment schedule for the accepted quantity; stock was already posted
 * when the site received the goods, so it is not posted again.
 */
export async function linkGrnToPo(s: Site, actor: Actor, payload: any) {
  const user = s.requireRole(['PURCHASE', 'ADMIN']);
  const grn = await s.find('GRN_Register', 'GRN_No', String(payload?.grnNo || ''));
  if (!grn) throw new SiteError('GRN not found.');
  if (String(grn.PO_Link_Status || '') !== 'AWAITING PO') throw new SiteError(grn.GRN_No + ' is already linked to ' + (grn.PO_No || 'a purchase order') + '.');
  const inputs: any[] = Array.isArray(payload.poLines) ? payload.poLines : [];
  if (!inputs.length || inputs.length > 30) throw new SiteError('Select the PO lines this GRN belongs to.');
  const records = await purchaseRecords(s);
  const first = records.find((r: any) => r.id === inputs[0].id && r.kind === 'purchase');
  if (!first) throw new SiteError('PO line not found.');
  if (String(first.project) !== String(grn.Project_ID)) throw new SiteError('The PO must be for project ' + grn.Project_ID + '.');
  const body = {
    action: 'receive', items: inputs.map((x) => ({id: x.id, version: Number(x.version), received: x.received ?? x.accepted, accepted: x.accepted, note: x.note || ('Linked by Purchase to ' + grn.GRN_No)})),
    date: dateKey(grn.Received_Date), challan: String(grn.Delivery_Note_No || ''), vehicle: String(grn.Vehicle_No || ''),
    remarks: dprText(payload.remarks, 'Remarks', 500, false), siteGrnBookNo: String(grn.Site_GRN_Book_No || ''),
  };
  const plan = await planGrn(actor, body, s.db, {generatedGrnNo: String(grn.GRN_No)});
  if (!plan.ok) throw new SiteError(plan.error);
  await s.update('GRN_Register', 'GRN_No', grn.GRN_No, {PO_No: String(first.po || ''), PO_Link_Status: 'LINKED', PO_Linked_By: user.email, PO_Linked_At: s.now()});
  await s.updateWhere('Material_Receipts', (r) => String(r.GRN_No) === String(grn.GRN_No), {PO_No: String(first.po || '')});
  await s.audit('GRN_LINKED_TO_PO', 'GRN', grn.GRN_No, 'AWAITING PO', String(first.po || ''), {lines: inputs.length, by: user.email});
  const {statements, marker} = grnStatements(s.db, actor, body, plan, {sql: '(SELECT version FROM site_lock WHERE id=1)=?', binds: [await s.version()]});
  s.external = {statements, guard: {sql: 'EXISTS (SELECT 1 FROM history WHERE id=?)', binds: [marker]}};
  return {linked: true, grnNo: grn.GRN_No, poNo: String(first.po || ''), schedules: plan.inserts.length};
}
