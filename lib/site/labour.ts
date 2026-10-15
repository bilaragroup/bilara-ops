// Labour productivity and weekly vendor payables (Thursday-to-Wednesday cycle, paid the
// following Thursday), GM leniency, and the labour records register.
// Converted from the QC app's LaborPayables.gs and LaborRecords.gs. The separate "Bilara Labor
// Records" Google workbook is replaced by live views here, read straight from the DPR tables.
import {Site, Row, SiteError, dateKey, isValidDateKey, parseDateKey, addDaysKey, weekStartKey, clientSafe, normaliseEmail, unique} from './core';
import {getProjectsForUser} from './access';
import {dprPercent, dprText, dprClientProject, materialRound, shortId} from './util';
import {dprIsSubmitted} from './dpr';

export function laborRound(value: any) { return Math.round(Number(value || 0) * 100) / 100; }

export function laborShiftRates(shiftCode: any) {
  const shift = Number(shiftCode || 0);
  if ([8, 9.5, 10].indexOf(shift) < 0) throw new SiteError('Shift must be 8, 9.5 or 10 hours.');
  const helperDay = shift === 8 ? 1000 : 1200;
  const masonDay = shift === 8 ? 1200 : 1400;
  return {shiftHours: shift, helperDayRate: helperDay, masonDayRate: masonDay, helperHourlyRate: helperDay / shift, masonHourlyRate: masonDay / shift};
}

/** The Thursday–Wednesday cycle holding a work date, and its Thursday payout. */
export function laborCycleForDate(workDate: any) {
  const key = dateKey(workDate);
  if (!isValidDateKey(key)) throw new SiteError('Invalid labor work date.');
  const start = weekStartKey(key);
  return {start, end: addDaysKey(start, 6), payout: addDaysKey(start, 7)};
}

export function laborPayableKey(cycleStart: any, projectId: any, vendor: any) {
  return [String(cycleStart || ''), String(projectId || ''), String(vendor || '').trim().toUpperCase().replace(/\s+/g, ' ')].join('|');
}

