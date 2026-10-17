import {sameOrigin} from '@/lib/access';
// One endpoint for the site pages (Site Engineer, PM, QC, GM, Purchase), like the QC app's
// apiCall(action, args): POST {action, args:[...]} or GET ?action=...&projectId=...
// Sign-in is the purchasing app's; each person has one role, mapped to the site role.
import {actor, AccessError} from '@/lib/access';
import type {Actor} from '@/lib/permissions';
import {Site, SiteError, SiteUser, runSiteAction, siteRole, clientSafe, formatDate, uuid} from '@/lib/site/core';
import {getProjectsForUser, getSiteOperationsProjectsForUser} from '@/lib/site/access';
import * as M from '@/lib/site/materials';
import * as G from '@/lib/site/grn';
import * as P from '@/lib/site/purchase-view';
import * as D from '@/lib/site/dpr';
import * as L from '@/lib/site/labour';
import * as T from '@/lib/site/attendance';
import * as O from '@/lib/site/ops';
import * as B from '@/lib/site/dashboard';
import * as Q from '@/lib/site/qc';
import {assertProjectArchiveAccess, assertProjectAccess} from '@/lib/site/access';
import {listFiles} from '@/lib/site/files';
import {documentStorage} from '@/lib/documents';

const BUILD = 'site-ops-2026.10.15';

type Handler = (s: Site, a: Actor, args: any[]) => Promise<any>;
const READ_ONLY = new Set(['bootstrap', 'getMaterialInventoryWorkspace', 'getReceiveGoodsWorkspace', 'getGrnItemMaster', 'getSitePurchaseWorkspace', 'getDprWorkspace', 'listSiteFiles', 'getOperationsDashboard', 'getLaborPayablesWorkspace', 'getLaborRecords', 'getAdminAttendanceWorkspace', 'getDprComplianceWorkspace', 'getEmailSchedule', 'getPmWorkspace', 'getPmChecklistRegister', 'getPmChecklistRecord', 'getReinspectionBookingContext', 'getTemplateItems', 'getChecklistForEditing', 'getSchedulingWorkspace', 'getBookingForEditing', 'getTemplateLibrary']);

