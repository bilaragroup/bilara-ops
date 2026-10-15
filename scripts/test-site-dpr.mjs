// Daily Progress Report converted from the QC app: PM target, Site Engineer morning and end of day
// with photos and material usage, entry window, resubmission, and access by role.
// The figures repeat the day run on the original QC app (83.33% and 80%; stock 300 + 500 − 420 = 380).
// Isolated runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime = await createRuntime(), {mf} = runtime;
let clock = null; // ISO time sent as the server's "now" (local test header)
async function call(route, body, email = 'qa-admin@example.invalid') {
  const headers = {'content-type': 'application/json', 'x-bilara-test-user-email': email, 'x-bilara-test-user-id': email};
  if (clock) headers['x-bilara-test-now'] = clock;
  const res = await mf.dispatchFetch('http://localhost/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const type = res.headers.get('content-type') || '';
  return {status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer(), type};
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
const site = (action, args, email) => call('site', {action, args}, email);
const siteOk = async (action, args, email) => { const r = await site(action, args, email); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.data)); return r.data.value; };
let passed = 0; const pass = (m) => { passed++; console.log('PASS ' + m); };
const PM = 'pm@example.invalid', SE = 'se@example.invalid', SE2 = 'se2@example.invalid', QC = 'qc@example.invalid', GM = 'gm@example.invalid';
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'});
const add = (s, n) => { const x = new Date(s + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const at = (day, hhmm) => new Date(day + 'T' + hhmm + ':00+05:30').toISOString();
// A tiny valid JPEG-like payload (only the data URL format and type are checked).
const photo = (name) => ({name, mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,' + Buffer.from('jpeg-' + name).toString('base64')});

try {
  for (const [email, name, roles] of [[PM, 'Biju PM', ['Project Manager']], [SE, 'Sandeep SE', ['Site Engineer']], [SE2, 'Arjun SE', ['Site Engineer']], [QC, 'Anu QC', ['QC']], [GM, 'Sachin GM', ['GM']]])
    await ok('users', {email, name, roles, projects: [], active: 1, version: 0});
  await ok('projects', {project: '960', name: 'Ajin', site: 'Chalakudy', managerEmail: PM, qcEmail: '', engineerEmails: [SE], active: 1, version: 0});
  await ok('projects', {project: '961', name: 'Thomas Villa', site: 'Aluva', managerEmail: PM, qcEmail: '', engineerEmails: [SE2], active: 1, version: 0});
  await siteOk('recordInitialSiteStock', [{projectId: '960', clientRequestId: 'open-1', siteEngineerVerified: true, verifiedBy: 'Sandeep', notes: 'Count',
    lines: [{materialCode: 'CEMENT', quantity: 40}, {materialCode: 'CEMENT_BLOCK_6_INCH', quantity: 300}]}], PM);
  await siteOk('recordMaterialReceipt', [{projectId: '960', clientRequestId: 'grn-1', receivedDate: today, supplier: 'Blocks Co', vehicleNo: 'KL-1', qualityDeclarationAccepted: true,
    lines: [{materialCode: 'CEMENT_BLOCK_6_INCH', inputUnit: 'NOS', quantity: 500}]}], SE);

  // PM target for today
  let ws = await siteOk('getDprWorkspace', ['960', today], PM);
  assert.equal(ws.permissions.canEditPlan, true); assert.equal(ws.daily, null);
  assert.equal(ws.activityCatalogue.length, 105);
  const plan = {projectId: '960', workDate: today, clientRequestId: 'plan-1', expectedPlanVersion: 0, plannedMasons: 4, plannedLabourers: 4, plannedShiftCode: '8', plannedVendor: 'Ravi labour',
    targets: [
      {activityCategory: 'BRICKWORK', floor: 'GROUND_FLOOR', workStage: 'UP_TO_LINTEL', materialType: '6-inch cement blocks', workArea: 'Living room', measurementType: 'QUANTITY', unit: 'sq ft', plannedTarget: 180, plannedHours: 8, plannedActivityMasons: 2, plannedActivityLabourers: 2, pmRemarks: 'Photo each wall from the door'},
      {activityCategory: 'OTHER', activityNumber: 25, floor: 'GROUND_FLOOR', workArea: 'Front', measurementType: 'PERCENTAGE', plannedTarget: 100, plannedHours: 8, plannedActivityMasons: 2, plannedActivityLabourers: 2, pmRemarks: 'Show shuttering and cover blocks'},
    ]};
  assert.equal((await site('saveDprPlan', [{...plan, targets: [{...plan.targets[0], pmRemarks: ''}]}], PM)).status, 400);
  assert.equal((await site('saveDprPlan', [{...plan, plannedMasons: 2}], PM)).status, 400);
  assert.equal((await site('saveDprPlan', [{...plan, workDate: add(today, -1)}], PM)).status, 400);
  assert.equal((await site('saveDprPlan', [plan], SE)).status, 400);
  ws = await siteOk('saveDprPlan', [plan], PM);
  assert.equal(ws.daily.planVersion, 1); assert.equal(ws.targets.length, 2);
  assert.equal(ws.targets[0].activityName, '6-inch cement blocks brickwork'); assert.equal(ws.targets[0].activityNumber, '21');
  assert.equal(ws.targets[1].activityName, 'Lintel & sunshade concrete - GF'); assert.equal(ws.targets[1].unit, '%');
  assert.equal((await site('saveDprPlan', [{...plan, clientRequestId: 'plan-2'}], PM)).status, 400);
  pass('PM target: brickwork maps to activity 21, other activity 25; photo instructions required; manpower, past dates, roles and stale versions checked');

  // Site Engineer morning
  assert.equal((await site('saveDprEvening', [{projectId: '960', workDate: today, clientRequestId: 'eod-0', wastageReviewed: true, qualityAssuranceAccepted: true, results: []}], SE)).status, 400);
  assert.equal((await site('saveDprMorning', [{projectId: '960', workDate: today, masons: 4, labourers: 4, actualShiftCode: '8', actualVendor: 'Ravi'}], SE2)).status, 400);
  assert.equal((await site('saveDprMorning', [{projectId: '960', workDate: today, masons: 4, labourers: 4, actualShiftCode: '8', actualVendor: 'Ravi'}], QC)).status, 400);
  ws = await siteOk('saveDprMorning', [{projectId: '960', workDate: today, masons: 4, labourers: 4, actualShiftCode: '8', actualVendor: 'Ravi labour', remarks: 'Blocks unloaded at 8 am'}], SE);
  assert.equal(ws.daily.reportStatus, 'MORNING UPDATED');
  ws = await siteOk('getDprWorkspace', ['960', today], PM);
  assert.equal(ws.permissions.canEditPlan, false); assert.match(ws.permissions.lockReason, /locked because the Site Engineer has started/);
  pass('morning headcount by the site engineer only; the PM target locks once the site starts');

  // End of day
  ws = await siteOk('getDprWorkspace', ['960', today], SE);
  const [t1, t2] = ws.targets;
  const blocks = ws.materials.find((m) => m.materialCode === 'CEMENT_BLOCK_6_INCH');
  assert.equal(blocks.balanceQuantity, 800);
  const eod = {projectId: '960', workDate: today, clientRequestId: 'eod-1', wastageReviewed: true, qualityAssuranceAccepted: true, eveningRemarks: 'Good day',
    results: [
      {targetId: t1.targetId, actualActivityMasons: 2, actualActivityLabourers: 2, hoursPerWorker: 8, actualQuantity: 150, outputDescription: 'Walls to sill', shortfallReason: 'Late block delivery'},
      {targetId: t2.targetId, actualActivityMasons: 2, actualActivityLabourers: 2, hoursPerWorker: 8, completionPercent: 80, outputDescription: 'Shuttering and steel done', shortfallReason: 'Concrete tomorrow'}],
    materials: [{materialKey: blocks.materialKey, usedQuantity: 420}],
    activityPhotos: [{targetId: t1.targetId, photos: [photo('a1.jpg'), photo('a2.jpg')]}, {targetId: t2.targetId, photos: [photo('b1.jpg'), photo('b2.jpg')]}],
    materialPhotos: [photo('m1.jpg')]};
  assert.match((await site('saveDprEvening', [{...eod, activityPhotos: [{targetId: t1.targetId, photos: [photo('a1.jpg')]}, eod.activityPhotos[1]]}], SE)).data.error, /at least 2 photos/);
  assert.match((await site('saveDprEvening', [{...eod, materialPhotos: []}], SE)).data.error, /material-balance photo/);
  assert.match((await site('saveDprEvening', [{...eod, materials: [{materialKey: blocks.materialKey, usedQuantity: 900}]}], SE)).data.error, /exceeds available stock/);
  assert.match((await site('saveDprEvening', [{...eod, results: [{...eod.results[0], shortfallReason: ''}, eod.results[1]]}], SE)).data.error, /shortfall reason/);
  assert.match((await site('saveDprEvening', [{...eod, results: [{...eod.results[0], actualActivityMasons: 5}, eod.results[1]]}], SE)).data.error, /cannot exceed the morning/);
  ws = await siteOk('getDprWorkspace', ['960', today], SE);
  assert.equal(ws.materials.find((m) => m.materialCode === 'CEMENT_BLOCK_6_INCH').balanceQuantity, 800);
  pass('end-of-day checks: 2 photos per activity, a material photo, stock, shortfall reason, manpower; refused saves leave stock untouched');

  ws = await siteOk('saveDprEvening', [eod], SE);
  assert.equal(ws.daily.reportStatus, 'SUBMITTED'); assert.equal(ws.daily.submissionVersion, 1);
  const r1 = ws.results.find((r) => r.targetId === t1.targetId), r2 = ws.results.find((r) => r.targetId === t2.targetId);
  assert.equal(r1.achievementPercent, 83.33); assert.equal(r2.achievementPercent, 80);
  assert.equal(ws.materials.find((m) => m.materialCode === 'CEMENT_BLOCK_6_INCH').balanceQuantity, 380);
  assert.equal(ws.daily.workPhotoCount, 4); assert.equal(ws.daily.materialPhotoCount, 1); assert.equal(ws.daily.qualityAssuranceSignedName, 'Sandeep SE');
  assert.equal((await siteOk('saveDprEvening', [eod], SE)).daily.submissionVersion, 1);
  pass('DPR submitted: 83.33% and 80% achievement, blocks 300 + 500 − 420 = 380, 4 work + 1 material photos, signed by the site engineer; a retry is not saved twice');

  // Photos: listed and opened by the right people only
  const list = await siteOk('listSiteFiles', [ws.daily.dayFolderUrl.split('files=')[1] ? decodeURIComponent(ws.daily.dayFolderUrl.split('files=')[1]) : ''], PM);
  assert.equal(list.files.length, 5);
  const file = await call('site?action=siteFile&key=' + encodeURIComponent(list.files[0].key), undefined, PM);
  assert.equal(file.status, 200); assert.ok(file.type.startsWith('image/'));
  assert.equal((await call('site?action=siteFile&key=' + encodeURIComponent(list.files[0].key), undefined, SE2)).status, 403);
  assert.equal((await site('listSiteFiles', ['site/960/dpr/' + today], SE2)).status, 400);
  pass('photos are stored with the DPR and open for the PM, not for another site\'s engineer');

  // Resubmission
  assert.equal((await site('saveDprEvening', [{...eod, clientRequestId: 'eod-2'}], SE)).status, 400);
  ws = await siteOk('requestDprResubmission', [{projectId: '960', workDate: today, reason: 'Wrong block count'}], SE);
  assert.equal(ws.daily.resubmitStatus, 'REQUESTED');
  assert.equal((await site('approveDprResubmission', [{projectId: '960', workDate: today}], SE)).status, 400);
  ws = await siteOk('approveDprResubmission', [{projectId: '960', workDate: today}], PM);
  assert.equal(ws.daily.resubmitStatus, 'APPROVED'); assert.equal(ws.daily.qualityAssuranceAccepted, false);
  ws = await siteOk('saveDprEvening', [{...eod, clientRequestId: 'eod-2', materials: [{materialKey: blocks.materialKey, usedQuantity: 400}], activityPhotos: [], materialPhotos: []}], SE);
  assert.equal(ws.daily.submissionVersion, 2); assert.equal(ws.daily.resubmitStatus, 'USED');
  assert.equal(ws.materials.find((m) => m.materialCode === 'CEMENT_BLOCK_6_INCH').balanceQuantity, 400);
  pass('correction: SE asks, PM approves, SE resubmits (version 2); the stock is corrected by the difference (420 → 400 used, balance 400)');

  // Entry window: work date and the next day only (server clock moved forward)
  clock = at(add(today, 2), '10:00');
  ws = await siteOk('getDprWorkspace', ['960', today], SE).catch(async () => (await site('getDprWorkspace', ['960', today], SE)));
  const late = await site('requestDprResubmission', [{projectId: '960', workDate: today, reason: 'x'}], SE);
  assert.equal(late.status, 400); assert.match(late.data.error, /work date or the following day/);
  clock = null;
  pass('the site can only enter or correct a DPR on the work date or the next day');

  // Site Off day
  const tomorrow = add(today, 1);
  assert.equal((await site('saveDprPlan', [{projectId: '960', workDate: tomorrow, clientRequestId: 'off-1', expectedPlanVersion: 0, siteOff: true, siteOffCategory: 'BAD WEATHER', siteOffReason: ''}], PM)).status, 200);
  clock = at(tomorrow, '09:00');
  const exempt = await site('saveDprMorning', [{projectId: '960', workDate: tomorrow, masons: 1, labourers: 1, actualShiftCode: '8', actualVendor: 'x'}], SE);
  assert.match(exempt.data.error, /marked Site Off/);
  clock = null;
  pass('a Site Off day needs no DPR');

  // Same inputs as the day replayed on the original QC app; every calculated field must match it.
  await siteOk('saveDprPlan', [{projectId: '961', workDate: today, clientRequestId: 'p961', expectedPlanVersion: 0, plannedMasons: 4, plannedLabourers: 4, plannedShiftCode: '8', plannedVendor: 'Ravi labour',
    targets: [
      {activityCategory: 'BRICKWORK', floor: 'GROUND_FLOOR', workStage: 'UP_TO_LINTEL', materialType: '6-inch cement blocks', workArea: 'Living and dining walls', measurementType: 'QUANTITY', unit: 'sq ft', plannedTarget: 180, plannedHours: 8, plannedActivityMasons: 3, plannedActivityLabourers: 3, pmRemarks: 'x'},
      {activityCategory: 'OTHER', activityNumber: 25, floor: 'GROUND_FLOOR', workArea: 'Front sunshade', measurementType: 'PERCENTAGE', plannedTarget: 100, plannedHours: 8, plannedActivityMasons: 1, plannedActivityLabourers: 1, pmRemarks: 'x'}]}], PM);
  await siteOk('saveDprMorning', [{projectId: '961', workDate: today, masons: 4, labourers: 4, actualShiftCode: '8', actualVendor: 'Ravi labour'}], SE2);
  let w = await siteOk('getDprWorkspace', ['961', today], SE2);
  assert.deepEqual(w.targets.map((t) => [t.activityNumber, t.activityName, t.locationRoom, t.plannedWorkerHours]),
    [['21', '6-inch cement blocks brickwork', 'GROUND FLOOR — Living and dining walls', 48], ['25', 'Lintel & sunshade concrete - GF', 'GROUND FLOOR — Front sunshade', 16]]);
  w = await siteOk('saveDprEvening', [{projectId: '961', workDate: today, clientRequestId: 'e961', wastageReviewed: true, qualityAssuranceAccepted: true, materials: [],
    results: [
      {targetId: w.targets[0].targetId, actualActivityMasons: 3, actualActivityLabourers: 3, hoursPerWorker: 8, actualQuantity: 150, outputDescription: 'Ground floor living and dining walls up to sill', shortfallReason: 'Blocks arrived at 11 am, late start'},
      {targetId: w.targets[1].targetId, actualActivityMasons: 1, actualActivityLabourers: 1, hoursPerWorker: 6, completionPercent: 80, reducedHoursReason: 'Concrete mixer breakdown for 2 hours', outputDescription: 'Front sunshade cast except corner return', shortfallReason: 'Mixer breakdown'}],
    activityPhotos: [{targetId: w.targets[0].targetId, photos: [photo('a'), photo('b')]}, {targetId: w.targets[1].targetId, photos: [photo('c'), photo('d')]}], materialPhotos: [photo('m')]}], SE2);
  const pick = (r) => [r.actualQuantity, r.completionPercent, r.achievementPercent, r.plannedHours, r.effectiveHours, r.hourUsePercent, r.timeAdjustedTarget, r.timeAdjustedAchievementPercent,
    r.actualActivityWorkers, r.actualWorkerHours, r.cappedAchievementPercent, r.overtimeHoursPerWorker, r.overtimeWorkerHours];
  assert.deepEqual(pick(w.results.find((r) => r.targetId === w.targets[0].targetId)), [150, 83.33, 83.33, 8, 8, 100, 180, 83.33, 6, 48, 83.33, 0, 0]);
  assert.deepEqual(pick(w.results.find((r) => r.targetId === w.targets[1].targetId)), ['', 80, 80, 8, 6, 75, 75, 106.67, 2, 12, 80, 0, 0]);
  pass('same inputs as the original QC app give the same figures (achievement, time-adjusted target 75 and 106.67%, worker-hours)');

  // GM sees the DPR read-only
  ws = await siteOk('getDprWorkspace', ['960', today], GM);
  assert.equal(ws.permissions.canEditPlan, false); assert.equal(ws.permissions.canEditEvening, false); assert.match(ws.permissions.lockReason, /view-only/);
  pass('GM sees DPRs read-only');

  console.log(`ALL ${passed} SITE DPR CHECKS PASSED`);
} finally { await runtime.dispose(); }
