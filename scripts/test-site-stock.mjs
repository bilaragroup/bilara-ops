// Site stock converted from the QC app: opening stock, GRN with and without a PO, GIN, wastage,
// thresholds, reconciliation, item master, Purchase view, access by role and project.
// Isolated runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime = await createRuntime(), {mf} = runtime;
async function call(route, body, email = 'qa-admin@example.invalid') {
  const res = await mf.dispatchFetch('http://localhost/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', 'x-bilara-test-user-email': email, 'x-bilara-test-user-id': email}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: res.status, data: await res.json()};
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
const site = (action, arg, email) => call('site', {action, args: [arg]}, email);
const siteOk = async (action, arg, email) => { const r = await site(action, arg, email); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r)); return r.data.value; };
const all = async () => (await call('records')).data.records;
const row = async (id) => (await all()).find((r) => r.id === id);
const add = (s, n) => { const x = new Date(s + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'});
function normalWindow(now=new Date()){const add=(s,n)=>{const x=new Date(s+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};const t=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),e=add(t,14),back=(new Date(e+'T00:00:00Z').getUTCDay()+3)%7;return back?add(e,7-back):e;}
let passed = 0; const pass = (m) => { passed++; console.log('PASS ' + m); };
const PM = 'pm@example.invalid', SE = 'se@example.invalid', SE2 = 'se2@example.invalid', QC = 'qc@example.invalid', BOQ = 'boq@example.invalid', BUY = 'buy@example.invalid', AUD = 'audit@example.invalid', GM = 'gm@example.invalid', LAB = 'labour@example.invalid';
let rid = 0; const req = () => 'req-' + (++rid) + '-' + Date.now();
const bal = (ws, code, variant = '') => ws.balances.find((b) => b.materialCode === code && b.variant === variant);

try {
  for (const [email, name, roles] of [[PM, 'QA PM', ['Project Manager']], [SE, 'QA SE', ['Site Engineer']], [SE2, 'Other SE', ['Site Engineer']], [QC, 'QA QC', ['QC']], [BOQ, 'QA BOQ', ['BOQ Team']], [BUY, 'QA Buyer', ['Purchase Manager']], [AUD, 'QA Audit', ['Audit']], [GM, 'QA GM', ['GM']], [LAB, 'QA Labour', ['Labour Manager']]])
    await ok('users', {email, name, roles, projects: [], active: 1, version: 0});
  assert.equal((await call('users', {email: 'two@example.invalid', name: 'Two roles', roles: ['GM', 'Audit'], projects: [], active: 1, version: 0})).status, 400);
  assert.equal((await call('records', undefined, LAB)).status, 403);
  pass('one role per person; site-only roles do not see purchasing records');

  await ok('projects', {project: '960', name: 'Ajin', site: 'Chalakudy', managerEmail: PM, qcEmail: '', engineerEmails: [SE], active: 1, version: 0});
  await ok('projects', {project: '961', name: 'Thomas Villa', site: 'Aluva', managerEmail: PM, qcEmail: '', engineerEmails: [SE2], active: 1, version: 0});

  const boot = await siteOk('bootstrap', undefined, SE);
  assert.equal(boot.user.role, 'SITE_ENGINEER');
  assert.deepEqual(boot.projects.map((p) => p.Project_ID), ['960']);
  assert.deepEqual((await siteOk('bootstrap', undefined, PM)).projects.map((p) => p.Project_ID), ['960', '961']);
  assert.deepEqual((await siteOk('bootstrap', undefined, QC)).siteOperationProjects, []);
  pass('site bootstrap: SE sees their site, PM both, an unassigned QC none');

  let ws = await siteOk('getMaterialInventoryWorkspace', '960', SE);
  assert.ok(bal(ws, 'CEMENT') && bal(ws, 'STEEL', '12 mm'));
  assert.equal(bal(ws, 'CEMENT').balanceQuantity, 0);
  assert.equal(ws.permissions.canReceive, true);
  assert.equal((await site('getMaterialInventoryWorkspace', '961', SE)).status, 400);
  assert.equal((await site('getMaterialInventoryWorkspace', '960', QC)).status, 400);
  pass('Site Materials: standard items start at zero; another site and an unassigned QC are refused');

  // Opening stock by the PM (once)
  assert.equal((await site('recordInitialSiteStock', {projectId: '960', clientRequestId: req(), siteEngineerVerified: true, verifiedBy: 'Sandeep', notes: 'count', lines: [{materialCode: 'CEMENT', quantity: 40}]}, SE)).status, 400);
  ws = await siteOk('recordInitialSiteStock', {projectId: '960', clientRequestId: req(), siteEngineerVerified: true, verifiedBy: 'Sandeep', notes: 'Physical count with SE',
    lines: [{materialCode: 'CEMENT', quantity: 40, threshold: 10}, {materialCode: 'CEMENT_BLOCK_6_INCH', quantity: 300}]}, PM);
  assert.equal(bal(ws, 'CEMENT').balanceQuantity, 40);
  assert.equal(bal(ws, 'CEMENT_BLOCK_6_INCH').balanceQuantity, 300);
  const again = await site('recordInitialSiteStock', {projectId: '960', clientRequestId: req(), siteEngineerVerified: true, verifiedBy: 'x', notes: 'x', lines: [{materialCode: 'CEMENT', quantity: 50}]}, PM);
  assert.equal(again.status, 400); assert.match(again.data.error, /already has stock history/);
  pass('opening stock: PM only, once; afterwards only a reconciliation can change it');

  // GRN without a PO (the QC app's GRN): numbered, stock in, awaiting PO
  const grnNoPo = await siteOk('recordMaterialReceipt', {projectId: '960', clientRequestId: 'grn-a', receivedDate: today, supplier: 'Local blocks', vehicleNo: 'KL-08-1234', deliveryNoteNo: 'DN-9',
    siteGrnBookNo: '0457', qualityDeclarationAccepted: true, lines: [{materialCode: 'CEMENT_BLOCK_6_INCH', inputUnit: 'NOS', quantity: 500}]}, SE);
  assert.equal(grnNoPo.lastRecordedGrn, 'GRN-960-000001');
  assert.equal(bal(grnNoPo, 'CEMENT_BLOCK_6_INCH').balanceQuantity, 800);
  assert.equal(grnNoPo.receipts[0].siteGrnBookNo, '0457');
  const dup = await siteOk('recordMaterialReceipt', {projectId: '960', clientRequestId: 'grn-a', receivedDate: today, supplier: 'Local blocks', vehicleNo: 'KL-08-1234', qualityDeclarationAccepted: true, lines: [{materialCode: 'CEMENT_BLOCK_6_INCH', inputUnit: 'NOS', quantity: 500}]}, SE);
  assert.equal(dup.lastRecordedGrn, 'GRN-960-000001'); assert.equal(bal(dup, 'CEMENT_BLOCK_6_INCH').balanceQuantity, 800);
  assert.equal((await site('recordMaterialReceipt', {projectId: '960', clientRequestId: req(), receivedDate: today, supplier: 'x', vehicleNo: 'x', qualityDeclarationAccepted: true, lines: [{materialCode: 'CEMENT', inputUnit: 'BAGS', quantity: 1}]}, PM)).status, 400);
  assert.equal((await site('recordMaterialReceipt', {projectId: '960', clientRequestId: req(), receivedDate: add(today, 1), supplier: 'x', vehicleNo: 'x', qualityDeclarationAccepted: true, lines: [{materialCode: 'CEMENT', inputUnit: 'BAGS', quantity: 1}]}, SE)).status, 400);
  assert.equal((await site('recordMaterialReceipt', {projectId: '960', clientRequestId: req(), receivedDate: today, supplier: 'x', vehicleNo: 'x', qualityDeclarationAccepted: false, lines: [{materialCode: 'CEMENT', inputUnit: 'BAGS', quantity: 1}]}, SE)).status, 400);
  pass('GRN without a PO: GRN-960-000001, stock 300 → 800, retry is not counted twice; PM, future dates and unsigned GRNs refused');

  // Steel by bundles and sand by lorry measurement
  const steel = await siteOk('recordMaterialReceipt', {projectId: '960', clientRequestId: req(), receivedDate: today, supplier: 'Steel Co', vehicleNo: 'KL-1', qualityDeclarationAccepted: true,
    lines: [{materialCode: 'STEEL', variant: '12 mm', inputUnit: 'BUNDLES', fullBundles: 2, barsPerBundle: 10, looseBars: 2, barLength: 12, barLengthUnit: 'M'},
      {materialCode: 'M_SAND', inputUnit: 'CFT', dimensionUnit: 'FT', lorryLength: 14, lorryWidth: 7, depthReadings: [2, 2.5, 3]}]}, SE);
  // 22 bars × 12 m × 144/162 = 234.667 kg ; 14 × 7 × 2.5 = 245 CFT
  assert.equal(bal(steel, 'STEEL', '12 mm').balanceQuantity, 234.667);
  assert.equal(bal(steel, 'M_SAND').balanceQuantity, 245);
  assert.equal(steel.lastRecordedGrn, 'GRN-960-000002');
  pass('steel by bundles → kg (d²/162) and M-sand by lorry size → CFT, as in the QC app');

  // Wastage (bug fixed: it never saved in the QC app)
  ws = await siteOk('recordDailyMaterialWastage', {projectId: '960', clientRequestId: req(), wasteDate: today, lines: [{materialCode: 'CEMENT_BLOCK_6_INCH', inputUnit: 'NOS', quantity: 20, reason: 'Broken in unloading'}]}, SE);
  assert.equal(bal(ws, 'CEMENT_BLOCK_6_INCH').balanceQuantity, 780);
  assert.equal(ws.materialWastage[0].reason, 'Broken in unloading');
  const over = await site('recordDailyMaterialWastage', {projectId: '960', clientRequestId: req(), wasteDate: today, lines: [{materialCode: 'CEMENT', inputUnit: 'BAGS', quantity: 41, reason: 'x'}]}, SE);
  assert.equal(over.status, 400); assert.match(over.data.error, /exceeds available stock/);
  pass('daily wastage now saves (780 left); wastage above stock is refused');

  // GIN from another site
  ws = await siteOk('recordMaterialGin', {projectId: '960', clientRequestId: req(), receivedDate: today, sourceSite: '961 Thomas Villa', transferNoteNo: 'TN-4', vehicleNo: 'KL-2', qualityDeclarationAccepted: true,
    lines: [{materialCode: 'COLUMN_BOX', inputUnit: 'NOS', quantity: 12}]}, SE);
  assert.equal(ws.lastRecordedGin, 'GIN-960-000001');
  assert.equal(bal(ws, 'COLUMN_BOX').balanceQuantity, 12);
  pass('GIN-960-000001 accepted from another site; site assets get a balance on first receipt');

  // Thresholds and reconciliation (PM)
  ws = await siteOk('saveMaterialThresholds', {projectId: '960', thresholds: [{materialKey: bal(ws, 'CEMENT').materialKey, threshold: 50}]}, PM);
  assert.equal(bal(ws, 'CEMENT').status, 'LOW');
  ws = await siteOk('reconcileMaterialBalance', {projectId: '960', clientRequestId: req(), materialKey: bal(ws, 'CEMENT').materialKey, actualBalance: 38, reason: 'Two bags set hard'}, PM);
  assert.equal(bal(ws, 'CEMENT').balanceQuantity, 38); assert.equal(bal(ws, 'CEMENT').totalAdjusted, -2);
  assert.equal((await site('reconcileMaterialBalance', {projectId: '960', clientRequestId: req(), materialKey: bal(ws, 'CEMENT').materialKey, actualBalance: 1, reason: 'x'}, SE)).status, 400);
  pass('thresholds mark LOW; reconciliation 40 → 38 with a reason; Site Engineer cannot reconcile');

  // GRN against a purchase order: purchasing receipt + payment + stock in one save
  const W = normalWindow();
  const id = (await ok('records', {kind: 'plan', project: '960', item: 'Cement', unit: 'BAGS', milestone: '1', activity: '1', activityName: 'Footing', activityBoqQty: 100, boqQty: 100, owner: 'Jithin', itemCategory: 'Materials', window: W, due: W, requestBatchId: 'g1'}, PM)).id;
  let r = await row(id); await ok('records', {id, version: r.version, boqOriginalRate: 350, targetDiscountPercent: 5, boqOwner: 'Subha'}, BOQ); r = await row(id);
  await ok('gm-approval', {ids: [id], versions: {[id]: r.version}, decision: 'Approved', note: 'ok', confirmed: true}, BOQ);
  r = await row(id); await ok('records', {id, version: r.version, vendor: 'QA Traders', quoteRate: 320, quoteReference: 'Q1', entity: 'GROUP', stage: 'Vendors finalized'}, BUY);
  r = await row(id); await ok('audit-decision', {ids: [id], versions: {[id]: r.version}, decision: 'Approved', note: 'ok', confirmed: true}, AUD);
  r = await row(id); await ok('orders', {orderId: crypto.randomUUID(), items: [{id, version: r.version, qty: 100}], creditDays: 7, exceptionReason: 'QA'}, BUY);
  const po = (await all()).find((x) => x.kind === 'purchase' && x.parent === id);
  const rg = await siteOk('getReceiveGoodsWorkspace', '960', SE);
  const line = rg.poLines.find((l) => l.id === po.id);
  assert.equal(line.pending, 100); assert.equal(line.suggestedMaterialCode, 'CEMENT');
  assert.equal((await site('getReceiveGoodsWorkspace', '961', SE)).status, 400);
  const got = await siteOk('receivePurchaseOrder', {projectId: '960', clientRequestId: 'po-grn-1', receivedDate: today, vehicleNo: 'KL-3', deliveryNoteNo: 'CH-77', siteGrnBookNo: '0458', qualityDeclarationAccepted: true,
    poLines: [{id: po.id, version: po.version, received: 60, accepted: 55, materialCode: 'CEMENT'}]}, SE);
  assert.equal(got.lastRecordedGrn, 'GRN-960-000003'); assert.equal(got.schedules, 1);
  const after = await row(po.id);
  assert.equal(after.acceptedQty, 55); assert.equal(after.receipts[0].grnNo, 'GRN-960-000003'); assert.equal(after.receipts[0].siteGrnBookNo, '0458');
  const pay = (await all()).filter((x) => x.kind === 'payment' && x.parent === po.id && x.basis === 'GRN');
  assert.equal(pay.length, 1); assert.equal(pay[0].total, 55 * 32000);
  ws = await siteOk('getMaterialInventoryWorkspace', '960', SE);
  assert.equal(bal(ws, 'CEMENT').balanceQuantity, 93);
  assert.equal(ws.receipts.find((x) => x.grnNo === 'GRN-960-000003').poNo, after.po);
  pass('GRN against a PO: one number on both sides, 55 bags accepted → payment ₹17,600 and stock 38 → 93, saved together');

  // A stale PO version leaves nothing behind (neither stock nor payment)
  const stale = await site('receivePurchaseOrder', {projectId: '960', clientRequestId: 'po-grn-2', receivedDate: today, vehicleNo: 'KL-3', qualityDeclarationAccepted: true,
    poLines: [{id: po.id, version: po.version, received: 5, accepted: 5, materialCode: 'CEMENT'}]}, SE);
  assert.equal(stale.status, 400);
  ws = await siteOk('getMaterialInventoryWorkspace', '960', SE);
  assert.equal(bal(ws, 'CEMENT').balanceQuantity, 93);
  assert.equal((await all()).filter((x) => x.kind === 'payment' && x.parent === po.id && x.basis === 'GRN').length, 1);
  assert.ok(!(await siteOk('getSitePurchaseWorkspace', {projectId: '960'}, BUY)).followups.some((f) => f.GRN_No === 'GRN-960-000004'));
  pass('a changed PO line refuses the GRN and nothing is half-saved');

  // Purchase links the no-PO GRN to a PO; payment is created only then
  const id2 = (await ok('records', {kind: 'plan', project: '960', item: '6-inch cement blocks', unit: 'NOS', milestone: '2', activity: '21', activityName: 'Brickwork', activityBoqQty: 500, boqQty: 500, owner: 'Jithin', itemCategory: 'Materials', window: W, due: W, requestBatchId: 'g2'}, PM)).id;
  r = await row(id2); await ok('records', {id: id2, version: r.version, boqOriginalRate: 50, targetDiscountPercent: 5, boqOwner: 'Subha'}, BOQ); r = await row(id2);
  await ok('gm-approval', {ids: [id2], versions: {[id2]: r.version}, decision: 'Approved', note: 'ok', confirmed: true}, BOQ);
  r = await row(id2); await ok('records', {id: id2, version: r.version, vendor: 'Local blocks', quoteRate: 45, quoteReference: 'Q2', entity: 'GROUP', stage: 'Vendors finalized'}, BUY);
  r = await row(id2); await ok('audit-decision', {ids: [id2], versions: {[id2]: r.version}, decision: 'Approved', note: 'ok', confirmed: true}, AUD);
  r = await row(id2); await ok('orders', {orderId: crypto.randomUUID(), items: [{id: id2, version: r.version, qty: 500}], creditDays: 0, exceptionReason: 'QA'}, BUY);
  const po2 = (await all()).find((x) => x.kind === 'purchase' && x.parent === id2);
  assert.equal((await site('linkGrnToPo', {grnNo: 'GRN-960-000001', poLines: [{id: po2.id, version: po2.version, accepted: 500}]}, SE)).status, 400);
  let pv = await siteOk('getSitePurchaseWorkspace', {projectId: '960'}, BUY);
  assert.equal(pv.followups.find((f) => f.GRN_No === 'GRN-960-000001').PO_Link_Status, 'AWAITING PO');
  const linked = await siteOk('linkGrnToPo', {grnNo: 'GRN-960-000001', poLines: [{id: po2.id, version: po2.version, received: 500, accepted: 500}]}, BUY);
  assert.equal(linked.schedules, 1); assert.equal(linked.poNo, po2.po);
  ws = await siteOk('getMaterialInventoryWorkspace', '960', SE);
  assert.equal(bal(ws, 'CEMENT_BLOCK_6_INCH').balanceQuantity, 780);
  assert.equal((await site('linkGrnToPo', {grnNo: 'GRN-960-000001', poLines: [{id: po2.id, version: (await row(po2.id)).version, accepted: 1}]}, BUY)).status, 400);
  pass('a GRN without a PO is paid only after Purchase links it; stock is not counted twice');

  // Purchase view and follow-up review
  pv = await siteOk('saveGrnFollowup', {grnNo: 'GRN-960-000003', reviewStatus: 'Verified', invoiceMatch: 'Matched', remarks: 'ok', projectId: '960'}, BUY);
  const f = pv.followups.find((x) => x.GRN_No === 'GRN-960-000003');
  assert.equal(f.Purchase_Review_Status, 'Verified'); assert.equal(f.Purchase_PO_No, after.po);
  assert.ok(pv.arrivals.length >= 4 && pv.balances.length > 10 && pv.summary.length > 10 && pv.wastage.length === 1);
  assert.equal((await site('getSitePurchaseWorkspace', {}, SE)).status, 400);
  pass('Purchase sees arrivals, stock, wastage, summary and the GRN follow-up list live, and records its review');

  // GRN item master: Purchase edits; invalid rows are marked, not offered
  const im = await siteOk('getGrnItemMaster', undefined, BUY);
  const items = im.items.concat([{Category: 'Construction Material', Subcategory: 'plumbing', Item_Name: 'PVC pipe 4 inch', Stock_Unit: 'nos', Input_Units: 'nos', Active: 'Yes'},
    {Category: 'Furniture', Item_Name: 'Chair', Stock_Unit: 'nos', Input_Units: 'nos', Active: 'Yes'}]);
  const saved = await siteOk('saveGrnItemMaster', {items}, BUY);
  assert.equal(saved.invalid, 1);
  assert.equal(saved.items.find((x) => x.Item_Name === 'PVC pipe 4 inch').Item_Code, 'MATERIAL_PVC_PIPE_4_INCH');
  ws = await siteOk('getMaterialInventoryWorkspace', '960', SE);
  const pvc = ws.majorMaterials.find((m) => m.code === 'MATERIAL_PVC_PIPE_4_INCH');
  assert.equal(pvc.subcategory, 'PLUMBING');
  assert.ok(!ws.majorMaterials.some((m) => m.name === 'Chair'));
  assert.equal((await site('saveGrnItemMaster', {items}, SE)).status, 400);
  pass('GRN item master: Purchase adds items (plumbing subcategory kept), invalid rows are marked and not offered');

  // Ledger integrity: the audit finds nothing to repair
  const audit = await siteOk('auditAndRepairMaterialInventory', undefined);
  assert.equal(audit.repaired, 0, JSON.stringify(audit.findings));
  pass('every balance equals the sum of its ledger movements');

  console.log(`ALL ${passed} SITE STOCK CHECKS PASSED`);
} finally { await runtime.dispose(); }
