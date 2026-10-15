// Daily operations: DPR compliance register, the evening and next-morning emails, the QC
// office-duty roster, Purchase GRN / material / low-stock digests, and the email schedule.
// Converted from the QC app's OperationsAutomation.gs and EmailSchedule.gs.
//
// Weeks are Thursday to Wednesday (decision 15 Oct 2026); the compliance page shows the
// Thursday–Wednesday week of the chosen date as well as the day itself.
import {Site, Row, SiteError, istParts, dateKey, parseDateKey, addDaysKey, weekStartKey, weekEndKey, formatDate, storedDate, clientSafe, normaliseEmail, unique, sha256Hex, runSiteAction, isValidDateKey} from './core';
import {isSelectableProject, activeRoleUsers} from './access';
import {deliverEmail, htmlEscape} from './mail';
import {dprIsSubmitted} from './dpr';
import {laborGroupRows, laborPayableActivities, laborRound} from './labour';
import {officeAttendancePlan, isQcSundayOffDate, attendanceBusyStatus, activeQcUsers} from './attendance';

export const DAILY_EMAIL_SCHEDULES = [
  {id: 'qcOffice', key: 'DAILY_EMAIL_QC_OFFICE_TIME', label: 'QC office-duty notice', fallback: '19:00'},
  {id: 'lowStock', key: 'DAILY_EMAIL_LOW_STOCK_TIME', label: 'Purchase low-stock / next-day plan', fallback: '19:15'},
  {id: 'dprReminder', key: 'DAILY_EMAIL_DPR_REMINDER_TIME', label: 'DPR pending warning and PM status', fallback: '20:00'},
  {id: 'dprFinal', key: 'DAILY_EMAIL_DPR_FINAL_TIME', label: 'Final DPR, attendance and management report', fallback: '08:30'},
  {id: 'grnDigest', key: 'DAILY_EMAIL_GRN_TIME', label: 'Same-day Purchase GRN digest', fallback: '19:30'},
  {id: 'materialDigest', key: 'DAILY_EMAIL_MATERIAL_TIME', label: 'Same-day detailed site-material report', fallback: '19:45'},
];
const DAILY_EMAIL_TIMES_PROPERTY = 'DAILY_EMAIL_TIMES_JSON_V1';
const DPR_FINAL_DELIVERY_WINDOW_MINUTES = 60;
const DAILY_EMAIL_DELIVERY_WINDOW_MINUTES = 15;

// ---------- small shared pieces ----------

export async function activeRoleEmails(s: Site, roles: string[]) {
  return unique((await activeRoleUsers(s, roles)).map((r) => normaliseEmail(r.Email)).filter(Boolean));
}
export async function purchaseNotificationRecipients(s: Site) { return activeRoleEmails(s, ['PURCHASE']); }
const operationsSiteOff = (row: Row) => Boolean(row) && (String(row.Site_Off_Status || '').toUpperCase() === 'YES' || String(row.Plan_Status || '').toUpperCase() === 'SITE OFF' || String(row.Report_Status || '').toUpperCase() === 'SITE OFF');
const operationsNotStarted = (row: Row) => Boolean(row) && (String(row.Not_Started_Status || '').toUpperCase() === 'YES' || String(row.Plan_Status || '').toUpperCase() === 'NOT STARTED' || String(row.Report_Status || '').toUpperCase() === 'NOT STARTED');
async function operationalEmailEnabled(s: Site, key: string) { return String((await s.config(key)) || 'Yes').trim().toLowerCase() === 'yes'; }

