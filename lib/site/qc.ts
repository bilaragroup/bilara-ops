// QC checklists, QC bookings (calendar) and inspections, converted from the QC app's
// Workflow.gs, Scheduling.gs, Evidence.gs, TemplateSync.gs and the read functions in Code.gs.
// Behaviour is unchanged; only the storage moved:
//  - Google Sheets tabs → site_* tables (same field names).
//  - Google Drive inspection folders → files under site/<project>/qc/<base inspection id>/ :
//      01 - QC Upload - Vnn   the booked QC adds files here while the booking is open
//      02 - Locked Evidence   copied here on submission; the app has no way to change or delete them
//      03 - Signed Reports    the signed inspection report (an HTML page instead of a Drive PDF)
//  - The shared Google template workbook → the Checklist_Library table, edited in the app.
import {Site, Row, SiteError, SiteUser, dateKey, parseDateKey, isValidDateKey, formatDate, clientSafe, normaliseEmail, unique, sha256Hex, uuid, runSiteAction} from './core';
import {assertProjectAccess, assertProjectArchiveAccess, getProjectsForUser, normaliseAllowedProjects} from './access';
import {decodeDataUrl, DecodedFile, folderUrl, safeName, removeFiles, listFiles, ALLOWED_PHOTO_MIME} from './files';
import {sendNotification} from './ops';
import {htmlEscape} from './mail';
import {documentStorage} from '@/lib/documents';

const CONFIRMED = ['BOOKED', 'ACCEPTED'];
const ACTIVE_CAPACITY = ['BOOKED', 'PENDING ACCEPTANCE', 'ACCEPTED'];
const DECLARATION = 'I confirm that I personally conducted this inspection and that the observations recorded are accurate.';
const EVIDENCE_TYPES = ALLOWED_PHOTO_MIME.concat(['application/pdf']);
const up = (v: any) => String(v ?? '').trim().toUpperCase();
const low = (v: any) => String(v ?? '').trim().toLowerCase();

export function stageCode(stage: any) { return String(stage || 'GEN').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || 'GEN'; }
export function isConfirmedBookingStatus(status: any) { return CONFIRMED.indexOf(up(status)) >= 0; }
export function activeCapacityStatus(status: any) { return ACTIVE_CAPACITY.indexOf(up(status)) >= 0; }
function checklistOwnerEmail(header: Row | null) { return header ? low(header.Prepared_By_PM || header.Published_By) : ''; }
async function hashObject(obj: any) { return sha256Hex(JSON.stringify(obj)); }
const fileLink = (key: string) => '/api/site?action=siteFile&key=' + encodeURIComponent(key);

async function assertChecklistOwner(s: Site, user: SiteUser, header: Row) {
  if (user.role === 'ADMIN') return true;
  // Prepared_By_PM is authorship history; the project's current PM manages the checklist.
  await assertProjectAccess(s, user, header.Project_ID);
  return true;
}
async function assertBookingOwner(s: Site, user: SiteUser, booking: Row) {
  if (user.role === 'ADMIN' || user.role === 'GM') return true;
  await assertProjectAccess(s, user, booking.Project_ID);
  return true;
}
async function activeQcUser(s: Site, email: string) {
  return (await s.read('Users_Roles')).find((r) => low(r.Email) === low(email) && up(r.Role) === 'QC' && low(r.Active) === 'yes') || null;
}
async function latestInspectionVersion(s: Site, baseId: any) {
  return (await s.filter('Inspection_Header', (r) => String(r.Base_Inspection_ID) === String(baseId) && String(r.Void_Status || 'Active') !== 'Void'))
    .sort((a, b) => Number(b.Version_Number) - Number(a.Version_Number))[0] || null;
}
export function evidenceBaseId(qualityCheckCode: any, requestedBaseId: any) {
  if (String(requestedBaseId || '').trim()) return String(requestedBaseId).trim();
  const code = String(qualityCheckCode || '').trim();
  if (!code) throw new SiteError('A quality-check code is required before creating evidence folders.');
  return code.replace(/^QCK-/, 'QCI-');
}

/** Sends the event email after the action is saved, so a failed save never mails anyone. */
function notifyAfterCommit(s: Site, eventType: string, relatedId: string, recipient: string, subject: string, html: string) {
  const clock = s.clock || undefined, db = s.db;
  s.after.push(async () => { await runSiteAction(null, 'notify:' + eventType, (m) => sendNotification(m, eventType, relatedId, recipient, subject, html), {clock, db}); });
}
function emailBody(intro: string, record: Row, details: Record<string, any>) {
  const rows = Object.keys(details || {}).map((k) => {
    const v = String(details[k] ?? '');
    const value = /^\/(api\/site|site)\?/.test(v) ? 'Open the record in the Bilara app' : htmlEscape(v);
    return '<tr><td style="padding:6px;border:1px solid #ddd"><b>' + htmlEscape(k) + '</b></td><td style="padding:6px;border:1px solid #ddd">' + value + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial;color:#1f2937"><h2 style="color:#1D2559">Bilara QC</h2><p>' + htmlEscape(intro) + '</p><p><b>Project:</b> ' + htmlEscape(record.Project_ID || '') +
    '<br><b>Inspection:</b> ' + htmlEscape(record.Inspection_Heading || '') + '</p><table style="border-collapse:collapse">' + rows + '</table></div>';
}

// ---------- evidence folders (were Drive folders) ----------

type Bundle = {baseInspectionId: string; inspection: string; upload: string; locked: string; reports: string};
function bundleFor(projectId: any, baseId: string, versionLabel: string): Bundle {
  const root = 'site/' + safeName(String(projectId), 'project') + '/qc/' + safeName(baseId, 'inspection');
  const label = /^V\d{2,}$/.test(up(versionLabel)) ? up(versionLabel) : 'V01';
  return {baseInspectionId: baseId, inspection: root, upload: root + '/01 - QC Upload - ' + label, locked: root + '/02 - Locked Evidence', reports: root + '/03 - Signed Reports'};
}
function bundleFromBooking(booking: Row): Bundle | null {
  const inspection = String(booking.Inspection_Folder_ID || ''), upload = String(booking.Upload_Folder_ID || '');
  if (!inspection || !upload) return null;
  return {baseInspectionId: evidenceBaseId(booking.Quality_Check_Code, booking.Base_Inspection_ID), inspection, upload, locked: inspection + '/02 - Locked Evidence', reports: inspection + '/03 - Signed Reports'};
}
function bookingFolderChanges(s: Site, b: Bundle) {
  return {Inspection_Folder_ID: b.inspection, Inspection_Folder_URL: folderUrl(b.inspection), Upload_Folder_ID: b.upload, Upload_Folder_URL: folderUrl(b.upload),
    Upload_Status: 'OPEN', Upload_Opened_At: s.now()};
}
async function closeBookingUpload(s: Site, booking: Row, finalStatus: string, actorEmail: string) {
  await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, {Upload_Status: finalStatus || 'CLOSED', Upload_Closed_At: s.now()});
  await s.audit('EVIDENCE_UPLOAD_CLOSED', 'QC_BOOKING', booking.Booking_ID, booking.Upload_Status || 'OPEN', finalStatus || 'CLOSED', {
    uploadFolderId: booking.Upload_Folder_ID || '', qcEmail: low(booking.QC_Email), actorEmail: actorEmail || ''});
}
function manifestOf(r: Row) {
  return {sourceFileId: String(r.Source_File_ID || ''), archivedFileId: String(r.Archived_File_ID || ''), name: String(r.File_Name || ''), relativePath: String(r.Relative_Path || '/'),
    mimeType: String(r.MIME_Type || ''), size: Number(r.File_Size_Bytes || 0), sourceUpdatedAt: String(r.Source_Updated_At || '')};
}
async function putFile(s: Site, key: string, bytes: Uint8Array | ArrayBuffer, mimeType: string) {
  await documentStorage().put(key, bytes, {httpMetadata: {contentType: mimeType}});
  s.onError.push(() => removeFiles([key]));
}

/** Copy everything the QC put in the booking's upload folder into the locked evidence of this version. */
async function archiveUploadEvidence(s: Site, booking: Row, bundle: Bundle, versionId: string, actorEmail: string) {
  const baseId = bundle.baseInspectionId;
  const prior = await s.filter('Evidence_Files', (r) => String(r.Base_Inspection_ID) === baseId && up(r.Status) === 'ARCHIVED');
  const archived: Record<string, boolean> = {};
  prior.forEach((r) => { archived[String(r.Source_File_ID)] = true; });
  const manifest = prior.filter((r) => String(r.Inspection_Version_ID) === versionId && String(r.Source_File_ID).indexOf('INLINE-') !== 0).map(manifestOf);
  const storage = documentStorage();
  for (const file of await listFiles(bundle.upload)) {
    if (archived[file.key]) continue;
    const relative = file.key.slice(bundle.upload.length + 1);
    const parts = relative.split('/'), name = parts.pop() || 'file', relativePath = parts.join('/') || '/';
    const object: any = await storage.get(file.key);
    if (!object) throw new SiteError('Evidence archive failed for "' + name + '". Nothing has been signed; retry after checking the file.');
    const mimeType = String(object.httpMetadata?.contentType || 'application/octet-stream');
    const target = bundle.locked + '/' + versionId + '/' + relative;
    await putFile(s, target, await object.arrayBuffer(), mimeType);
    const row = {Evidence_Record_ID: 'EV-' + uuid(), Project_ID: booking.Project_ID, Base_Inspection_ID: baseId, Inspection_Version_ID: versionId, Booking_ID: booking.Booking_ID,
      Source_File_ID: file.key, Source_File_URL: fileLink(file.key), Archived_File_ID: target, Archived_File_URL: fileLink(target), File_Name: name, Relative_Path: relativePath,
      MIME_Type: mimeType, File_Size_Bytes: file.size, Source_Created_At: object.uploaded || '', Source_Updated_At: object.uploaded || '', Archived_At: s.now(), Archived_By: actorEmail, Status: 'ARCHIVED'};
    await s.append('Evidence_Files', row);
    archived[file.key] = true;
    manifest.push(manifestOf(row));
  }
  manifest.sort((a, b) => (a.sourceFileId + '|' + a.relativePath).localeCompare(b.sourceFileId + '|' + b.relativePath));
  return {count: manifest.length, manifest};
}

/** A photo taken on the checklist page itself, stored straight into the locked evidence. */
async function archiveInlineEvidence(s: Site, bundle: Bundle, file: any, booking: Row, baseId: string, versionId: string, projectItemId: string, index: number, actorEmail: string) {
  if (!file || !file.data) throw new SiteError('Inline photograph data is missing.');
  const sourceId = 'INLINE-' + await hashObject({versionId, projectItemId, index, name: file.name || '', data: file.data});
  const existing = await s.find('Evidence_Files', 'Source_File_ID', sourceId);
  if (existing && up(existing.Status) === 'ARCHIVED') return {url: String(existing.Archived_File_URL), manifest: manifestOf(existing)};
  const decoded = decodeDataUrl(file, 'Inspection photo', ALLOWED_PHOTO_MIME, 14 * 1024 * 1024);
  const key = bundle.locked + '/' + versionId + '/Inline checklist photos/' + projectItemId + '/' + String(index + 1).padStart(2, '0') + '-' + decoded.name;
  await putFile(s, key, decoded.bytes, decoded.mimeType);
  const row = {Evidence_Record_ID: 'EV-' + uuid(), Project_ID: booking.Project_ID, Base_Inspection_ID: baseId, Inspection_Version_ID: versionId, Booking_ID: booking.Booking_ID,
    Source_File_ID: sourceId, Source_File_URL: fileLink(key), Archived_File_ID: key, Archived_File_URL: fileLink(key), File_Name: decoded.name,
    Relative_Path: 'Inline checklist photos/' + projectItemId, MIME_Type: decoded.mimeType, File_Size_Bytes: decoded.bytes.length,
    Source_Created_At: s.now(), Source_Updated_At: s.now(), Archived_At: s.now(), Archived_By: actorEmail, Status: 'ARCHIVED'};
  await s.append('Evidence_Files', row);
  return {url: fileLink(key), manifest: manifestOf(row)};
}

/** The signed inspection report (was a PDF made from HTML in Drive; now the same HTML page). */
async function createInspectionReport(s: Site, header: Row, results: Row[], bundle: Bundle) {
  const e = htmlEscape;
  const rows = results.map((r) => '<tr><td>' + e(r.Sequence) + '</td><td>' + e(r.Checkpoint_Snapshot) + '</td><td>' + e(r.Acceptance_Criteria_Snapshot) + '</td><td>' + e(r.Actual_Value) + '</td><td>' + e(r.Assessment) + '</td><td>' + e(r.Observation) + '</td></tr>').join('');
  const submitted = header.Submitted_At instanceof Date ? formatDate(header.Submitted_At, 'dd MMM yyyy, hh:mm a') : String(header.Submitted_At || '');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + e(header.Inspection_Version_ID) + '</title><style>body{font-family:Arial;font-size:12px;color:#1f2937;max-width:960px;margin:24px auto;padding:0 16px}h1{color:#1D2559}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:5px;vertical-align:top}th{background:#1D2559;color:white}.meta{margin-bottom:12px}.digital-signature{margin-top:24px;padding-top:10px;border-top:1px solid #94a3b8;color:#334155}.digital-signature strong{color:#1D2559}</style></head><body>' +
    '<h1>Bilara Quality Inspection</h1><div class="meta"><b>Inspection:</b> ' + e(header.Inspection_Version_ID) + '<br><b>Project:</b> ' + e(header.Project_ID) + '<br><b>Heading:</b> ' + e(header.Inspection_Heading) +
    '<br><b>Result:</b> ' + e(header.Overall_Result) + '<br><b>QC:</b> ' + e(header.QC_Name) + ' (' + e(header.QC_Email) + ')<br><b>Submitted:</b> ' + e(submitted) + '<br><b>Integrity hash:</b> ' + e(header.Integrity_Hash) + '</div>' +
    '<table><thead><tr><th>#</th><th>Checkpoint</th><th>Requirement</th><th>Actual</th><th>Assessment</th><th>Observation</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p><b>Signed declaration:</b> ' + e(header.Signed_Declaration) + '</p><div class="digital-signature"><strong>Digitally signed by</strong><br>' + e(header.QC_Name) + '<br>' + e(header.QC_Email) +
    '<br><span>Signed on: ' + e(submitted) + '</span><br><span>Inspection version: ' + e(header.Inspection_Version_ID) + '</span></div></body></html>';
  const key = bundle.reports + '/' + safeName(header.Inspection_Version_ID, 'report') + '.html';
  await putFile(s, key, new TextEncoder().encode(html), 'text/html; charset=utf-8');
  return {key, url: fileLink(key)};
}

/** The booked QC adds files (photos, test reports) to the open upload folder — the Drive upload folder. */
export async function uploadQcEvidence(s: Site, payload: any) {
  const user = s.requireRole(['QC', 'ADMIN']);
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', payload?.bookingId);
  if (!booking) throw new SiteError('Booking not found.');
  if (user.role !== 'ADMIN' && low(booking.QC_Email) !== user.email) throw new SiteError('This booking belongs to another QC Engineer.');
  if (!isConfirmedBookingStatus(booking.Status)) throw new SiteError('Accept this QC Calendar booking before uploading evidence.');
  const bundle = bundleFromBooking(booking);
  if (!bundle || up(booking.Upload_Status) !== 'OPEN') throw new SiteError('The upload folder is not open. Open the inspection first.');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length || files.length > 5) throw new SiteError('Upload between one and five files at a time.');
  const folder = payload.folder ? '/' + safeName(payload.folder, 'Folder') : '';
  const keys: string[] = [];
  for (const [i, f] of files.entries()) {
    const decoded: DecodedFile = decodeDataUrl(f, 'Evidence file ' + (i + 1), EVIDENCE_TYPES, 20 * 1024 * 1024);
    const key = bundle.upload + folder + '/' + formatDate(s.now(), 'yyyyMMdd-HHmmss') + '-' + decoded.name;
    await putFile(s, key, decoded.bytes, decoded.mimeType);
    keys.push(key);
  }
  await s.audit('QC_EVIDENCE_UPLOADED', 'QC_BOOKING', booking.Booking_ID, '', 'OPEN', {files: keys.length});
  return {uploaded: keys.length, files: (await listFiles(bundle.upload)).map((f) => ({...f, name: f.key.split('/').pop(), url: fileLink(f.key)})), uploadFolderUrl: folderUrl(bundle.upload)};
}