export async function laborPayableActivities(s: Site) {
  const dailyMap: Record<string, Row> = {}, projectMap: Record<string, Row> = {}, resultMap: Record<string, Row> = {};
  (await s.read('DPR_Daily')).forEach((row) => { dailyMap[String(row.DPR_ID || '')] = row; });
  (await s.read('Projects')).forEach((row) => { projectMap[String(row.Project_ID || '')] = row; });
  (await s.read('DPR_Results')).forEach((row) => { resultMap[String(row.Target_ID || '')] = row; });
  return (await s.read('DPR_Targets')).filter((target) => {
    const daily = dailyMap[String(target.DPR_ID || '')];
    return daily && dprIsSubmitted(daily) && String(target.Status || 'ACTIVE').toUpperCase() === 'ACTIVE';
  }).map((target) => {
    const daily = dailyMap[String(target.DPR_ID || '')] || {};
    const project = projectMap[String(target.Project_ID || '')] || {};
    const result = resultMap[String(target.Target_ID || '')] || {};
    const workDate = dateKey(target.Work_Date || daily.Work_Date);
    const cycle = laborCycleForDate(workDate);
    const shift = laborShiftRates(daily.Actual_Shift_Code || daily.Planned_Shift_Code || 8);
    const plannedShift = laborShiftRates(daily.Planned_Shift_Code || 8);
    const plannedMasons = Number(target.Planned_Activity_Masons || 0), plannedHelpers = Number(target.Planned_Activity_Labourers || 0), plannedHours = Number(target.Planned_Hours || 0);
    const actualMasons = Number(result.Actual_Activity_Masons || 0), actualHelpers = Number(result.Actual_Activity_Labourers || 0);
    const hoursPerWorker = Number(result.Hours_Per_Worker || result.Effective_Hours || 0);
    const actualWorkerHours = actualMasons * hoursPerWorker + actualHelpers * hoursPerWorker;
    const overtimeHoursPerWorker = Math.max(0, Number(result.Overtime_Hours_Per_Worker || (hoursPerWorker - plannedShift.shiftHours) || 0));
    const overtimeWorkerHours = (actualMasons + actualHelpers) * overtimeHoursPerWorker;
    const achievement = Math.min(100, Math.max(0, Number(result.Capped_Achievement_Percent || result.Achievement_Percent || 0)));
    const projected = plannedMasons * plannedHours * plannedShift.masonHourlyRate + plannedHelpers * plannedHours * plannedShift.helperHourlyRate;
    const actualPayable = actualMasons * hoursPerWorker * shift.masonHourlyRate + actualHelpers * hoursPerWorker * shift.helperHourlyRate;
    return {
      cycleStart: cycle.start, cycleEnd: cycle.end, payoutDate: cycle.payout, workDate, projectId: String(target.Project_ID || ''),
      projectNumber: String(project.Project_Number || daily.Project_Number || ''), client: String(project.Client || daily.Client || ''), location: String(project.Location || ''),
      vendor: String(daily.Actual_Vendor || daily.Planned_Vendor || 'UNSPECIFIED').trim(), dprId: String(target.DPR_ID || ''), targetId: String(target.Target_ID || ''),
      activity: String(target.Activity_Name || ''), shiftHours: shift.shiftHours, masonHourlyRate: laborRound(shift.masonHourlyRate), helperHourlyRate: laborRound(shift.helperHourlyRate),
      plannedMasons, plannedHelpers, plannedHoursPerWorker: plannedHours, plannedWorkerHours: laborRound((plannedMasons + plannedHelpers) * plannedHours),
      actualMasons, actualHelpers, actualHoursPerWorker: hoursPerWorker, actualWorkerHours: laborRound(actualWorkerHours), overtimeHoursPerWorker: laborRound(overtimeHoursPerWorker),
      overtimeWorkerHours: laborRound(overtimeWorkerHours), achievementPercent: laborRound(achievement), weightedAchievementPoints: laborRound(actualWorkerHours * achievement),
      projectedPayable: laborRound(projected), actualHoursPayable: laborRound(actualPayable), activityTargetAdjustedPayable: laborRound(actualPayable * achievement / 100),
    };
  }).sort((a, b) => a.workDate.localeCompare(b.workDate) || a.projectNumber.localeCompare(b.projectNumber));
}

