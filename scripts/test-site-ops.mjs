// GM / management side converted from the QC app: DPR compliance on the Thursday–Wednesday week,
// dashboard periods, labour payables and records, QC office attendance, email times and the
// 5-minute email dispatcher (test mail mode: nothing leaves the machine). Isolated runtime only.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime = await createRuntime(), {mf, db} = runtime;
let clock = null;
async function call(route, body, email = 'qa-admin@example.invalid', extra = {}) {
  const headers = {'content-type': 'application/json', 'x-bilara-test-user-email': email, 'x-bilara-test-user-id': email, ...extra};
  if (clock) headers['x-bilara-test-now'] = clock;
  const res = await mf.dispatchFetch('http://localhost/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const type = res.headers.get('content-type') || '';
  return {status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer()};
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
const site = (action, args, email) => call('site', {action, args}, email);
const siteOk = async (action, args, email) => { const r = await site(action, args, email); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.data)); return r.data.value; };
let passed = 0; const pass = (m) => { passed++; console.log('PASS ' + m); };
const PM = 'pm@example.invalid', SE = 'se@example.invalid', SE2 = 'se2@example.invalid', QC = 'qc@example.invalid', QC2 = 'qc2@example.invalid',
  GM = 'gm@example.invalid', HR = 'hr@example.invalid', LM = 'labour@example.invalid', PUR = 'purchase@example.invalid', AUD = 'audit@example.invalid', ADMIN = 'qa-admin@example.invalid';