// ---------- PM: checklists ----------

export async function getPmWorkspace(s: Site, projectId: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  await assertProjectAccess(s, user, projectId);
  const qcUsers = (await s.read('Users_Roles')).filter((r) => up(r.Role) === 'QC' && low(r.Active) === 'yes')
    .map((r) => ({email: low(r.Email), name: String(r.Name || r.Email)})).sort((a, b) => a.name.localeCompare(b.name));
  return clientSafe({
    project: await s.find('Projects', 'Project_ID', projectId),
    drawings: await s.filter('Drawing_Register', (r) => String(r.Project_ID) === String(projectId) && low(r.Current) !== 'no'),
    stages: unique((await s.filter('Checklist_Library', (r) => low(r.Active) === 'yes')).map((r) => r.Stage)),
    checklists: await s.filter('Project_Checklist_Header', (r) => String(r.Project_ID) === String(projectId)),
    qcUsers,
  });
}

function projectChecklistIdForPayload(payload: any) {
  if (payload.projectChecklistId) return String(payload.projectChecklistId);
  const requestId = String(payload.clientRequestId || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return 'PCQ-' + payload.projectId + '-' + stageCode(payload.stage) + '-' + (requestId || uuid().slice(0, 6).toUpperCase());
}

async function replaceDraftItems(s: Site, projectChecklistId: string, items: any[]) {
  await s.deleteWhere('Project_Checklist_Items', (r) => String(r.Project_Checklist_ID) === projectChecklistId);
  await s.appendMany('Project_Checklist_Items', (items || []).map((item: any, index: number) => ({
    Project_Checklist_ID: projectChecklistId, Project_Item_ID: projectChecklistId + '-I' + String(index + 1).padStart(3, '0'),
    Template_Item_ID: item.Template_Item_ID || item.templateItemId || '', Sequence: index + 1,
    Checkpoint_Snapshot: String(item.Checkpoint || item.checkpoint || '').trim(),
    Acceptance_Criteria_Snapshot: String(item.Acceptance_Criteria || item.acceptanceCriteria || item.Default_Acceptance_Criteria || '').trim(),
    Response_Type: item.Response_Type || item.responseType || 'Assessment + observation', Unit: item.Unit || item.unit || '',
    Criticality: item.Criticality || item.criticality || 'Normal', Photo_Required: item.Photo_Required || item.photoRequired || 'On failure',
    Hold_Point: item.Hold_Point || item.holdPoint || 'No', Mandatory_Class: item.Mandatory_Class || item.mandatoryClass || 'Project-specific',
    Applicable: item.Applicable || item.applicable || 'Yes', PM_Notes: String(item.PM_Notes || item.pmNotes || '').trim(), Created_At: s.now(),
  })));
}

const keyDate = (v: any) => (v ? parseDateKey(dateKey(v)) : '');

export async function saveProjectChecklistDraft(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId || !payload.heading || !payload.stage) throw new SiteError('Project, inspection heading and stage are required.');
  await assertProjectAccess(s, user, payload.projectId);
  const id = projectChecklistIdForPayload(payload);
  const existing = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', id);
  if (existing && up(existing.Status) !== 'DRAFT') throw new SiteError('Published checklists cannot be edited. Create a new revision.');
  if (existing) await assertChecklistOwner(s, user, existing);
  const header = {
    Project_Checklist_ID: id, Project_ID: payload.projectId, Inspection_Heading: payload.heading, Stage: payload.stage, Checklist_Revision: payload.checklistRevision || 'R01', Status: 'DRAFT',
    Assigned_QC_Email: payload.assignedQcEmail || '', Planned_Date: keyDate(payload.plannedDate), Planned_End_Date: keyDate(payload.plannedEndDate),
    Location_Floor_Grid: payload.location || '', Architectural_Drawing_Record_ID: payload.archDrawingId || '', Structural_Drawing_Record_ID: payload.structuralDrawingId || '',
    MEP_Drawing_Record_ID: payload.mepDrawingId || '', Architectural_Drawing_Revision_Text: payload.archDrawingRevision || '', Structural_Drawing_Revision_Text: payload.structuralDrawingRevision || '',
    MEP_Drawing_Revision_Text: payload.mepDrawingRevision || '', Specification_Link: payload.specificationLink || '', Special_Requirements: payload.specialRequirements || '',
    Prepared_By_PM: user.email, Prepared_At: s.now(), Supersedes_Checklist_ID: payload.supersedesChecklistId || '',
  };
  if (existing) await s.update('Project_Checklist_Header', 'Project_Checklist_ID', id, header);
  else await s.append('Project_Checklist_Header', header);
  await replaceDraftItems(s, id, payload.items || []);
  await s.audit(existing ? 'CHECKLIST_DRAFT_UPDATED' : 'CHECKLIST_DRAFT_CREATED', 'PROJECT_CHECKLIST', id, existing ? 'DRAFT' : '', 'DRAFT', {projectId: payload.projectId});
  return {projectChecklistId: id, status: 'DRAFT'};
}

export async function publishProjectChecklist(s: Site, projectChecklistId: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId);
  if (!header || up(header.Status) !== 'DRAFT') throw new SiteError('Only a draft checklist can be published.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  const items = await s.filter('Project_Checklist_Items', (r) => r.Project_Checklist_ID === projectChecklistId && low(r.Applicable) !== 'no');
  if (!normaliseEmail(header.Assigned_QC_Email) || !isValidDateKey(dateKey(header.Planned_Date))) throw new SiteError('An active QC Engineer and planned start date are required before publishing.');
  if (!items.length) throw new SiteError('Checklist has no applicable items.');
  if (items.some((i) => !String(i.Checkpoint_Snapshot || '').trim() || !String(i.Acceptance_Criteria_Snapshot || '').trim())) throw new SiteError('Every applicable item requires a checkpoint and acceptance criteria.');
  await s.update('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId, {Status: 'PUBLISHED', Published_At: s.now(), Published_By: user.email});
  const assignmentId = await s.nextId('ASN', 4);
  await s.append('Assignments', {Assignment_ID: assignmentId, Project_Checklist_ID: projectChecklistId, Project_ID: header.Project_ID, Assigned_To_Email: low(header.Assigned_QC_Email),
    Assigned_By_Email: user.email, Assignment_Type: 'INITIAL INSPECTION', Due_Date: header.Planned_Date, Status: 'AWAITING BOOKING', Created_At: s.now(), Notes: '', Booking_ID: '', Quality_Check_Code: ''});
  await s.audit('CHECKLIST_PUBLISHED', 'PROJECT_CHECKLIST', projectChecklistId, 'DRAFT', 'PUBLISHED', {assignmentId});
  return {projectChecklistId, assignmentId, status: 'PUBLISHED', nextStep: 'BOOK_QC_SLOT'};
}

export async function saveAndPublishProjectChecklist(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId || !payload.heading || !payload.stage) throw new SiteError('Project, inspection heading and stage are required.');
  if (!normaliseEmail(payload.assignedQcEmail)) throw new SiteError('Select an assigned QC Engineer before publishing.');
  if (!isValidDateKey(dateKey(payload.plannedDate))) throw new SiteError('Select a valid planned start date before publishing.');
  if (!(await activeQcUser(s, payload.assignedQcEmail))) throw new SiteError('The assigned QC Engineer is not active. Refresh and select an active QC Engineer.');
  await assertProjectAccess(s, user, payload.projectId);
  if (payload.plannedDate && payload.plannedEndDate && String(payload.plannedEndDate) < String(payload.plannedDate)) throw new SiteError('Planned end date cannot be earlier than the planned start date.');
  if (!/^R\d{2}$/.test(String(payload.checklistRevision || 'R01'))) throw new SiteError('Select a valid checklist revision.');
  payload = {...payload, projectChecklistId: projectChecklistIdForPayload(payload)};
  const existing = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload.projectChecklistId);
  if (existing && up(existing.Status) === 'PUBLISHED') {
    const assignment = await s.find('Assignments', 'Project_Checklist_ID', payload.projectChecklistId);
    return {projectChecklistId: payload.projectChecklistId, assignmentId: assignment ? assignment.Assignment_ID : '', status: 'PUBLISHED', alreadyCompleted: true, nextStep: 'BOOK_QC_SLOT'};
  }
  await saveProjectChecklistDraft(s, payload);
  return publishProjectChecklist(s, payload.projectChecklistId);
}

export async function updatePublishedChecklist(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectChecklistId) throw new SiteError('Checklist ID is required.');
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload.projectChecklistId);
  if (!header || up(header.Status) !== 'PUBLISHED') throw new SiteError('Published checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  if ((await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID))).length) throw new SiteError('Completed or submitted checklists cannot be edited.');
  const today = s.todayKey(), oldStart = dateKey(header.Planned_Date), newStart = dateKey(payload.plannedDate || header.Planned_Date);
  if (oldStart && today >= oldStart) throw new SiteError('Editing is locked on the planned start date.');
  if (newStart && newStart < today) throw new SiteError('The planned start date cannot be in the past.');
  if (payload.plannedEndDate && newStart && dateKey(payload.plannedEndDate) < newStart) throw new SiteError('Planned end date cannot be earlier than the start date.');
  if (!Array.isArray(payload.items) || !payload.items.length) throw new SiteError('The checklist must contain at least one item.');
  if (payload.items.some((i: any) => !String(i.Checkpoint || i.Checkpoint_Snapshot || '').trim() || !String(i.Acceptance_Criteria || i.Acceptance_Criteria_Snapshot || '').trim())) throw new SiteError('Every item requires a heading and acceptance criteria.');
  const qcEmail = low(payload.assignedQcEmail || header.Assigned_QC_Email);
  await s.update('Project_Checklist_Header', 'Project_Checklist_ID', header.Project_Checklist_ID, {
    Inspection_Heading: String(payload.heading || header.Inspection_Heading).trim(), Assigned_QC_Email: qcEmail,
    Planned_Date: payload.plannedDate ? keyDate(payload.plannedDate) : header.Planned_Date, Planned_End_Date: payload.plannedEndDate ? keyDate(payload.plannedEndDate) : '',
    Location_Floor_Grid: payload.location || '', Checklist_Revision: payload.checklistRevision || header.Checklist_Revision,
    Architectural_Drawing_Revision_Text: payload.archDrawingRevision || '', Structural_Drawing_Revision_Text: payload.structuralDrawingRevision || '', MEP_Drawing_Revision_Text: payload.mepDrawingRevision || '',
    Specification_Link: payload.specificationLink || '', Special_Requirements: payload.specialRequirements || ''});
  await replaceDraftItems(s, header.Project_Checklist_ID, payload.items.map((i: any) => ({Template_Item_ID: i.Template_Item_ID || '', Checkpoint: i.Checkpoint || i.Checkpoint_Snapshot,
    Acceptance_Criteria: i.Acceptance_Criteria || i.Acceptance_Criteria_Snapshot, PM_Notes: i.PM_Notes || '', Response_Type: i.Response_Type, Unit: i.Unit, Criticality: i.Criticality,
    Photo_Required: i.Photo_Required, Hold_Point: i.Hold_Point, Mandatory_Class: i.Mandatory_Class, Applicable: i.Applicable})));
  await s.updateWhere('Assignments', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID) && up(r.Status) === 'AWAITING BOOKING',
    {Assigned_To_Email: qcEmail, Due_Date: payload.plannedEndDate ? keyDate(payload.plannedEndDate) : (payload.plannedDate ? keyDate(payload.plannedDate) : header.Planned_Date)});
  await s.audit('CHECKLIST_UPDATED', 'PROJECT_CHECKLIST', header.Project_Checklist_ID, 'PUBLISHED', 'PUBLISHED', {});
  return {status: 'PUBLISHED', projectChecklistId: header.Project_Checklist_ID};
}