export async function laborGroupRows(s: Site, activities: any[]) {
  const daily: Record<string, any> = {}, weekly: Record<string, any> = {};
  (activities || []).forEach((item) => {
    const key = [item.workDate, item.projectId, item.vendor.toUpperCase()].join('|');
    if (!daily[key]) daily[key] = {...item, days: {}, plannedWorkerHours: 0, actualWorkerHours: 0, overtimeWorkerHours: 0, weightedPoints: 0, projectedPayable: 0, actualHoursPayable: 0};
    const day = daily[key];
    day.days[item.workDate] = true;
    day.plannedWorkerHours += item.plannedWorkerHours; day.actualWorkerHours += item.actualWorkerHours; day.overtimeWorkerHours += item.overtimeWorkerHours;
    day.weightedPoints += item.weightedAchievementPoints; day.projectedPayable += item.projectedPayable; day.actualHoursPayable += item.actualHoursPayable;
  });
  const dailyRows = Object.keys(daily).map((key) => {
    const row = daily[key];
    row.productivityPercent = row.actualWorkerHours > 0 ? row.weightedPoints / row.actualWorkerHours : 0;
    row.targetAdjustedPayable = row.actualHoursPayable * Math.min(100, row.productivityPercent) / 100;
    row.withheld = Math.max(0, row.actualHoursPayable - row.targetAdjustedPayable);
    ['plannedWorkerHours', 'actualWorkerHours', 'overtimeWorkerHours', 'productivityPercent', 'projectedPayable', 'actualHoursPayable', 'targetAdjustedPayable', 'withheld'].forEach((f) => { row[f] = laborRound(row[f]); });
    return row;
  });
  dailyRows.forEach((day) => {
    const key = laborPayableKey(day.cycleStart, day.projectId, day.vendor);
    if (!weekly[key]) weekly[key] = {...day, payableKey: key, days: {}, plannedWorkerHours: 0, actualWorkerHours: 0, overtimeWorkerHours: 0, weightedPoints: 0, projectedPayable: 0, actualHoursPayable: 0};
    const week = weekly[key];
    week.days[day.workDate] = true;
    week.plannedWorkerHours += day.plannedWorkerHours; week.actualWorkerHours += day.actualWorkerHours; week.overtimeWorkerHours += day.overtimeWorkerHours;
    week.weightedPoints += day.weightedPoints; week.projectedPayable += day.projectedPayable; week.actualHoursPayable += day.actualHoursPayable;
  });
  const adjustments: Record<string, Row> = {};
  (await s.filter('Labor_GM_Adjustments', (row) => String(row.Status || '').toUpperCase() === 'APPROVED')).forEach((row) => { adjustments[String(row.Payable_Key || '')] = row; });
  const weeklyRows = Object.keys(weekly).map((key) => {
    const row = weekly[key], adjustment = adjustments[key] || {};
    row.daysReported = Object.keys(row.days).length;
    row.productivityPercent = row.actualWorkerHours > 0 ? row.weightedPoints / row.actualWorkerHours : 0;
    row.targetAdjustedPayable = row.actualHoursPayable * Math.min(100, row.productivityPercent) / 100;
    row.withheld = Math.max(0, row.actualHoursPayable - row.targetAdjustedPayable);
    row.recoveryPercent = Math.min(100, Math.max(0, Number(adjustment.Recovery_Percent || 0)));
    row.recoveryAmount = row.withheld * row.recoveryPercent / 100;
    row.finalApprovedPayable = row.targetAdjustedPayable + row.recoveryAmount;
    row.gmReason = String(adjustment.Reason || ''); row.gmApprovedBy = String(adjustment.Approved_By || ''); row.gmApprovedAt = adjustment.Approved_At || '';
    ['plannedWorkerHours', 'actualWorkerHours', 'overtimeWorkerHours', 'productivityPercent', 'projectedPayable', 'actualHoursPayable', 'targetAdjustedPayable', 'withheld', 'recoveryPercent', 'recoveryAmount', 'finalApprovedPayable']
      .forEach((f) => { row[f] = laborRound(row[f]); });
    return row;
  }).sort((a, b) => b.cycleStart.localeCompare(a.cycleStart) || a.vendor.localeCompare(b.vendor) || a.projectNumber.localeCompare(b.projectNumber));
  return {daily: dailyRows, weekly: weeklyRows};
}

async function laborRowsForUser(s: Site, user: any, rows: any[]) {
  if (user.role !== 'PM') return rows;
  const email = normaliseEmail(user.email);
  const owned: Record<string, boolean> = {};
  (await s.read('Projects')).filter((p) => normaliseEmail(p.PM_Email) === email).forEach((p) => { owned[String(p.Project_ID || '')] = true; });
  return rows.filter((row) => Boolean(owned[row.projectId]));
}