const ACTIONS: Record<string, Handler> = {
  bootstrap: async (s) => {
    const user = s.currentUser();
    return clientSafe({
      systemName: await s.config('SYSTEM_NAME'), build: BUILD, user,
      projects: await getProjectsForUser(s, user), siteOperationProjects: await getSiteOperationsProjectsForUser(s, user),
      today: s.todayKey(), assignments: user.role === 'QC' || user.role === 'ADMIN' ? await Q.getAssignments(s, user) : [],
    });
  },
  // Site stock (Site Materials)
  getMaterialInventoryWorkspace: (s, _a, x) => M.getMaterialInventoryWorkspace(s, x[0]),
  recordMaterialReceipt: (s, _a, x) => M.recordMaterialReceipt(s, x[0]),
  recordMaterialGin: (s, _a, x) => M.recordMaterialGin(s, x[0]),
  recordSiteAssetSnapshot: (s, _a, x) => M.recordSiteAssetSnapshot(s, x[0]),
  recordDailySteelWastage: (s, _a, x) => M.recordDailySteelWastage(s, x[0]),
  recordDailyMaterialWastage: (s, _a, x) => M.recordDailyMaterialWastage(s, x[0]),
  saveMaterialThresholds: (s, _a, x) => M.saveMaterialThresholds(s, x[0]),
  recordInitialSiteStock: (s, _a, x) => M.recordInitialSiteStock(s, x[0]),
  reconcileMaterialBalance: (s, _a, x) => M.reconcileMaterialBalance(s, x[0]),
  auditAndRepairMaterialInventory: (s) => M.auditAndRepairMaterialInventory(s),
  // The Purchase workbook copy is live now, so there is nothing to schedule.
  schedulePurchaseMaterialMirrorSync: async (s) => { s.requireRole(['SITE_ENGINEER', 'ADMIN']); return {status: 'SYNCED'}; },
  // Goods received against purchase orders
  getReceiveGoodsWorkspace: (s, a, x) => G.getReceiveGoodsWorkspace(s, a, x[0]),
  receivePurchaseOrder: (s, a, x) => G.receivePurchaseOrder(s, a, x[0]),
  linkGrnToPo: (s, a, x) => G.linkGrnToPo(s, a, x[0]),
  // Purchase: item master and the site purchase view
  getGrnItemMaster: (s) => M.getGrnItemMaster(s),
  saveGrnItemMaster: (s, _a, x) => M.saveGrnItemMaster(s, x[0]),
  getSitePurchaseWorkspace: (s, _a, x) => P.getSitePurchaseWorkspace(s, x[0] || {}),
  saveGrnFollowup: (s, _a, x) => P.saveGrnFollowup(s, x[0]),
  // Daily Progress Report
  getDprWorkspace: (s, _a, x) => D.getDprWorkspace(s, x[0], x[1]),
  saveDprPlan: (s, _a, x) => D.saveDprPlan(s, x[0]),
  saveDprMorning: (s, _a, x) => D.saveDprMorning(s, x[0]),
  saveDprCheckin: (s, _a, x) => D.saveDprCheckin(s, x[0]),
  saveDprEvening: (s, _a, x) => D.saveDprEvening(s, x[0]),
  uploadDeferredDprEvidence: (s, _a, x) => D.uploadDeferredDprEvidence(s, x[0]),
  scheduleDprPostCommitTrigger: (s) => D.scheduleDprPostCommitTrigger(s),
  requestDprResubmission: (s, _a, x) => D.requestDprResubmission(s, x[0]),
  approveDprResubmission: (s, _a, x) => D.approveDprResubmission(s, x[0]),
  // QC checklists (PM pages), QC calendar and inspections (QC pages)
  getPmWorkspace: (s, _a, x) => Q.getPmWorkspace(s, x[0]),
  getPmChecklistRegister: (s) => Q.getPmChecklistRegister(s),
  getPmChecklistRecord: (s, _a, x) => Q.getPmChecklistRecord(s, x[0]),
  getReinspectionBookingContext: (s, _a, x) => Q.getReinspectionBookingContext(s, x[0]),
  getTemplateItems: (s, _a, x) => Q.getTemplateItems(s, x[0]),
  getChecklistForEditing: (s, _a, x) => Q.getChecklistForEditing(s, x[0]),
  saveProjectChecklistDraft: (s, _a, x) => Q.saveProjectChecklistDraft(s, x[0]),
  saveAndPublishProjectChecklist: (s, _a, x) => Q.saveAndPublishProjectChecklist(s, x[0]),
  publishProjectChecklist: (s, _a, x) => Q.publishProjectChecklist(s, x[0]),
  updatePublishedChecklist: (s, _a, x) => Q.updatePublishedChecklist(s, x[0]),
  deleteProjectChecklist: (s, _a, x) => Q.deleteProjectChecklist(s, x[0]),
  getTemplateLibrary: (s) => Q.getTemplateLibrary(s),
  saveTemplateLibrary: (s, _a, x) => Q.saveTemplateLibrary(s, x[0]),
  syncTemplateLibrary: (s, _a, x) => Q.saveTemplateLibrary(s, x[0]),
  saveDrawingRecord: (s, _a, x) => Q.saveDrawingRecord(s, x[0]),
  getSchedulingWorkspace: (s, _a, x) => Q.getSchedulingWorkspace(s, x[0], x[1]),
  createQcBooking: (s, _a, x) => Q.createQcBooking(s, x[0]),
  cancelQcBooking: (s, _a, x) => Q.cancelQcBooking(s, x[0]),
  updateQcBooking: (s, _a, x) => Q.updateQcBooking(s, x[0]),
  getBookingForEditing: (s, _a, x) => Q.getBookingForEditing(s, x[0]),
  respondToQcBooking: (s, _a, x) => Q.respondToQcBooking(s, x[0]),
  addQcUnavailability: (s, _a, x) => Q.addQcUnavailability(s, x[0]),
  createReinspectionBooking: (s, _a, x) => Q.createReinspectionBooking(s, x[0]),
  getInspectionForExecution: (s, _a, x) => Q.getInspectionForExecution(s, x[0], x[1], x[2]),
  uploadQcEvidence: (s, _a, x) => Q.uploadQcEvidence(s, x[0]),
  submitInspection: (s, _a, x) => Q.submitInspection(s, x[0]),
  uploadInspectionPhotoBatch: (s, _a, x) => Q.uploadInspectionPhotoBatch(s, x[0]),
  finalizeInspectionEvidence: (s, _a, x) => Q.finalizeInspectionEvidence(s, x[0]),
  // GM / management pages (dashboard, labour payables and records, QC office attendance, DPR compliance)
  getOperationsDashboard: (s, _a, x) => B.getOperationsDashboard(s, x[0] || {}),
  getLaborPayablesWorkspace: (s, _a, x) => L.getLaborPayablesWorkspace(s, x[0] || {}),
  saveGmLaborLeniency: (s, _a, x) => L.saveGmLaborLeniency(s, x[0]),
  getLaborRecords: (s, _a, x) => L.getLaborRecords(s, x[0] || {}),
  getAdminAttendanceWorkspace: (s, _a, x) => T.getAdminAttendanceWorkspace(s, x[0], x[1]),
  saveAttendanceDecision: (s, _a, x) => T.saveAttendanceDecision(s, x[0]),
  refreshHrAttendance: (s, _a, x) => T.refreshHrAttendance(s, x[0]),
  getDprComplianceWorkspace: (s, _a, x) => O.getDprComplianceWorkspace(s, x[0] || {}),
  // Email times (Admin) — the QC app's Email Schedule dialog
  getEmailSchedule: (s) => O.getEmailSchedule(s),
  saveEmailSchedule: (s, _a, x) => O.saveEmailSchedule(s, x[0]),
  // Photos and documents kept for the site pages (were Google Drive folders)
  listSiteFiles: async (s, _a, x) => {
    const prefix = String(x[0] || '');
    await checkFileAccess(s, prefix);
    return {prefix, files: (await listFiles(prefix)).map((f) => ({...f, name: f.key.split('/').pop(), url: '/api/site?action=siteFile&key=' + encodeURIComponent(f.key)}))};
  },
};