export async function deleteProjectChecklist(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload?.projectChecklistId);
  if (!header) throw new SiteError('Checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  if ((await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID))).length) throw new SiteError('Completed or submitted checklists cannot be deleted.');
  const bookings = await s.filter('QC_Booking_Header', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID) && ['COMPLETED', 'CANCELLED'].indexOf(up(r.Status)) < 0);
  for (const b of bookings) await cancelQcBooking(s, {bookingId: b.Booking_ID, reason: 'Checklist deleted: ' + String(payload.reason || '')});
  await s.update('Project_Checklist_Header', 'Project_Checklist_ID', header.Project_Checklist_ID, {Status: 'DELETED', Deleted_At: s.now(), Deleted_By: user.email, Deletion_Reason: payload.reason || ''});
  await s.updateWhere('Assignments', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID) && up(r.Status) !== 'COMPLETED', {Status: 'CANCELLED', Completed_At: s.now()});
  await s.audit('CHECKLIST_DELETED', 'PROJECT_CHECKLIST', header.Project_Checklist_ID, header.Status, 'DELETED', {reason: payload.reason || ''});
  return {status: 'DELETED'};
}

export async function getPmChecklistRegister(s: Site) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  // Historical records stay visible after a project leaves ONGOING status.
  const projectMap: Record<string, Row> = {};
  (await s.read('Projects')).forEach((p) => { projectMap[String(p.Project_ID)] = p; });
  const headers = (await s.read('Project_Checklist_Header')).filter((h) => {
    if (!projectMap[String(h.Project_ID)]) return false;
    if (['DELETED', 'CANCELLED'].indexOf(up(h.Status)) >= 0) return false;
    if (user.role === 'ADMIN' || user.role === 'GM') return true;
    return low(projectMap[String(h.Project_ID)].PM_Email) === low(user.email);
  });
  const allowed: Record<string, boolean> = {};
  headers.forEach((h) => { allowed[String(h.Project_Checklist_ID)] = true; });
  const inspectionsBy: Record<string, Row[]> = {}, bookingsBy: Record<string, Row[]> = {}, dateMap: Record<string, string[]> = {};
  (await s.read('Inspection_Header')).forEach((i) => { const id = String(i.Project_Checklist_ID || ''); if (allowed[id] && up(i.Void_Status || 'Active') !== 'VOID') (inspectionsBy[id] ||= []).push(i); });
  (await s.read('QC_Booking_Header')).forEach((b) => { const id = String(b.Project_Checklist_ID || ''); if (allowed[id]) (bookingsBy[id] ||= []).push(b); });
  (await s.read('QC_Booking_Dates')).forEach((d) => { if (up(d.Status) !== 'CANCELLED') (dateMap[String(d.Booking_ID)] ||= []).push(dateKey(d.Visit_Date)); });
  const today = s.todayKey();
  const ms = (v: any) => (v ? new Date(v).getTime() || 0 : 0);
  const records = headers.map((h) => {
    const id = String(h.Project_Checklist_ID), project = projectMap[String(h.Project_ID)] || {};
    const inspections = (inspectionsBy[id] || []).sort((a, b) => Number(b.Version_Number || 0) - Number(a.Version_Number || 0));
    const bookings = (bookingsBy[id] || []).sort((a, b) => ms(b.Updated_At || b.Created_At) - ms(a.Updated_At || a.Created_At));
    const activeBooking = bookings.find((b) => ['COMPLETED', 'CANCELLED', 'REJECTED'].indexOf(up(b.Status)) < 0);
    const display: Row = activeBooking || bookings[0] || {};
    const latest: Row = inspections[0] || {};
    const start = dateKey(h.Planned_Date), latestResult = up(latest.Overall_Result);
    const lifecycleCompleted = latestResult === 'COMPLETED - PASSED', reinspectionRequired = inspections.length > 0 && !lifecycleCompleted;
    return {
      projectChecklistId: id, projectId: String(h.Project_ID || ''), projectNumber: String(project.Project_Number || h.Project_ID || ''), projectName: String(project.Project_Name || project.Client || ''),
      client: String(project.Client || ''), pmName: String(project.PM_Name || ''), pmEmail: low(project.PM_Email), heading: String(h.Inspection_Heading || ''), stage: String(h.Stage || ''),
      revision: String(h.Checklist_Revision || ''), plannedDate: start, plannedEndDate: dateKey(h.Planned_End_Date) || start, checklistStatus: String(h.Status || ''),
      completed: lifecycleCompleted, hasInspection: inspections.length > 0, reinspectionRequired, canBookReinspection: reinspectionRequired && !activeBooking,
      latestBaseInspectionId: String(latest.Base_Inspection_ID || ''),
      nextInspectionVersion: inspections.length ? 'V' + String(Number(latest.Version_Number || inspections.length) + 1).padStart(2, '0') : 'V01',
      editable: inspections.length === 0 && up(h.Status) === 'PUBLISHED' && (!start || today < start),
      bookingId: String(display.Booking_ID || ''), hasBooking: bookings.length > 0, activeBookingId: String(activeBooking ? activeBooking.Booking_ID : ''),
      qualityCode: String(display.Quality_Check_Code || latest.Quality_Check_Code || ''), bookingStatus: String(display.Status || ''), responseStatus: String(display.Response_Status || ''),
      qcEmail: low(display.QC_Email || latest.QC_Email || h.Assigned_QC_Email), suggestedQcEmail: low(h.Assigned_QC_Email),
      bookingDates: unique(dateMap[String(display.Booking_ID)] || []), latestInspectionVersion: String(latest.Inspection_Version_ID || ''),
      latestResult: String(latest.Overall_Result || ''), submittedAt: latest.Submitted_At || '', pdfUrl: String(latest.PDF_Link || ''), evidenceUrl: String(latest.Evidence_Archive_Folder_URL || ''),
      versionCount: inspections.length,
    };
  });
  const targets = await s.read('DPR_Targets'), results = await s.read('DPR_Results');
  const dayWiseRecords = (await s.read('DPR_Daily')).filter((d) => {
    if (!String(d.Evening_Updated_At || '').trim() && up(d.Report_Status) !== 'EOD UPDATED') return false;
    if (user.role === 'ADMIN' || user.role === 'GM') return true;
    return low((projectMap[String(d.Project_ID)] || {}).PM_Email) === low(user.email);
  }).map((d) => {
    const project = projectMap[String(d.Project_ID)] || {};
    const t = targets.filter((x) => String(x.DPR_ID || '') === String(d.DPR_ID || '') && up(x.Status || 'ACTIVE') === 'ACTIVE');
    const ids: Record<string, boolean> = {};
    t.forEach((x) => { ids[String(x.Target_ID || '')] = true; });
    const r = results.filter((x) => Boolean(ids[String(x.Target_ID || '')]));
    const ach = r.map((x) => Number(x.Achievement_Percent)).filter((n) => Number.isFinite(n));
    return {dprId: String(d.DPR_ID || ''), projectId: String(d.Project_ID || ''), projectNumber: String(project.Project_Number || d.Project_Number || d.Project_ID || ''),
      projectName: String(project.Project_Name || project.Client || d.Client || ''), client: String(project.Client || d.Client || ''), pmName: String(project.PM_Name || ''), pmEmail: low(project.PM_Email),
      workDate: dateKey(d.Work_Date), reportStatus: String(d.Report_Status || ''), workforce: Number(d.Morning_Worker_Total || 0), targetCount: t.length, resultCount: r.length,
      averageAchievement: ach.length ? Math.round(ach.reduce((a, b) => a + b, 0) / ach.length * 100) / 100 : '', eveningRemarks: String(d.Evening_Remarks || '')};
  }).sort((a, b) => b.workDate.localeCompare(a.workDate));
  return clientSafe({records, dayWiseRecords});
}

export async function getPmChecklistRecord(s: Site, projectChecklistId: any) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId);
  if (!header || up(header.Status) === 'DELETED') throw new SiteError('Checklist not found.');
  await assertProjectArchiveAccess(s, user, header.Project_ID);
  const items = (await s.filter('Project_Checklist_Items', (r) => String(r.Project_Checklist_ID) === String(projectChecklistId))).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  const inspections = (await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(projectChecklistId) && up(r.Void_Status || 'Active') !== 'VOID'))
    .sort((a, b) => Number(b.Version_Number || 0) - Number(a.Version_Number || 0));
  const ids: Record<string, boolean> = {};
  inspections.forEach((i) => { ids[String(i.Inspection_Version_ID)] = true; });
  const results = await s.filter('Inspection_Results', (r) => Boolean(ids[String(r.Inspection_Version_ID)]));
  const latestResult = inspections.length ? up(inspections[0].Overall_Result) : '';
  return clientSafe({project: (await s.find('Projects', 'Project_ID', header.Project_ID)) || {}, header, items, inspections, results, hasInspection: inspections.length > 0,
    completed: latestResult === 'COMPLETED - PASSED', reinspectionRequired: inspections.length > 0 && latestResult !== 'COMPLETED - PASSED'});
}

async function eligibleQcUsers(s: Site, project: Row, exclude = '') {
  return (await s.read('Users_Roles')).filter((r) => up(r.Role) === 'QC' && low(r.Active) === 'yes').map((r) => ({email: low(r.Email), name: String(r.Name || r.Email || ''), allowedProjects: String(r.Allowed_Project_IDs || '')}))
    .filter((q) => {
      const normalised = normaliseAllowedProjects(q.allowedProjects);
      const allowed = normalised.split(',').map((x) => x.trim()).filter(Boolean);
      return (!allowed.length || normalised === 'ALL' || allowed.indexOf(String(project.Project_ID)) >= 0 || allowed.indexOf(String(project.Project_Number || '')) >= 0) && q.email !== exclude;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getReinspectionBookingContext(s: Site, projectChecklistId: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId);
  if (!header || up(header.Status) !== 'PUBLISHED') throw new SiteError('Published checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  const latest = (await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(projectChecklistId) && up(r.Void_Status || 'Active') !== 'VOID'))
    .sort((a, b) => Number(b.Version_Number || 0) - Number(a.Version_Number || 0))[0];
  if (!latest) throw new SiteError('The initial inspection has not been submitted. Use the normal booking flow.');
  if (up(latest.Overall_Result) === 'COMPLETED - PASSED') throw new SiteError('This checklist has passed and does not require a re-site visit.');
  const active = (await s.read('QC_Booking_Header')).find((b) => String(b.Project_Checklist_ID) === String(projectChecklistId) && String(b.Base_Inspection_ID) === String(latest.Base_Inspection_ID) &&
    ['PENDING ACCEPTANCE', 'BOOKED', 'ACCEPTED'].indexOf(up(b.Status)) >= 0);
  if (active) throw new SiteError('A re-site visit is already active for this checklist: ' + active.Quality_Check_Code);
  const previousQcEmail = low(latest.QC_Email);
  // The QC app checks only Project_ID here (not the project number).
  const qcUsers = (await eligibleQcUsers(s, {Project_ID: header.Project_ID}, previousQcEmail));
  if (!qcUsers.length) throw new SiteError('A re-site visit must be assigned to a different active QC Engineer, but no other eligible QC Engineer is available for this project. Add or activate another QC Engineer before booking the next version.');
  return clientSafe({projectChecklistId, projectId: header.Project_ID, heading: header.Inspection_Heading, baseInspectionId: latest.Base_Inspection_ID,
    latestInspectionVersion: latest.Inspection_Version_ID, latestResult: latest.Overall_Result, nextInspectionVersion: 'V' + String(Number(latest.Version_Number || 0) + 1).padStart(2, '0'),
    previousQcEmail, suggestedQcEmail: qcUsers[0].email, qcUsers});
}

export async function getTemplateItems(s: Site, stage: any) {
  s.requireRole(['PM', 'ADMIN']);
  return clientSafe((await s.filter('Checklist_Library', (r) => r.Stage === stage && low(r.Active) === 'yes')).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0)));
}

export async function getChecklistForEditing(s: Site, projectChecklistId: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId);
  if (!header || up(header.Status) !== 'PUBLISHED') throw new SiteError('Editable published checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  const completed = (await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(projectChecklistId))).length > 0;
  const start = dateKey(header.Planned_Date);
  return clientSafe({header, items: (await s.filter('Project_Checklist_Items', (r) => String(r.Project_Checklist_ID) === String(projectChecklistId))).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0)),
    editable: !completed && (!start || s.todayKey() < start), completed});
}