export async function getLaborPayablesWorkspace(s: Site, filters: any) {
  const user = s.requireRole(['LABOR_MANAGER', 'AUDITOR', 'GM', 'PM']);
  const grouped = await laborGroupRows(s, await laborPayableActivities(s));
  const input = filters || {};
  const apply = async (rows: any[]) => (await laborRowsForUser(s, user, rows)).filter((row) =>
    (!input.cycleStart || row.cycleStart === input.cycleStart) && (!input.projectId || row.projectId === input.projectId) &&
    (!input.vendor || row.vendor.toUpperCase() === String(input.vendor).trim().toUpperCase()));
  let weekly = await apply(grouped.weekly), daily = await apply(grouped.daily);
  const allWeekly = await laborRowsForUser(s, user, grouped.weekly);
  const canViewAmounts = ['GM', 'AUDITOR', 'LABOR_MANAGER'].indexOf(user.role) >= 0;
  if (!canViewAmounts) {
    weekly = weekly.map((row) => ({payableKey: row.payableKey, cycleStart: row.cycleStart, cycleEnd: row.cycleEnd, payoutDate: row.payoutDate, projectId: row.projectId,
      projectNumber: row.projectNumber, client: row.client, location: row.location, vendor: row.vendor, plannedWorkerHours: row.plannedWorkerHours,
      actualWorkerHours: row.actualWorkerHours, overtimeWorkerHours: row.overtimeWorkerHours, productivityPercent: row.productivityPercent}));
    daily = daily.map((row) => ({workDate: row.workDate, projectId: row.projectId, projectNumber: row.projectNumber, client: row.client, location: row.location,
      vendor: row.vendor, plannedWorkerHours: row.plannedWorkerHours, actualWorkerHours: row.actualWorkerHours, overtimeWorkerHours: row.overtimeWorkerHours, productivityPercent: row.productivityPercent}));
  } else {
    weekly = weekly.map(({days, weightedPoints, ...row}: any) => row);
    daily = daily.map(({days, weightedPoints, ...row}: any) => row);
  }
  return clientSafe({
    role: user.role, canApprove: user.role === 'GM', canViewAmounts, daily, weekly,
    cycles: unique(allWeekly.map((row) => row.cycleStart)).reverse(), vendors: unique(allWeekly.map((row) => row.vendor)),
    projects: (await getProjectsForUser(s, user)).map(dprClientProject), currentCycle: laborCycleForDate(s.todayKey()),
    filters: {cycleStart: String(input.cycleStart || ''), vendor: String(input.vendor || ''), projectId: String(input.projectId || '')},
  });
}

export async function saveGmLaborLeniency(s: Site, payload: any) {
  const user = s.requireRole(['GM']);
  const key = String(payload && payload.payableKey || '').trim();
  const recovery = dprPercent(payload && payload.recoveryPercent, 'Recovery of withheld amount');
  const reason = dprText(payload && payload.reason, 'GM leniency reason', 1000, recovery > 0);
  const row = (await laborGroupRows(s, await laborPayableActivities(s))).weekly.find((item) => item.payableKey === key);
  if (!row) throw new SiteError('This weekly site/vendor payable no longer exists. Refresh and retry.');
  const existing = (await s.filter('Labor_GM_Adjustments', (item) => String(item.Payable_Key || '') === key && String(item.Status || '').toUpperCase() === 'APPROVED'))
    .sort((a, b) => Number(b.Approval_Version || 0) - Number(a.Approval_Version || 0))[0] || null;
  if (existing) await s.update('Labor_GM_Adjustments', 'Adjustment_ID', existing.Adjustment_ID, {Status: 'SUPERSEDED', Updated_At: s.now()});
  const version = Number(existing && existing.Approval_Version || 0) + 1;
  await s.append('Labor_GM_Adjustments', {
    Adjustment_ID: shortId('LGA-'), Payable_Key: key, Cycle_Start: parseDateKey(row.cycleStart), Cycle_End: parseDateKey(row.cycleEnd), Payout_Date: parseDateKey(row.payoutDate),
    Project_ID: row.projectId, Project_Number: row.projectNumber, Client: row.client, Location: row.location, Vendor: row.vendor, Recovery_Percent: recovery,
    Reason: reason, Status: 'APPROVED', Approval_Version: version, Approved_By: user.email, Approved_At: s.now(), Updated_At: s.now(),
  });
  await s.audit('LABOR_LENIENCY_APPROVED', 'LABOR_PAYABLE', key, existing ? String(existing.Recovery_Percent || 0) : '0', String(recovery), {
    projectId: row.projectId, vendor: row.vendor, cycleStart: row.cycleStart, reason, approvedBy: user.email,
  });
  return getLaborPayablesWorkspace(s, {cycleStart: row.cycleStart});
}

