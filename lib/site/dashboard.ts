// Role-scoped operational dashboards for PM, GM, Auditor, Admin and Purchase (from the QC
// app's Dashboard.gs). The default period is now the Thursday-to-Wednesday week (decision
// 15 Oct 2026) and replaces the QC app's rolling last-7-days week, so "week" means the
// same Thursday-to-Wednesday week here as in purchasing and payments.
import {Site, Row, SiteError, dateKey, isValidDateKey, addDaysKey, weekStartKey, clientSafe, normaliseEmail, unique, storedDate} from './core';
import {isSelectableProject} from './access';
import {dprIsSubmitted} from './dpr';

const MAX_RANGE_DAYS = 366;
const round = (v: any) => Math.round(Number(v || 0) * 100) / 100;
const percent = (part: any, whole: any) => (Number(whole || 0) > 0 ? round(Number(part || 0) / Number(whole) * 100) : null);
const inRange = (value: any, start: string, end: string) => { const k = dateKey(value); return k >= start && k <= end; };
const passed = (row: Row) => String(row.Overall_Result || '').toUpperCase() === 'COMPLETED - PASSED';
const siteOff = (row: Row) => Boolean(row) && (String(row.Site_Off_Status || '').toUpperCase() === 'YES' || String(row.Plan_Status || '').toUpperCase() === 'SITE OFF' || String(row.Report_Status || '').toUpperCase() === 'SITE OFF');
const notStarted = (row: Row) => Boolean(row) && (String(row.Not_Started_Status || '').toUpperCase() === 'YES' || String(row.Plan_Status || '').toUpperCase() === 'NOT STARTED' || String(row.Report_Status || '').toUpperCase() === 'NOT STARTED');
const exempt = (row: Row) => siteOff(row) || notStarted(row);
const materialKey = (row: Row) => [String(row.Material_Code || ''), String(row.Material_Name || ''), String(row.Variant || ''), String(row.Unit || row.Stock_Unit || '')].join('|');

function healthScore(pillars: Record<string, any>) {
  const weights: Record<string, number> = {quality: 35, delivery: 30, reporting: 20, material: 15};
  let weighted = 0, used = 0, available = 0;
  Object.keys(weights).forEach((k) => {
    const v = pillars[k];
    if (v === null || v === undefined || !isFinite(Number(v))) return;
    weighted += Math.max(0, Math.min(100, Number(v))) * weights[k]; used += weights[k]; available++;
  });
  return {score: used ? round(weighted / used) : null, availablePillars: available, possiblePillars: 4};
}
function workingDays(start: string, end: string) {
  let count = 0;
  for (let k = start; k <= end; k = addDaysKey(k, 1)) if (new Date(k + 'T00:00:00Z').getUTCDay() !== 0) count++;
  return count;
}

export const DASHBOARD_PRESETS = [
  {id: 'DAY', label: 'Day'}, {id: 'WEEK', label: 'This week (Thu–Wed)'},
  {id: 'MONTH', label: 'Last 30 days'}, {id: 'QUARTER', label: 'Last 90 days'},
];

export function dashboardRange(today: string, filters: any) {
  const f = filters || {};
  const asked = String(f.preset || 'WEEK').toUpperCase();
  const preset = DASHBOARD_PRESETS.some((p) => p.id === asked) ? asked : 'WEEK';
  const key = (v: any) => { const k = dateKey(v); if (!isValidDateKey(k)) throw new SiteError('Select a valid dashboard date.'); return k; };
  let end = f.endDate ? key(f.endDate) : today;
  let start: string;
  if (f.startDate) start = key(f.startDate);
  else if (preset === 'DAY') start = end;
  else if (preset === 'MONTH') start = addDaysKey(end, -29);
  else if (preset === 'QUARTER') start = addDaysKey(end, -89);
  else start = weekStartKey(end); // WEEK: the Thursday-to-Wednesday week holding the end date
  if (end > today) end = today;
  if (start > end) throw new SiteError('Dashboard start date cannot be after the end date.');
  const span = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
  if (span > MAX_RANGE_DAYS) throw new SiteError('Dashboard date range cannot exceed 366 days.');
  return {start, end, preset, days: span, label: (DASHBOARD_PRESETS.find((p) => p.id === preset) || {label: preset}).label};
}