// ---------- template library (was the shared Google workbook + "Sync templates") ----------

const TEMPLATE_HEADERS = ['Template_Item_ID', 'Template_Revision', 'Stage', 'Sequence', 'Checkpoint', 'Default_Acceptance_Criteria', 'Response_Type', 'Unit', 'Criticality',
  'Photo_Required', 'Hold_Point', 'Mandatory_Class', 'Source', 'Active'];
function generatedTemplateId(stage: string, revision: string, sequence: number) {
  const code = String(stage).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return 'CK-' + code + '-' + revision + '-' + String(sequence).padStart(3, '0');
}

export async function getTemplateLibrary(s: Site) {
  s.requireRole(['PM', 'ADMIN']);
  const rows = await s.read('Checklist_Library');
  return clientSafe({headers: TEMPLATE_HEADERS, rows: rows.map((r) => { const o: Row = {}; TEMPLATE_HEADERS.forEach((h) => { o[h] = r[h]; }); return o; }),
    activeCount: rows.filter((r) => r.Active === 'Yes').length, syncedAt: (await s.property('TEMPLATE_LIBRARY_SAVED_AT')) || ''});
}

/** Replace the whole library with validated rows — the same checks the Google-sheet sync made. */
export async function saveTemplateLibrary(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  const input = Array.isArray(payload?.rows) ? payload.rows : [];
  const values = input.map((r: any) => TEMPLATE_HEADERS.map((h) => String(r?.[h] ?? '').trim())).filter((row: string[]) => row.some((v) => v !== ''));
  if (!values.length) throw new SiteError('The shared template library contains no template rows.');
  const rows = values.map((out: any[], index: number) => {
    const sourceRow = index + 2;
    const revision = String(out[1]).toUpperCase(), stage = out[2], sequence = Number(out[3]), active = String(out[13]).toLowerCase();
    if (!/^R\d{2,3}$/.test(revision)) throw new SiteError('Invalid revision in shared template row ' + sourceRow + '. Use R01, R02, etc.');
    if (!stage || !Number.isInteger(sequence) || sequence < 1 || !out[4] || !out[5]) throw new SiteError('Row ' + sourceRow + ' requires Stage, positive Sequence, Checkpoint and Acceptance Criteria.');
    if (['yes', 'no'].indexOf(active) < 0) throw new SiteError('Active must be Yes or No in row ' + sourceRow + '.');
    out[1] = revision; out[3] = sequence; out[13] = active === 'yes' ? 'Yes' : 'No';
    if (!out[0]) out[0] = generatedTemplateId(stage, revision, sequence);
    if (!out[6]) out[6] = 'Assessment + observation';
    if (!out[8]) out[8] = 'Normal';
    if (!out[9]) out[9] = 'On failure';
    if (!out[10]) out[10] = 'No';
    if (!out[11]) out[11] = 'Project-specific';
    if (!out[12]) out[12] = 'Shared PM Template Library';
    return out;
  });
  const ids: Record<string, boolean> = {}, sequences: Record<string, boolean> = {}, activeRevisions: Record<string, Record<string, boolean>> = {};
  rows.forEach((row: any[]) => {
    if (ids[row[0]]) throw new SiteError('Duplicate Template_Item_ID: ' + row[0]);
    ids[row[0]] = true;
    const sk = row[2] + '|' + row[1] + '|' + row[3];
    if (sequences[sk]) throw new SiteError('Duplicate sequence for ' + row[2] + ' ' + row[1] + ': ' + row[3]);
    sequences[sk] = true;
    if (row[13] === 'Yes') (activeRevisions[row[2]] ||= {})[row[1]] = true;
  });
  Object.keys(activeRevisions).forEach((stage) => {
    const revisions = Object.keys(activeRevisions[stage]);
    if (revisions.length > 1) throw new SiteError(stage + ' has multiple active revisions: ' + revisions.join(', ') + '. Keep only one Active = Yes.');
  });
  await s.deleteWhere('Checklist_Library', () => true);
  await s.appendMany('Checklist_Library', rows.map((row: any[]) => { const o: Row = {}; TEMPLATE_HEADERS.forEach((h, i) => { o[h] = row[i]; }); return o; }));
  const activeCount = rows.filter((r: any[]) => r[13] === 'Yes').length;
  s.setProperty('TEMPLATE_LIBRARY_SAVED_AT', s.now().toISOString());
  await s.audit('TEMPLATE_LIBRARY_SYNCED', 'TEMPLATE_LIBRARY', 'Checklist_Library', '', 'SYNCED', {rows: rows.length, activeRows: activeCount, syncedBy: user.email});
  return {status: 'SYNCED', rowCount: rows.length, activeCount, syncedAt: s.now().toISOString()};
}

// ---------- drawings (the Drawing_Register tab was edited by hand in the sheet) ----------

export async function saveDrawingRecord(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectId || !String(payload.drawingNumber || '').trim() || !String(payload.revision || '').trim()) throw new SiteError('Project, drawing number and revision are required.');
  await assertProjectAccess(s, user, payload.projectId);
  const id = String(payload.drawingRecordId || '') || 'DRW-' + uuid().slice(0, 8).toUpperCase();
  const record = {Drawing_Record_ID: id, Project_ID: payload.projectId, Discipline: String(payload.discipline || '').trim(), Drawing_Number: String(payload.drawingNumber).trim(),
    Title: String(payload.title || '').trim(), Revision: String(payload.revision).trim(), Current: payload.current === false ? 'No' : 'Yes', File_Key: '', Uploaded_By: user.email, Uploaded_At: s.now()};
  const existing = await s.find('Drawing_Register', 'Drawing_Record_ID', id);
  if (existing) await s.update('Drawing_Register', 'Drawing_Record_ID', id, record);
  else await s.append('Drawing_Register', record);
  await s.audit('DRAWING_RECORD_SAVED', 'DRAWING', id, existing ? existing.Revision : '', record.Revision, {projectId: payload.projectId});
  return {drawingRecordId: id};
}

// ---------- QC calendar and bookings ----------

export async function getSchedulingWorkspace(s: Site, year: any, month: any) {
  const user = s.requireRole(['PM', 'QC', 'ADMIN', 'GM']);
  const y = Number(year), m = Number(month);
  if (!Number.isInteger(y) || y < 2020 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) throw new SiteError('Select a valid calendar month and year.');
  const startKey = `${y}-${String(m).padStart(2, '0')}-01`, endKey = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const qcUsers = (await s.read('Users_Roles')).filter((r) => up(r.Role) === 'QC' && low(r.Active) === 'yes').filter((r) => user.role !== 'QC' || low(r.Email) === user.email)
    .map((r) => ({email: low(r.Email), name: String(r.Name || r.Email), allowedProjects: String(r.Allowed_Project_IDs || '')})).sort((a, b) => a.name.localeCompare(b.name));
  const monthDates = await s.filter('QC_Booking_Dates', (r) => { const k = dateKey(r.Visit_Date); return k >= startKey && k <= endKey && up(r.Status) !== 'CANCELLED' && (user.role !== 'QC' || low(r.QC_Email) === user.email); });
  const needed: Record<string, boolean> = {};
  monthDates.forEach((r) => { needed[String(r.Booking_ID)] = true; });
  const headers: Record<string, Row> = {}, projectMap: Record<string, Row> = {};
  (await s.read('Projects')).forEach((p) => { projectMap[String(p.Project_ID)] = p; });
  (await s.read('QC_Booking_Header')).forEach((r) => { if (needed[String(r.Booking_ID)]) headers[String(r.Booking_ID)] = r; });
  const bookings = monthDates.map((r) => {
    const h = headers[String(r.Booking_ID)] || {};
    const project = projectMap[String(h.Project_ID || r.Project_ID)] || {};
    const qcEmail = low(r.QC_Email || h.QC_Email);
    const owns = user.role === 'ADMIN' || user.role === 'GM' || (user.role === 'QC' && qcEmail === user.email) || (user.role === 'PM' && low(project.PM_Email) === user.email);
    return {
      bookingId: owns ? String(r.Booking_ID || '') : 'BUSY-' + qcEmail + '-' + dateKey(r.Visit_Date), qualityCode: owns ? String(r.Quality_Check_Code || h.Quality_Check_Code || '') : 'BUSY',
      qcEmail, visitDate: dateKey(r.Visit_Date), daySequence: Number(r.Day_Sequence || 0), status: String(r.Status || h.Status || ''),
      projectNumber: owns ? String(h.Project_Number || project.Project_Number || h.Project_ID || r.Project_ID || '') : '', projectName: owns ? String(project.Project_Name || '') : '',
      client: owns ? String(h.Client || '') : '', location: owns ? String(h.Site_Location || '') : '', uploadFolderUrl: owns ? String(h.Upload_Folder_URL || '') : '',
      bookingStatus: String(h.Status || r.Status || ''), purpose: owns ? String(h.Booking_Purpose || 'CHECKLIST') : 'BUSY', otherReason: owns ? String(h.Other_Reason || '') : '',
      responseStatus: String(h.Response_Status || (up(h.Status) === 'BOOKED' ? 'ACCEPTED' : '')), notes: owns ? String(h.Notes || '') : '',
      projectChecklistId: owns ? String(h.Project_Checklist_ID || '') : '',
      canManage: user.role === 'ADMIN' || user.role === 'GM' || (user.role === 'PM' && low(project.PM_Email) === user.email),
    };
  });
  const unavailable = (await s.filter('QC_Unavailability', (r) => { const k = dateKey(r.Date); return k >= startKey && k <= endKey && up(r.Status) === 'ACTIVE' && (user.role !== 'QC' || low(r.QC_Email) === user.email); }))
    .map((r) => ({qcEmail: low(r.QC_Email), date: dateKey(r.Date), type: String(r.Type || 'Blocked')}));
  const projects = (await getProjectsForUser(s, user)).map((p) => ({projectId: String(p.Project_ID || ''), projectNumber: String(p.Project_Number || ''), projectName: String(p.Project_Name || ''),
    location: String(p.Location || ''), status: String(p.Status || ''), milestone: String(p.Milestone || ''), client: String(p.Client || ''),
    siteEngineerName: String(p.Site_Engineer_Name || ''), siteEngineerEmail: String(p.Site_Engineer_Email || '')}));
  const owned: Record<string, boolean> = {};
  projects.forEach((p) => { owned[p.projectId] = true; });
  const checklists = user.role === 'QC' ? [] : await s.filter('Project_Checklist_Header', (r) => up(r.Status) === 'PUBLISHED' && (user.role === 'ADMIN' || user.role === 'GM' || Boolean(owned[String(r.Project_ID)])));
  const latestByBase: Record<string, Row> = {};
  (user.role === 'QC' ? [] : await s.read('Inspection_Header')).filter((r) => up(r.Void_Status || 'Active') !== 'VOID' && (user.role === 'ADMIN' || user.role === 'GM' || Boolean(owned[String(r.Project_ID)])))
    .forEach((r) => { const k = String(r.Base_Inspection_ID || ''); if (k && (!latestByBase[k] || Number(r.Version_Number || 0) > Number(latestByBase[k].Version_Number || 0))) latestByBase[k] = r; });
  return clientSafe({
    year: y, month: m, qcUsers, bookings, unavailable, projects,
    checklists: checklists.map((c) => ({projectChecklistId: String(c.Project_Checklist_ID || ''), projectId: String(c.Project_ID || ''), heading: String(c.Inspection_Heading || ''), stage: String(c.Stage || ''),
      revision: String(c.Checklist_Revision || ''), plannedDate: dateKey(c.Planned_Date), plannedEndDate: dateKey(c.Planned_End_Date)})),
    reinspections: Object.keys(latestByBase).map((k) => latestByBase[k]).map((r) => ({baseInspectionId: String(r.Base_Inspection_ID || ''), inspectionVersionId: String(r.Inspection_Version_ID || ''),
      versionNumber: Number(r.Version_Number || 0), projectId: String(r.Project_ID || ''), projectChecklistId: String(r.Project_Checklist_ID || ''), heading: String(r.Inspection_Heading || ''), result: String(r.Overall_Result || '')})),
    dailyCapacity: Math.max(1, Number((await s.config('QC_DAILY_CAPACITY')) || 1)),
  });
}

async function createQualityCheckCode(s: Site, project: Row, checklist: Row) {
  const key = 'QUALITY_CODE_COUNTER_' + project.Project_ID;
  const next = Number((await s.property(key)) || 0) + 1;
  s.setProperty(key, next);
  const projectNo = String(project.Project_Number || project.Project_ID).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);
  return 'QCK-' + projectNo + '-' + stageCode(checklist.Stage) + '-' + String(next).padStart(3, '0');
}