const at = (day, hhmm) => new Date(day + 'T' + hhmm + ':00+05:30').toISOString();
const photo = (name) => ({name, mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,' + Buffer.from('jpeg-' + name).toString('base64')});
const mails = async () => (await db.prepare('SELECT * FROM site_notification_log ORDER BY _row').all()).results;

// Wednesday 14 Oct 2026 is the last day of the Thursday 8 – Wednesday 14 week.
const WED = '2026-10-14', THU = '2026-10-15';

try {
  for (const [email, name, roles] of [[PM, 'Biju PM', ['Project Manager']], [SE, 'Sandeep SE', ['Site Engineer']], [SE2, 'Arjun SE', ['Site Engineer']], [QC, 'Anu QC', ['QC']],
    [QC2, 'Bindu QC', ['QC']], [GM, 'Sachin GM', ['GM']], [HR, 'Hari HR', ['HR']], [LM, 'Lal Labour', ['Labour Manager']], [PUR, 'Priya Purchase', ['Purchase Manager']], [AUD, 'Asha Audit', ['Audit']]])
    await ok('users', {email, name, roles, projects: [], active: 1, version: 0});
  await ok('projects', {project: '960', name: 'Ajin', site: 'Chalakudy', managerEmail: PM, qcEmail: '', engineerEmails: [SE], active: 1, version: 0});
  await ok('projects', {project: '961', name: 'Thomas Villa', site: 'Aluva', managerEmail: PM, qcEmail: '', engineerEmails: [SE2], active: 1, version: 0});

  // A full DPR day on project 960; project 961 gets no PM target.
  clock = at('2026-10-13', '18:00');
  await siteOk('recordInitialSiteStock', [{projectId: '960', clientRequestId: 'open-1', siteEngineerVerified: true, verifiedBy: 'Sandeep', notes: 'Count',
    lines: [{materialCode: 'CEMENT_BLOCK_6_INCH', quantity: 800}]}], PM);
  await siteOk('saveDprPlan', [{projectId: '960', workDate: WED, clientRequestId: 'plan-1', expectedPlanVersion: 0, plannedMasons: 4, plannedLabourers: 4, plannedShiftCode: '8', plannedVendor: 'Ravi labour',
    targets: [
      {activityCategory: 'BRICKWORK', floor: 'GROUND_FLOOR', workStage: 'UP_TO_LINTEL', materialType: '6-inch cement blocks', workArea: 'Living room', measurementType: 'QUANTITY', unit: 'sq ft', plannedTarget: 180, plannedHours: 8, plannedActivityMasons: 2, plannedActivityLabourers: 2, pmRemarks: 'Photo each wall'},
      {activityCategory: 'OTHER', activityNumber: 25, floor: 'GROUND_FLOOR', workArea: 'Front', measurementType: 'PERCENTAGE', plannedTarget: 100, plannedHours: 8, plannedActivityMasons: 2, plannedActivityLabourers: 2, pmRemarks: 'Show shuttering'}]}], PM);
  clock = at(WED, '09:00');
  await siteOk('saveDprMorning', [{projectId: '960', workDate: WED, masons: 4, labourers: 4, actualShiftCode: '8', actualVendor: 'Ravi labour'}], SE);
  clock = at(WED, '18:30');
  let ws = await siteOk('getDprWorkspace', ['960', WED], SE);
  const [t1, t2] = ws.targets, blocks = ws.materials.find((m) => m.materialCode === 'CEMENT_BLOCK_6_INCH');
  ws = await siteOk('saveDprEvening', [{projectId: '960', workDate: WED, clientRequestId: 'eod-1', wastageReviewed: true, qualityAssuranceAccepted: true,
    results: [
      {targetId: t1.targetId, actualActivityMasons: 2, actualActivityLabourers: 2, hoursPerWorker: 8, actualQuantity: 150, outputDescription: 'Walls to sill', shortfallReason: 'Late blocks'},
      {targetId: t2.targetId, actualActivityMasons: 2, actualActivityLabourers: 2, hoursPerWorker: 8, completionPercent: 80, outputDescription: 'Shuttering done', shortfallReason: 'Concrete tomorrow'}],
    materials: [{materialKey: blocks.materialKey, usedQuantity: 420}],
    activityPhotos: [{targetId: t1.targetId, photos: [photo('a1.jpg'), photo('a2.jpg')]}, {targetId: t2.targetId, photos: [photo('b1.jpg'), photo('b2.jpg')]}],
    materialPhotos: [photo('m1.jpg')]}], SE);
  assert.equal(ws.daily.reportStatus, 'SUBMITTED');

  // DPR compliance, read the next morning
  clock = at(THU, '10:00');
  assert.equal((await site('getDprComplianceWorkspace', [{workDate: WED}], PM)).status, 400);
  const comp = await siteOk('getDprComplianceWorkspace', [{workDate: WED}], GM);
  const c960 = comp.rows.find((r) => r.Project_ID === '960'), c961 = comp.rows.find((r) => r.Project_ID === '961');
  assert.equal(c960.Compliance_Status, 'FILED ON TIME'); assert.equal(c960.HR_Attendance_Status, 'PRESENT'); assert.equal(c960.Plan_Timing, 'PLANNED AHEAD');
  assert.equal(c961.Compliance_Status, 'PM PLAN MISSING');
  assert.equal(comp.stats.onTime, 1); assert.equal(comp.stats.pmPlanMissing, comp.rows.length - 1); // every other ongoing project assert.equal(comp.stats.onTimeRate, 100);
  assert.equal(comp.week.start, '2026-10-08'); assert.equal(comp.week.end, WED);
  assert.deepEqual(comp.week.days.map((d) => d.date), ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', WED]);
  assert.equal(comp.week.stats.onTime, 1); assert.equal(comp.week.stats.pmPlanMissing, 7 * comp.rows.length - 1);
  const thuComp = await siteOk('getDprComplianceWorkspace', [{workDate: THU}], GM);
  assert.equal(thuComp.week.start, THU); assert.equal(thuComp.week.days.length, 1);
  pass('DPR compliance: 960 filed on time (planned ahead), 961 has no PM target; the week shown is Thursday 8 to Wednesday 14 Oct, and Thursday 15 starts a new week');

  // Dashboard periods
  const dWeek = await siteOk('getOperationsDashboard', [{}], GM);
  assert.equal(dWeek.range.preset, 'WEEK'); assert.equal(dWeek.range.start, THU); assert.equal(dWeek.range.end, THU);
  // The QC app's rolling "last 7 days" week is gone: an old link asking for it gets the Thu–Wed week.
  const d7 = await siteOk('getOperationsDashboard', [{preset: 'LAST_7_DAYS'}], GM);
  assert.equal(d7.range.start, THU); assert.match(d7.range.label, /Thu–Wed/);
  const dPrev = await siteOk('getOperationsDashboard', [{preset: 'WEEK', endDate: WED}], GM);
  assert.equal(dPrev.range.start, '2026-10-08'); assert.equal(dPrev.range.end, WED);
  assert.deepEqual(dPrev.presets.map((p) => p.id), ['DAY', 'WEEK', 'MONTH', 'QUARTER']);
  assert.equal((await site('getOperationsDashboard', [{}], SE)).status, 400);
  pass('dashboard: "This week" is the Thu–Wed week (from Thursday 15 it starts again), the old rolling 7-day week is no longer offered; site engineers cannot open it');

  // Labour payables: cycle Thu 8 – Wed 14, paid Thursday 15
  const lab = await siteOk('getLaborPayablesWorkspace', [{}], GM);
  const week = lab.weekly.find((r) => r.projectId === '960');
  assert.equal(week.cycleStart, '2026-10-08'); assert.equal(week.cycleEnd, WED); assert.equal(week.payoutDate, THU);
  assert.equal(week.vendor, 'Ravi labour'); assert.equal(week.actualWorkerHours, 64);
  // 2 masons × 8 h × ₹150 + 2 helpers × 8 h × ₹125 = ₹4,400 per activity → ₹8,800; productivity (83.33 + 80)/2 = 81.665% (shown 81.66, same rounding as the QC app)
  assert.equal(week.actualHoursPayable, 8800); assert.equal(week.productivityPercent, 81.66); assert.equal(week.targetAdjustedPayable, 7186.52);
  assert.equal(week.withheld, 1613.48);
  const pmLab = await siteOk('getLaborPayablesWorkspace', [{}], PM);
  assert.equal(pmLab.canViewAmounts, false); assert.equal(pmLab.weekly[0].actualHoursPayable, undefined);
  assert.equal((await site('saveGmLaborLeniency', [{payableKey: week.payableKey, recoveryPercent: 50, reason: 'Block delay was the supplier'}], LM)).status, 400);
  const after = await siteOk('saveGmLaborLeniency', [{payableKey: week.payableKey, recoveryPercent: 50, reason: 'Block delay was the supplier'}], GM);
  const w2 = after.weekly.find((r) => r.payableKey === week.payableKey);
  assert.equal(w2.recoveryAmount, 806.74); assert.equal(w2.finalApprovedPayable, 7993.26); assert.equal(w2.gmApprovedBy, GM);
  pass('labour payables: Thu 8 – Wed 14 cycle paid Thursday 15; ₹8,800 at 81.66% = ₹7,186.52; GM releases 50% of the withheld ₹1,613.48; PM sees hours without amounts');

  const rec = await siteOk('getLaborRecords', [{projectId: '960'}], LM);
  assert.equal(rec.rows.length, 2); assert.equal(rec.summary[0].DPR_Days, 1); assert.equal(rec.summary[0].Average_Raw_Target_Achievement_Percent, 81.66);
  assert.equal((await site('getLaborRecords', [{}], SE)).status, 400);
  pass('labour records register (was the Google workbook) is read live from the DPRs');

  // QC office attendance (GM): a booked/blocked QC is not expected at the office
  await db.prepare('INSERT INTO site_qc_booking_dates (Booking_ID, QC_Email, Visit_Date, Day_Sequence, Status, Project_ID) VALUES (?,?,?,?,?,?)')
    .bind('BKG-T1', QC, '2026-10-16T00:00:00+05:30', 1, 'BOOKED', '960').run();
  await db.prepare('INSERT INTO site_qc_unavailability (Unavailability_ID, QC_Email, Date, Type, Status) VALUES (?,?,?,?,?)')
    .bind('UNAV-1', QC2, '2026-10-16T00:00:00+05:30', 'Leave', 'ACTIVE').run();
  await db.prepare('UPDATE site_lock SET version = version + 1 WHERE id = 1').run();
  assert.equal((await site('getAdminAttendanceWorkspace', [2026, 10], ADMIN)).status, 400);
  let att = await siteOk('getAdminAttendanceWorkspace', [2026, 10], GM);
  const day16 = att.officePlan.find((d) => d.date === '2026-10-16');
  assert.deepEqual(day16.expected, ['Bindu QC']);
  assert.ok(!att.officePlan.some((d) => d.date === '2026-10-18'), 'Sunday is never an office day');
  assert.equal(att.register.find((r) => r.date === '2026-10-16').reason, 'Leave');
  assert.equal((await site('saveAttendanceDecision', [{date: '2026-10-16', email: QC, present: true}], GM)).status, 400);
  att = await siteOk('saveAttendanceDecision', [{date: '2026-10-16', email: QC2, present: false, reason: 'Leave', decision: 'REJECTED'}], GM);
  assert.equal(att.register.find((r) => r.date === '2026-10-16' && r.email === QC2).lopStatus, 'LOP');
  assert.deepEqual(att.lopSummary.find((r) => r.email === QC2).lopDates, ['2026-10-16']);
  pass('QC office attendance: the booked QC is on site, the other is expected; Sundays skipped; a rejected absence is loss of pay');

  // Email times (Admin)
  assert.equal((await site('getEmailSchedule', [], GM)).status, 400);
  let sched = await siteOk('getEmailSchedule', [], ADMIN);
  assert.equal(sched.schedules.find((x) => x.id === 'dprFinal').time, '08:30');
  assert.equal((await site('saveEmailSchedule', [{qcOffice: '7pm'}], ADMIN)).status, 400);
  sched = await siteOk('saveEmailSchedule', [{qcOffice: '19:00', lowStock: '19:15', dprReminder: '20:00', dprFinal: '08:30', grnDigest: '19:30', materialDigest: '19:45'}], ADMIN);
  assert.equal(sched.schedules.find((x) => x.id === 'grnDigest').time, '19:30');
  pass('email times are set by the Admin in the app (24-hour HH:mm, India time)');

  // The 5-minute dispatcher
  clock = null;
  assert.equal((await call('site-cron', {}, ADMIN)).status, 403);
  assert.equal((await call('site-cron', {}, ADMIN, {'x-site-cron-secret': 'wrong'})).status, 403);
  clock = at(THU, '08:35');
  const run1 = await ok('site-cron', {}, ADMIN, {'x-site-cron-secret': 'qa-cron-secret'});
  assert.equal(run1.dprFinal.status, 'COMPLETED', JSON.stringify(run1.dprFinal)); assert.equal(run1.dprFinal.date, WED);
  let log = await mails();
  const types = log.map((m) => m.Event_Type);
  assert.ok(types.includes('PM_DAILY_SITE_SUMMARY') && types.includes('MANAGEMENT_DAILY_OPERATIONS_DIGEST') && types.includes('HR_DPR_ATTENDANCE_SUMMARY') && types.includes('LABOR_DAILY_DIGEST'), types.join());
  assert.ok(log.every((m) => m.Status === 'SENT'));
  assert.match(log.find((m) => m.Event_Type === 'MANAGEMENT_DAILY_OPERATIONS_DIGEST').Recipient_Email, /gm@example\.invalid/);
  const count = log.length;
  clock = at(THU, '08:40');
  const run2 = await ok('site-cron', {}, ADMIN, {'x-site-cron-secret': 'qa-cron-secret'});
  assert.equal(run2.dprFinal.alreadyDispatched, true);
  assert.equal((await mails()).length, count);
  clock = at(THU, '10:00');
  const run3 = await ok('site-cron', {}, ADMIN, {'x-site-cron-secret': 'qa-cron-secret'});
  assert.equal(run3.dprFinal.status, 'WINDOW CLOSED');
  pass('dispatcher: at 8:35 am the final DPR emails go to the PM, GM/Admin/Audit, HR and Labour Manager once; a second run sends nothing; after the window nothing is sent');

  clock = at(THU, '20:05');
  const run4 = await ok('site-cron', {}, ADMIN, {'x-site-cron-secret': 'qa-cron-secret'});
  assert.equal(run4.dprReminder.status, 'COMPLETED', JSON.stringify(run4.dprReminder));
  log = await mails();
  assert.ok(log.some((m) => m.Event_Type === 'PM_DPR_10PM_STATUS' && m.Related_Record_ID === THU + '|' + PM));
  assert.ok(log.some((m) => m.Event_Type === 'MANAGEMENT_DPR_EVENING_WARNING'));
  const sched2 = await siteOk('getEmailSchedule', [], ADMIN);
  assert.ok(sched2.lastDispatcherRunAt); assert.ok(sched2.recent.length >= count);
  pass('dispatcher: the 8 pm DPR warning goes to the PM and management; the Admin page shows the last run and recent emails');

  console.log(`\n${passed} checks passed`);
} finally {
  await runtime.dispose();
}
