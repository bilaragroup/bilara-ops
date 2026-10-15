// QC office attendance and loss-of-pay register, kept by the GM (from the QC app's
// Attendance.gs). The GM-only "QC Office Attendance & LOP Register" Google workbook is replaced
// by the GM Attendance page: the office plan, today's list, the month's register (Present,
// absence reason, GM decision) and the LOP summary.
import {Site, Row, SiteError, dateKey, parseDateKey, weekdayOfKey, clientSafe, normaliseEmail, unique} from './core';
import {isSelectableProject} from './access';
import {dprText} from './util';

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function activeCapacityStatus(status: any) { return ['BOOKED', 'PENDING ACCEPTANCE', 'ACCEPTED'].indexOf(String(status).toUpperCase()) >= 0; }
export function attendanceBusyStatus(status: any) { return activeCapacityStatus(status) || String(status).toUpperCase() === 'COMPLETED'; }

export async function activeQcUsers(s: Site) {
  return (await s.read('Users_Roles')).filter((r) => String(r.Role || '').toUpperCase() === 'QC' && String(r.Active || '').toLowerCase() === 'yes')
    .map((r) => ({name: String(r.Name || r.Email || ''), email: String(r.Email || '').trim().toLowerCase()})).sort((a, b) => a.name.localeCompare(b.name));
}

/** Sunday is a weekly off for QC staff unless they are booked on a site. */
export function isQcSundayOffDate(value: any) {
  const key = dateKey(value);
  return Boolean(key) && weekdayOfKey(key) === 0;
}

export async function officeWorkingDateKeys(s: Site, year: number, month: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new SiteError('Invalid attendance month.');
  const configured = String((await s.config('QC_OFFICE_WORKING_DAYS')) || 'MON,TUE,WED,THU,FRI,SAT').toUpperCase().split(',').map((v) => v.trim());
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate(), result: string[] = [];
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const weekday = weekdayOfKey(key);
    if (weekday === 0) continue; // Sunday never creates an office attendance row.
    if (configured.indexOf(DAY_NAMES[weekday]) >= 0) result.push(key);
  }
  return result;
}

export async function officeAttendancePlan(s: Site, year: number, month: number) {
  const workingDates = await officeWorkingDateKeys(s, year, month);
  const dateSet: Record<string, boolean> = {};
  workingDates.forEach((d) => { dateSet[d] = true; });
  const busy: Record<string, boolean> = {}, unavailable: Record<string, string> = {};
  (await s.read('QC_Booking_Dates')).forEach((r) => {
    const date = dateKey(r.Visit_Date), email = String(r.QC_Email || '').trim().toLowerCase();
    if (dateSet[date] && attendanceBusyStatus(r.Status)) busy[email + '|' + date] = true;
  });
  (await s.read('QC_Unavailability')).forEach((r) => {
    const date = dateKey(r.Date), email = String(r.QC_Email || '').trim().toLowerCase();
    if (dateSet[date] && String(r.Status || '').toUpperCase() === 'ACTIVE') unavailable[email + '|' + date] = String(r.Type || 'Unavailable');
  });
  const qcs = await activeQcUsers(s);
  const qcEmails: Record<string, boolean> = {};
  qcs.forEach((q) => { qcEmails[q.email] = true; });
  // A QC assigned to a project as its site engineer / site QC is on site duty every working day.
  (await s.read('Projects')).filter(isSelectableProject).forEach((project) => {
    unique(String(project.Site_Engineer_Email || '').concat(';', String(project.Site_QC_Email || '')).split(/[;,]/).map(normaliseEmail))
      .filter((email) => qcEmails[email]).forEach((email) => workingDates.forEach((date) => { busy[email + '|' + date] = true; }));
  });
  const engineers = qcs.map((q) => ({name: q.name, email: q.email, officeDates: workingDates.filter((date) => !busy[q.email + '|' + date])}));
  const expectedRows: Array<{date: string; name: string; email: string; suggestedReason: string}> = [];
  engineers.forEach((q) => q.officeDates.forEach((date) => expectedRows.push({date, name: q.name, email: q.email, suggestedReason: unavailable[q.email + '|' + date] || ''})));
  return {workingDates, engineers, expectedRows, busy, unavailable};
}

export function attendanceLopStatus(input: {present?: any; decision?: any}) {
  if (input.present === true) return 'NO LOP';
  const decision = String(input.decision || 'PENDING').toUpperCase();
  if (decision === 'APPROVED') return 'APPROVED ABSENCE';
  if (decision === 'REJECTED') return 'LOP';
  return 'PENDING REVIEW';
}

async function savedInputs(s: Site, monthKey: string) {
  const saved: Record<string, Row> = {};
  (await s.filter('QC_Office_Attendance', (r) => dateKey(r.Work_Date).slice(0, 7) === monthKey)).forEach((r) => { saved[dateKey(r.Work_Date) + '|' + String(r.QC_Email).toLowerCase()] = r; });
  return saved;
}