// ---------- labour records register (was the "Bilara Labor Records" workbook) ----------

export const LABOR_RECORD_HEADERS = ['DPR_ID', 'Target_ID', 'Work_Date', 'Project_ID', 'Project_Number', 'Client', 'Project_Manager', 'PM_Email', 'Site_Engineer', 'Site_Engineer_Email',
  'Activity_Number', 'Activity', 'Location', 'Measurement_Unit', 'Planned_Target', 'Actual_Achieved', 'Raw_Target_Achievement_Percent', 'Planned_Hours', 'Effective_Hours',
  'Planned_Hours_Used_Percent', 'Time_Adjusted_Target', 'Time_Adjusted_Achievement_Percent', 'Reduced_Hours_Reason', 'Planned_Masons', 'Planned_Labourers',
  'Actual_Masons', 'Actual_Labourers', 'DPR_Status', 'DPR_Submission_Version', 'Quality_Signed_By', 'Quality_Signed_At', 'Output_Description', 'Shortfall_Reason'];

/** Activity-hours register and per-project summary, read live from the DPR tables. */
export async function getLaborRecords(s: Site, filters: any) {
  const user = s.requireRole(['LABOR_MANAGER', 'AUDITOR', 'GM', 'ADMIN']);
  const input = filters || {};
  const dailyMap: Record<string, Row> = {}, projectMap: Record<string, Row> = {}, resultMap: Record<string, Row> = {};
  (await s.read('DPR_Daily')).forEach((row) => { dailyMap[String(row.DPR_ID || '')] = row; });
  (await s.read('Projects')).forEach((row) => { projectMap[String(row.Project_ID || '')] = row; });
  (await s.read('DPR_Results')).forEach((row) => { resultMap[String(row.Target_ID || '')] = row; });
  const n = (v: any) => (v === '' || v === undefined ? '' : Number(v || 0));
  const rows = (await s.filter('DPR_Targets', (t) => Boolean(dailyMap[String(t.DPR_ID || '')]) && String(t.Status || 'ACTIVE').toUpperCase() === 'ACTIVE' &&
    (!input.projectId || String(t.Project_ID) === String(input.projectId)) && (!input.from || dateKey(t.Work_Date) >= input.from) && (!input.to || dateKey(t.Work_Date) <= input.to)))
    .sort((a, b) => dateKey(a.Work_Date).localeCompare(dateKey(b.Work_Date)) || Number(a.Sequence || 0) - Number(b.Sequence || 0))
    .map((target) => {
      const daily = dailyMap[String(target.DPR_ID || '')] || {}, project = projectMap[String(target.Project_ID || '')] || {}, result = resultMap[String(target.Target_ID || '')] || {};
      const actual = String(target.Measurement_Type || '').toUpperCase() === 'PERCENTAGE' ? result.Completion_Percent : result.Actual_Quantity;
      return {
        DPR_ID: target.DPR_ID || '', Target_ID: target.Target_ID || '', Work_Date: dateKey(target.Work_Date), Project_ID: target.Project_ID || '',
        Project_Number: project.Project_Number || daily.Project_Number || '', Client: project.Client || daily.Client || '', Project_Manager: project.PM_Name || '',
        PM_Email: normaliseEmail(project.PM_Email || daily.PM_Email), Site_Engineer: project.Site_Engineer_Name || daily.Site_Engineer_Name || '',
        Site_Engineer_Email: normaliseEmail(String(project.Site_Engineer_Email || daily.Site_Engineer_Email || '').split(/[;,]/)[0]),
        Activity_Number: target.Activity_Number || target.Sequence || '', Activity: target.Activity_Name || '', Location: target.Location_Room || '', Measurement_Unit: target.Unit || '',
        Planned_Target: Number(target.Planned_Target || 0), Actual_Achieved: n(actual), Raw_Target_Achievement_Percent: n(result.Achievement_Percent),
        Planned_Hours: Number(target.Planned_Hours || result.Planned_Hours || 0), Effective_Hours: n(result.Effective_Hours), Planned_Hours_Used_Percent: n(result.Hour_Use_Percent),
        Time_Adjusted_Target: n(result.Time_Adjusted_Target), Time_Adjusted_Achievement_Percent: n(result.Time_Adjusted_Achievement_Percent),
        Reduced_Hours_Reason: result.Reduced_Hours_Reason || '', Planned_Masons: Number(daily.Planned_Masons || 0), Planned_Labourers: Number(daily.Planned_Labourers || 0),
        Actual_Masons: n(daily.Morning_Masons), Actual_Labourers: n(daily.Morning_Labourers), DPR_Status: daily.Report_Status || 'PLANNED',
        DPR_Submission_Version: Number(daily.EOD_Submission_Version || 0), Quality_Signed_By: daily.Quality_Assurance_Signed_By || '',
        Quality_Signed_At: daily.Quality_Assurance_Signed_At || '', Output_Description: result.Output_Description || '', Shortfall_Reason: result.Shortfall_Reason || '',
      };
    });
  const grouped: Record<string, any> = {};
  rows.forEach((row) => {
    const key = String(row.Project_ID || '');
    if (!grouped[key]) grouped[key] = {projectId: key, projectNumber: row.Project_Number, client: row.Client, pmName: row.Project_Manager, pmEmail: row.PM_Email,
      dates: {}, first: '', latest: '', activities: 0, planned: 0, effective: 0, rawTotal: 0, rawCount: 0, adjustedTotal: 0, adjustedCount: 0, reduced: 0};
    const item = grouped[key], date = row.Work_Date;
    if (date) { item.dates[date] = true; item.first = !item.first || date < item.first ? date : item.first; item.latest = !item.latest || date > item.latest ? date : item.latest; }
    item.activities++;
    item.planned += Number(row.Planned_Hours || 0);
    if (row.Effective_Hours !== '') item.effective += Number(row.Effective_Hours || 0);
    if (row.Raw_Target_Achievement_Percent !== '') { item.rawTotal += Number(row.Raw_Target_Achievement_Percent || 0); item.rawCount++; }
    if (row.Time_Adjusted_Achievement_Percent !== '') { item.adjustedTotal += Number(row.Time_Adjusted_Achievement_Percent || 0); item.adjustedCount++; }
    if (row.Effective_Hours !== '' && Number(row.Effective_Hours || 0) < Number(row.Planned_Hours || 0)) item.reduced++;
  });
  const summary = Object.keys(grouped).map((key) => {
    const i = grouped[key];
    return {Project_ID: i.projectId, Project_Number: i.projectNumber, Client: i.client, Project_Manager: i.pmName, PM_Email: i.pmEmail, First_Work_Date: i.first,
      Latest_Work_Date: i.latest, DPR_Days: Object.keys(i.dates).length, Activity_Records: i.activities, Total_Planned_Hours: materialRound(i.planned),
      Total_Effective_Hours: materialRound(i.effective), Planned_Hours_Used_Percent: i.planned > 0 ? Math.round(i.effective / i.planned * 10000) / 100 : 0,
      Average_Raw_Target_Achievement_Percent: i.rawCount ? Math.round(i.rawTotal / i.rawCount * 100) / 100 : 0,
      Average_Time_Adjusted_Achievement_Percent: i.adjustedCount ? Math.round(i.adjustedTotal / i.adjustedCount * 100) / 100 : 0, Reduced_Hours_Activities: i.reduced};
  }).sort((a, b) => String(a.Project_Number).localeCompare(String(b.Project_Number), undefined, {numeric: true}));
  return clientSafe({role: user.role, headers: LABOR_RECORD_HEADERS, rows, summary});
}