async function upsertBookingAssignment(s: Site, bookingId: string, qualityCode: string, checklist: Row, qcEmail: string, pmEmail: string, dates: string[], baseInspectionId: string) {
  const candidates = await s.filter('Assignments', (a) => a.Project_Checklist_ID === checklist.Project_Checklist_ID && up(a.Status) === 'AWAITING BOOKING');
  const changes = {Assigned_To_Email: qcEmail, Assigned_By_Email: pmEmail, Due_Date: parseDateKey(dates[dates.length - 1]), Status: 'PENDING ACCEPTANCE', Booking_ID: bookingId,
    Quality_Check_Code: qualityCode, Notes: JSON.stringify({baseInspectionId: baseInspectionId || '', bookingDates: dates})};
  if (candidates.length) await s.update('Assignments', 'Assignment_ID', candidates[candidates.length - 1].Assignment_ID, changes);
  else await s.append('Assignments', {Assignment_ID: 'ASN-' + uuid().slice(0, 8).toUpperCase(), Project_Checklist_ID: checklist.Project_Checklist_ID, Project_ID: checklist.Project_ID,
    Assignment_Type: baseInspectionId ? 'REINSPECTION' : 'INITIAL INSPECTION', Created_At: s.now(), Completed_At: '', ...changes});
}

async function assertQcFree(s: Site, qc: Row, qcEmail: string, dates: string[], excludeBookingId = '') {
  const capacity = Math.max(1, Number((await s.config('QC_DAILY_CAPACITY')) || 1));
  const active = await s.filter('QC_Booking_Dates', (r) => low(r.QC_Email) === qcEmail && activeCapacityStatus(r.Status) && String(r.Booking_ID) !== excludeBookingId);
  const blocks = await s.filter('QC_Unavailability', (r) => low(r.QC_Email) === qcEmail && up(r.Status) === 'ACTIVE');
  for (const d of dates) {
    if (active.filter((r) => dateKey(r.Visit_Date) === d).length >= capacity) throw new SiteError(qc.Name + (excludeBookingId ? ' is fully booked on ' : ' is already fully booked on ') + d + '.');
    const block = blocks.find((r) => dateKey(r.Date) === d);
    if (block) throw new SiteError(qc.Name + ' is unavailable on ' + d + ': ' + block.Type);
  }
}

export async function createQcBooking(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  const purpose = up(payload?.bookingPurpose || 'CHECKLIST'), isOther = purpose === 'OTHER';
  if (!payload || !payload.projectId || (!isOther && !payload.projectChecklistId) || !payload.qcEmail || !Array.isArray(payload.dates) || !payload.dates.length) {
    throw new SiteError(isOther ? 'Project, QC Engineer and at least one visit date are required.' : 'Project, published checklist, QC Engineer and at least one visit date are required.');
  }
  if (isOther && !String(payload.otherReason || '').trim()) throw new SiteError('Enter the reason for an Other site visit.');
  await assertProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  const checklist = isOther ? null : await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload.projectChecklistId);
  if (!project || (!isOther && (!checklist || String(checklist.Project_ID) !== String(payload.projectId) || up(checklist.Status) !== 'PUBLISHED'))) throw new SiteError('A published checklist belonging to the selected project is required.');
  if (checklist) await assertChecklistOwner(s, user, checklist);
  const qcEmail = low(payload.qcEmail);
  const qc = await activeQcUser(s, qcEmail);
  if (!qc) throw new SiteError('Selected QC Engineer is not active.');
  const qcAccess = normaliseAllowedProjects(qc.Allowed_Project_IDs);
  const qcProjects = qcAccess.split(',').map((x) => x.trim()).filter(Boolean);
  // A blank list means the QC is a shared company resource; a list restricts them.
  if (qcProjects.length && qcAccess !== 'ALL' && qcProjects.indexOf(String(payload.projectId)) < 0 && qcProjects.indexOf(String(project.Project_Number || '')) < 0) {
    throw new SiteError('Selected QC Engineer is not authorised for this project. Update the user\'s project access before booking.');
  }
  if (['COMPLETED', 'CANCELLED', 'CANCELED', 'CLOSED'].indexOf(up(project.Status)) >= 0) throw new SiteError('New QC bookings are disabled because this project is inactive or closed.');
  if (payload.dates.length > 31) throw new SiteError('A single booking cannot contain more than 31 visit dates.');
  const dates: string[] = unique(payload.dates.map(dateKey));
  if (dates.some((d) => !isValidDateKey(d))) throw new SiteError('One or more booking dates are invalid.');
  if (dates.some((d) => d < s.todayKey())) throw new SiteError('Past dates cannot be booked.');
  const requestedBookingId = String(payload.clientRequestId || '').trim();
  if (requestedBookingId) {
    if (!/^BKG-WEB-[A-Za-z0-9-]{8,80}$/.test(requestedBookingId)) throw new SiteError('Invalid booking request identifier. Reload the calendar and retry.');
    const existing = await s.find('QC_Booking_Header', 'Booking_ID', requestedBookingId);
    if (existing) {
      if (String(existing.Project_ID) !== String(payload.projectId) || String(existing.Project_Checklist_ID || '') !== String(payload.projectChecklistId || '') || low(existing.QC_Email) !== qcEmail) {
        throw new SiteError('This booking request identifier is already attached to a different booking. Reload the calendar.');
      }
      const existingDates = (await s.filter('QC_Booking_Dates', (r) => String(r.Booking_ID) === requestedBookingId && up(r.Status) !== 'CANCELLED')).map((r) => dateKey(r.Visit_Date)).sort();
      return clientSafe({bookingId: requestedBookingId, qualityCheckCode: existing.Quality_Check_Code, dates: existingDates, status: existing.Status, uploadFolderUrl: existing.Upload_Folder_URL || '', duplicateRequest: true});
    }
  }
  if (!isOther && !payload.baseInspectionId) {
    const initial = (await s.read('QC_Booking_Header')).find((r) => String(r.Project_Checklist_ID) === String(checklist!.Project_Checklist_ID) && !String(r.Base_Inspection_ID || '').trim() &&
      ['BOOKED', 'PENDING ACCEPTANCE', 'ACCEPTED', 'COMPLETED'].indexOf(up(r.Status)) >= 0);
    if (initial) throw new SiteError('This checklist already has an initial QC booking (' + initial.Quality_Check_Code + '). Cancel the active booking or use a reinspection Base ID.');
  }
  if (!isOther && payload.baseInspectionId) {
    const dup = (await s.read('QC_Booking_Header')).find((r) => String(r.Project_Checklist_ID) === String(checklist!.Project_Checklist_ID) && String(r.Base_Inspection_ID) === String(payload.baseInspectionId) &&
      ['PENDING ACCEPTANCE', 'BOOKED', 'ACCEPTED'].indexOf(up(r.Status)) >= 0);
    if (dup) throw new SiteError('A re-site visit is already active for this checklist (' + dup.Quality_Check_Code + '). Edit or cancel that booking instead.');
  }
  await assertQcFree(s, qc, qcEmail, dates);
  const bookingId = requestedBookingId || 'BKG-' + formatDate(s.now(), 'yyyyMMdd') + '-' + uuid().slice(0, 6).toUpperCase();
  let qualityCode: string;
  if (isOther) qualityCode = 'VISIT-' + String(project.Project_Number || project.Project_ID).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) + '-' + uuid().slice(0, 5).toUpperCase();
  else if (payload.baseInspectionId) {
    const latest = await latestInspectionVersion(s, payload.baseInspectionId);
    if (!latest) throw new SiteError('Reinspection base ID not found.');
    if (String(latest.Project_ID) !== String(payload.projectId) || String(latest.Project_Checklist_ID) !== String(payload.projectChecklistId)) throw new SiteError('The selected reinspection version does not belong to this project and checklist.');
    qualityCode = latest.Quality_Check_Code || String(payload.baseInspectionId).replace(/^QCI-/, 'QCK-');
  } else qualityCode = await createQualityCheckCode(s, project, checklist!);
  const evidenceBase = isOther ? '' : evidenceBaseId(qualityCode, payload.baseInspectionId || '');
  // Evidence folders are created when the QC opens the inspection, as before.
  await s.append('QC_Booking_Header', {
    Booking_ID: bookingId, Quality_Check_Code: qualityCode, Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client, Site_Location: project.Location,
    Project_Checklist_ID: checklist ? checklist.Project_Checklist_ID : '', Inspection_Heading: checklist ? checklist.Inspection_Heading : String(payload.otherReason).trim(),
    Stage: checklist ? checklist.Stage : 'OTHER SITE VISIT', QC_Email: qcEmail, PM_Email: user.email, Status: 'PENDING ACCEPTANCE', Created_At: s.now(), Created_By: user.email,
    Cancelled_At: '', Cancelled_By: '', Cancellation_Reason: '', Notes: payload.notes || '', Base_Inspection_ID: payload.baseInspectionId || '',
    Inspection_Folder_ID: '', Inspection_Folder_URL: '', Upload_Folder_ID: '', Upload_Folder_URL: '', Upload_Status: 'PENDING', Upload_Opened_At: '', Upload_Closed_At: '',
    Booking_Purpose: isOther ? 'OTHER' : 'CHECKLIST', Other_Reason: isOther ? String(payload.otherReason).trim() : '', Response_Status: 'PENDING', Responded_At: '', Responded_By: '',
    Rejection_Reason: '', Updated_At: '', Updated_By: ''});
  await s.appendMany('QC_Booking_Dates', dates.map((d, i) => ({Booking_ID: bookingId, Quality_Check_Code: qualityCode, QC_Email: qcEmail, Visit_Date: parseDateKey(d), Day_Sequence: i + 1,
    Status: 'PENDING ACCEPTANCE', Project_ID: project.Project_ID, Site_Location: project.Location, Created_At: s.now()})));
  if (!isOther) await upsertBookingAssignment(s, bookingId, qualityCode, checklist!, qcEmail, user.email, dates, payload.baseInspectionId || '');
  await s.audit('QC_SLOT_BOOKED', 'QC_BOOKING', bookingId, '', 'PENDING ACCEPTANCE', {qualityCode, qcEmail, dates, projectId: project.Project_ID, evidenceBaseId: evidenceBase});
  const earlierInitial = isOther ? true : (await s.read('QC_Booking_Header')).some((r) => r.Booking_ID !== bookingId && String(r.Project_Checklist_ID) === String(checklist!.Project_Checklist_ID) && !String(r.Base_Inspection_ID || '').trim());
  if (!isOther && !payload.baseInspectionId && !earlierInitial) {
    const label = dates.length > 1 ? dates[0] + ' to ' + dates[dates.length - 1] : dates[0];
    notifyAfterCommit(s, 'QC_SLOT_BOOKED', bookingId, qcEmail, '[BILARA QC BOOKING] ' + project.Project_Number + ' | ' + checklist!.Inspection_Heading + ' | Visit ' + label + ' | ' + qualityCode,
      emailBody('A project manager has booked your first QC site-visit slot for this inspection.', checklist!, {'Quality-check code': qualityCode, Project: project.Project_Number + ' — ' + project.Project_Name,
        Client: project.Client, Location: project.Location, 'Visit dates': dates.join(', '), 'Booking ID': bookingId, 'Evidence upload folder': 'Created automatically when the QC opens the inspection'}));
  }
  return clientSafe({bookingId, qualityCheckCode: qualityCode, dates, status: 'PENDING ACCEPTANCE', uploadFolderUrl: ''});
}

export async function cancelQcBooking(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', payload?.bookingId);
  if (!booking) throw new SiteError('Booking not found.');
  await assertProjectAccess(s, user, booking.Project_ID);
  await assertBookingOwner(s, user, booking);
  if (up(booking.Status) === 'COMPLETED') throw new SiteError('Completed bookings cannot be cancelled.');
  if (up(booking.Status) === 'CANCELLED') return {status: 'CANCELLED'};
  await closeBookingUpload(s, booking, 'CANCELLED', user.email);
  await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, {Status: 'CANCELLED', Cancelled_At: s.now(), Cancelled_By: user.email, Cancellation_Reason: payload.reason || ''});
  await s.updateWhere('QC_Booking_Dates', (r) => r.Booking_ID === booking.Booking_ID, {Status: 'CANCELLED'});
  await s.updateWhere('Assignments', (r) => r.Booking_ID === booking.Booking_ID, {Status: 'CANCELLED', Completed_At: s.now()});
  await s.audit('QC_BOOKING_CANCELLED', 'QC_BOOKING', booking.Booking_ID, booking.Status, 'CANCELLED', {reason: payload.reason || ''});
  return {status: 'CANCELLED'};
}