/** The GM Attendance page: QC schedules for the month, office plan, register and LOP. */
export async function getAdminAttendanceWorkspace(s: Site, year: any, month: any) {
  const user = s.requireRole(['GM']);
  const today = s.todayKey();
  const y = Number(year || today.slice(0, 4)), m = Number(month || today.slice(5, 7));
  const plan = await officeAttendancePlan(s, y, m);
  const bookingHeaders: Record<string, Row> = {};
  (await s.read('QC_Booking_Header')).forEach((r) => { bookingHeaders[String(r.Booking_ID || '')] = r; });
  const projects: Record<string, Row> = {};
  (await s.read('Projects')).forEach((r) => { projects[String(r.Project_ID || '')] = r; });
  const prefix = String(y) + '-' + String(m).padStart(2, '0') + '-';
  const scheduleByQc: Record<string, any[]> = {};
  (await activeQcUsers(s)).forEach((q) => { scheduleByQc[q.email] = []; });
  (await s.read('QC_Booking_Dates')).forEach((row) => {
    const date = dateKey(row.Visit_Date), email = String(row.QC_Email || '').trim().toLowerCase();
    if (!scheduleByQc[email] || date.indexOf(prefix) !== 0 || !attendanceBusyStatus(row.Status)) return;
    const header = bookingHeaders[String(row.Booking_ID || '')] || {};
    const project = projects[String(header.Project_ID || row.Project_ID || '')] || {};
    scheduleByQc[email].push({date, kind: 'BOOKED', projectNumber: String(project.Project_Number || header.Project_ID || row.Project_ID || ''),
      purpose: String(header.Booking_Purpose || '').toUpperCase() === 'OTHER' ? String(header.Other_Reason || 'Other site visit') : String(header.Inspection_Heading || header.Quality_Check_Code || 'QC inspection'),
      status: String(row.Status || header.Status || '')});
  });
  (await s.read('QC_Unavailability')).forEach((row) => {
    const date = dateKey(row.Date), email = String(row.QC_Email || '').trim().toLowerCase();
    if (!scheduleByQc[email] || date.indexOf(prefix) !== 0 || String(row.Status || '').toUpperCase() !== 'ACTIVE') return;
    scheduleByQc[email].push({date, kind: 'UNAVAILABLE', purpose: String(row.Type || 'Unavailable'), status: 'UNAVAILABLE'});
  });
  const monthKey = prefix.slice(0, 7);
  const saved = await savedInputs(s, monthKey);
  const register = plan.expectedRows.map((r) => {
    const input = saved[r.date + '|' + r.email];
    const present = input ? input.Present === true || String(input.Present).toUpperCase() === 'TRUE' : false;
    const decision = input ? String(input.GM_Decision || 'PENDING') : 'PENDING';
    return {date: r.date, name: r.name, email: r.email, present, reason: input ? String(input.Absence_Reason || '') : r.suggestedReason || '',
      decision, lopStatus: attendanceLopStatus({present, decision}), updatedAt: input ? input.Updated_At || '' : '', updatedBy: input ? String(input.Updated_By || '') : ''};
  });
  const lop: Record<string, any> = {};
  register.forEach((row) => {
    if (!lop[row.email]) lop[row.email] = {name: row.name, email: row.email, absentDates: [], approvedDates: [], lopDates: []};
    if (!row.present) lop[row.email].absentDates.push(row.date);
    if (row.lopStatus === 'APPROVED ABSENCE') lop[row.email].approvedDates.push(row.date);
    if (row.lopStatus === 'LOP') lop[row.email].lopDates.push(row.date);
  });
  const officePlan = plan.workingDates.map((date) => ({date, expected: plan.expectedRows.filter((r) => r.date === date).map((r) => r.name).sort()}));
  return clientSafe({
    year: y, month: m, today, gmEmail: user.email,
    engineers: plan.engineers.map((q) => ({...q, schedule: scheduleByQc[q.email] || []})),
    officePlan, register, todayRows: register.filter((r) => r.date === today),
    lopSummary: Object.keys(lop).sort().map((email) => ({...lop[email], lopDays: lop[email].lopDates.length})),
  });
}

/** GM records Present / absence reason / decision for one QC engineer on one office day. */
export async function saveAttendanceDecision(s: Site, payload: any) {
  const user = s.requireRole(['GM']);
  const date = dateKey(payload?.date);
  const email = normaliseEmail(payload?.email);
  if (!date || !email) throw new SiteError('Choose the date and QC engineer.');
  const [y, m] = date.split('-').map(Number);
  const plan = await officeAttendancePlan(s, y, m);
  const expected = plan.expectedRows.find((r) => r.date === date && r.email === email);
  if (!expected) throw new SiteError('This QC engineer is not expected in the office on ' + date + '.');
  const decision = String(payload.decision || 'PENDING').toUpperCase();
  if (['PENDING', 'APPROVED', 'REJECTED'].indexOf(decision) < 0) throw new SiteError('GM decision must be Pending, Approved or Rejected.');
  const present = payload.present === true;
  const changes = {Work_Date: parseDateKey(date), QC_Email: email, QC_Name: expected.name, Present: present,
    Absence_Reason: dprText(payload.reason, 'Absence reason', 500, false), GM_Decision: decision, LOP_Status: attendanceLopStatus({present, decision}),
    Updated_At: s.now(), Updated_By: user.email};
  const existing = (await s.filter('QC_Office_Attendance', (r) => dateKey(r.Work_Date) === date && String(r.QC_Email).toLowerCase() === email))[0];
  if (existing) await s.updateBatch('QC_Office_Attendance', [{record: existing, changes}]);
  else await s.append('QC_Office_Attendance', changes);
  await s.audit('QC_OFFICE_ATTENDANCE_UPDATED', 'QC_OFFICE_ATTENDANCE', date + '|' + email, '', decision, {workDate: date, qcEmail: email, present, absenceReason: changes.Absence_Reason, gmDecision: decision, updatedBy: user.email});
  return getAdminAttendanceWorkspace(s, y, m);
}

export async function refreshHrAttendance(s: Site, payload: any) {
  s.requireRole(['GM']);
  return getAdminAttendanceWorkspace(s, Number(payload?.year), Number(payload?.month));
}