export async function getOperationsDashboard(s: Site, filters: any) {
  const user = s.requireRole(['PM', 'GM', 'AUDITOR', 'ADMIN', 'PURCHASE']);
  const today = s.todayKey();
  const range = dashboardRange(today, filters);
  const requestedPm = normaliseEmail((filters || {}).pmEmail);
  const allProjects = (await s.read('Projects')).filter(isSelectableProject);
  const projects = user.role === 'PM' ? allProjects.filter((p) => normaliseEmail(p.PM_Email) === user.email)
    : requestedPm ? allProjects.filter((p) => normaliseEmail(p.PM_Email) === requestedPm) : allProjects.slice();
  const projectMap: Record<string, Row> = {};
  projects.forEach((p) => { projectMap[String(p.Project_ID)] = p; });
  const rows = (table: string, field: string, start: string, end: string) => s.filter(table, (r) => inRange(r[field], start, end));
  const rawDaily = (await rows('DPR_Daily', 'Work_Date', range.start, range.end)).filter((r) => Boolean(projectMap[String(r.Project_ID)]));
  const byProjectDate: Record<string, Row> = {};
  rawDaily.forEach((row) => {
    const key = String(row.Project_ID || '') + '|' + dateKey(row.Work_Date), prev = byProjectDate[key];
    if (!prev || (dprIsSubmitted(row) && !dprIsSubmitted(prev)) || (dprIsSubmitted(row) === dprIsSubmitted(prev) &&
      new Date(row.Updated_At || row.Evening_Updated_At || row.Created_At || 0) > new Date(prev.Updated_At || prev.Evening_Updated_At || prev.Created_At || 0))) byProjectDate[key] = row;
  });
  const allDaily = Object.keys(byProjectDate).map((k) => byProjectDate[k]);
  const dailyRows = allDaily.filter(dprIsSubmitted);
  const dailyMap: Record<string, Row> = {};
  dailyRows.forEach((r) => { dailyMap[String(r.DPR_ID)] = r; });
  const resultRows = (await rows('DPR_Results', 'Work_Date', range.start, range.end)).filter((r) => Boolean(dailyMap[String(r.DPR_ID)]));
  const targetRows = (await rows('DPR_Targets', 'Work_Date', range.start, range.end)).filter((r) => Boolean(dailyMap[String(r.DPR_ID)]) && String(r.Status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  const lifetime: Record<string, Row> = {};
  (await s.read('DPR_Labor_Summary')).forEach((r) => { if (projectMap[String(r.Project_ID || '')]) lifetime[String(r.Project_ID || '')] = r; });
  const materialRows = (await rows('DPR_Materials', 'Work_Date', range.start, range.end)).filter((r) => Boolean(projectMap[String(r.Project_ID)]));
  const wasteRows = (await rows('Material_Wastage_Daily', 'Waste_Date', range.start, range.end)).filter((r) => Boolean(projectMap[String(r.Project_ID)]) && String(r.Status || 'COMMITTED').toUpperCase() === 'COMMITTED');
  const grnRows = (await rows('GRN_Register', 'Received_Date', range.start, range.end)).filter((r) => Boolean(projectMap[String(r.Project_ID)]) && String(r.Status || '').toUpperCase() === 'COMMITTED');
  const arrivalRows = (await rows('Material_Incoming', 'Received_Date', range.start, range.end)).filter((r) => Boolean(projectMap[String(r.Project_ID)]));
  const balanceRows = await s.filter('Material_Balances', (r) => Boolean(projectMap[String(r.Project_ID)]));
  const lowStockRows = balanceRows.filter((r) => Number(r.Low_Stock_Threshold || 0) > 0 && Number(r.Balance_Quantity || 0) <= Number(r.Low_Stock_Threshold || 0));

  const summaries: Record<string, any> = {};
  projects.forEach((p) => {
    summaries[String(p.Project_ID)] = {projectId: String(p.Project_ID), projectNumber: String(p.Project_Number || ''), client: String(p.Client || ''), projectName: String(p.Project_Name || ''),
      pmName: String(p.PM_Name || ''), pmEmail: normaliseEmail(p.PM_Email), submittedDprs: 0, efficiencyTotal: 0, efficiencyCount: 0, efficiencyPercent: 0, efficiencyLastWeek: 0,
      efficiencyLastMonth: 0, grnCount: 0, materialGroups: {}, wastagePercent: 0, highWastage: false, lowStockCount: 0, plannedHours: 0, effectiveHours: 0, hourUsePercent: 0,
      timeAdjustedEfficiencyTotal: 0, timeAdjustedEfficiencyCount: 0, timeAdjustedEfficiencyPercent: 0, cumulativePlannedHours: 0, cumulativeEffectiveHours: 0, cumulativeHourUsePercent: 0};
  });
  dailyRows.forEach((r) => { summaries[String(r.Project_ID)].submittedDprs++; });
  resultRows.forEach((r) => {
    const d = dailyMap[String(r.DPR_ID)], sm = d && summaries[String(d.Project_ID)];
    if (!sm || r.Achievement_Percent === '' || r.Achievement_Percent === null) return;
    sm.efficiencyTotal += Number(r.Achievement_Percent || 0); sm.efficiencyCount++;
    if (Number(r.Planned_Hours || 0) > 0) {
      sm.plannedHours += Number(r.Planned_Hours || 0); sm.effectiveHours += Number(r.Effective_Hours || 0);
      if (r.Time_Adjusted_Achievement_Percent !== '' && r.Time_Adjusted_Achievement_Percent !== null) { sm.timeAdjustedEfficiencyTotal += Number(r.Time_Adjusted_Achievement_Percent || 0); sm.timeAdjustedEfficiencyCount++; }
    }
  });
  // "This week" means the Thursday-to-Wednesday week to date; "month" the last 30 days.
  const thisWeekStart = weekStartKey(today);
  const comparison: Record<string, any> = {};
  (await rows('DPR_Results', 'Work_Date', addDaysKey(today, -29), today)).filter((r) => Boolean(projectMap[String(r.Project_ID)])).forEach((r) => {
    const id = String(r.Project_ID), d = dateKey(r.Work_Date);
    const item = comparison[id] ||= {weekTotal: 0, weekCount: 0, monthTotal: 0, monthCount: 0};
    const v = Number(r.Achievement_Percent || 0);
    item.monthTotal += v; item.monthCount++;
    if (d >= thisWeekStart) { item.weekTotal += v; item.weekCount++; }
  });
  grnRows.forEach((r) => { summaries[String(r.Project_ID)].grnCount++; });
  lowStockRows.forEach((r) => { summaries[String(r.Project_ID)].lowStockCount++; });
  materialRows.forEach((r) => {
    const sm = summaries[String(r.Project_ID)], k = materialKey(r);
    if (!sm.materialGroups[k]) sm.materialGroups[k] = {materialCode: String(r.Material_Code || ''), materialName: String(r.Material_Name || ''), variant: String(r.Variant || ''), unit: String(r.Unit || ''), used: 0, wasted: 0, wastagePercent: 0};
    sm.materialGroups[k].used += Number(r.Used_Quantity || 0);
  });
  wasteRows.forEach((r) => {
    const sm = summaries[String(r.Project_ID)], k = materialKey(r);
    if (!sm.materialGroups[k]) sm.materialGroups[k] = {materialCode: String(r.Material_Code || ''), materialName: String(r.Material_Name || ''), variant: String(r.Variant || ''), unit: String(r.Stock_Unit || ''), used: 0, wasted: 0, wastagePercent: 0};
    sm.materialGroups[k].wasted += Number(r.Waste_Quantity || 0);
  });
  Object.keys(summaries).forEach((id) => {
    const sm = summaries[id], c = comparison[id] || {};
    sm.efficiencyPercent = sm.efficiencyCount ? round(sm.efficiencyTotal / sm.efficiencyCount) : null;
    sm.efficiencyLastWeek = c.weekCount ? round(c.weekTotal / c.weekCount) : 0;
    sm.efficiencyLastMonth = c.monthCount ? round(c.monthTotal / c.monthCount) : 0;
    const groups = Object.keys(sm.materialGroups).map((k) => {
      const g = sm.materialGroups[k], handled = g.used + g.wasted;
      g.used = round(g.used); g.wasted = round(g.wasted); g.wastagePercent = handled > 0 ? round(g.wasted / handled * 100) : 0;
      return g;
    }).filter((g) => g.used > 0 || g.wasted > 0);
    sm.materials = groups.sort((a: any, b: any) => b.wastagePercent - a.wastagePercent || a.materialName.localeCompare(b.materialName));
    sm.wastagePercent = groups.length ? round(groups.reduce((sum: number, g: any) => sum + g.wastagePercent, 0) / groups.length) : 0;
    sm.highWastage = sm.wastagePercent > 5;
    sm.plannedHours = round(sm.plannedHours); sm.effectiveHours = round(sm.effectiveHours);
    sm.hourUsePercent = sm.plannedHours > 0 ? round(sm.effectiveHours / sm.plannedHours * 100) : 0;
    sm.timeAdjustedEfficiencyPercent = sm.timeAdjustedEfficiencyCount ? round(sm.timeAdjustedEfficiencyTotal / sm.timeAdjustedEfficiencyCount) : 0;
    const life = lifetime[id] || {};
    sm.cumulativePlannedHours = Number(life.Total_Planned_Hours || 0); sm.cumulativeEffectiveHours = Number(life.Total_Effective_Hours || 0); sm.cumulativeHourUsePercent = Number(life.Planned_Hours_Used_Percent || 0);
    delete sm.materialGroups; delete sm.efficiencyTotal; delete sm.efficiencyCount; delete sm.timeAdjustedEfficiencyTotal; delete sm.timeAdjustedEfficiencyCount;
  });

  const management = user.role !== 'PURCHASE';
  const checklistRows = management ? await s.filter('Project_Checklist_Header', (r) => Boolean(projectMap[String(r.Project_ID)]) && String(r.Status || '').toUpperCase() !== 'DELETED') : [];
  const attempts = management ? await s.filter('Inspection_Header', (r) => Boolean(projectMap[String(r.Project_ID)]) && String(r.Void_Status || 'Active').toUpperCase() !== 'VOID' && inRange(r.Submitted_At, range.start, range.end)) : [];
  const latestMap: Record<string, Row> = {};
  attempts.forEach((r) => {
    const base = String(r.Base_Inspection_ID || r.Inspection_Version_ID || ''), prev = latestMap[base];
    if (!prev || Number(r.Version_Number || 1) > Number(prev.Version_Number || 1) || (Number(r.Version_Number || 1) === Number(prev.Version_Number || 1) && new Date(r.Submitted_At) > new Date(prev.Submitted_At))) latestMap[base] = r;
  });
  const latest = Object.keys(latestMap).map((k) => latestMap[k]);
  const activeBookings = management ? await s.filter('QC_Booking_Header', (r) => Boolean(projectMap[String(r.Project_ID)]) && ['COMPLETED', 'CANCELLED', 'REJECTED'].indexOf(String(r.Status || '').toUpperCase()) < 0) : [];
  const projectChecklistCounts: Record<string, any> = {}, pmCards: Record<string, any> = {}, qcCards: Record<string, any> = {};
  const emptyPm = (name: string, email: string) => ({name, email, projectCount: 0, plannedProjects: 0, completedProjects: 0, pmStatusRecordedDays: 0, plannedSiteDays: 0, siteOffDays: 0, notStartedDays: 0,
    completedDprDays: 0, checklistsPrepared: 0, checklistsPublished: 0, inspections: 0, passed: 0, failed: 0, submittedDprs: 0, expectedDprs: 0, efficiencyTotal: 0, efficiencyCount: 0, healthScore: null as any});
  const pmBucket = (p: Row) => { const e = normaliseEmail(p.PM_Email), k = e || String(p.PM_Name || 'Unassigned'); return pmCards[k] ||= emptyPm(String(p.PM_Name || e || 'Unassigned'), e); };
  const pmEmailBucket = (email: any, fallback: Row) => {
    const n = normaliseEmail(email), m = allProjects.find((p) => normaliseEmail(p.PM_Email) === n);
    if (m) return pmBucket(m);
    if (!n) return pmBucket(fallback || {});
    return pmCards[n] ||= emptyPm(n, n);
  };
  projects.forEach((p) => { pmBucket(p).projectCount++; });
  checklistRows.forEach((r) => {
    const id = String(r.Project_ID), counts = projectChecklistCounts[id] ||= {prepared: 0, published: 0}, p = projectMap[id] || {};
    if (inRange(r.Prepared_At, range.start, range.end)) { counts.prepared++; pmEmailBucket(r.Prepared_By_PM, p).checklistsPrepared++; }
    if (inRange(r.Published_At, range.start, range.end)) { counts.published++; pmEmailBucket(r.Published_By || r.Prepared_By_PM, p).checklistsPublished++; }
  });
  const qcBucket = (email: any, name: any) => {
    const n = normaliseEmail(email), k = n || String(name || 'Unassigned');
    return qcCards[k] ||= {name: String(name || n || 'Unassigned'), email: n, inspectionAttempts: 0, completedChecks: 0, passed: 0, failed: 0, passRate: null, majorDefects: 0, minorDefects: 0, reinspections: 0, activeBookings: 0};
  };
  attempts.forEach((r) => { const q = qcBucket(r.QC_Email, r.QC_Name); q.inspectionAttempts++; if (Number(r.Version_Number || 1) > 1) q.reinspections++; });
  latest.forEach((r) => {
    const id = String(r.Project_ID), sm = summaries[id];
    if (!sm) return;
    sm.qualityChecks = Number(sm.qualityChecks || 0) + 1;
    sm.qualityPassed = Number(sm.qualityPassed || 0) + (passed(r) ? 1 : 0);
    sm.qualityFailed = Number(sm.qualityFailed || 0) + (passed(r) ? 0 : 1);
    sm.majorDefects = Number(sm.majorDefects || 0) + Number(r.Major_Defect_Count || 0);
    sm.minorDefects = Number(sm.minorDefects || 0) + Number(r.Minor_Defect_Count || 0);
    const q = qcBucket(r.QC_Email, r.QC_Name);
    q.completedChecks++; if (passed(r)) q.passed++; else q.failed++;
    q.majorDefects += Number(r.Major_Defect_Count || 0); q.minorDefects += Number(r.Minor_Defect_Count || 0);
    const pm = pmBucket(projectMap[id] || {}); pm.inspections++; if (passed(r)) pm.passed++; else pm.failed++;
  });
  activeBookings.forEach((r) => { qcBucket(r.QC_Email, '').activeBookings++; });
  const dailyByProject: Record<string, Row[]> = {};
  allDaily.forEach((r) => { (dailyByProject[String(r.Project_ID)] ||= []).push(r); });
  Object.keys(summaries).forEach((id) => {
    const sm = summaries[id], cl = projectChecklistCounts[id] || {}, d = dailyByProject[id] || [];
    sm.checklistsPrepared = Number(cl.prepared || 0); sm.checklistsPublished = Number(cl.published || 0);
    ['qualityChecks', 'qualityPassed', 'qualityFailed', 'majorDefects', 'minorDefects'].forEach((k) => { sm[k] = Number(sm[k] || 0); });
    sm.qualityPassRate = percent(sm.qualityPassed, sm.qualityChecks);
    sm.siteOffDays = d.filter(siteOff).length; sm.notStartedDays = d.filter(notStarted).length; sm.pmStatusRecordedDays = d.length;
    sm.expectedDprs = d.filter((r) => !exempt(r)).length; sm.plannedSiteDays = sm.expectedDprs; sm.completedDprDays = sm.submittedDprs;
    sm.plannedByPm = sm.plannedSiteDays > 0; sm.completedBySiteEngineer = sm.plannedSiteDays > 0 && sm.completedDprDays >= sm.plannedSiteDays;
    sm.planCompletionPercent = percent(sm.completedDprDays, sm.plannedSiteDays);
    sm.dprCoverage = sm.expectedDprs ? Math.min(100, percent(sm.submittedDprs, sm.expectedDprs) as number) : null;
    const controlled = (sm.materials || []).filter((i: any) => i.used > 0 || i.wasted > 0);
    sm.materialControlScore = controlled.length ? percent(controlled.filter((i: any) => i.wastagePercent <= 5).length, controlled.length) : null;
    const h = healthScore({quality: sm.qualityPassRate, delivery: sm.efficiencyPercent, reporting: sm.dprCoverage, material: sm.materialControlScore});
    sm.operationsHealth = h.score; sm.healthCoverage = h.availablePillars + '/' + h.possiblePillars;
    const pm = pmBucket(projectMap[id] || {});
    pm.submittedDprs += sm.submittedDprs; pm.expectedDprs += sm.expectedDprs; pm.plannedSiteDays += sm.plannedSiteDays; pm.pmStatusRecordedDays += sm.pmStatusRecordedDays;
    pm.siteOffDays += sm.siteOffDays; pm.notStartedDays += sm.notStartedDays; pm.completedDprDays += sm.completedDprDays;
    if (sm.plannedByPm) pm.plannedProjects++;
    if (sm.completedBySiteEngineer) pm.completedProjects++;
    if (sm.efficiencyPercent !== null && sm.efficiencyPercent !== undefined) { pm.efficiencyTotal += sm.efficiencyPercent; pm.efficiencyCount++; }
  });
  Object.keys(qcCards).forEach((k) => { qcCards[k].passRate = percent(qcCards[k].passed, qcCards[k].completedChecks); });
  Object.keys(pmCards).forEach((k) => {
    const i = pmCards[k];
    i.qualityPassRate = percent(i.passed, i.inspections);
    i.dprCoverage = i.expectedDprs ? Math.min(100, percent(i.submittedDprs, i.expectedDprs) as number) : null;
    i.deliveryEfficiency = i.efficiencyCount ? round(i.efficiencyTotal / i.efficiencyCount) : null;
    i.healthScore = healthScore({quality: i.qualityPassRate, delivery: i.deliveryEfficiency, reporting: i.dprCoverage, material: null}).score;
    delete i.efficiencyTotal; delete i.efficiencyCount;
  });
  const qualityTrendMap: Record<string, any> = {};
  latest.forEach((r) => { const k = dateKey(r.Submitted_At), i = qualityTrendMap[k] ||= {date: k, passed: 0, failed: 0}; if (passed(r)) i.passed++; else i.failed++; });
  const exceptions: any[] = [];
  Object.keys(summaries).forEach((id) => {
    const sm = summaries[id];
    if (sm.qualityFailed) exceptions.push({severity: 'CRITICAL', type: 'QUALITY', projectNumber: sm.projectNumber, owner: sm.pmName, message: sm.qualityFailed + ' latest quality check(s) failed'});
    if (sm.dprCoverage !== null && sm.dprCoverage < 80) exceptions.push({severity: 'HIGH', type: 'DPR', projectNumber: sm.projectNumber, owner: sm.pmName, message: (sm.expectedDprs - sm.submittedDprs) + ' expected DPR(s) missing'});
    if (sm.highWastage) exceptions.push({severity: 'HIGH', type: 'MATERIAL', projectNumber: sm.projectNumber, owner: sm.pmName, message: 'Material-group wastage average is ' + sm.wastagePercent + '%'});
    if (sm.efficiencyPercent > 0 && sm.efficiencyPercent < 80) exceptions.push({severity: 'MEDIUM', type: 'DELIVERY', projectNumber: sm.projectNumber, owner: sm.pmName, message: 'Delivery achievement is ' + sm.efficiencyPercent + '%'});
  });
  const rank: Record<string, number> = {CRITICAL: 0, HIGH: 1, MEDIUM: 2};
  exceptions.sort((a, b) => rank[a.severity] - rank[b.severity] || a.projectNumber.localeCompare(b.projectNumber, undefined, {numeric: true}));
  const qualityPassedCount = latest.filter(passed).length;
  const totalExpected = allDaily.filter((r) => !exempt(r)).length;
  const groupsAll = Object.keys(summaries).reduce((items: any[], k) => items.concat(summaries[k].materials || []), []);
  const companyPillars = {
    quality: percent(qualityPassedCount, latest.length),
    delivery: resultRows.length ? round(resultRows.reduce((sum, r) => sum + Number(r.Achievement_Percent || 0), 0) / resultRows.length) : null,
    reporting: totalExpected ? Math.min(100, percent(dailyRows.length, totalExpected) as number) : null,
    material: groupsAll.length ? percent(groupsAll.filter((i) => i.wastagePercent <= 5).length, groupsAll.length) : null,
  };
  const companyHealth = healthScore(companyPillars);
  const trendMap: Record<string, any> = {};
  resultRows.forEach((r) => {
    const d = dailyMap[String(r.DPR_ID)];
    if (!d || r.Achievement_Percent === '') return;
    const k = dateKey(d.Work_Date), i = trendMap[k] ||= {date: k, total: 0, count: 0};
    i.total += Number(r.Achievement_Percent || 0); i.count++;
  });
  const yesterday = addDaysKey(today, -1);
  const yesterdayIn = yesterday >= range.start && yesterday <= range.end;
  const yDaily = (yesterdayIn ? dailyRows : (await rows('DPR_Daily', 'Work_Date', yesterday, yesterday)).filter((r) => Boolean(projectMap[String(r.Project_ID)]) && dprIsSubmitted(r))).filter((r) => dateKey(r.Work_Date) === yesterday);
  const yIds: Record<string, boolean> = {};
  yDaily.forEach((r) => { yIds[String(r.DPR_ID)] = true; });
  const yResults = (yesterdayIn ? resultRows : await rows('DPR_Results', 'Work_Date', yesterday, yesterday)).filter((r) => Boolean(yIds[String(r.DPR_ID)]));
  const yTargets = (yesterdayIn ? targetRows : await rows('DPR_Targets', 'Work_Date', yesterday, yesterday)).filter((r) => dateKey(r.Work_Date) === yesterday);
  const yTargetMap: Record<string, Row> = {};
  yTargets.forEach((r) => { yTargetMap[String(r.Target_ID)] = r; });
  const yMaterials = (yesterdayIn ? materialRows : await rows('DPR_Materials', 'Work_Date', yesterday, yesterday)).filter((r) => Boolean(yIds[String(r.DPR_ID)]));
  const yWaste = (yesterdayIn ? wasteRows : await rows('Material_Wastage_Daily', 'Waste_Date', yesterday, yesterday)).filter((r) => Boolean(projectMap[String(r.Project_ID)]) && dateKey(r.Waste_Date) === yesterday);
  const workReports = yDaily.map((row) => {
    const p = projectMap[String(row.Project_ID)] || {};
    const results = yResults.filter((r) => String(r.DPR_ID) === String(row.DPR_ID));
    return {
      dprId: String(row.DPR_ID), projectId: String(row.Project_ID), projectNumber: String(p.Project_Number || row.Project_Number || ''), client: String(p.Client || row.Client || ''),
      pmName: String(p.PM_Name || ''), reportStatus: String(row.Report_Status || ''),
      efficiencyPercent: results.length ? round(results.reduce((sum, r) => sum + Number(r.Achievement_Percent || 0), 0) / results.length) : 0,
      masons: Number(row.Morning_Masons || 0), labourers: Number(row.Morning_Labourers || 0), eveningRemarks: String(row.Evening_Remarks || ''),
      qualitySigned: String(row.Quality_Assurance_Accepted || '').toUpperCase() === 'YES', qualitySignedName: String(row.Quality_Assurance_Signed_Name || ''),
      qualitySignedBy: String(row.Quality_Assurance_Signed_By || ''), qualitySignedAt: row.Quality_Assurance_Signed_At || '',
      plannedHours: round(results.reduce((sum, r) => sum + Number(r.Planned_Hours || 0), 0)), effectiveHours: round(results.reduce((sum, r) => sum + Number(r.Effective_Hours || 0), 0)),
      activities: results.map((r) => { const t = yTargetMap[String(r.Target_ID)] || {}; return {activity: String(t.Activity_Name || ''), achievementPercent: Number(r.Achievement_Percent || 0),
        output: String(r.Output_Description || ''), shortfallReason: String(r.Shortfall_Reason || ''), plannedHours: Number(r.Planned_Hours || t.Planned_Hours || 0), effectiveHours: Number(r.Effective_Hours || 0),
        hourUsePercent: Number(r.Hour_Use_Percent || 0), timeAdjustedAchievementPercent: Number(r.Time_Adjusted_Achievement_Percent || 0), reducedHoursReason: String(r.Reduced_Hours_Reason || '')}; }),
      materials: yMaterials.filter((m) => String(m.DPR_ID) === String(row.DPR_ID) && Number(m.Used_Quantity || 0) > 0).map((m) => ({name: String(m.Material_Name || ''), variant: String(m.Variant || ''), quantity: Number(m.Used_Quantity || 0), unit: String(m.Unit || '')})),
      wastage: yWaste.filter((w) => String(w.Project_ID) === String(row.Project_ID) && String(w.Status || 'COMMITTED').toUpperCase() === 'COMMITTED').map((w) => ({name: String(w.Material_Name || ''), variant: String(w.Variant || ''), quantity: Number(w.Waste_Quantity || 0), unit: String(w.Stock_Unit || ''), reason: String(w.Reason || '')})),
    };
  });
  const companyWaste: Record<string, any> = {};
  wasteRows.forEach((r) => { const k = materialKey(r); (companyWaste[k] ||= {materialName: String(r.Material_Name || ''), variant: String(r.Variant || ''), unit: String(r.Stock_Unit || ''), quantity: 0}).quantity += Number(r.Waste_Quantity || 0); });
  const usage: Record<string, any> = {};
  materialRows.forEach((r) => {
    if (Number(r.Used_Quantity || 0) <= 0) return;
    const k = [dateKey(r.Work_Date), r.Project_ID, r.Material_Name, r.Variant, r.Unit].join('|');
    (usage[k] ||= {date: dateKey(r.Work_Date), projectNumber: String((projectMap[String(r.Project_ID)] || {}).Project_Number || ''), materialName: String(r.Material_Name || ''), variant: String(r.Variant || ''), unit: String(r.Unit || ''), quantity: 0}).quantity += Number(r.Used_Quantity || 0);
  });
  const stockRow = (r: Row) => { const p = projectMap[String(r.Project_ID)] || {}; return {projectNumber: String(p.Project_Number || r.Project_Number || ''), client: String(p.Client || r.Client || ''), milestone: String(p.Milestone || ''),
    materialName: String(r.Material_Name || ''), variant: String(r.Variant || ''), balanceQuantity: Number(r.Balance_Quantity || 0), threshold: Number(r.Low_Stock_Threshold || 0), unit: String(r.Stock_Unit || '')}; };
  const sortStock = (a: any, b: any) => a.projectNumber.localeCompare(b.projectNumber, undefined, {numeric: true}) || a.materialName.localeCompare(b.materialName);
  const response: any = clientSafe({
    role: user.role, range, presets: DASHBOARD_PRESETS, selectedPm: requestedPm, generatedAt: storedDate(s.now()), yesterday, weekStart: thisWeekStart,
    projects: Object.keys(summaries).map((k) => summaries[k]).sort((a, b) => a.projectNumber.localeCompare(b.projectNumber, undefined, {numeric: true})),
    efficiencyTrend: Object.keys(trendMap).sort().map((k) => ({date: k, efficiencyPercent: round(trendMap[k].total / trendMap[k].count)})),
    recentGrns: grnRows.sort((a, b) => new Date(b.Received_At || b.Received_Date).getTime() - new Date(a.Received_At || a.Received_Date).getTime()).slice(0, 50).map((r) => ({
      grnNo: String(r.GRN_No || ''), receivedDate: dateKey(r.Received_Date), projectNumber: String(r.Project_Number || ''), client: String(r.Client || ''), supplier: String(r.Supplier || ''),
      lineCount: Number(r.Line_Count || 0), signedBy: String(r.Signed_By || ''), notificationStatus: String(r.Purchase_Notification_Status || ''), poNo: String(r.PO_No || ''), poLinkStatus: String(r.PO_Link_Status || ''),
      items: arrivalRows.filter((i) => String(i.GRN_No || '') === String(r.GRN_No || '')).map((i) => String(i.Material_Name || '') + (i.Variant ? ' ' + i.Variant : '') + ': ' + round(i.Stock_Quantity) + ' ' + String(i.Stock_Unit || ''))})),
    usageHistory: Object.keys(usage).map((k) => ({...usage[k], quantity: round(usage[k].quantity)})).sort((a, b) => b.date.localeCompare(a.date) || a.projectNumber.localeCompare(b.projectNumber, undefined, {numeric: true})).slice(0, 200),
    wastageTotals: Object.keys(companyWaste).map((k) => ({...companyWaste[k], quantity: round(companyWaste[k].quantity)})).sort((a, b) => b.quantity - a.quantity),
    lowStock: lowStockRows.map(stockRow).sort(sortStock),
    stockBalances: balanceRows.filter((r) => Number(r.Balance_Quantity || 0) !== 0 || Number(r.Low_Stock_Threshold || 0) > 0).slice(0, 1000)
      .map((r) => ({...stockRow(r), status: Number(r.Low_Stock_Threshold || 0) > 0 && Number(r.Balance_Quantity || 0) <= Number(r.Low_Stock_Threshold || 0) ? 'LOW' : 'OK'})).sort(sortStock),
    executive: {
      operationsHealth: companyHealth.score, healthCoverage: companyHealth.availablePillars + '/' + companyHealth.possiblePillars, qualityPassRate: companyPillars.quality,
      qualityChecks: latest.length, qualityPassed: qualityPassedCount, qualityFailed: latest.length - qualityPassedCount,
      majorDefects: latest.reduce((sum, r) => sum + Number(r.Major_Defect_Count || 0), 0), minorDefects: latest.reduce((sum, r) => sum + Number(r.Minor_Defect_Count || 0), 0),
      inspectionAttempts: attempts.length, reinspections: attempts.filter((r) => Number(r.Version_Number || 1) > 1).length, deliveryEfficiency: companyPillars.delivery,
      submittedDprs: dailyRows.length, expectedDprs: totalExpected, dprCoverage: companyPillars.reporting, pmStatusRecordedDays: allDaily.length,
      siteOffDays: allDaily.filter(siteOff).length, notStartedDays: allDaily.filter(notStarted).length,
      siteOffProjects: Object.keys(summaries).filter((k) => summaries[k].siteOffDays > 0).length, notStartedProjects: Object.keys(summaries).filter((k) => summaries[k].notStartedDays > 0).length,
      grnCount: grnRows.length, lowStockItems: lowStockRows.length, materialControlScore: companyPillars.material,
      checklistsPrepared: checklistRows.filter((r) => inRange(r.Prepared_At, range.start, range.end)).length, checklistsPublished: checklistRows.filter((r) => inRange(r.Published_At, range.start, range.end)).length,
      activeSites: projects.length, ongoingProjects: projects.length, plannedProjects: Object.keys(summaries).filter((k) => summaries[k].plannedByPm).length,
      completedProjects: Object.keys(summaries).filter((k) => summaries[k].completedBySiteEngineer).length, plannedSiteDays: totalExpected, completedDprDays: dailyRows.length,
      planCompletionPercent: percent(dailyRows.length, totalExpected), activeQcBookings: activeBookings.length, workingDays: workingDays(range.start, range.end),
    },
    qualityTrend: Object.keys(qualityTrendMap).sort().map((k) => qualityTrendMap[k]),
    pmScorecards: Object.keys(pmCards).map((k) => pmCards[k]).sort((a, b) => (b.healthScore || -1) - (a.healthScore || -1)),
    qcScorecards: Object.keys(qcCards).map((k) => qcCards[k]).sort((a, b) => b.completedChecks - a.completedChecks || a.name.localeCompare(b.name)),
    exceptions: exceptions.slice(0, 20), yesterdayReports: workReports,
    projectManagers: unique(allProjects.map((p) => normaliseEmail(p.PM_Email))).map((email) => ({email, name: String((allProjects.find((p) => normaliseEmail(p.PM_Email) === email) || {}).PM_Name || email)})),
  });
  if (user.role === 'PURCHASE') {
    response.efficiencyTrend = []; response.qualityTrend = []; response.pmScorecards = []; response.qcScorecards = []; response.exceptions = [];
    delete response.executive; response.yesterdayReports = []; response.projectManagers = [];
    response.projects.forEach((p: any) => {
      ['efficiencyPercent', 'efficiencyLastWeek', 'efficiencyLastMonth', 'submittedDprs', 'plannedHours', 'effectiveHours', 'hourUsePercent', 'timeAdjustedEfficiencyPercent',
        'cumulativePlannedHours', 'cumulativeEffectiveHours', 'cumulativeHourUsePercent'].forEach((k) => { delete p[k]; });
    });
  }
  return response;
}