export async function updateQcBooking(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  if (!payload || !payload.bookingId || !payload.qcEmail || !Array.isArray(payload.dates) || !payload.dates.length) throw new SiteError('Booking, QC Engineer and visit dates are required.');
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', payload.bookingId);
  if (!booking) throw new SiteError('Booking not found.');
  await assertProjectAccess(s, user, booking.Project_ID);
  await assertBookingOwner(s, user, booking);
  if (['COMPLETED', 'CANCELLED'].indexOf(up(booking.Status)) >= 0) throw new SiteError('Completed or cancelled bookings cannot be edited.');
  if ((await s.filter('Inspection_Header', (r) => String(r.Booking_ID) === String(booking.Booking_ID))).length) throw new SiteError('This inspection has already been submitted and cannot be edited.');
  const dates: string[] = unique(payload.dates.map(dateKey));
  if (!dates.length || dates.length > 31 || dates.some((d) => !isValidDateKey(d))) throw new SiteError('Select between 1 and 31 valid visit dates.');
  if (dates[0] < s.todayKey()) throw new SiteError('Past dates cannot be assigned.');
  const qcEmail = low(payload.qcEmail);
  const qc = await activeQcUser(s, qcEmail);
  if (!qc) throw new SiteError('Selected QC Engineer is not active.');
  const allowed = String(qc.Allowed_Project_IDs || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allowed.length && allowed.indexOf('ALL') < 0 && allowed.indexOf(String(booking.Project_ID)) < 0) throw new SiteError('Selected QC Engineer is not authorised for this project.');
  await assertQcFree(s, qc, qcEmail, dates, String(booking.Booking_ID));
  const oldDates = (await s.filter('QC_Booking_Dates', (r) => String(r.Booking_ID) === String(booking.Booking_ID) && activeCapacityStatus(r.Status))).map((r) => dateKey(r.Visit_Date)).sort();
  const reset = qcEmail !== low(booking.QC_Email) || dates.join('|') !== oldDates.join('|');
  const newStatus = reset ? 'PENDING ACCEPTANCE' : booking.Status;
  await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, {QC_Email: qcEmail, Notes: payload.notes || '', Status: newStatus, Response_Status: reset ? 'PENDING' : booking.Response_Status,
    Responded_At: reset ? '' : booking.Responded_At, Responded_By: reset ? '' : booking.Responded_By, Rejection_Reason: '', Updated_At: s.now(), Updated_By: user.email});
  await s.updateWhere('QC_Booking_Dates', (r) => String(r.Booking_ID) === String(booking.Booking_ID), {Status: 'CANCELLED'});
  await s.appendMany('QC_Booking_Dates', dates.map((d, i) => ({Booking_ID: booking.Booking_ID, Quality_Check_Code: booking.Quality_Check_Code, QC_Email: qcEmail, Visit_Date: parseDateKey(d), Day_Sequence: i + 1,
    Status: newStatus, Project_ID: booking.Project_ID, Site_Location: booking.Site_Location, Created_At: s.now()})));
  await s.updateWhere('Assignments', (r) => String(r.Booking_ID) === String(booking.Booking_ID), {Assigned_To_Email: qcEmail, Due_Date: parseDateKey(dates[dates.length - 1]), Status: newStatus,
    Reassigned_From: qcEmail !== low(booking.QC_Email) ? booking.QC_Email : ''});
  await s.audit('QC_BOOKING_UPDATED', 'QC_BOOKING', booking.Booking_ID, booking.Status, newStatus, {qcEmail, dates});
  return {status: newStatus, dates};
}

export async function getBookingForEditing(s: Site, bookingId: any) {
  const user = s.requireRole(['PM', 'ADMIN', 'GM']);
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', bookingId);
  if (!booking) throw new SiteError('Booking not found.');
  await assertProjectAccess(s, user, booking.Project_ID);
  await assertBookingOwner(s, user, booking);
  const submitted = (await s.filter('Inspection_Header', (r) => String(r.Booking_ID) === String(booking.Booking_ID))).length > 0;
  const editable = !submitted && ['COMPLETED', 'CANCELLED'].indexOf(up(booking.Status)) < 0;
  const dates = (await s.filter('QC_Booking_Dates', (r) => String(r.Booking_ID) === String(booking.Booking_ID) && up(r.Status) !== 'CANCELLED')).map((r) => dateKey(r.Visit_Date)).sort();
  const project = (await s.find('Projects', 'Project_ID', booking.Project_ID)) || {Project_ID: booking.Project_ID};
  return clientSafe({booking, dates, qcUsers: await eligibleQcUsers(s, project), editable, submitted});
}

export async function respondToQcBooking(s: Site, payload: any) {
  const user = s.requireRole(['QC']);
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', payload?.bookingId);
  if (!booking) throw new SiteError('Booking not found.');
  if (low(booking.QC_Email) !== user.email) throw new SiteError('This booking is assigned to another QC Engineer.');
  if (['COMPLETED', 'CANCELLED'].indexOf(up(booking.Status)) >= 0) throw new SiteError('This booking is already closed.');
  const response = up(payload.response);
  if (['ACCEPTED', 'REJECTED'].indexOf(response) < 0) throw new SiteError('Choose Accept or Reject.');
  if (response === 'REJECTED' && !String(payload.reason || '').trim()) throw new SiteError('Enter a reason for rejection.');
  const status = response === 'ACCEPTED' ? 'BOOKED' : 'REJECTED';
  await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, {Status: status, Response_Status: response, Responded_At: s.now(), Responded_By: user.email, Rejection_Reason: response === 'REJECTED' ? String(payload.reason).trim() : ''});
  await s.updateWhere('QC_Booking_Dates', (r) => String(r.Booking_ID) === String(booking.Booking_ID) && up(r.Status) !== 'CANCELLED', {Status: status});
  await s.updateWhere('Assignments', (r) => String(r.Booking_ID) === String(booking.Booking_ID), {Status: status});
  await s.audit('QC_BOOKING_' + response, 'QC_BOOKING', booking.Booking_ID, booking.Status, status, {reason: payload.reason || ''});
  return {status};
}

export async function addQcUnavailability(s: Site, payload: any) {
  const user = s.requireRole(['QC', 'ADMIN', 'GM']);
  const qcEmail = (user.role === 'ADMIN' || user.role === 'GM') && payload?.qcEmail ? low(payload.qcEmail) : user.email;
  const date = dateKey(payload?.date);
  if (!isValidDateKey(date)) throw new SiteError('Select a valid date.');
  const requestedType = String(payload.type || 'Blocked').trim();
  if (up(requestedType) === 'OTHER' && !String(payload.notes || '').trim()) throw new SiteError('Enter the reason for Other unavailability.');
  if ((await s.filter('QC_Booking_Dates', (r) => low(r.QC_Email) === qcEmail && dateKey(r.Visit_Date) === date && activeCapacityStatus(r.Status))).length) throw new SiteError('This date already has a confirmed booking and cannot be blocked.');
  const id = 'UNAV-' + uuid();
  await s.append('QC_Unavailability', {Unavailability_ID: id, QC_Email: qcEmail, Date: parseDateKey(date), Type: up(requestedType) === 'OTHER' ? 'Other — ' + String(payload.notes).trim() : requestedType,
    Notes: payload.notes || '', Status: 'ACTIVE', Created_By: user.email, Created_At: s.now()});
  await s.audit('QC_DATE_BLOCKED', 'QC_UNAVAILABILITY', id, '', 'ACTIVE', {qcEmail, date, type: payload.type});
  return {unavailabilityId: id, status: 'ACTIVE'};
}

export async function createReinspectionBooking(s: Site, payload: any) {
  const user = s.requireRole(['PM', 'ADMIN']);
  if (!payload || !payload.projectChecklistId || !payload.qcEmail || !Array.isArray(payload.dates) || !payload.dates.length) throw new SiteError('Checklist, QC Engineer and re-site visit dates are required.');
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload.projectChecklistId);
  if (!header || up(header.Status) !== 'PUBLISHED') throw new SiteError('Published checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  await assertChecklistOwner(s, user, header);
  const latest = (await s.filter('Inspection_Header', (r) => String(r.Project_Checklist_ID) === String(header.Project_Checklist_ID) && up(r.Void_Status || 'Active') !== 'VOID'))
    .sort((a, b) => Number(b.Version_Number || 0) - Number(a.Version_Number || 0))[0];
  if (!latest) throw new SiteError('The initial inspection has not been submitted. Use the normal QC booking flow.');
  if (up(latest.Overall_Result) === 'COMPLETED - PASSED') throw new SiteError('This checklist has already passed. A re-site visit is not required.');
  const requested = low(payload.qcEmail), previous = low(latest.QC_Email);
  if (requested === previous) throw new SiteError('A failed or partial inspection must be rechecked by a different QC Engineer. Select someone other than ' + previous + '.');
  const active = (await s.read('QC_Booking_Header')).find((b) => String(b.Project_Checklist_ID) === String(header.Project_Checklist_ID) && String(b.Base_Inspection_ID) === String(latest.Base_Inspection_ID) &&
    ['PENDING ACCEPTANCE', 'BOOKED', 'ACCEPTED'].indexOf(up(b.Status)) >= 0);
  if (active) throw new SiteError('A re-site visit is already booked for this checklist: ' + active.Quality_Check_Code);
  const nextVersion = 'V' + String(Number(latest.Version_Number || 0) + 1).padStart(2, '0');
  return createQcBooking(s, {projectId: header.Project_ID, projectChecklistId: header.Project_Checklist_ID, qcEmail: requested, dates: payload.dates, baseInspectionId: latest.Base_Inspection_ID,
    notes: 'Re-site visit for automatic ' + nextVersion + ' after ' + latest.Inspection_Version_ID + (String(payload.notes || '').trim() ? ' — ' + String(payload.notes).trim() : ''),
    clientRequestId: payload.clientRequestId || '', bookingPurpose: 'CHECKLIST'});
}

// ---------- QC: assignments and inspections ----------

/** The QC's open bookings (bootstrap assignments). */
export async function getAssignments(s: Site, user: SiteUser) {
  const headerMap: Record<string, Row> = {}, projectMap: Record<string, Row> = {}, dateMap: Record<string, string[]> = {};
  (await s.read('Project_Checklist_Header')).forEach((h) => { headerMap[String(h.Project_Checklist_ID)] = h; });
  (await s.read('Projects')).forEach((p) => { projectMap[String(p.Project_ID)] = p; });
  (await s.read('QC_Booking_Dates')).forEach((d) => { if (up(d.Status) !== 'CANCELLED') (dateMap[String(d.Booking_ID)] ||= []).push(dateKey(d.Visit_Date)); });
  return (await s.read('QC_Booking_Header')).filter((b) => up(b.Booking_Purpose || 'CHECKLIST') !== 'OTHER' && ['PENDING ACCEPTANCE', 'BOOKED', 'ACCEPTED', 'IN PROGRESS'].indexOf(up(b.Status)) >= 0 &&
    (user.role === 'ADMIN' || low(b.QC_Email) === user.email)).map((b) => {
    const h = headerMap[String(b.Project_Checklist_ID)] || {}, project = projectMap[String(b.Project_ID || h.Project_ID)] || {};
    const dates: string[] = unique(dateMap[String(b.Booking_ID)] || []);
    return {Assignment_ID: '', Booking_ID: b.Booking_ID, Project_Checklist_ID: b.Project_Checklist_ID, Project_ID: b.Project_ID || h.Project_ID,
      Project_Number: b.Project_Number || project.Project_Number || b.Project_ID || '', Quality_Check_Code: b.Quality_Check_Code, Assigned_To_Email: b.QC_Email,
      Due_Date: dates.length ? dates[dates.length - 1] : '', Booking_Dates: dates, Inspection_Heading: b.Inspection_Heading || h.Inspection_Heading || '', Stage: b.Stage || h.Stage || '',
      Location_Floor_Grid: h.Location_Floor_Grid || '', Base_Inspection_ID: b.Base_Inspection_ID || '', Inspection_Folder_URL: b.Inspection_Folder_URL || '', Upload_Folder_URL: b.Upload_Folder_URL || '',
      Upload_Status: b.Upload_Status || '', Booking_Status: b.Status || '', Response_Status: b.Response_Status || '', Rejection_Reason: b.Rejection_Reason || '', Notes: b.Notes || ''};
  }).sort((a, b) => String(a.Due_Date || '').localeCompare(String(b.Due_Date || '')));
}

export async function getInspectionForExecution(s: Site, projectChecklistId: any, baseInspectionId: any, bookingId: any) {
  const user = s.requireRole(['QC', 'ADMIN']);
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', projectChecklistId);
  if (!header) throw new SiteError('Published project checklist not found.');
  await assertProjectAccess(s, user, header.Project_ID);
  const items = (await s.filter('Project_Checklist_Items', (r) => r.Project_Checklist_ID === projectChecklistId && low(r.Applicable) !== 'no')).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  const prior = baseInspectionId ? await latestInspectionVersion(s, baseInspectionId) : null;
  const priorResults = prior ? await s.filter('Inspection_Results', (r) => r.Inspection_Version_ID === prior.Inspection_Version_ID) : [];
  let booking = bookingId ? await s.find('QC_Booking_Header', 'Booking_ID', bookingId) : null;
  if (user.role !== 'ADMIN') {
    if (!booking || !isConfirmedBookingStatus(booking.Status)) throw new SiteError('Accept this QC Calendar booking before starting the inspection.');
    if (low(booking.QC_Email) !== user.email) throw new SiteError('This booking belongs to another QC Engineer.');
    if (String(booking.Project_Checklist_ID) !== String(projectChecklistId)) throw new SiteError('Booking and checklist do not match.');
  }
  // The upload folder is opened when the QC first opens the inspection.
  if (booking && isConfirmedBookingStatus(booking.Status) && !String(booking.Upload_Folder_ID || '').trim()) {
    const project = await s.find('Projects', 'Project_ID', header.Project_ID);
    if (!project) throw new SiteError('The project linked to this inspection was not found.');
    const baseId = evidenceBaseId(booking.Quality_Check_Code, booking.Base_Inspection_ID || baseInspectionId || '');
    const latestForBase = await latestInspectionVersion(s, baseId);
    const label = 'V' + String(latestForBase ? Number(latestForBase.Version_Number || 0) + 1 : 1).padStart(2, '0');
    const changes = bookingFolderChanges(s, bundleFor(header.Project_ID, baseId, label));
    await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, changes);
    booking = {...booking, ...changes};
  }
  const uploads = booking && booking.Upload_Folder_ID ? (await listFiles(String(booking.Upload_Folder_ID))).map((f) => ({...f, name: f.key.split('/').pop(), url: fileLink(f.key)})) : [];
  return clientSafe({header, items, prior, priorResults, booking, uploads});
}