function validTime(value: any) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  return Boolean(m) && Number(m![1]) <= 23 && Number(m![2]) <= 59;
}
function normaliseTime(value: any) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim().replace(/^'/, ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return String(Number(m[1])).padStart(2, '0') + ':' + m[2];
}
async function savedEmailTimes(s: Site): Promise<Record<string, string>> {
  try { const raw = await s.property(DAILY_EMAIL_TIMES_PROPERTY); const p = raw ? JSON.parse(raw) : {}; return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; }
}
export async function dailyEmailTimeValue(s: Site, key: string, fallback: string) {
  const fromProperty = normaliseTime((await savedEmailTimes(s))[key]);
  if (validTime(fromProperty)) return fromProperty;
  const fromConfig = normaliseTime(await s.config(key));
  if (validTime(fromConfig)) return fromConfig;
  return normaliseTime(fallback) || '00:00';
}
async function dailyEmailTimeDisplay(s: Site, key: string, fallback: string) {
  const [h, m] = (await dailyEmailTimeValue(s, key, fallback)).split(':').map(Number);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
async function emailWindow(s: Site, key: string, fallback: string, windowMinutes: number) {
  const now = s.now();
  const ist = istParts(now), current = ist.H * 60 + ist.m;
  const [h, m] = (await dailyEmailTimeValue(s, key, fallback)).split(':').map(Number);
  const start = h * 60 + m, end = Math.min(24 * 60, start + Math.max(1, windowMinutes));
  return {before: current < start, open: current >= start && current < end, closed: current >= end};
}

/** The binding DPR deadline: the next morning at the configured final-report time (India time). */
export async function operationsDprDeadline(s: Site, workDate: string): Promise<Date> {
  const [h, m] = (await dailyEmailTimeValue(s, 'DAILY_EMAIL_DPR_FINAL_TIME', '08:30')).split(':').map(Number);
  const next = addDaysKey(workDate, 1);
  return new Date(next + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00+05:30');
}
async function deadlineLabel(s: Site, workDate: string) { return formatDate(await operationsDprDeadline(s, workDate), 'dd MMM yyyy, hh:mm a'); }
const timestampMs = (v: any) => { if (!v) return NaN; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? NaN : d.getTime(); };

// ---------- sending with per-recipient de-duplication ----------

async function claimKey(eventType: string, relatedId: string, recipient: string) {
  const date = ((String(relatedId || '').match(/\d{4}-\d{2}-\d{2}/) || ['undated'])[0]).replace(/-/g, '');
  return 'OPS_MAIL_CLAIM_' + date + '_' + (await sha256Hex([eventType, relatedId, normaliseEmail(recipient)].join('|'))).slice(0, 32);
}
async function sentRecipients(s: Site, eventType: string, relatedId: string) {
  const sent: string[] = [];
  (await s.read('Notification_Log')).forEach((row) => {
    if (String(row.Event_Type || '') !== eventType || String(row.Related_Record_ID || '') !== relatedId || String(row.Status || '').toUpperCase() !== 'SENT') return;
    (String(row.Recipient_Email || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach((e) => sent.push(normaliseEmail(e)));
  });
  return unique(sent);
}

/**
 * Send one operational email at most once per recipient: recipients are claimed (and saved)
 * before sending, so a retry or an overlapping run cannot send the same email twice.
 */
export async function sendOperationalEmail(s: Site, eventType: string, relatedId: string, to: string[], cc: string[], subject: string, html: string) {
  const recipients = unique((to || []).map(normaliseEmail).filter(Boolean));
  const copied = unique((cc || []).map(normaliseEmail).filter((e) => e && recipients.indexOf(e) < 0));
  if (!recipients.length) return {status: 'NO RECIPIENT'};
  const opts = {clock: s.clock || undefined, db: s.db};
  const claim = await runSiteAction(null, 'mail:' + eventType, async (m) => {
    const sent = await sentRecipients(m, eventType, relatedId);
    const covered = async (email: string) => sent.indexOf(email) >= 0 || Boolean(await m.property(await claimKey(eventType, relatedId, email)));
    let pendingTo: string[] = [], pendingCc: string[] = [];
    for (const e of recipients) if (!(await covered(e))) pendingTo.push(e);
    for (const e of copied) if (!(await covered(e))) pendingCc.push(e);
    if (!pendingTo.length && !pendingCc.length) return null;
    if (!pendingTo.length && pendingCc.length) pendingTo = [pendingCc.shift()!];
    const all = unique(pendingTo.concat(pendingCc));
    for (const e of all) m.setProperty(await claimKey(eventType, relatedId, e), 'CLAIMED|' + m.now().toISOString());
    return {pendingTo, pendingCc, all};
  }, opts);
  if (!claim) return {status: 'SENT', alreadySent: true};
  const id = 'NOT-' + crypto.randomUUID();
  const result = await deliverEmail({to: claim.pendingTo, cc: claim.pendingCc, subject, html});
  await runSiteAction(null, 'mail-log:' + eventType, async (m) => {
    for (const e of claim.all) m.setProperty(await claimKey(eventType, relatedId, e), result.ok ? 'SENT|' + m.now().toISOString() : '');
    await m.append('Notification_Log', {Notification_ID: id, Event_Type: eventType, Related_Record_ID: relatedId,
      Recipient_Email: claim.pendingTo.join(',') + (claim.pendingCc.length ? ' | CC: ' + claim.pendingCc.join(',') : ''), Subject: subject, Sent_At: m.now(),
      Status: result.ok ? 'SENT' : 'FAILED', Error_Message: result.ok ? '' : String(result.error || '')});
  }, opts);
  return result.ok ? {status: 'SENT', notificationId: id} : {status: 'FAILED', error: String(result.error || '')};
}

/** Event notices (booking, inspection, GRN) — sendNotification_ in the QC app. */
export async function sendNotification(s: Site, eventType: string, relatedId: string, recipient: string, subject: string, html: string) {
  if (!recipient) return {status: 'DISABLED'};
  if (eventType === 'GRN_RECEIVED') { if (String(await s.config('ENABLE_PURCHASE_GRN_EMAILS')).trim().toLowerCase() !== 'yes') return {status: 'DISABLED'}; }
  else if (String(await s.config('ENABLE_EMAIL_NOTIFICATIONS')).toLowerCase() !== 'yes') return {status: 'DISABLED'};
  if (['QC_SLOT_BOOKED', 'INSPECTION_SUBMITTED', 'CRITICAL_INSPECTION_ALERT', 'GRN_RECEIVED'].indexOf(eventType) < 0) return {status: 'BLOCKED'};
  const id = 'NOT-' + crypto.randomUUID();
  const result = await deliverEmail({to: [recipient], subject, html});
  await s.append('Notification_Log', {Notification_ID: id, Event_Type: eventType, Related_Record_ID: relatedId, Recipient_Email: recipient, Subject: subject,
    Sent_At: s.now(), Status: result.ok ? 'SENT' : 'FAILED', Error_Message: result.ok ? '' : String(result.error || '')});
  return result.ok ? {status: 'SENT', notificationId: id} : {status: 'FAILED', notificationId: id, error: result.error};
}

// ---------- DPR compliance ----------

function planTiming(createdAt: any, workDate: string) {
  const createdKey = dateKey(createdAt);
  if (!createdKey) return {label: 'UNKNOWN', leadDays: '' as any};
  const leadDays = Math.round((parseDateKey(workDate).getTime() - parseDateKey(createdKey).getTime()) / 86400000);
  return {label: leadDays > 0 ? 'PLANNED AHEAD' : (leadDays === 0 ? 'SAME-DAY PLAN' : 'LATE PLAN RECORD'), leadDays};
}
function plannedWork(targets: Row[]) {
  return (targets || []).map((t) => {
    const q = String(t.Planned_Target ?? '').trim(), u = String(t.Unit || '').trim(), loc = String(t.Location_Room || t.Work_Area || '').trim();
    return String(t.Activity_Name || 'Activity') + (q ? ' — target ' + q + (u ? ' ' + u : '') : '') + (loc ? ' at ' + loc : '');
  }).join('; ').slice(0, 4000);
}
function actualWork(targets: Row[], results: Row[]) {
  const names: Record<string, string> = {};
  (targets || []).forEach((t) => { names[String(t.Target_ID || '')] = String(t.Activity_Name || 'Activity'); });
  return (results || []).map((r) => {
    const a = String(r.Actual_Quantity ?? '').trim(), c = String(r.Completion_Percent ?? '').trim(), o = String(r.Output_Description || '').trim();
    return (names[String(r.Target_ID || '')] || 'Activity') + (a ? ' — actual ' + a : '') + (c ? ' (' + c + '% complete)' : '') + (o ? ': ' + o : '');
  }).join('; ').slice(0, 4000);
}
function projectSiteEngineerEmails(project: Row) {
  return unique(String(project.Site_Engineer_Email || '').concat(';', String(project.Site_QC_Email || '')).split(/[;,]/).map(normaliseEmail));
}

export async function buildDprComplianceForDate(s: Site, workDate: string, options: {phase?: string; persist?: boolean; asOf?: Date} = {}) {
  const phase = String(options.phase || 'FINAL').toUpperCase();
  const persist = options.persist !== false;
  const deadline = await operationsDprDeadline(s, workDate);
  const asOf = options.asOf instanceof Date ? options.asOf : deadline;
  const existingIds: Record<string, boolean> = {};
  (await s.filter('DPR_Compliance_Register', (row) => dateKey(row.Work_Date) === workDate)).forEach((row) => { existingIds[String(row.Compliance_ID || '')] = true; });
  const dailyByProject: Record<string, Row[]> = {};
  (await s.filter('DPR_Daily', (row) => dateKey(row.Work_Date) === workDate)).forEach((row) => { (dailyByProject[String(row.Project_ID || '')] ||= []).push(row); });
  const chosen: Record<string, Row> = {};
  Object.keys(dailyByProject).forEach((projectId) => {
    chosen[projectId] = dailyByProject[projectId].sort((a, b) => {
      const sd = Number(dprIsSubmitted(b)) - Number(dprIsSubmitted(a));
      if (sd) return sd;
      const cd = Number(operationsSiteOff(b) || operationsNotStarted(b)) - Number(operationsSiteOff(a) || operationsNotStarted(a));
      if (cd) return cd;
      const ta = timestampMs(a.EOD_Submitted_At || a.Quality_Assurance_Signed_At || a.Evening_Updated_At || a.Updated_At);
      const tb = timestampMs(b.EOD_Submitted_At || b.Quality_Assurance_Signed_At || b.Evening_Updated_At || b.Updated_At);
      if (!isNaN(ta) || !isNaN(tb)) return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      return Number(b._row || 0) - Number(a._row || 0);
    })[0];
  });
  const targetsByDpr: Record<string, Row[]> = {}, resultsByDpr: Record<string, Row[]> = {};
  (await s.filter('DPR_Targets', (row) => String(row.Status || 'ACTIVE').toUpperCase() === 'ACTIVE')).forEach((row) => { (targetsByDpr[String(row.DPR_ID || '')] ||= []).push(row); });
  (await s.read('DPR_Results')).forEach((row) => { (resultsByDpr[String(row.DPR_ID || '')] ||= []).push(row); });
  const records: Row[] = [];
  for (const project of (await s.read('Projects')).filter(isSelectableProject)) {
    const projectId = String(project.Project_ID || '');
    const dpr: Row = chosen[projectId] || {};
    const hasPmPlan = Boolean(dpr.DPR_ID);
    const status = String(dpr.Report_Status || '').toUpperCase();
    const siteOff = hasPmPlan && operationsSiteOff(dpr), notStarted = hasPmPlan && operationsNotStarted(dpr), entryExempt = siteOff || notStarted;
    const submittedAt = dpr.EOD_Submitted_At || dpr.Quality_Assurance_Signed_At || dpr.Evening_Updated_At || dpr.Updated_At || '';
    const wasSubmitted = dprIsSubmitted(dpr);
    const submittedMs = timestampMs(submittedAt), timestampKnown = !isNaN(submittedMs);
    const visibleAsSubmitted = wasSubmitted && (!timestampKnown || submittedMs <= asOf.getTime());
    const filedOnTime = visibleAsSubmitted && (!timestampKnown || submittedMs <= deadline.getTime());
    const filedLate = phase === 'FINAL' && wasSubmitted && timestampKnown && submittedMs > deadline.getTime();
    const targets = targetsByDpr[String(dpr.DPR_ID || '')] || [], results = resultsByDpr[String(dpr.DPR_ID || '')] || [];
    const timing = hasPmPlan ? planTiming(dpr.Created_At, workDate) : {label: 'NOT PLANNED', leadDays: ''};
    let points = 0, weight = 0;
    results.forEach((r) => { const w = Math.max(0, Number(r.Actual_Worker_Hours || 0)) || 1; points += Math.max(0, Number(r.Achievement_Percent || 0)) * w; weight += w; });
    const productivity = weight ? Math.round(points / weight * 100) / 100 : 0;
    const workSummary = results.map((r) => String(r.Output_Description || '').trim()).filter(Boolean).join('; ').slice(0, 2000);
    const engineers = unique(String(dpr.Site_Engineer_Email || '').concat(';', projectSiteEngineerEmails(project).join(';')).split(/[;,]/).map(normaliseEmail));
    const id = 'DPC-' + workDate.replace(/-/g, '') + '-' + projectId;
    const record: Row = {
      Compliance_ID: id, Work_Date: parseDateKey(workDate), Day: formatDate(parseDateKey(workDate), 'EEEE'), Project_ID: projectId,
      Project_Number: project.Project_Number || '', Client: project.Client || '', Location: project.Location || '',
      Site_Engineer: dpr.Site_Engineer_Name || project.Site_Engineer_Name || project.Site_QC_Name || '', Site_Engineer_Email: engineers.join(','),
      Project_Manager: project.PM_Name || '', PM_Email: normaliseEmail(project.PM_Email || dpr.PM_Email || dpr.Created_By), DPR_ID: dpr.DPR_ID || '',
      DPR_Status: hasPmPlan ? (status || 'NOT FILED') : 'NO PM TARGET', Submitted_At: submittedAt,
      Compliance_Status: !hasPmPlan ? 'PM PLAN MISSING' : (siteOff ? 'SITE OFF' : (notStarted ? 'NOT STARTED' : (filedOnTime ? (timestampKnown ? 'FILED ON TIME' : 'FILED') : (filedLate ? 'FILED LATE' : 'MISSING')))),
      Site_Off_Category: siteOff ? String(dpr.Site_Off_Category || '') : '', Site_Off_Reason: siteOff ? String(dpr.Site_Off_Reason || '') : '', Checked_At: s.now(),
      Not_Started_Reason: notStarted ? String(dpr.Not_Started_Reason || '') : '', Activities_Planned: targets.length, Activities_Reported: results.length,
      Site_Productivity_Percent: productivity, Work_Summary: workSummary,
      HR_Attendance_Status: !hasPmPlan ? 'NOT APPLICABLE — PM PLAN MISSING' : (entryExempt ? 'NOT REQUIRED' : (filedOnTime ? 'PRESENT' : 'ABSENT')),
      HR_Attendance_Reason: !hasPmPlan ? 'PROJECT MANAGER DID NOT SET A TARGET' : (siteOff ? 'SITE OFF' : (notStarted ? 'NOT STARTED' : (filedOnTime ? 'DPR SUBMITTED ON TIME' : (filedLate ? 'DPR SUBMITTED LATE' : 'DPR NOT SUBMITTED')))),
      Plan_Created_At: dpr.Created_At || '', Plan_Created_By: dpr.Created_By || dpr.PM_Email || '', Plan_Timing: timing.label, Plan_Lead_Days: timing.leadDays,
      Planned_Work_Details: hasPmPlan ? (entryExempt ? (siteOff ? 'SITE OFF' : 'NOT STARTED') : plannedWork(targets)) : 'TARGET NOT SET BY PROJECT MANAGER',
      Actual_Work_Details: entryExempt ? 'DPR NOT REQUIRED' : actualWork(targets, results),
      Fulfilment_Status: !hasPmPlan ? 'PM TARGET NOT SET' : (siteOff ? 'SITE OFF' : (notStarted ? 'NOT STARTED — COMPLIANCE CLOSED' : (!visibleAsSubmitted ? 'NOT SUBMITTED' : (results.length >= targets.length ? 'ALL PLANNED ACTIVITIES REPORTED' : 'PARTIAL ACTIVITY REPORT')))),
      Filed_On_Time: !hasPmPlan ? 'NOT APPLICABLE' : (entryExempt ? 'NOT REQUIRED' : (filedOnTime ? 'YES' : 'NO')),
      DPR_Deadline_At: deadline, Review_Phase: phase,
    };
    if (persist) {
      if (existingIds[id]) await s.update('DPR_Compliance_Register', 'Compliance_ID', id, record);
      else { await s.append('DPR_Compliance_Register', record); existingIds[id] = true; }
    }
    records.push(record);
  }
  return records;
}

export function operationsComplianceStats(records: Row[]) {
  const rows = records || [];
  const count = (st: string) => rows.filter((r) => r.Compliance_Status === st).length;
  const onTime = count('FILED ON TIME') + count('FILED'), late = count('FILED LATE'), missing = count('MISSING');
  const siteOff = count('SITE OFF'), notStarted = count('NOT STARTED'), pmPlanMissing = count('PM PLAN MISSING');
  const plannedSites = Math.max(0, rows.length - pmPlanMissing), workRequired = Math.max(0, plannedSites - siteOff - notStarted);
  return {ongoingSites: rows.length, plannedSites, pmPlanMissing, workRequired, workPlanned: workRequired, onTime, late, missing, siteOff, notStarted,
    submitted: onTime + late, onTimeRate: workRequired ? Math.round(onTime / workRequired * 10000) / 100 : 100};
}

const showRow = (r: Row) => {
  const o: Row = {};
  Object.keys(r).forEach((k) => { if (k !== '_row') o[k] = r[k] instanceof Date ? storedDate(r[k]) : r[k]; });
  return o;
};

/** DPR Compliance page: the chosen day and its Thursday–Wednesday week. */
export async function getDprComplianceWorkspace(s: Site, filters: any) {
  s.requireRole(['GM', 'ADMIN', 'AUDITOR']);
  const input = filters || {};
  const today = s.todayKey();
  const workDate = String(input.workDate || addDaysKey(today, -1));
  if (!isValidDateKey(workDate)) throw new SiteError('Select a valid work date.');
  let rows = await s.filter('DPR_Compliance_Register', (row) => dateKey(row.Work_Date) === workDate);
  if (input.refresh === true || !rows.length) {
    await buildDprComplianceForDate(s, workDate);
    rows = await s.filter('DPR_Compliance_Register', (row) => dateKey(row.Work_Date) === workDate);
  }
  // The week the chosen date belongs to (Thursday to Wednesday), up to today.
  const weekStart = weekStartKey(workDate), weekEnd = weekEndKey(workDate);
  const days: Array<{date: string; stats: any}> = [];
  let weekRows: Row[] = [];
  for (let d = weekStart; d <= weekEnd && d <= today; d = addDaysKey(d, 1)) {
    let dayRows = await s.filter('DPR_Compliance_Register', (row) => dateKey(row.Work_Date) === d);
    // Past days are built once; today's figures are only provisional until its deadline.
    if (!dayRows.length) dayRows = d < today ? (await buildDprComplianceForDate(s, d), await s.filter('DPR_Compliance_Register', (row) => dateKey(row.Work_Date) === d))
      : await buildDprComplianceForDate(s, d, {phase: 'REMINDER', persist: false, asOf: s.now()});
    days.push({date: d, stats: operationsComplianceStats(dayRows)});
    weekRows = weekRows.concat(dayRows);
  }
  return clientSafe({
    rows: rows.map(showRow), stats: operationsComplianceStats(rows), workDate,
    week: {start: weekStart, end: weekEnd, label: 'Thursday ' + weekStart + ' to Wednesday ' + weekEnd, days, stats: operationsComplianceStats(weekRows)},
  });
}

// ---------- the scheduled emails ----------

function statsHtml(stats: any) {
  const cells = [['Ongoing sites', stats.ongoingSites], ['PM status recorded', stats.plannedSites], ['PM planned', stats.workPlanned], ['Filed on time', stats.onTime],
    ['Filed late', stats.late], ['DPR not submitted', stats.missing], ['PM targets missing', stats.pmPlanMissing], ['Site Off', stats.siteOff], ['Not Started', stats.notStarted],
    ['On-time compliance', stats.onTimeRate + '%']].map((i) => '<td style="padding:10px 14px;border:1px solid #dbe2ea"><div style="font-size:12px;color:#64748b">' + htmlEscape(i[0]) + '</div><div style="font-size:20px;font-weight:700">' + htmlEscape(i[1]) + '</div></td>').join('');
  return '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0"><tr>' + cells + '</tr></table>';
}
function planActualCells(row: Row) {
  const plan = row.Planned_Work_Details || (Number(row.Activities_Planned || 0) ? row.Activities_Planned + ' planned activity/activities' : '—');
  const actual = row.Actual_Work_Details || row.Work_Summary || (['SITE OFF', 'NOT STARTED'].indexOf(row.Compliance_Status) >= 0 ? 'Not required' : 'No DPR result submitted');
  return '<td>' + htmlEscape(row.Plan_Timing || 'UNKNOWN') + '<br><span style="color:#64748b">By ' + htmlEscape(row.Plan_Created_By || row.PM_Email || '—') +
    (row.Plan_Created_At ? ' on ' + htmlEscape(row.Plan_Created_At instanceof Date ? storedDate(row.Plan_Created_At) : row.Plan_Created_At) : '') + '</span></td><td>' + htmlEscape(plan) + '</td><td>' + htmlEscape(actual) +
    '<br><span style="color:#64748b">' + htmlEscape(row.Fulfilment_Status || '') + '</span></td>';
}
function statusRemark(row: Row) {
  if (row.Compliance_Status === 'SITE OFF') return (row.Site_Off_Category || 'SITE OFF') + (row.Site_Off_Reason ? ' — ' + row.Site_Off_Reason : '');
  if (row.Compliance_Status === 'NOT STARTED') return 'NOT STARTED' + (row.Not_Started_Reason ? ' — ' + row.Not_Started_Reason : '');
  return row.Work_Summary || '—';
}
function reminderRowsHtml(rows: Row[], label: string) {
  return rows.map((r) => '<tr><td>' + htmlEscape(r.Project_Number) + '<br>' + htmlEscape(r.Client) + '</td><td>' + htmlEscape(r.Site_Engineer || r.Site_Engineer_Email || 'Not assigned') +
    '</td><td><b>' + htmlEscape(r.Compliance_Status === 'MISSING' ? 'NOT SUBMITTED AS OF ' + label : r.Compliance_Status) + '</b>' +
    (r.Submitted_At ? '<br>' + htmlEscape(r.Submitted_At instanceof Date ? storedDate(r.Submitted_At) : r.Submitted_At) : '') + '</td>' + planActualCells(r) +
    '<td>' + htmlEscape(r.Site_Productivity_Percent || 0) + '%</td></tr>').join('');
}

export async function sendNextDayQcOfficeDutyNotices(s: Site) {
  if (!(await emailWindow(s, 'DAILY_EMAIL_QC_OFFICE_TIME', '19:00', DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open) return {status: 'WINDOW CLOSED', stream: 'QC_OFFICE'};
  if (!(await operationalEmailEnabled(s, 'ENABLE_QC_OFFICE_DUTY_EMAILS'))) return {status: 'DISABLED'};
  const tomorrow = addDaysKey(s.todayKey(), 1);
  if (isQcSundayOffDate(tomorrow)) {
    const booked = unique((await s.filter('QC_Booking_Dates', (r) => dateKey(r.Visit_Date) === tomorrow && attendanceBusyStatus(r.Status))).map((r) => normaliseEmail(r.QC_Email)).filter(Boolean));
    const off = (await activeQcUsers(s)).map((r) => r.email).filter((e) => booked.indexOf(e) < 0);
    await s.audit('QC_SUNDAY_OFF_APPLIED', 'DATE', tomorrow, '', 'COMPLETED', {bookedQcCount: booked.length, sundayOffQcCount: off.length});
    return {status: 'SUNDAY_OFF_UNLESS_BOOKED', date: tomorrow, bookedQcCount: booked.length, sundayOffQcCount: off.length, lowStock: null};
  }
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(tomorrow + 'T00:00:00Z').getUTCDay()];
  const configured = String((await s.config('QC_OFFICE_WORKING_DAYS')) || 'MON,TUE,WED,THU,FRI,SAT').toUpperCase().split(',').map((v) => v.trim());
  if (configured.indexOf(weekday) < 0) return {status: 'NON_WORKING_DAY', date: tomorrow};
  const [y, m] = tomorrow.split('-').map(Number);
  const expected = (await officeAttendancePlan(s, y, m)).expectedRows.filter((r) => r.date === tomorrow);
  let sent = 0, failed = 0;
  for (const row of expected) {
    const html = '<div style="font-family:Arial;color:#1f2937"><h2>QC office duty for tomorrow</h2><p>Hello ' + htmlEscape(row.name) + ',</p><p>You do not have an active QC site booking for <b>' +
      htmlEscape(tomorrow) + '</b>. You are therefore expected to report to the office. Your attendance will be marked only by the GM.</p>' +
      (row.suggestedReason ? '<p><b>Recorded exception/unavailability:</b> ' + htmlEscape(row.suggestedReason) + '. This still requires a GM decision in the attendance register.</p>' : '') +
      '<p>If a special exception is required, have it recorded with a reason for GM approval before attendance is finalised.</p></div>';
    const r = await sendOperationalEmail(s, 'QC_OFFICE_DUTY_NOTICE', tomorrow + '|' + row.email, [row.email], [], '[BILARA QC OFFICE DUTY] Duty Date ' + tomorrow + ' | ' + row.name, html);
    if (r.status === 'SENT') sent++; else if (r.status === 'FAILED') failed++;
  }
  const bookingHeaders: Record<string, Row> = {};
  (await s.read('QC_Booking_Header')).forEach((r) => { bookingHeaders[String(r.Booking_ID || '')] = r; });
  const projectMap: Record<string, Row> = {};
  (await s.read('Projects')).forEach((r) => { projectMap[String(r.Project_ID || '')] = r; });
  const qcNames: Record<string, string> = {};
  (await activeQcUsers(s)).forEach((r) => { qcNames[r.email] = r.name; });
  const seen: Record<string, boolean> = {}, dutyRows: any[] = [];
  (await s.filter('QC_Booking_Dates', (r) => dateKey(r.Visit_Date) === tomorrow && attendanceBusyStatus(r.Status))).forEach((row) => {
    const header = bookingHeaders[String(row.Booking_ID || '')] || {};
    const email = normaliseEmail(row.QC_Email || header.QC_Email);
    const project = projectMap[String(header.Project_ID || row.Project_ID || '')] || {};
    const key = email + '|' + String(project.Project_ID || header.Project_ID || row.Project_ID || '') + '|' + String(row.Booking_ID || '');
    if (!email || seen[key]) return;
    seen[key] = true;
    dutyRows.push({name: qcNames[email] || String(header.QC_Name || email), email, projectNumber: String(project.Project_Number || header.Project_ID || row.Project_ID || ''),
      client: String(project.Client || project.Project_Name || ''), duty: String(header.Inspection_Heading || header.Other_Reason || header.Quality_Check_Code || 'QC site booking'), status: String(row.Status || header.Status || '')});
  });
  (await s.read('Projects')).filter(isSelectableProject).forEach((project) => {
    projectSiteEngineerEmails(project).filter((e) => Boolean(qcNames[e])).forEach((email) => {
      const key = email + '|' + String(project.Project_ID || '') + '|SITE_ASSIGNMENT';
      if (seen[key] || dutyRows.some((r) => r.email === email && r.projectNumber === String(project.Project_Number || ''))) return;
      seen[key] = true;
      dutyRows.push({name: qcNames[email], email, projectNumber: String(project.Project_Number || ''), client: String(project.Client || project.Project_Name || ''), duty: 'Ongoing site assignment', status: 'SITE DUTY'});
    });
  });
  const summaryTo = unique((await activeRoleEmails(s, ['GM'])).concat(await activeRoleEmails(s, ['ADMIN']), await activeRoleEmails(s, ['AUDITOR'])));
  const bookedRows = dutyRows.sort((a, b) => a.name.localeCompare(b.name) || a.projectNumber.localeCompare(b.projectNumber, undefined, {numeric: true}))
    .map((r) => '<tr><td>' + htmlEscape(r.name) + '</td><td>' + htmlEscape(r.email) + '</td><td>' + htmlEscape(r.projectNumber) + ' — ' + htmlEscape(r.client) + '</td><td>' + htmlEscape(r.duty) + '</td><td>' + htmlEscape(r.status) + '</td></tr>').join('');
  const summaryRows = expected.map((r) => '<tr><td>' + htmlEscape(r.name) + '</td><td>' + htmlEscape(r.email) + '</td><td>' + htmlEscape(r.suggestedReason || 'Office duty') + '</td></tr>').join('');
  const summary = await sendOperationalEmail(s, 'QC_OFFICE_DUTY_SUMMARY', tomorrow, summaryTo, [],
    '[BILARA QC OFFICE ROSTER] Duty Date ' + tomorrow + ' | ' + dutyRows.length + ' site duty | ' + expected.length + ' office',
    '<div style="font-family:Arial;color:#1f2937"><h2>QC duty roster for tomorrow</h2><p>Date: <b>' + htmlEscape(tomorrow) + '</b></p><h3>Booked / assigned to site (' + dutyRows.length +
    ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>QC Engineer</th><th>Email</th><th>Project</th><th>Duty</th><th>Status</th></tr>' +
    (bookedRows || '<tr><td colspan="5">No QC engineer is booked or assigned to a site.</td></tr>') + '</table><h3>Not booked — expected in office (' + expected.length +
    ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>QC Engineer</th><th>Email</th><th>Status / exception</th></tr>' +
    (summaryRows || '<tr><td colspan="3">No QC engineer is expected in the office.</td></tr>') + '</table></div>');
  if (summary.status === 'FAILED' || summary.status === 'NO RECIPIENT') failed++;
  await s.audit('QC_OFFICE_DUTY_NOTICES_RUN', 'DATE', tomorrow, '', failed ? 'PARTIAL' : 'COMPLETED', {siteDuty: dutyRows.length, expected: expected.length, sent, failed, summary: summary.status});
  return {status: failed ? 'PARTIAL' : 'COMPLETED', date: tomorrow, siteDuty: dutyRows.length, expected: expected.length, sent, failed, summary};
}

export async function sendDailyPurchaseGrnDigest(s: Site, workDate: string) {
  const today = s.todayKey();
  if (workDate !== today || !(await emailWindow(s, 'DAILY_EMAIL_GRN_TIME', '19:30', DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open) return {status: 'WINDOW CLOSED', stream: 'GRN_DIGEST', date: workDate, expectedDate: today};
  if (!(await operationalEmailEnabled(s, 'ENABLE_DAILY_GRN_DIGEST'))) return {status: 'DISABLED'};
  const recipients = await purchaseNotificationRecipients(s);
  if (!recipients.length) return {status: 'NO ACTIVE PURCHASE RECIPIENT', date: workDate};
  const cc = unique((await activeRoleEmails(s, ['AUDITOR'])).concat(await activeRoleEmails(s, ['ADMIN']), await activeRoleEmails(s, ['GM'])));
  const grns = await s.filter('GRN_Register', (r) => dateKey(r.Received_Date) === workDate);
  const receipts = await s.read('Material_Receipts');
  const rows = grns.map((g) => {
    const items = receipts.filter((r) => String(r.GRN_No || '') === String(g.GRN_No || '')).map((r) => htmlEscape(r.Material_Name) + ' — ' + htmlEscape(r.Stock_Quantity) + ' ' + htmlEscape(r.Stock_Unit)).join('<br>');
    return '<tr><td>' + htmlEscape(g.Project_Number) + '</td><td>' + htmlEscape(g.Client) + '</td><td>' + htmlEscape(g.GRN_No) + '</td><td>' + htmlEscape(g.Supplier) + '</td><td>' + (items || '—') + '</td><td>' + htmlEscape(g.Signed_By) + '</td></tr>';
  }).join('');
  const body = grns.length ? '<p>All GRNs received on <b>' + htmlEscape(workDate) + '</b> are consolidated below.</p><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Client</th><th>GRN</th><th>Supplier</th><th>Items</th><th>Signed by</th></tr>' + rows + '</table>'
    : '<p><b>No GRNs were recorded on ' + htmlEscape(workDate) + '.</b></p>';
  const result = await sendOperationalEmail(s, 'DAILY_GRN_DIGEST', workDate, recipients, cc, '[BILARA GRN DAILY SUMMARY] Work Date ' + workDate + ' | ' + grns.length + ' GRN(s)',
    '<div style="font-family:Arial;color:#1f2937"><h2>Bilara daily GRN digest</h2>' + body + '</div>');
  if (result.status === 'SENT') for (const g of grns) await s.update('GRN_Register', 'GRN_No', g.GRN_No, {Purchase_Notification_Status: 'SENT DAILY DIGEST', Purchase_Notification_Recipients: recipients.join(','), Purchase_Notified_At: s.now()});
  await s.audit('DAILY_GRN_DIGEST_RUN', 'DATE', workDate, '', result.status, {grnCount: grns.length, recipients});
  return {status: result.status, date: workDate, grnCount: grns.length};
}

export async function sendDailyDetailedMaterialDigest(s: Site, workDate: string) {
  if (!(await operationalEmailEnabled(s, 'ENABLE_DAILY_GRN_DIGEST'))) return {status: 'DISABLED'};
  const today = s.todayKey();
  if (workDate !== today || !(await emailWindow(s, 'DAILY_EMAIL_MATERIAL_TIME', '19:45', DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open) return {status: 'WINDOW CLOSED', stream: 'MATERIAL_DIGEST', date: workDate, expectedDate: today};
  const purchase = await purchaseNotificationRecipients(s);
  const management = unique((await activeRoleEmails(s, ['GM'])).concat(await activeRoleEmails(s, ['ADMIN']), await activeRoleEmails(s, ['AUDITOR'])));
  const to = purchase.length ? purchase : management.slice(0, 1), cc = purchase.length ? management : management.slice(1);
  if (!to.length) return {status: 'NO RECIPIENT', date: workDate};
  const projects = (await s.read('Projects')).filter(isSelectableProject);
  const balances: Record<string, Row[]> = {}, all = await s.read('Material_Balances');
  all.forEach((r) => { (balances[String(r.Project_ID || '')] ||= []).push(r); });
  const receipts: Record<string, Row[]> = {};
  (await s.filter('Material_Receipts', (r) => dateKey(r.Received_Date) === workDate && String(r.Status || '').toUpperCase() !== 'REVERSED')).forEach((r) => { (receipts[String(r.Project_ID || '')] ||= []).push(r); });
  const lowStock = all.filter((r) => ['LOW', 'OUT OF STOCK', 'NEGATIVE'].indexOf(String(r.Status || '').toUpperCase()) >= 0).length;
  const sections = projects.map((project) => {
    const id = String(project.Project_ID || '');
    const bal = (balances[id] || []).slice().sort((a, b) => String(a.Material_Name || '').localeCompare(String(b.Material_Name || '')) || String(a.Variant || '').localeCompare(String(b.Variant || '')));
    const rec = (receipts[id] || []).map((r) => '<tr><td>' + htmlEscape(r.GRN_No || '—') + '</td><td>' + htmlEscape(r.Material_Name || r.Material_Code || 'Material') + '</td><td>' + htmlEscape(r.Variant || '—') + '</td><td>' + htmlEscape(r.Stock_Quantity || 0) + ' ' + htmlEscape(r.Stock_Unit || '') + '</td><td>' + htmlEscape(r.Supplier || '—') + '</td></tr>').join('');
    const balRows = bal.map((r) => '<tr><td>' + htmlEscape(r.Material_Name || r.Material_Code || 'Material') + '</td><td>' + htmlEscape(r.Variant || '—') + '</td><td>' + htmlEscape(r.Balance_Quantity || 0) + ' ' + htmlEscape(r.Stock_Unit || '') + '</td><td>' + htmlEscape(r.Low_Stock_Threshold || 0) + ' ' + htmlEscape(r.Stock_Unit || '') + '</td><td><b>' + htmlEscape(r.Status || 'OK') + '</b></td></tr>').join('');
    return '<div style="margin:22px 0;padding:14px;border:1px solid #cbd5e1;border-radius:8px"><h3>' + htmlEscape(project.Project_Number || id) + ' — ' + htmlEscape(project.Client || '') + '</h3><p>' + htmlEscape(project.Location || '') +
      '</p><h4>Materials received on ' + htmlEscape(workDate) + '</h4>' + (rec ? '<table border="1" cellpadding="6" cellspacing="0"><tr><th>GRN</th><th>Material</th><th>Variant</th><th>Quantity received</th><th>Supplier</th></tr>' + rec + '</table>' : '<p>No materials were received for this site.</p>') +
      '<h4>Current site material balance</h4>' + (balRows ? '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Material</th><th>Variant</th><th>Available quantity</th><th>Low-stock threshold</th><th>Status</th></tr>' + balRows + '</table>' : '<p>No material balance records are available for this site.</p>') + '</div>';
  }).join('');
  const result = await sendOperationalEmail(s, 'DAILY_SITE_MATERIAL_DIGEST', workDate, to, cc,
    '[BILARA MATERIAL DAILY SUMMARY] Work Date ' + workDate + ' | ' + projects.length + ' site(s) | ' + lowStock + ' low/out-of-stock item(s)',
    '<div style="font-family:Arial;color:#1f2937"><h2>Daily site-by-site material report</h2><p>This separate report lists materials added during the work date and the current available balance for every active site.</p>' + sections + '</div>');
  await s.audit('DAILY_SITE_MATERIAL_DIGEST_RUN', 'DATE', workDate, '', result.status, {projects: projects.length, projectsWithReceipts: Object.keys(receipts).length, lowStockItems: lowStock, recipients: unique(to.concat(cc))});
  return {status: result.status, date: workDate, projects: projects.length, projectsWithReceipts: Object.keys(receipts).length, lowStockItems: lowStock};
}

export async function sendDprTenPmReminder(s: Site, workDate: string) {
  if (!(await operationalEmailEnabled(s, 'ENABLE_DPR_COMPLIANCE_EMAILS'))) return {status: 'DISABLED'};
  const today = s.todayKey();
  if (workDate !== today || !(await emailWindow(s, 'DAILY_EMAIL_DPR_REMINDER_TIME', '20:00', DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open) return {status: 'WINDOW CLOSED', stream: 'DPR_REMINDER', date: workDate, expectedDate: today};
  const dl = await deadlineLabel(s, workDate), reminderLabel = await dailyEmailTimeDisplay(s, 'DAILY_EMAIL_DPR_REMINDER_TIME', '20:00');
  const records = await buildDprComplianceForDate(s, workDate, {phase: 'REMINDER', persist: false, asOf: s.now()});
  const deliveries: any[] = [], byPm: Record<string, Row[]> = {};
  records.forEach((r) => { if (r.PM_Email) (byPm[r.PM_Email] ||= []).push(r); });
  for (const email of Object.keys(byPm)) {
    const rows = byPm[email], stats = operationsComplianceStats(rows);
    const pmName = rows.map((r) => String(r.Project_Manager || '').trim()).filter(Boolean)[0] || email;
    deliveries.push(await sendOperationalEmail(s, 'PM_DPR_10PM_STATUS', workDate + '|' + email, [email], [],
      '[BILARA DPR - PM REMINDER] Work Date ' + workDate + ' | ' + pmName + ' | Submitted ' + stats.submitted + ' | PM planned ' + stats.workPlanned + ' | DPR pending ' + stats.missing + ' | Targets missing ' + stats.pmPlanMissing + ' | Site Off ' + stats.siteOff + ' | Not Started ' + stats.notStarted,
      '<div style="font-family:Arial;color:#1f2937"><h2>' + htmlEscape(reminderLabel) + ' DPR follow-up status</h2><p>This reminder contains only your assigned sites. Pending engineers can still submit by <b>' + htmlEscape(dl) + '</b>.</p>' + statsHtml(stats) +
      '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Site Engineer</th><th>Reminder-time status</th><th>PM plan timing</th><th>Planned work / quantity</th><th>Actual work / accomplishment</th><th>Accomplishment</th></tr>' + reminderRowsHtml(rows, reminderLabel) + '</table></div>'));
  }
  const mgmt = unique((await activeRoleEmails(s, ['GM'])).concat(await activeRoleEmails(s, ['ADMIN'])));
  if (mgmt.length) {
    const warning = records.filter((r) => r.Compliance_Status === 'MISSING' || r.Compliance_Status === 'PM PLAN MISSING');
    const st = operationsComplianceStats(records);
    deliveries.push(await sendOperationalEmail(s, 'MANAGEMENT_DPR_EVENING_WARNING', workDate, mgmt, [],
      '[BILARA DPR WARNING - NOT COMPLETED] Work Date ' + workDate + ' | DPR pending ' + st.missing + ' | Targets missing ' + st.pmPlanMissing,
      '<div style="font-family:Arial;color:#1f2937"><h2 style="color:#b91c1c">WARNING — DPR NOT COMPLETED</h2><p>Company-wide reminder status for work date <b>' + htmlEscape(workDate) + '</b> as of <b>' + htmlEscape(reminderLabel) +
      '</b>. Auditors are not copied on this reminder. The final report is issued after <b>' + htmlEscape(dl) + '</b>.</p>' + statsHtml(st) +
      (warning.length ? '<h3>Incomplete DPR / PM planning actions</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Site Engineer</th><th>Warning status</th><th>PM plan timing</th><th>Planned work / quantity</th><th>Actual work / accomplishment</th><th>Accomplishment</th></tr>' + reminderRowsHtml(warning, reminderLabel) + '</table>'
        : '<p><b>No incomplete DPR or PM target-setting action remains.</b></p>') + '</div>'));
  }
  const missingByEngineer: Record<string, Row[]> = {};
  records.filter((r) => r.Compliance_Status === 'MISSING').forEach((r) => {
    unique(String(r.Site_Engineer_Email || '').split(/[;,]/).map(normaliseEmail)).forEach((e) => { if (e) (missingByEngineer[e] ||= []).push(r); });
  });
  for (const email of Object.keys(missingByEngineer)) {
    const rows = missingByEngineer[email];
    const name = rows.map((r) => String(r.Site_Engineer || '').trim()).filter(Boolean)[0] || email;
    const planned = rows.map((r) => '<tr><td>' + htmlEscape(r.Project_Number) + '<br>' + htmlEscape(r.Client) + '</td><td>' + htmlEscape(r.Project_Manager || r.PM_Email || 'Project Manager') + '</td><td>' +
      htmlEscape(r.Planned_Work_Details || 'Planned activity details are recorded in the DPR') + '</td><td>' + htmlEscape(r.Plan_Timing || '') + '</td></tr>').join('');
    deliveries.push(await sendOperationalEmail(s, 'SITE_ENGINEER_DPR_10PM_REMINDER', workDate + '|' + email, [email], [],
      '[BILARA DPR WARNING - NOT COMPLETED] Work Date ' + workDate + ' | ' + name + ' | Submit before ' + dl,
      '<div style="font-family:Arial;color:#1f2937"><h2 style="color:#b91c1c">WARNING — DPR NOT COMPLETED</h2><p>Your DPR for the PM-planned work below has not been submitted as of ' + htmlEscape(reminderLabel) + '.</p><p><b>Submit the DPR before ' +
      htmlEscape(dl) + ' to avoid being marked absent for ' + htmlEscape(workDate) + '.</b></p><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Project Manager</th><th>Work planned by PM</th><th>Planning timing</th></tr>' + planned + '</table></div>'));
  }
  const failures = deliveries.filter((d) => d.status === 'FAILED' || d.status === 'NO RECIPIENT').length;
  const status = failures ? 'PARTIAL' : 'COMPLETED';
  await s.audit('DPR_10PM_REMINDER_RUN', 'DATE', workDate, '', status, {projects: records.length, projectManagers: Object.keys(byPm).length, engineersReminded: Object.keys(missingByEngineer).length,
    pendingProjects: records.filter((r) => r.Compliance_Status === 'MISSING').length, deliveryFailures: failures});
  return {status, date: workDate, projects: records.length, projectManagers: Object.keys(byPm).length, engineersReminded: Object.keys(missingByEngineer).length, deliveryFailures: failures};
}

export async function sendDailyDprComplianceSummary(s: Site, workDate: string) {
  if (!(await operationalEmailEnabled(s, 'ENABLE_DPR_COMPLIANCE_EMAILS'))) return {status: 'DISABLED'};
  const expected = addDaysKey(s.todayKey(), -1);
  if (workDate !== expected) return {status: 'FINAL DPR DATE CLOSED', date: workDate, expectedDate: expected};
  const deadline = await operationsDprDeadline(s, workDate);
  const windowEnd = new Date(deadline.getTime() + DPR_FINAL_DELIVERY_WINDOW_MINUTES * 60000);
  if (s.now().getTime() < deadline.getTime()) return {status: 'WAITING FOR CONFIGURED DEADLINE', date: workDate, deadline};
  if (s.now().getTime() >= windowEnd.getTime()) {
    await s.audit('DPR_COMPLIANCE_WINDOW_CLOSED', 'DATE', workDate, '', 'SKIPPED', {deadline, windowEndedAt: windowEnd, reason: 'Final DPR is morning-only; evening is reserved for the current-day warning.'});
    return {status: 'FINAL DPR WINDOW CLOSED', date: workDate, deadline, windowEndedAt: windowEnd};
  }
  const dl = await deadlineLabel(s, workDate);
  const records = await buildDprComplianceForDate(s, workDate, {phase: 'FINAL', persist: true, asOf: s.now()});
  const allStats = operationsComplianceStats(records);
  const deliveries: any[] = [];
  const dailyLabor = (await laborGroupRows(s, await laborPayableActivities(s))).daily.filter((r) => r.workDate === workDate);
  const laborByProject: Record<string, any[]> = {};
  dailyLabor.forEach((r) => { (laborByProject[r.projectId] ||= []).push(r); });
  const grnsByProject: Record<string, Row[]> = {};
  (await s.filter('GRN_Register', (r) => dateKey(r.Received_Date) === workDate)).forEach((r) => { (grnsByProject[String(r.Project_ID || '')] ||= []).push(r); });
  const receiptsByProject: Record<string, Row[]> = {};
  (await s.filter('Material_Receipts', (r) => dateKey(r.Received_Date) === workDate && String(r.Status || '').toUpperCase() !== 'REVERSED')).forEach((r) => { (receiptsByProject[String(r.Project_ID || '')] ||= []).push(r); });
  const materialSummary = (pid: string) => (receiptsByProject[pid] || []).map((r) => String(r.Material_Name || r.Material_Code || 'Material') + (r.Variant ? ' ' + r.Variant : '') + ' — ' + r.Stock_Quantity + ' ' + r.Stock_Unit).join('; ') || 'None';
  const siteRow = (row: Row) => {
    const pid = String(row.Project_ID || '');
    const hours = laborRound((laborByProject[pid] || []).reduce((sum, i) => sum + Number(i.actualWorkerHours || 0), 0));
    return '<tr><td>' + htmlEscape(row.Project_Number) + '<br>' + htmlEscape(row.Client) + '</td><td>' + htmlEscape(row.Site_Engineer || row.Site_Engineer_Email || 'Not assigned') + '</td><td><b>' +
      htmlEscape(row.Compliance_Status) + '</b><br>' + htmlEscape(row.DPR_Status) + (row.Submitted_At ? '<br>' + htmlEscape(row.Submitted_At instanceof Date ? storedDate(row.Submitted_At) : row.Submitted_At) : '') + '</td>' +
      planActualCells(row) + '<td>' + htmlEscape(hours) + '</td><td>' + htmlEscape(row.Site_Productivity_Percent || 0) + '%</td><td>' +
      htmlEscape((grnsByProject[pid] || []).map((g) => String(g.GRN_No || 'GRN')).join(', ') || 'None') + '</td><td>' + htmlEscape(materialSummary(pid)) + '</td><td>' + htmlEscape(statusRemark(row)) + '</td></tr>';
  };
  const tableHead = '<tr><th>Project</th><th>Site Engineer</th><th>Deadline compliance</th><th>PM plan timing</th><th>Planned work / quantity</th><th>Actual fulfilment</th><th>Worker-hours</th><th>Productivity</th><th>GRNs</th><th>Materials received</th><th>Work / Site Off / Not Started</th></tr>';
  const byPm: Record<string, Row[]> = {};
  records.forEach((r) => { if (r.PM_Email) (byPm[r.PM_Email] ||= []).push(r); });
  for (const email of Object.keys(byPm)) {
    const rows = byPm[email], stats = operationsComplianceStats(rows);
    const pmName = rows.map((r) => String(r.Project_Manager || '').trim()).filter(Boolean)[0] || email;
    const missing = rows.filter((r) => r.Compliance_Status === 'PM PLAN MISSING');
    const missingHtml = missing.length ? '<h3 style="color:#b91c1c">Your ongoing projects without a PM target (' + missing.length + ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Client</th><th>Site Engineer</th><th>Planning lapse</th></tr>' +
      missing.map((r) => '<tr><td>' + htmlEscape(r.Project_Number) + '</td><td>' + htmlEscape(r.Client) + '</td><td>' + htmlEscape(r.Site_Engineer || r.Site_Engineer_Email || 'Not assigned') + '</td><td><b>TARGET NOT SET</b></td></tr>').join('') + '</table>'
      : '<p><b>PM planning compliance:</b> Planned work, Site Off, or Not Started was recorded for all your ongoing projects.</p>';
    deliveries.push(await sendOperationalEmail(s, 'PM_DAILY_SITE_SUMMARY', workDate + '|' + email, [email], [],
      '[BILARA FINAL DPR - PM] Work Date ' + workDate + ' | ' + pmName + ' | PM planned ' + stats.workPlanned + ' | Site Off ' + stats.siteOff + ' | Not Started ' + stats.notStarted + ' | Targets missing ' + stats.pmPlanMissing + ' | DPR missing ' + stats.missing,
      '<div style="font-family:Arial;color:#1f2937"><h2>Final previous-day DPR and site summary</h2><p>Date: <b>' + htmlEscape(workDate) + '</b>. The configured deadline of <b>' + htmlEscape(dl) +
      '</b> has closed. This email contains only sites assigned to you. Labour monetary amounts are excluded from DPR reporting.</p>' + statsHtml(stats) + missingHtml + '<table border="1" cellpadding="6" cellspacing="0">' + tableHead + rows.map(siteRow).join('') + '</table></div>'));
  }
  const mgmt = unique((await activeRoleEmails(s, ['GM'])).concat(await activeRoleEmails(s, ['ADMIN']), await activeRoleEmails(s, ['AUDITOR'])));
  const mgmtCc = await activeRoleEmails(s, ['PM']);
  const missingRecords = records.filter((r) => r.Compliance_Status === 'MISSING'), pmMissing = records.filter((r) => r.Compliance_Status === 'PM PLAN MISSING');
  const missedEngineerHtml = missingRecords.length ? '<h3 style="color:#b91c1c">Site Engineers who did not submit DPR (' + missingRecords.length + ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Site Engineer</th><th>Email</th><th>Project</th><th>Project Manager</th></tr>' +
    missingRecords.map((r) => '<tr><td>' + htmlEscape(r.Site_Engineer || 'Not assigned') + '</td><td>' + htmlEscape(r.Site_Engineer_Email || '') + '</td><td>' + htmlEscape(r.Project_Number) + ' — ' + htmlEscape(r.Client) + '</td><td>' + htmlEscape(r.Project_Manager || r.PM_Email || 'Not assigned') + '</td></tr>').join('') + '</table>'
    : '<p><b>Site Engineer DPR lapses:</b> None.</p>';
  const missedPmHtml = pmMissing.length ? '<h3 style="color:#b91c1c">Project Managers who did not set targets (' + pmMissing.length + ' ongoing project(s))</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project Manager</th><th>Email</th><th>Ongoing project</th><th>Planning status</th></tr>' +
    pmMissing.map((r) => '<tr><td>' + htmlEscape(r.Project_Manager || 'Not assigned') + '</td><td>' + htmlEscape(r.PM_Email || '') + '</td><td>' + htmlEscape(r.Project_Number) + ' — ' + htmlEscape(r.Client) + '</td><td><b>TARGET NOT SET</b></td></tr>').join('') + '</table>'
    : '<p><b>PM target-setting lapses:</b> None across ongoing projects.</p>';
  deliveries.push(await sendOperationalEmail(s, 'MANAGEMENT_DAILY_OPERATIONS_DIGEST', workDate, mgmt, mgmtCc,
    '[BILARA FINAL DPR] Work Date ' + workDate + ' | PM planned ' + allStats.workPlanned + ' | Site Off ' + allStats.siteOff + ' | Not Started ' + allStats.notStarted + ' | Targets missing ' + allStats.pmPlanMissing + ' | DPR missing ' + allStats.missing + ' | On time ' + allStats.onTime,
    '<div style="font-family:Arial;color:#1f2937"><h2>Final DPR — work date ' + htmlEscape(workDate) + '</h2><p>This is the final previous-day DPR report. Every ongoing site is shown after the configured deadline of <b>' + htmlEscape(dl) +
    '</b>, including PM planned work, Site Off, Not Started, PM target-setting lapses, submitted DPRs, missing DPRs, planning lead time, actual fulfilment, GRNs and materials received. Labour monetary amounts are excluded.</p>' +
    statsHtml(allStats) + missedEngineerHtml + missedPmHtml + '<h3>All ongoing project records</h3><table border="1" cellpadding="6" cellspacing="0">' + tableHead + records.map(siteRow).join('') + '</table></div>'));
  const hr = await activeRoleEmails(s, ['HR']);
  const names: Record<string, string> = {};
  (await s.read('Users_Roles')).forEach((u) => { const e = normaliseEmail(u.Email); if (e) names[e] = String(u.Name || '').trim(); });
  const people: Record<string, any> = {};
  records.filter((r) => ['FILED ON TIME', 'FILED', 'FILED LATE', 'MISSING'].indexOf(r.Compliance_Status) >= 0).forEach((r) => {
    const emails = unique(String(r.Site_Engineer_Email || '').split(/[;,]/).map(normaliseEmail));
    const candidates = emails.length ? emails : [''];
    candidates.forEach((e) => {
      const name = names[e] || (candidates.length === 1 ? String(r.Site_Engineer || '').trim() : '') || e || 'Not assigned';
      const key = e || name.toLowerCase();
      const status = r.Compliance_Status === 'MISSING' || r.Compliance_Status === 'FILED LATE' ? 'ABSENT' : 'PRESENT';
      const detail = r.Compliance_Status === 'FILED LATE' ? 'DPR SUBMITTED LATE — ABSENT' : (r.Compliance_Status === 'MISSING' ? 'DPR NOT SUBMITTED — ABSENT' : 'DPR SUBMITTED ON TIME — PRESENT');
      if (!people[key] || status === 'ABSENT') people[key] = {name, status, detail};
    });
  });
  const attendance = Object.keys(people).map((k) => people[k]).sort((a, b) => a.name.localeCompare(b.name));
  const absent = attendance.filter((p) => p.status === 'ABSENT'), present = attendance.filter((p) => p.status === 'PRESENT');
  const pmLapse: Record<string, any> = {};
  pmMissing.forEach((r) => { const k = normaliseEmail(r.PM_Email) || String(r.Project_Manager || 'Not assigned').toLowerCase(); if (!pmLapse[k]) pmLapse[k] = {name: r.Project_Manager || r.PM_Email || 'Not assigned', email: r.PM_Email || '', projects: 0}; pmLapse[k].projects++; });
  const pmLapses = Object.keys(pmLapse).map((k) => pmLapse[k]).sort((a, b) => a.name.localeCompare(b.name));
  const namesTable = (rows: any[], label: string) => !rows.length ? '<p><b>' + label + ':</b> None</p>' : '<h3>' + label + ' (' + rows.length + ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Name</th><th>Attendance</th></tr>' +
    rows.map((p) => '<tr><td>' + htmlEscape(p.name) + '</td><td><b>' + htmlEscape(p.status) + '</b><br>' + htmlEscape(p.detail || '') + '</td></tr>').join('') + '</table>';
  const pmTable = pmLapses.length ? '<h3>Project Managers who did not set targets (' + pmLapses.length + ')</h3><table border="1" cellpadding="6" cellspacing="0"><tr><th>Name</th><th>Email</th><th>Ongoing projects without target</th></tr>' +
    pmLapses.map((p) => '<tr><td>' + htmlEscape(p.name) + '</td><td>' + htmlEscape(p.email) + '</td><td>' + htmlEscape(p.projects) + '</td></tr>').join('') + '</table>' : '<p><b>Project Managers without targets:</b> None.</p>';
  if (hr.length) deliveries.push(await sendOperationalEmail(s, 'HR_DPR_ATTENDANCE_SUMMARY', workDate, hr, [],
    '[BILARA DPR - HR ATTENDANCE] Work Date ' + workDate + ' | Site Engineers absent/late ' + absent.length + ' | PMs missing targets ' + pmLapses.length,
    '<div style="font-family:Arial;color:#1f2937"><h2>Final daily DPR attendance</h2><p>Attendance is finalised after the configured deadline of <b>' + htmlEscape(dl) + '</b> and is based only on PM-assigned DPR plans. A planned DPR not submitted by the deadline is marked <b>ABSENT</b>. Site Off and dates without a PM plan are excluded.</p>' +
    namesTable(present, 'DPR submitted — PRESENT') + namesTable(absent, 'DPR not submitted — ABSENT') + pmTable + '</div>'));
  const labourTo = await activeRoleEmails(s, ['LABOR_MANAGER']);
  if (dailyLabor.length) deliveries.push(await sendOperationalEmail(s, 'LABOR_DAILY_DIGEST', workDate, labourTo, [], '[BILARA LABOR DAILY SUMMARY] Work Date ' + workDate + ' | ' + dailyLabor.length + ' site/vendor row(s)',
    '<div style="font-family:Arial;color:#1f2937"><h2>Daily labor operations</h2><p>This email contains labor information only.</p><table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Vendor</th><th>Actual/planned worker-hours</th><th>Productivity</th><th>Actual-hours payable</th><th>Target-adjusted payable</th></tr>' +
    dailyLabor.map((r) => '<tr><td>' + htmlEscape(r.projectNumber) + ' — ' + htmlEscape(r.client) + '</td><td>' + htmlEscape(r.vendor) + '</td><td>' + htmlEscape(r.actualWorkerHours) + '/' + htmlEscape(r.plannedWorkerHours) + '</td><td>' + htmlEscape(r.productivityPercent) + '%</td><td>₹' + htmlEscape(r.actualHoursPayable) + '</td><td>₹' + htmlEscape(r.targetAdjustedPayable) + '</td></tr>').join('') + '</table></div>'));
  const failures = deliveries.filter((d) => d.status === 'FAILED' || d.status === 'NO RECIPIENT').length;
  const finalStatus = failures ? 'PARTIAL' : 'COMPLETED';
  await s.audit('DPR_COMPLIANCE_RUN', 'DATE', workDate, '', finalStatus, {stats: allStats, missing: missingRecords.length, pmPlanMissing: pmMissing.length, presentPeople: present.length, absentPeople: absent.length,
    pmPlanningLapses: pmLapses.length, hrRecipients: hr.length, projectManagers: Object.keys(byPm).length, deliveries: deliveries.map((d) => d.status), deliveryFailures: failures});
  return {status: finalStatus, date: workDate, stats: allStats, projects: records.length, missing: missingRecords.length, pmPlanMissing: pmMissing.length, presentPeople: present.length, absentPeople: absent.length, deliveryFailures: failures, deliveries: deliveries.map((d) => d.status)};
}

export async function sendDailyLowStockPlanningDigest(s: Site) {
  if (!(await emailWindow(s, 'DAILY_EMAIL_LOW_STOCK_TIME', '19:15', DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open) return {status: 'WINDOW CLOSED', stream: 'LOW_STOCK'};
  if (!(await operationalEmailEnabled(s, 'ENABLE_DAILY_LOW_STOCK_DIGEST'))) return {status: 'DISABLED'};
  const planDate = addDaysKey(s.todayKey(), 1);
  const projects: Record<string, Row> = {};
  (await s.read('Projects')).filter(isSelectableProject).forEach((p) => { projects[String(p.Project_ID || '')] = p; });
  const dailyByProject: Record<string, Row> = {};
  (await s.filter('DPR_Daily', (r) => dateKey(r.Work_Date) === planDate)).forEach((r) => { dailyByProject[String(r.Project_ID || '')] = r; });
  const targetsByDpr: Record<string, Row[]> = {};
  (await s.filter('DPR_Targets', (r) => dateKey(r.Work_Date) === planDate && String(r.Status || 'ACTIVE').toUpperCase() === 'ACTIVE')).forEach((r) => { (targetsByDpr[String(r.DPR_ID || '')] ||= []).push(r); });
  const lowStock = await s.filter('Material_Balances', (r) => Boolean(projects[String(r.Project_ID || '')]) && Number(r.Low_Stock_Threshold || 0) > 0 && Number(r.Balance_Quantity || 0) <= Number(r.Low_Stock_Threshold || 0));
  const rows = lowStock.map((r) => {
    const p = projects[String(r.Project_ID || '')] || {}, d = dailyByProject[String(r.Project_ID || '')] || {};
    const activities = operationsSiteOff(d) ? 'SITE OFF — ' + String(d.Site_Off_Category || '') + (d.Site_Off_Reason ? ': ' + d.Site_Off_Reason : '')
      : (operationsNotStarted(d) ? 'NOT STARTED — ' + String(d.Not_Started_Reason || '') : (targetsByDpr[String(d.DPR_ID || '')] || []).map((t) => String(t.Activity_Name || '')).filter(Boolean).join('; ') || 'No next-day target recorded');
    return '<tr><td>' + htmlEscape(p.Project_Number || r.Project_Number) + ' — ' + htmlEscape(p.Client || r.Client) + '</td><td>' + htmlEscape(p.Milestone || '—') + '</td><td>' + htmlEscape(r.Material_Name) + (r.Variant ? ' ' + htmlEscape(r.Variant) : '') +
      '</td><td><b>' + htmlEscape(r.Balance_Quantity) + ' ' + htmlEscape(r.Stock_Unit) + '</b></td><td>' + htmlEscape(r.Low_Stock_Threshold) + ' ' + htmlEscape(r.Stock_Unit) + '</td><td>' + htmlEscape(activities) + '</td></tr>';
  }).join('');
  const purchase = await purchaseNotificationRecipients(s);
  const cc = unique((await activeRoleEmails(s, ['AUDITOR'])).concat(await activeRoleEmails(s, ['ADMIN']), await activeRoleEmails(s, ['GM'])));
  const result = await sendOperationalEmail(s, 'DAILY_LOW_STOCK_PLAN', planDate, purchase, cc, '[BILARA PURCHASE LOW STOCK] Plan Date ' + planDate + ' | ' + lowStock.length + ' item(s) at/below threshold',
    '<div style="font-family:Arial;color:#1f2937"><h2>Low stock and next-day site plan</h2><p>Planning date: <b>' + htmlEscape(planDate) + '</b>.</p>' +
    (rows ? '<table border="1" cellpadding="6" cellspacing="0"><tr><th>Project</th><th>Phase / milestone</th><th>Material</th><th>Balance</th><th>Threshold</th><th>Next-day activity</th></tr>' + rows + '</table>' : '<p><b>No configured material is at or below its threshold.</b></p>') + '</div>');
  await s.audit('DAILY_LOW_STOCK_DIGEST_RUN', 'DATE', planDate, '', result.status, {lowStockItems: lowStock.length, recipients: purchase});
  return {status: result.status, date: planDate, lowStockItems: lowStock.length};
}

// ---------- the dispatcher (run every 5 minutes; replaces the Apps Script triggers) ----------

async function runSlot(slot: string, workDate: string, clock: (() => Date) | null, db: any, fn: (s: Site) => Promise<any>) {
  return runSiteAction(null, 'email:' + slot, async (s) => {
    const marker = 'DAILY_EMAIL_DISPATCH_' + slot + '_' + workDate.replace(/-/g, '');
    if ((await s.property(marker)) === 'COMPLETED') return {status: 'SENT', alreadyDispatched: true};
    let result: any;
    try { result = await fn(s); } catch (err) { result = {status: 'FAILED', error: err instanceof Error ? err.message : String(err)}; }
    if (['SENT', 'COMPLETED', 'DISABLED', 'NON_WORKING_DAY', 'SUNDAY_OFF_UNLESS_BOOKED'].indexOf(String(result?.status || '').toUpperCase()) >= 0) s.setProperty(marker, 'COMPLETED');
    return result;
  }, {clock: clock || undefined, db});
}

export async function runConfiguredDailyEmailDispatcher(opts: {clock?: () => Date; db?: any} = {}) {
  const probe = new Site(null, 'email:probe', opts.db);
  if (opts.clock) probe.clock = opts.clock;
  const today = probe.todayKey(), previous = addDaysKey(today, -1);
  const results: any = {date: today, timezone: 'Asia/Kolkata', qcOffice: null, lowStock: null, dprReminder: null, dprFinal: null, grnDigest: null, materialDigest: null};
  const finalWindow = await emailWindow(probe, 'DAILY_EMAIL_DPR_FINAL_TIME', '08:30', DPR_FINAL_DELIVERY_WINDOW_MINUTES);
  const clock = opts.clock || null;
  if (finalWindow.open) results.dprFinal = await runSlot('DPR_FINAL', previous, clock, opts.db, (s) => sendDailyDprComplianceSummary(s, previous));
  else if (finalWindow.closed) results.dprFinal = {status: 'WINDOW CLOSED', date: previous, reason: 'Final DPR is restricted to its configured morning recovery window.'};
  const open = async (key: string, fb: string) => (await emailWindow(probe, key, fb, DAILY_EMAIL_DELIVERY_WINDOW_MINUTES)).open;
  if (await open('DAILY_EMAIL_GRN_TIME', '19:30')) results.grnDigest = await runSlot('GRN_DIGEST', today, clock, opts.db, (s) => sendDailyPurchaseGrnDigest(s, today));
  if (await open('DAILY_EMAIL_MATERIAL_TIME', '19:45')) results.materialDigest = await runSlot('MATERIAL_DIGEST', today, clock, opts.db, (s) => sendDailyDetailedMaterialDigest(s, today));
  if (await open('DAILY_EMAIL_DPR_REMINDER_TIME', '20:00')) results.dprReminder = await runSlot('DPR_REMINDER', today, clock, opts.db, (s) => sendDprTenPmReminder(s, today));
  if (await open('DAILY_EMAIL_QC_OFFICE_TIME', '19:00')) results.qcOffice = await runSlot('QC_OFFICE', today, clock, opts.db, (s) => sendNextDayQcOfficeDutyNotices(s));
  if (await open('DAILY_EMAIL_LOW_STOCK_TIME', '19:15')) results.lowStock = await runSlot('LOW_STOCK', today, clock, opts.db, (s) => sendDailyLowStockPlanningDigest(s));
  const attempted = [results.dprFinal, results.grnDigest, results.materialDigest, results.dprReminder, results.qcOffice, results.lowStock].filter(Boolean);
  const failures = attempted.filter((r: any) => { const st = String(r?.status || '').toUpperCase(); return st === 'FAILED' || st === 'PARTIAL' || st.indexOf('NO ') === 0; }).length;
  results.status = failures ? 'PARTIAL' : 'COMPLETED';
  await runSiteAction(null, 'email:dispatcher', async (s) => {
    s.setProperty('DAILY_EMAIL_DISPATCHER_LAST_RUN_AT', s.now().toISOString());
    if (attempted.length) await s.audit('DAILY_EMAIL_DISPATCHER_RUN', 'SYSTEM', 'dispatcher', '', results.status, results);
  }, {clock: opts.clock, db: opts.db});
  return results;
}

// ---------- Admin: email times and health (was the spreadsheet menu dialog) ----------

export async function getEmailSchedule(s: Site) {
  s.requireRole(['ADMIN']);
  const schedules = [];
  for (const item of DAILY_EMAIL_SCHEDULES) schedules.push({id: item.id, key: item.key, label: item.label, time: await dailyEmailTimeValue(s, item.key, item.fallback), fallback: item.fallback});
  const log = await s.read('Notification_Log');
  const failed = log.filter((r) => String(r.Status || '').toUpperCase() === 'FAILED');
  return clientSafe({
    timezone: 'Asia/Kolkata', schedules,
    enabled: {officeDuty: await operationalEmailEnabled(s, 'ENABLE_QC_OFFICE_DUTY_EMAILS'), lowStock: await operationalEmailEnabled(s, 'ENABLE_DAILY_LOW_STOCK_DIGEST'),
      grnDigest: await operationalEmailEnabled(s, 'ENABLE_DAILY_GRN_DIGEST'), dprCompliance: await operationalEmailEnabled(s, 'ENABLE_DPR_COMPLIANCE_EMAILS')},
    recipients: {pm: (await activeRoleEmails(s, ['PM'])).length, gm: (await activeRoleEmails(s, ['GM'])).length, admin: (await activeRoleEmails(s, ['ADMIN'])).length,
      auditor: (await activeRoleEmails(s, ['AUDITOR'])).length, hr: (await activeRoleEmails(s, ['HR'])).length, purchase: (await purchaseNotificationRecipients(s)).length},
    lastDispatcherRunAt: (await s.property('DAILY_EMAIL_DISPATCHER_LAST_RUN_AT')) || '',
    lastDelivery: log.length ? showRow(log[log.length - 1]) : null, lastFailure: failed.length ? showRow(failed[failed.length - 1]) : null,
    recent: log.slice(-50).reverse().map(showRow),
  });
}

export async function saveEmailSchedule(s: Site, payload: any) {
  const admin = s.requireRole(['ADMIN']);
  const saved: Record<string, string> = {};
  for (const item of DAILY_EMAIL_SCHEDULES) {
    const value = String(payload?.[item.id] || '').trim();
    if (!validTime(value)) throw new SiteError(item.label + ' must be a valid time in HH:mm format.');
    saved[item.key] = value;
    const row = await s.find('System_Config', 'Key', item.key);
    if (row) await s.update('System_Config', 'Key', item.key, {Value: value});
    else await s.append('System_Config', {Key: item.key, Value: value, Description: item.label + ' in 24-hour HH:mm format, Asia/Kolkata.'});
  }
  s.setProperty(DAILY_EMAIL_TIMES_PROPERTY, JSON.stringify(saved));
  for (const [key, flag] of [['ENABLE_QC_OFFICE_DUTY_EMAILS', 'officeDuty'], ['ENABLE_DAILY_LOW_STOCK_DIGEST', 'lowStock'], ['ENABLE_DAILY_GRN_DIGEST', 'grnDigest'], ['ENABLE_DPR_COMPLIANCE_EMAILS', 'dprCompliance']] as const) {
    if (payload?.enabled && typeof payload.enabled[flag] === 'boolean') {
      const value = payload.enabled[flag] ? 'Yes' : 'No';
      if (await s.find('System_Config', 'Key', key)) await s.update('System_Config', 'Key', key, {Value: value});
      else await s.append('System_Config', {Key: key, Value: value, Description: ''});
    }
  }
  await s.audit('DAILY_EMAIL_TIMES_CONFIGURED', 'SYSTEM_CONFIG', 'DAILY_EMAIL_SCHEDULES', '', 'UPDATED', {runBy: admin.email, timezone: 'Asia/Kolkata', schedules: saved});
  return getEmailSchedule(s);
}
