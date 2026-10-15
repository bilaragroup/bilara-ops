// QC checklists, bookings and inspections converted from the QC app. The first inspection repeats
// the one run on the original QC app (lintel checklist, one minor defect → PARTIALLY COMPLETED,
// QCK-<project>-LINTELANDS-001 → QCI-…-V01), then a re-site visit by a different QC passes it (V02).
// Isolated runtime only; emails are kept in test mode.
import assert from 'node:assert/strict';
import {createRuntime} from './qa-runtime.mjs';

const runtime = await createRuntime(), {mf, db} = runtime;
let clock = null;
async function call(route, body, email = 'qa-admin@example.invalid') {
  const headers = {'content-type': 'application/json', 'x-bilara-test-user-email': email, 'x-bilara-test-user-id': email};
  if (clock) headers['x-bilara-test-now'] = clock;
  const res = await mf.dispatchFetch('http://localhost/api/' + route, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const type = res.headers.get('content-type') || '';
  return {status: res.status, type, data: type.includes('json') ? await res.json() : new TextDecoder().decode(await res.arrayBuffer())};
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
const site = (action, args, email) => call('site', {action, args}, email);
const siteOk = async (action, args, email) => { const r = await site(action, args, email); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.data)); return r.data.value; };
const siteErr = async (action, args, email, pattern) => { const r = await site(action, args, email); assert.equal(r.status, 400, action + ' ' + JSON.stringify(r.data)); if (pattern) assert.match(r.data.error, pattern); };
let passed = 0; const pass = (m) => { passed++; console.log('PASS ' + m); };
const PM = 'pm@example.invalid', QC = 'qc@example.invalid', QC2 = 'qc2@example.invalid', GM = 'gm@example.invalid', SE = 'se@example.invalid', ADMIN = 'qa-admin@example.invalid';
const at = (day, hhmm) => new Date(day + 'T' + hhmm + ':00+05:30').toISOString();
const img = (name) => ({name, mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,' + Buffer.from('jpeg-' + name).toString('base64')});
const pdf = (name) => ({name, mimeType: 'application/pdf', data: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + name).toString('base64')});
const mails = async () => (await db.prepare('SELECT * FROM site_notification_log ORDER BY _row').all()).results;
const D0 = '2026-10-20', D1 = '2026-10-21', D3 = '2026-10-23';
const STAGE = 'Lintel and sunshade';

try {
  for (const [email, name, roles] of [[PM, 'Biju PM', ['Project Manager']], [QC, 'Anu QC', ['QC']], [QC2, 'Bindu QC', ['QC']], [GM, 'Sachin GM', ['GM']], [SE, 'Sandeep SE', ['Site Engineer']]])
    await ok('users', {email, name, roles, projects: [], active: 1, version: 0});
  await ok('projects', {project: '960', name: 'Ajin', site: 'Chalakudy', managerEmail: PM, qcEmail: '', engineerEmails: [SE], active: 1, version: 0});
  clock = at(D0, '09:00');

  // Template library (was the shared Google workbook)
  const row = (seq, checkpoint, criteria, extra = {}) => ({Template_Revision: 'R01', Stage: STAGE, Sequence: seq, Checkpoint: checkpoint, Default_Acceptance_Criteria: criteria, Active: 'Yes', ...extra});
  await siteErr('saveTemplateLibrary', [{rows: [row(1, 'a', 'b'), row(1, 'c', 'd')]}], PM, /Duplicate Template_Item_ID/);
  await siteErr('saveTemplateLibrary', [{rows: [row(1, 'a', 'b', {Template_Item_ID: 'T1'}), row(1, 'c', 'd', {Template_Item_ID: 'T2'})]}], PM, /Duplicate sequence/);
  await siteErr('saveTemplateLibrary', [{rows: [row(1, 'a', 'b'), row(2, 'c', 'd', {Template_Revision: 'R02'})]}], PM, /multiple active revisions/);
  await siteErr('saveTemplateLibrary', [{rows: [row(1, 'a', 'b')]}], SE);
  const lib = await siteOk('saveTemplateLibrary', [{rows: [row(1, 'Lintel rebar as per drawing', '4 bars 12 mm, stirrups 8 mm at 150 c/c, 25 mm cover blocks'),
    row(2, 'Shuttering level and props', 'Level within 3 mm; props at 600 c/c', {Criticality: 'Critical', Photo_Required: 'Yes'})]}], PM);
  assert.equal(lib.rowCount, 2); assert.equal(lib.activeCount, 2);
  const ws = await siteOk('getPmWorkspace', ['960'], PM);
  assert.deepEqual(ws.stages, [STAGE]);
  const items = await siteOk('getTemplateItems', [STAGE], PM);
  assert.equal(items[0].Template_Item_ID, 'CK-LINTEL-AND-SUNSHADE-R01-001'); assert.equal(items[1].Criticality, 'Critical');
  pass('template library kept in the app with the same checks as the Google-sheet sync (sequence, single active revision, generated IDs)');

  // PM prepares and publishes a checklist
  const checklist = {projectId: '960', heading: 'GF lintel and sunshade before concreting', stage: STAGE, checklistRevision: 'R01', assignedQcEmail: QC, plannedDate: D1,
    location: 'Ground floor front', archDrawingRevision: 'A-R02', structuralDrawingRevision: 'S-R03', mepDrawingRevision: 'M-R01', clientRequestId: 'f7703e7d0e454866',
    items: items.map((i) => ({...i, Checkpoint: i.Checkpoint + (i.Sequence === 1 ? ' S-R03' : ''), Acceptance_Criteria: i.Default_Acceptance_Criteria}))};
  await siteErr('saveAndPublishProjectChecklist', [{...checklist, assignedQcEmail: ''}], PM, /assigned QC Engineer/);
  await siteErr('saveAndPublishProjectChecklist', [checklist], SE);
  const pub = await siteOk('saveAndPublishProjectChecklist', [checklist], PM);
  const PCQ = 'PCQ-960-LINTELANDS-F7703E7D0E454866';
  assert.equal(pub.projectChecklistId, PCQ); assert.equal(pub.status, 'PUBLISHED'); assert.equal(pub.assignmentId, 'ASN-20261020-0001');
  assert.equal((await siteOk('saveAndPublishProjectChecklist', [checklist], PM)).alreadyCompleted, true);
  pass('PM publishes the checklist (same ID pattern PCQ-<project>-<stage>-<request>, assignment ASN-…-0001); a repeat is not published twice');

  // Booking
  await siteOk('addQcUnavailability', [{date: D3, type: 'Leave'}], QC);
  await siteErr('createQcBooking', [{projectId: '960', projectChecklistId: PCQ, qcEmail: QC, dates: [D3]}], PM, /unavailable on 2026-10-23: Leave/);
  await siteErr('createQcBooking', [{projectId: '960', projectChecklistId: PCQ, qcEmail: QC, dates: ['2026-10-19']}], PM, /Past dates/);
  const reqId = 'BKG-WEB-2bbe6b80-81f3-4367-996b-8680408ebb8b';
  const booking = await siteOk('createQcBooking', [{projectId: '960', projectChecklistId: PCQ, qcEmail: QC, dates: [D1], notes: 'Before concreting at 2 pm', clientRequestId: reqId}], PM);
  assert.equal(booking.bookingId, reqId); assert.equal(booking.qualityCheckCode, 'QCK-960-LINTELANDS-001'); assert.equal(booking.status, 'PENDING ACCEPTANCE');
  assert.equal((await siteOk('createQcBooking', [{projectId: '960', projectChecklistId: PCQ, qcEmail: QC, dates: [D1], clientRequestId: reqId}], PM)).duplicateRequest, true);
  await siteErr('createQcBooking', [{projectId: '960', projectChecklistId: PCQ, qcEmail: QC2, dates: [D3]}], PM, /already has an initial QC booking/);
  assert.ok((await mails()).some((m) => m.Event_Type === 'QC_SLOT_BOOKED' && m.Recipient_Email === QC && m.Status === 'SENT'));
  const cal = await siteOk('getSchedulingWorkspace', [2026, 10], QC2);
  assert.equal(cal.bookings.length, 0); assert.equal(cal.qcUsers.length, 1);
  const calPm = await siteOk('getSchedulingWorkspace', [2026, 10], PM);
  assert.equal(calPm.bookings[0].qualityCode, 'QCK-960-LINTELANDS-001'); assert.equal(calPm.bookings[0].canManage, true);
  pass('PM books the QC: leave and past dates refused, code QCK-960-LINTELANDS-001, retry-safe, one initial booking per checklist, QC emailed; calendar shows each QC only their own');

  // QC accepts and opens the inspection
  await siteErr('getInspectionForExecution', [PCQ, '', reqId], QC, /Accept this QC Calendar booking/);
  await siteErr('respondToQcBooking', [{bookingId: reqId, response: 'REJECTED'}], QC, /reason for rejection/);
  assert.equal((await siteOk('respondToQcBooking', [{bookingId: reqId, response: 'ACCEPTED'}], QC)).status, 'BOOKED');
  const boot = await siteOk('bootstrap', [], QC);
  assert.equal(boot.assignments.length, 1); assert.equal(boot.assignments[0].Quality_Check_Code, 'QCK-960-LINTELANDS-001');
  clock = at(D1, '10:00');
  let exec = await siteOk('getInspectionForExecution', [PCQ, '', reqId], QC);
  assert.equal(exec.items.length, 2); assert.equal(exec.booking.Upload_Status, 'OPEN');
  assert.match(exec.booking.Upload_Folder_ID, /^site\/960\/qc\/QCI-960-LINTELANDS-001\/01 - QC Upload - V01$/);
  await siteErr('uploadQcEvidence', [{bookingId: reqId, files: [img('x.jpg')]}], QC2, /another QC Engineer/);
  const upl = await siteOk('uploadQcEvidence', [{bookingId: reqId, files: [img('slab-overview.jpg'), pdf('cube-test.pdf')]}], QC);
  assert.equal(upl.files.length, 2);
  pass('QC accepts; the inspection opens its upload folder (was a Drive folder) and only the booked QC can add files');

  // Submission
  const [i1, i2] = exec.items;
  const answers = [{projectItemId: i1.Project_Item_ID, assessment: 'MINOR DEFECT', actualValue: 'Cover 20 mm at two corners, rest 25 mm', observation: 'Add cover blocks at front-left and front-right corners before pour', photos: [img('rebar.jpg')]},
    {projectItemId: i2.Project_Item_ID, assessment: 'SATISFACTORY', actualValue: 'Level within 2 mm'}];
  const submit = {projectChecklistId: PCQ, bookingId: reqId, answers, declarationAccepted: true, clientRequestId: 'QCI-WEB-2463a7b9-6981-4658-8b89-fb9fd62528de', startedAt: at(D1, '09:40')};
  await siteErr('submitInspection', [{...submit, answers: [answers[0]]}], QC, /must have an assessment/);
  await siteErr('submitInspection', [{...submit, answers: [answers[0], {projectItemId: i2.Project_Item_ID, assessment: 'MAJOR DEFECT', observation: 'Props missing'}]}], QC, /Photograph required/);
  await siteErr('submitInspection', [{...submit, answers: [{...answers[0], observation: ''}, answers[1]]}], QC, /Remarks are required/);
  await siteErr('submitInspection', [{...submit, declarationAccepted: false}], QC, /declaration/);
  const r1 = await siteOk('submitInspection', [submit], QC);
  assert.equal(r1.inspectionVersionId, 'QCI-960-LINTELANDS-001-V01'); assert.equal(r1.overallResult, 'PARTIALLY COMPLETED');
  assert.equal((await siteOk('submitInspection', [submit], QC)).alreadySaved, true);
  const evidence = (await db.prepare("SELECT * FROM site_evidence_files WHERE Inspection_Version_ID='QCI-960-LINTELANDS-001-V01'").all()).results;
  assert.equal(evidence.length, 3); assert.ok(evidence.every((e) => e.Archived_File_ID.includes('/02 - Locked Evidence/QCI-960-LINTELANDS-001-V01/')));
  const report = await call('site?action=siteFile&key=' + encodeURIComponent(decodeURIComponent(r1.pdfUrl.split('key=')[1])), undefined, PM);
  assert.equal(report.status, 200); assert.match(report.data, /Bilara Quality Inspection/); assert.match(report.data, /PARTIALLY COMPLETED/); assert.match(report.data, /Digitally signed by/);
  assert.equal((await call('site?action=siteFile&key=' + encodeURIComponent(decodeURIComponent(r1.pdfUrl.split('key=')[1])), undefined, QC2)).status, 403);
  await siteErr('uploadQcEvidence', [{bookingId: reqId, files: [img('late.jpg')]}], QC, /not open|Accept/);
  assert.ok((await mails()).some((m) => m.Event_Type === 'INSPECTION_SUBMITTED' && m.Recipient_Email === PM));
  pass('QC submits: one minor defect → PARTIALLY COMPLETED as QCI-960-LINTELANDS-001-V01; 2 uploads + 1 photo locked; signed report opens for the PM, not another QC; upload closed; PM emailed');

  // PM register and re-site visit
  let reg = await siteOk('getPmChecklistRegister', [], PM);
  let rec = reg.records.find((r) => r.projectChecklistId === PCQ);
  assert.equal(rec.reinspectionRequired, true); assert.equal(rec.canBookReinspection, true); assert.equal(rec.nextInspectionVersion, 'V02'); assert.equal(rec.bookingStatus, 'COMPLETED');
  await siteErr('updatePublishedChecklist', [{projectChecklistId: PCQ, items: checklist.items}], PM, /cannot be edited/);
  await siteErr('deleteProjectChecklist', [{projectChecklistId: PCQ, reason: 'x'}], PM, /cannot be deleted/);
  const ctx = await siteOk('getReinspectionBookingContext', [PCQ], PM);
  assert.equal(ctx.suggestedQcEmail, QC2); assert.ok(!ctx.qcUsers.some((q) => q.email === QC));
  await siteErr('createReinspectionBooking', [{projectChecklistId: PCQ, qcEmail: QC, dates: ['2026-10-22']}], PM, /different QC Engineer/);
  const rb = await siteOk('createReinspectionBooking', [{projectChecklistId: PCQ, qcEmail: QC2, dates: ['2026-10-22']}], PM);
  assert.equal(rb.qualityCheckCode, 'QCK-960-LINTELANDS-001');
  await siteErr('createReinspectionBooking', [{projectChecklistId: PCQ, qcEmail: QC2, dates: ['2026-10-24']}], PM, /already booked/);
  await siteOk('respondToQcBooking', [{bookingId: rb.bookingId, response: 'ACCEPTED'}], QC2);
  pass('a partial result needs a re-site visit by a different QC (same quality code), the checklist is locked against edits and deletion');

  // Re-site visit from a phone (answers first, photos after)
  clock = at('2026-10-22', '11:00');
  exec = await siteOk('getInspectionForExecution', [PCQ, 'QCI-960-LINTELANDS-001', rb.bookingId], QC2);
  assert.equal(exec.prior.Inspection_Version_ID, 'QCI-960-LINTELANDS-001-V01'); assert.equal(exec.priorResults.length, 2);
  assert.match(exec.booking.Upload_Folder_ID, /01 - QC Upload - V02$/);
  const fast = await siteOk('submitInspection', [{projectChecklistId: PCQ, bookingId: rb.bookingId, baseInspectionId: 'QCI-960-LINTELANDS-001', fastCommit: true, declarationAccepted: true,
    clientRequestId: 'QCI-WEB-v2', answers: [{projectItemId: i1.Project_Item_ID, assessment: 'SATISFACTORY', actualValue: 'Cover 25 mm everywhere', pendingPhotoCount: 1}]}], QC2);
  assert.equal(fast.inspectionVersionId, 'QCI-960-LINTELANDS-001-V02'); assert.equal(fast.overallResult, 'COMPLETED - PASSED'); assert.equal(fast.evidenceStatus, 'UPLOAD PENDING');
  const carried = (await db.prepare("SELECT * FROM site_inspection_results WHERE Inspection_Version_ID='QCI-960-LINTELANDS-001-V02' ORDER BY Sequence").all()).results;
  assert.equal(carried[1].Carried_From_Version_ID, 'QCI-960-LINTELANDS-001-V01');
  const fin1 = await site('finalizeInspectionEvidence', [{inspectionVersionId: fast.inspectionVersionId, photoGroups: []}], QC2);
  assert.equal(fin1.status, 400); assert.match(fin1.data.error, /Only 0 of 1 selected checklist photos/);
  assert.equal((await db.prepare("SELECT Evidence_Status FROM site_inspection_header WHERE Inspection_Version_ID='QCI-960-LINTELANDS-001-V02'").first()).Evidence_Status, 'RETRY REQUIRED');
  await siteErr('uploadInspectionPhotoBatch', [{inspectionVersionId: fast.inspectionVersionId, projectItemId: i1.Project_Item_ID, photos: [img('a.jpg'), img('b.jpg'), img('c.jpg')]}], QC2, /one or two/);
  assert.equal((await siteOk('uploadInspectionPhotoBatch', [{inspectionVersionId: fast.inspectionVersionId, projectItemId: i1.Project_Item_ID, photos: [img('cover-ok.jpg')]}], QC2)).status, 'UPLOADING');
  const fin = await siteOk('finalizeInspectionEvidence', [{inspectionVersionId: fast.inspectionVersionId, photoGroups: []}], QC2);
  assert.equal(fin.evidenceStatus, 'COMPLETE'); assert.ok(fin.pdfUrl);
  const links = (await db.prepare('SELECT * FROM site_reinspection_links').all()).results;
  assert.equal(links.length, 1); assert.equal(links[0].From_Version_ID, 'QCI-960-LINTELANDS-001-V01');
  reg = await siteOk('getPmChecklistRegister', [], PM);
  rec = reg.records.find((r) => r.projectChecklistId === PCQ);
  assert.equal(rec.completed, true); assert.equal(rec.versionCount, 2); assert.equal(rec.latestResult, 'COMPLETED - PASSED');
  const full = await siteOk('getPmChecklistRecord', [PCQ], GM);
  assert.equal(full.inspections.length, 2); assert.equal(full.results.length, 4);
  pass('re-site visit V02 from a phone: the passed item carries over from V01, a missing photo asks for a retry, then photos and the signed report complete it; the checklist is closed as passed');

  // Booking edits and cancellation
  clock = at(D0, '12:00');
  const second = await siteOk('saveAndPublishProjectChecklist', [{...checklist, heading: 'FF lintel', clientRequestId: 'ff-lintel', plannedDate: '2026-10-28'}], PM);
  const b2 = await siteOk('createQcBooking', [{projectId: '960', projectChecklistId: second.projectChecklistId, qcEmail: QC, dates: ['2026-10-28']}], PM);
  assert.equal(b2.qualityCheckCode, 'QCK-960-LINTELANDS-002');
  await siteOk('respondToQcBooking', [{bookingId: b2.bookingId, response: 'ACCEPTED'}], QC);
  const moved = await siteOk('updateQcBooking', [{bookingId: b2.bookingId, qcEmail: QC, dates: ['2026-10-29']}], PM);
  assert.equal(moved.status, 'PENDING ACCEPTANCE');
  assert.equal((await siteOk('cancelQcBooking', [{bookingId: b2.bookingId, reason: 'Concrete postponed'}], PM)).status, 'CANCELLED');
  assert.equal((await siteOk('deleteProjectChecklist', [{projectChecklistId: second.projectChecklistId, reason: 'Merged'}], PM)).status, 'DELETED');
  pass('moving a booking asks the QC to accept again; bookings can be cancelled and an uninspected checklist deleted');

  console.log(`\n${passed} checks passed`);
} finally {
  await runtime.dispose();
}