function commitResponse(header: Row, duplicate: boolean) {
  return {baseInspectionId: header.Base_Inspection_ID, inspectionVersionId: header.Inspection_Version_ID, versionNumber: Number(header.Version_Number || 0), overallResult: header.Overall_Result,
    pdfUrl: header.PDF_Link || '', evidenceFolderUrl: header.Evidence_Archive_Folder_URL || '', evidenceStatus: header.Evidence_Status || (header.PDF_Link ? 'COMPLETE' : 'UPLOAD PENDING'),
    alreadySaved: Boolean(duplicate), dataSaved: true};
}
async function createBaseInspectionId(s: Site, header: Row) {
  const project = (await s.find('Projects', 'Project_ID', header.Project_ID)) || {};
  const projectNo = String(project.Project_Number || header.Project_ID).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);
  const date = formatDate(s.now(), 'yyyyMMdd'), key = 'INSPECTION_COUNTER_' + header.Project_ID + '_' + date;
  const next = Number((await s.property(key)) || 0) + 1;
  s.setProperty(key, next);
  return ((await s.config('INSPECTION_PREFIX')) || 'QCI') + '-' + projectNo + '-' + stageCode(header.Stage) + '-' + date + '-' + String(next).padStart(3, '0');
}
async function drawingRevisions(s: Site, header: Row) {
  const rev = async (id: any) => { const r = id ? await s.find('Drawing_Register', 'Drawing_Record_ID', id) : null; return r ? r.Drawing_Number + ' / ' + r.Revision : ''; };
  return {arch: String(header.Architectural_Drawing_Revision_Text || '').trim() || await rev(header.Architectural_Drawing_Record_ID),
    structural: String(header.Structural_Drawing_Revision_Text || '').trim() || await rev(header.Structural_Drawing_Record_ID),
    mep: String(header.MEP_Drawing_Revision_Text || '').trim() || await rev(header.MEP_Drawing_Record_ID)};
}
async function markAssignmentCompleted(s: Site, projectChecklistId: string, qcEmail: string) {
  const c = await s.filter('Assignments', (a) => a.Project_Checklist_ID === projectChecklistId && low(a.Assigned_To_Email) === qcEmail && up(a.Status) !== 'COMPLETED');
  if (c.length) await s.update('Assignments', 'Assignment_ID', c[c.length - 1].Assignment_ID, {Status: 'COMPLETED', Completed_At: s.now()});
}
async function completeBooking(s: Site, bookingId: string) {
  if (!bookingId || !(await s.find('QC_Booking_Header', 'Booking_ID', bookingId))) return;
  await s.update('QC_Booking_Header', 'Booking_ID', bookingId, {Status: 'COMPLETED'});
  // Days dropped when the booking was edited stay cancelled (the QC app revived them, so they showed twice).
  await s.updateWhere('QC_Booking_Dates', (r) => r.Booking_ID === bookingId && up(r.Status) !== 'CANCELLED', {Status: 'COMPLETED'});
}
async function notifyPmOfSubmission(s: Site, checklist: Row, inspection: Row, pdfUrl: string) {
  const project = (await s.find('Projects', 'Project_ID', inspection.Project_ID)) || {};
  const submitted = dateKey(inspection.Submitted_At || s.now()), label = String(project.Project_Number || inspection.Project_ID || 'Project');
  notifyAfterCommit(s, 'INSPECTION_SUBMITTED', inspection.Inspection_Version_ID, low(project.PM_Email),
    '[BILARA QC - ' + inspection.Overall_Result + '] ' + label + ' | ' + inspection.Inspection_Heading + ' | Submitted ' + submitted + ' | ' + inspection.Inspection_Version_ID,
    emailBody('A QC inspection has been signed and submitted.', checklist, {'Inspection version': inspection.Inspection_Version_ID, 'Overall result': inspection.Overall_Result,
      'QC Engineer': inspection.QC_Name + ' (' + inspection.QC_Email + ')', Passed: inspection.Passed_Count, 'Minor defects': inspection.Minor_Defect_Count, 'Major defects': inspection.Major_Defect_Count,
      'Archived evidence': inspection.Evidence_Archive_Folder_URL || '', 'Signed report': pdfUrl}));
  const critical = up(inspection.Overall_Result).indexOf('FAILED') >= 0 || up(inspection.Overall_Result).indexOf('HOLD') >= 0 || Number(inspection.Major_Defect_Count || 0) > 0;
  const escalation = low(await s.config('OPS_EMAIL'));
  if (critical && escalation && escalation !== low(project.PM_Email)) {
    notifyAfterCommit(s, 'CRITICAL_INSPECTION_ALERT', inspection.Inspection_Version_ID, escalation,
      '[BILARA QC - CRITICAL ALERT] ' + label + ' | ' + inspection.Inspection_Heading + ' | Submitted ' + submitted + ' | ' + inspection.Inspection_Version_ID,
      emailBody('A QC inspection has failed or reached a hold condition and requires management attention.', checklist, {'Inspection version': inspection.Inspection_Version_ID,
        'Overall result': inspection.Overall_Result, 'QC Engineer': inspection.QC_Name + ' (' + inspection.QC_Email + ')', 'Major defects': inspection.Major_Defect_Count, 'Signed report': pdfUrl}));
  }
}

export async function submitInspection(s: Site, payload: any) {
  const user = s.requireRole(['QC', 'ADMIN']);
  if (!payload || !payload.projectChecklistId || !Array.isArray(payload.answers)) throw new SiteError('Invalid inspection submission.');
  const already = String(payload.clientRequestId || '').trim() ? await s.find('Inspection_Header', 'Client_Request_ID', payload.clientRequestId) : null;
  if (already) {
    if (low(already.QC_Email) !== user.email && user.role !== 'ADMIN') throw new SiteError('This saved inspection belongs to another QC Engineer.');
    return commitResponse(already, true);
  }
  const header = await s.find('Project_Checklist_Header', 'Project_Checklist_ID', payload.projectChecklistId);
  if (!header || up(header.Status) !== 'PUBLISHED') throw new SiteError('Inspection checklist is not published.');
  await assertProjectAccess(s, user, header.Project_ID);
  const booking = payload.bookingId ? await s.find('QC_Booking_Header', 'Booking_ID', payload.bookingId) : null;
  if (!booking || !isConfirmedBookingStatus(booking.Status)) throw new SiteError('A confirmed, active QC booking is required.');
  if (String(booking.Project_Checklist_ID) !== String(payload.projectChecklistId)) throw new SiteError('Booking and project checklist do not match.');
  if (user.role !== 'ADMIN' && low(booking.QC_Email) !== user.email) throw new SiteError('This booking belongs to another QC Engineer.');
  const projectItems = (await s.filter('Project_Checklist_Items', (r) => r.Project_Checklist_ID === payload.projectChecklistId && low(r.Applicable) !== 'no')).sort((a, b) => Number(a.Sequence) - Number(b.Sequence));
  if (!projectItems.length) throw new SiteError('No project checklist items found.');
  const previous = payload.baseInspectionId ? await latestInspectionVersion(s, payload.baseInspectionId) : null;
  const qualityCheckCode = payload.qualityCheckCode || booking.Quality_Check_Code || '';
  const baseId = previous ? previous.Base_Inspection_ID : (qualityCheckCode ? String(qualityCheckCode).replace(/^QCK-/, 'QCI-') : await createBaseInspectionId(s, header));
  const version = previous ? Number(previous.Version_Number) + 1 : 1;
  const versionId = baseId + '-V' + String(version).padStart(2, '0');
  if (await s.find('Inspection_Header', 'Inspection_Version_ID', versionId)) throw new SiteError('This inspection version already exists. Refresh before resubmitting.');
  let bundle = bundleFromBooking(booking);
  if (!bundle) {
    bundle = bundleFor(header.Project_ID, baseId, 'V' + String(version).padStart(2, '0'));
    const changes = bookingFolderChanges(s, bundle);
    await s.update('QC_Booking_Header', 'Booking_ID', booking.Booking_ID, {...changes, Upload_Closed_At: ''});
    Object.assign(booking, changes);
  }
  if (String(bundle.baseInspectionId) !== String(baseId)) throw new SiteError('Booking evidence folder and inspection version do not have the same Base Inspection ID. Contact the administrator.');
  const versionFolder = bundle.locked + '/' + versionId;

  const priorMap: Record<string, Row> = {};
  (previous ? await s.filter('Inspection_Results', (r) => r.Inspection_Version_ID === previous.Inspection_Version_ID) : []).forEach((r) => { priorMap[r.Project_Item_ID] = r; });
  const answerMap: Record<string, any> = {};
  payload.answers.forEach((a: any) => { answerMap[a.projectItemId] = a; });
  const results: any[] = [];
  let passed = 0, minor = 0, major = 0, na = 0;
  for (const item of projectItems) {
    let a = answerMap[item.Project_Item_ID], carried = '';
    const p = priorMap[item.Project_Item_ID];
    if (!a && p && ['SATISFACTORY', 'NA'].indexOf(up(p.Assessment)) >= 0) {
      a = {actualValue: p.Actual_Value, assessment: p.Assessment, observation: p.Observation, photoLinks: p.Photo_Links, testReportLinks: p.Test_Report_Links};
      carried = previous!.Inspection_Version_ID;
    }
    if (!a || !a.assessment) throw new SiteError('Every open checklist item must have an assessment: ' + item.Checkpoint_Snapshot);
    const assessment = up(a.assessment);
    if (['MINOR DEFECT', 'MAJOR DEFECT'].indexOf(assessment) >= 0 && !String(a.observation || '').trim()) throw new SiteError('Remarks are required for defects: ' + item.Checkpoint_Snapshot);
    const existingPhotos = Array.isArray(a.photoLinks) ? a.photoLinks : String(a.photoLinks || '').split(',').map((x: string) => x.trim()).filter(Boolean);
    const pendingPhotos = Array.isArray(a.photos) ? a.photos.filter((f: any) => f && f.data) : [];
    const declared = Math.max(pendingPhotos.length, Number(a.pendingPhotoCount || 0));
    if (assessment === 'MAJOR DEFECT' && low(item.Photo_Required) === 'yes' && declared + existingPhotos.length === 0) throw new SiteError('Photograph required for critical failure: ' + item.Checkpoint_Snapshot);
    if (assessment === 'SATISFACTORY') passed++;
    else if (assessment === 'MINOR DEFECT') minor++;
    else if (assessment === 'MAJOR DEFECT') major++;
    else if (assessment === 'NA') na++;
    else throw new SiteError('Invalid assessment: ' + assessment);
    results.push({Inspection_Version_ID: versionId, Base_Inspection_ID: baseId, Version_Number: version, Project_Item_ID: item.Project_Item_ID, Sequence: item.Sequence,
      Checkpoint_Snapshot: item.Checkpoint_Snapshot, Acceptance_Criteria_Snapshot: item.Acceptance_Criteria_Snapshot, Actual_Value: a.actualValue || '', Unit: item.Unit, Assessment: assessment,
      Observation: a.observation || '', Photo_Links: '', Test_Report_Links: a.testReportLinks || '', Criticality: item.Criticality, Hold_Point: item.Hold_Point, Carried_From_Version_ID: carried,
      Recorded_At: s.now(), Recorded_By: user.email, _pending: pendingPhotos, _existing: existingPhotos});
  }
  const overall = major > 0 || results.some((r) => r.Criticality === 'Critical' && r.Assessment !== 'SATISFACTORY' && r.Assessment !== 'NA') ? 'FAILED / HOLD' : (minor > 0 ? 'PARTIALLY COMPLETED' : 'COMPLETED - PASSED');
  if (!payload.declarationAccepted) throw new SiteError('Signed QC declaration is required.');
  const drawings = await drawingRevisions(s, header);
  const base = {Base_Inspection_ID: baseId, Inspection_Version_ID: versionId, Version_Number: version, Project_Checklist_ID: payload.projectChecklistId, Project_ID: header.Project_ID,
    Inspection_Heading: header.Inspection_Heading, Stage: header.Stage, Location_Floor_Grid: header.Location_Floor_Grid, Checklist_Revision: header.Checklist_Revision,
    Architectural_Drawing_Revision: drawings.arch, Structural_Drawing_Revision: drawings.structural, MEP_Drawing_Revision: drawings.mep, QC_Email: user.email, QC_Name: user.name,
    Started_At: payload.startedAt ? new Date(payload.startedAt) : '', Overall_Result: overall, Passed_Count: passed, Minor_Defect_Count: minor, Major_Defect_Count: major, NA_Count: na,
    Open_Action_Count: 0, Signed_Declaration: DECLARATION, Signature_Link: '', PDF_Link: '', Parent_Version_ID: previous ? previous.Inspection_Version_ID : '', Locked: 'Yes',
    Void_Status: 'Active', Void_Reason: '', Booking_ID: payload.bookingId || '', Quality_Check_Code: qualityCheckCode || '', Client_Request_ID: payload.clientRequestId || '',
    Evidence_Archive_Folder_ID: versionFolder, Evidence_Archive_Folder_URL: folderUrl(versionFolder), Signed_Report_Folder_ID: bundle.reports, Signed_Report_Folder_URL: folderUrl(bundle.reports)};
  const strip = (r: any) => { const {_pending, _existing, ...rest} = r; return rest; };
  if (payload.fastCommit) {
    // Phone path: answers are saved now; photos follow in small batches, then finalizeInspectionEvidence.
    const expectedPhotos = payload.answers.reduce((sum: number, a: any) => sum + Number(a.pendingPhotoCount || 0), 0);
    results.forEach((r) => { r.Photo_Links = r._existing.join(', '); });
    const submittedAt = s.now();
    const integrityHash = await hashObject({baseId, versionId, version, header, results: results.map(strip), qc: user.email, submittedAt: submittedAt.toISOString()});
    const headerRow = {...base, Submitted_At: submittedAt, Integrity_Hash: integrityHash, Evidence_File_Count: 0, Evidence_Manifest_Hash: '', Evidence_Status: 'UPLOAD PENDING',
      Evidence_Expected_Count: expectedPhotos, Evidence_Completed_At: '', Evidence_Error: ''};
    await s.appendMany('Inspection_Results', results.map(strip));
    await s.append('Inspection_Header', headerRow);
    await s.audit('INSPECTION_DATA_COMMITTED', 'INSPECTION_VERSION', versionId, '', 'UPLOAD PENDING', {clientRequestId: payload.clientRequestId || '', expectedPhotos, bookingId: payload.bookingId || ''});
    return commitResponse(headerRow, false);
  }
  const archive = await archiveUploadEvidence(s, booking, bundle, versionId, user.email);
  const inline: any[] = [], referenced: string[] = [];
  for (const r of results) {
    const urls = r._existing.slice();
    for (const [index, file] of r._pending.entries()) {
      const saved = await archiveInlineEvidence(s, bundle, file, booking, baseId, versionId, r.Project_Item_ID, index, user.email);
      urls.push(saved.url); inline.push(saved.manifest);
    }
    r.Photo_Links = urls.join(', ');
    urls.forEach((u: string) => referenced.push(u));
  }
  inline.sort((a, b) => (a.sourceFileId + '|' + a.relativePath).localeCompare(b.sourceFileId + '|' + b.relativePath));
  const evidenceManifestHash = await hashObject({driveArchive: archive.manifest, inlineArchive: inline, referencedPhotoUrls: referenced.sort()});
  const clean = results.map(strip);
  const submittedAt = s.now();
  const integrityHash = await hashObject({baseId, versionId, version, header, results: clean, qc: user.email, submittedAt: submittedAt.toISOString()});
  await s.appendMany('Inspection_Results', clean);
  const inspectionHeader: Row = {...base, Submitted_At: submittedAt, Integrity_Hash: integrityHash, Evidence_File_Count: archive.count + inline.length, Evidence_Manifest_Hash: evidenceManifestHash,
    Evidence_Status: 'COMPLETE', Evidence_Expected_Count: 0, Evidence_Completed_At: submittedAt, Evidence_Error: ''};
  const report = await createInspectionReport(s, inspectionHeader, clean, bundle);
  inspectionHeader.PDF_Link = report.url; inspectionHeader.Report_Key = report.key;
  await s.append('Inspection_Header', inspectionHeader);
  if (previous) await s.append('Reinspection_Links', {Base_Inspection_ID: baseId, From_Version_ID: previous.Inspection_Version_ID, To_Version_ID: versionId,
    Reason: 'Re-site verification of the previous inspection', Created_At: s.now(), Created_By: user.email, Open_Action_Count_At_Creation: 0});
  await markAssignmentCompleted(s, payload.projectChecklistId, user.email);
  await closeBookingUpload(s, booking, 'CLOSED', user.email);
  await completeBooking(s, payload.bookingId || '');
  await s.audit('INSPECTION_SUBMITTED', 'INSPECTION_VERSION', versionId, previous ? previous.Overall_Result : '', overall, {baseId, version, integrityHash, evidenceManifestHash,
    evidenceFileCount: archive.count + inline.length, evidenceArchiveFolderId: versionFolder, signedReportFolderId: bundle.reports});
  await notifyPmOfSubmission(s, header, inspectionHeader, report.url);
  return {baseInspectionId: baseId, inspectionVersionId: versionId, versionNumber: version, overallResult: overall, pdfUrl: report.url, evidenceFolderUrl: folderUrl(versionFolder)};
}