/** Site files live under site/<project>/...; the same people who may open that project's records may open them. */
async function checkFileAccess(s: Site, key: string) {
  const m = /^site\/([^/]+)\//.exec(key);
  if (!m || key.includes('..')) throw new SiteError('File not found.');
  const user = s.currentUser();
  // A QC engineer opens the inspection files of projects they were booked on.
  if (user.role === 'QC' && /^site\/[^/]+\/qc\//.test(key)) { await assertProjectAccess(s, user, m[1]); return; }
  await assertProjectArchiveAccess(s, user, m[1]);
}

export function siteUserOf(a: Actor): SiteUser {
  return {email: a.email, name: a.name, role: siteRole(a.roles), allowedProjects: a.projects.length ? a.projects.join(',') : 'ALL'};
}

const VALIDATION_MESSAGES: Record<string, string> = {
  saveDprPlan: 'The daily target could not be saved. No target was confirmed. Refresh Daily Targets and try again.',
  saveDprMorning: 'The morning site update could not be saved. Refresh the Daily DPR and try again.',
  saveDprCheckin: 'The check-in could not be saved. It stays on this phone and will be sent again.',
  saveDprEvening: 'The end-of-day DPR could not be submitted. Your entered values remain on this page; refresh and submit again.',
};

/** friendlyApplicationError_: log the technical detail, show the person a reference. */
async function logError(user: SiteUser | null, action: string, error: any, args: any[]): Promise<string> {
  const technical = String(error?.message || error || 'Unknown error');
  const id = 'ERR-' + formatDate(new Date(), 'yyyyMMdd-HHmmss') + '-' + uuid().slice(0, 6).toUpperCase();
  const userMessage = 'Bilara could not complete this action because of an internal system error. Refresh the page and try once more. If it happens again, send the reference below to Admin; your technical details have already been logged.';
  try {
    await runSiteAction(null, 'logError', async (s) => {
      const payload = (args && args[0]) || {};
      await s.append('Application_Error_Log', {
        Error_ID: id, Occurred_At: s.now(), User_Email: user?.email || '', User_Role: user?.role || '', Action: action,
        Project_ID: String(payload.projectId || ''), Work_Date: String(payload.workDate || ''), User_Message: VALIDATION_MESSAGES[action] || userMessage,
        Technical_Message: technical, Stack_Trace: String(error?.stack || '').slice(0, 20000), Build: BUILD, Status: 'OPEN',
      });
    });
  } catch (logFailure) {
    console.error(JSON.stringify({event: 'site_error_log_failed', action, message: String(logFailure)}));
  }
  return (VALIDATION_MESSAGES[action] || userMessage) + ' Reference: ' + id;
}

async function handle(req: Request, action: string, args: any[]) {
  let user: SiteUser | null = null;
  try {
    const local = new URL(req.url).hostname === 'localhost' && req.headers.get('x-bilara-test-strict') !== '1';
    const a = await actor(req.headers, local);
    user = siteUserOf(a);
    if (!user.role) return Response.json({error: 'Your role does not use the site pages.'}, {status: 403});
    const fn = ACTIONS[action];
    if (!fn) return Response.json({error: 'Unsupported application action.'}, {status: 400});
    if (req.method === 'GET' && !READ_ONLY.has(action)) return Response.json({error: 'Use POST for this action.'}, {status: 405});
    const clock = local && req.headers.get('x-bilara-test-now') ? () => new Date(String(req.headers.get('x-bilara-test-now'))) : undefined;
    const value = await runSiteAction(user, action, (s) => fn(s, a, args), {clock});
    return Response.json({value: value ?? null}, {headers: {'Cache-Control': 'private, no-store'}});
  } catch (e) {
    if (e instanceof AccessError) return Response.json({error: e.message}, {status: e.status});
    if (e instanceof SiteError || (e as any)?.name === 'BilaraUserError') return Response.json({error: (e as Error).message}, {status: 400});
    return Response.json({error: await logError(user, action, e, args)}, {status: 500});
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get('action') === 'siteFile') {
    try {
      const local = new URL(req.url).hostname === 'localhost' && req.headers.get('x-bilara-test-strict') !== '1';
      const user = siteUserOf(await actor(req.headers, local));
      const key = String(q.get('key') || '');
      await runSiteAction(user, 'siteFile', (s) => checkFileAccess(s, key));
      const file = await documentStorage().get(key);
      if (!file) return Response.json({error: 'File not found.'}, {status: 404});
      return new Response(file.body, {headers: {'Content-Type': file.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff'}});
    } catch (e) {
      if (e instanceof AccessError) return Response.json({error: e.message}, {status: e.status});
      return Response.json({error: (e as Error).message || 'File not available.'}, {status: 403});
    }
  }
  const args = q.get('args') ? JSON.parse(String(q.get('args'))) : [q.get('projectId') ?? undefined];
  return handle(req, String(q.get('action') || ''), Array.isArray(args) ? args : [args]);
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({error: 'Origin not allowed.'}, {status: 403});
  const text = await req.text();
  if (text.length > 30 * 1024 * 1024) return Response.json({error: 'Request too large.'}, {status: 413});
  let b: any;
  try { b = JSON.parse(text); } catch { return Response.json({error: 'Enter valid JSON.'}, {status: 400}); }
  return handle(req, String(b?.action || ''), Array.isArray(b?.args) ? b.args : []);
}