export async function uploadInspectionPhotoBatch(s: Site, payload: any) {
  const user = s.requireRole(['QC', 'ADMIN']);
  if (!payload || !payload.inspectionVersionId || !payload.projectItemId || !Array.isArray(payload.photos) || !payload.photos.length || payload.photos.length > 2) throw new SiteError('Upload one or two inspection photos at a time.');
  payload.photos.forEach((file: any) => {
    if (!file || !/^image\//i.test(String(file.mimeType || '')) || !String(file.data || '').match(/^data:image\//i)) throw new SiteError('Only valid image evidence can be uploaded.');
    if (String(file.data || '').length > 14 * 1024 * 1024) throw new SiteError('This compressed photo is still too large. Choose a smaller photo and retry.');
  });
  const inspection = await s.find('Inspection_Header', 'Inspection_Version_ID', payload.inspectionVersionId);
  if (!inspection) throw new SiteError('The saved inspection could not be found.');
  if (user.role !== 'ADMIN' && low(inspection.QC_Email) !== user.email) throw new SiteError('This inspection belongs to another QC Engineer.');
  if (up(inspection.Evidence_Status) === 'COMPLETE') return {status: 'COMPLETE', uploaded: 0};
  const booking = await s.find('QC_Booking_Header', 'Booking_ID', inspection.Booking_ID);
  const result = (await s.read('Inspection_Results')).find((r) => String(r.Inspection_Version_ID) === String(inspection.Inspection_Version_ID) && String(r.Project_Item_ID) === String(payload.projectItemId));
  if (!booking || !result) throw new SiteError('The saved inspection item or booking could not be found.');
  const bundle = bundleFromBooking(booking);
  if (!bundle) throw new SiteError('The inspection data is saved, but its evidence folder is unavailable.');
  const urls = String(result.Photo_Links || '').split(',').map((v) => v.trim()).filter(Boolean);
  for (const [offset, file] of payload.photos.entries()) {
    const saved = await archiveInlineEvidence(s, bundle, file, booking, inspection.Base_Inspection_ID, inspection.Inspection_Version_ID, result.Project_Item_ID, Number(payload.photoIndex || 0) + offset, user.email);
    if (urls.indexOf(saved.url) < 0) urls.push(saved.url);
  }
  await s.updateBatch('Inspection_Results', [{record: result, changes: {Photo_Links: urls.join(', ')}}]);
  await s.update('Inspection_Header', 'Inspection_Version_ID', inspection.Inspection_Version_ID, {Evidence_Status: 'UPLOADING', Evidence_Error: ''});
  return {status: 'UPLOADING', uploaded: payload.photos.length, photoLinks: urls.length};
}

export async function finalizeInspectionEvidence(s: Site, payload: any) {
  const user = s.requireRole(['QC', 'ADMIN']);
  if (!payload || !payload.inspectionVersionId || !Array.isArray(payload.photoGroups)) throw new SiteError('The inspection evidence request is incomplete.');
  const inspection = await s.find('Inspection_Header', 'Inspection_Version_ID', payload.inspectionVersionId);
  if (!inspection) throw new SiteError('The saved inspection could not be found. Refresh the QC inspection list.');
  if (user.role !== 'ADMIN' && low(inspection.QC_Email) !== user.email) throw new SiteError('This inspection belongs to another QC Engineer.');
  if (up(inspection.Evidence_Status) === 'COMPLETE' && inspection.PDF_Link) return commitResponse(inspection, true);
  const versionId = String(inspection.Inspection_Version_ID);
  try {
    const booking = await s.find('QC_Booking_Header', 'Booking_ID', inspection.Booking_ID);
    if (!booking) throw new SiteError('The inspection data is saved, but its booking record is unavailable. Contact Admin with ' + versionId + '.');
    const checklist = (await s.find('Project_Checklist_Header', 'Project_Checklist_ID', inspection.Project_Checklist_ID)) || {};
    const bundle = bundleFromBooking(booking);
    if (!bundle) throw new SiteError('The inspection data is saved, but its evidence folder is unavailable. Ask Admin to restore it before retrying evidence.');
    const archive = await archiveUploadEvidence(s, booking, bundle, versionId, user.email);
    const groups: Record<string, any[]> = {};
    payload.photoGroups.forEach((g: any) => { groups[String(g.projectItemId || '')] = Array.isArray(g.photos) ? g.photos : []; });
    const resultRows = await s.filter('Inspection_Results', (r) => String(r.Inspection_Version_ID) === versionId);
    const inline = (await s.filter('Evidence_Files', (r) => String(r.Inspection_Version_ID) === versionId && String(r.Source_File_ID || '').indexOf('INLINE-') === 0 && up(r.Status) === 'ARCHIVED')).map(manifestOf);
    if (inline.length < Number(inspection.Evidence_Expected_Count || 0)) {
      throw new SiteError('Only ' + inline.length + ' of ' + Number(inspection.Evidence_Expected_Count || 0) + ' selected checklist photos reached the evidence archive. Retry the remaining photo upload.');
    }
    const referenced: string[] = [], updates: Array<{record: Row; changes: Row}> = [];
    for (const row of resultRows) {
      const urls = String(row.Photo_Links || '').split(',').map((v) => v.trim()).filter(Boolean);
      for (const [index, file] of (groups[String(row.Project_Item_ID || '')] || []).entries()) {
        const saved = await archiveInlineEvidence(s, bundle, file, booking, inspection.Base_Inspection_ID, versionId, row.Project_Item_ID, index, user.email);
        if (urls.indexOf(saved.url) < 0) urls.push(saved.url);
        inline.push(saved.manifest);
      }
      urls.forEach((u) => referenced.push(u));
      updates.push({record: row, changes: {Photo_Links: urls.join(', ')}});
    }
    await s.updateBatch('Inspection_Results', updates);
    inline.sort((a, b) => (a.sourceFileId + '|' + a.relativePath).localeCompare(b.sourceFileId + '|' + b.relativePath));
    const evidenceManifestHash = await hashObject({driveArchive: archive.manifest, inlineArchive: inline, referencedPhotoUrls: referenced.sort()});
    const refreshed = await s.filter('Inspection_Results', (r) => String(r.Inspection_Version_ID) === versionId);
    const report = inspection.PDF_Link ? {url: String(inspection.PDF_Link), key: String(inspection.Report_Key || '')} : await createInspectionReport(s, inspection, refreshed, bundle);
    const versionFolder = bundle.locked + '/' + versionId;
    const done = {PDF_Link: report.url, Report_Key: report.key, Evidence_Archive_Folder_ID: versionFolder, Evidence_Archive_Folder_URL: folderUrl(versionFolder),
      Evidence_File_Count: archive.count + inline.length, Evidence_Manifest_Hash: evidenceManifestHash, Evidence_Status: 'COMPLETE', Evidence_Completed_At: s.now(), Evidence_Error: ''};
    await s.update('Inspection_Header', 'Inspection_Version_ID', versionId, done);
    if (inspection.Parent_Version_ID && !(await s.read('Reinspection_Links')).some((r) => String(r.To_Version_ID) === versionId)) {
      await s.append('Reinspection_Links', {Base_Inspection_ID: inspection.Base_Inspection_ID, From_Version_ID: inspection.Parent_Version_ID, To_Version_ID: versionId,
        Reason: 'Re-site verification of the previous inspection', Created_At: s.now(), Created_By: user.email, Open_Action_Count_At_Creation: 0});
    }
    await markAssignmentCompleted(s, inspection.Project_Checklist_ID, user.email);
    await closeBookingUpload(s, booking, 'CLOSED', user.email);
    await completeBooking(s, inspection.Booking_ID || '');
    const completed = {...inspection, ...done};
    await s.audit('INSPECTION_EVIDENCE_COMPLETED', 'INSPECTION_VERSION', versionId, 'UPLOAD PENDING', 'COMPLETE', {evidenceManifestHash, evidenceFileCount: done.Evidence_File_Count});
    await notifyPmOfSubmission(s, checklist, completed, report.url);
    return commitResponse(completed, false);
  } catch (err) {
    const message = String((err as Error)?.message || err);
    s.failureWrites.push(async (f) => { await f.update('Inspection_Header', 'Inspection_Version_ID', versionId, {Evidence_Status: 'RETRY REQUIRED', Evidence_Error: message}); });
    throw new SiteError('Inspection answers are safely saved as ' + versionId + ', but evidence finalization needs retry: ' + message);
  }
}
