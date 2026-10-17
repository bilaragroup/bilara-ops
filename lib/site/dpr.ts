// Daily Progress Report: PM daily target, Site Engineer morning manpower and end-of-day
// output with photos, material usage and quality sign-off, and resubmission.
// Converted from the QC app's DPR.gs and DPR_Evidence.gs (photos now go to R2, not Drive).
import {Site, Row, SiteError, dateKey, parseDateKey, isValidDateKey, addDaysKey, clientSafe, normaliseEmail} from './core';
import {ACTIVITY_CATALOGUE} from '@/lib/activities';
import {assertProjectAccess, assertSiteOperationsProjectAccess, assertProjectArchiveAccess, projectSiteOperationsMatches} from './access';
import {dprInteger, dprNumber, dprPercent, dprHours, dprText, dprClientProject, materialRound, shortId} from './util';
import {ensureProjectMaterialBalances, materialRowsForDpr, applyDprMaterialConsumption, MATERIAL_MAJOR_DEFINITIONS, MATERIAL_MISC_UNITS, materialKey, materialDefinition} from './materials';
import {ALLOWED_PHOTO_MIME, decodeDataUrl, storeFiles, folderUrl, safeName, removeFiles, DecodedFile} from './files';

export const DPR_SITE_OFF_CATEGORIES = ['BAD WEATHER', 'MATERIAL SHORTAGE', 'LABOR SHORTAGE', 'CURING PERIOD', 'CLIENT SCOPE WORK', 'MISCELLANEOUS / OTHER'];
const DPR_MASONRY_MATERIALS = ['Red brick', 'Laterite stone', '6-inch cement blocks', '4-inch cement blocks'];
const DPR_DEFAULT_RATES = [
  {Activity_Code: 'MASONRY_WORK', Activity_Name: 'Masonry work', Measurement_Type: 'QUANTITY', Unit: 'blocks', Productivity_Rate_Per_Pair: 250, Mason_Ratio: 1, Labourer_Ratio: 1, Active: 'Yes', Notes: 'Reference only. The Project Manager sets the editable daily masonry target.'},
  {Activity_Code: 'PLASTERING', Activity_Name: 'Plastering', Measurement_Type: 'QUANTITY', Unit: 'sq ft', Productivity_Rate_Per_Pair: 300, Mason_Ratio: 1, Labourer_Ratio: 1, Active: 'Yes', Notes: 'Default target: 300 sq ft per mason-labourer pair per day.'},
];

/** The activity catalogue used by the PM's target picker: the one company list (lib/activities.ts). */
export const DPR_ACTIVITY_CATALOGUE = ACTIVITY_CATALOGUE;

export function dprCatalogueItem(number: any) {
  return DPR_ACTIVITY_CATALOGUE.find((item) => Number(item.number) === Number(number)) || null;
}
const upperFloors = ['SECOND_FLOOR', 'THIRD_FLOOR', 'FOURTH_FLOOR'];
function dprBrickActivity(floor: string, stage: string) {
  const f = upperFloors.indexOf(String(floor || '')) >= 0 ? 'FIRST_FLOOR' : String(floor || '');
  return dprCatalogueItem(({'GROUND_FLOOR|UP_TO_LINTEL': 21, 'GROUND_FLOOR|ABOVE_LINTEL': 27, 'FIRST_FLOOR|UP_TO_LINTEL': 38, 'FIRST_FLOOR|ABOVE_LINTEL': 50} as any)[f + '|' + String(stage || '')]);
}
function dprPlasterActivity(floor: string, area: string) {
  if (String(area || '') === 'PARAPET') return dprCatalogueItem(75);
  const f = upperFloors.indexOf(String(floor || '')) >= 0 ? 'FIRST_FLOOR' : String(floor || '');
  return dprCatalogueItem(({'GROUND_FLOOR|EXTERIOR': 41, 'GROUND_FLOOR|TOILET': 48, 'GROUND_FLOOR|INTERIOR': 52, 'FIRST_FLOOR|EXTERIOR_1': 64, 'FIRST_FLOOR|TOILET': 68, 'FIRST_FLOOR|INTERIOR': 70, 'FIRST_FLOOR|EXTERIOR_2': 75} as any)[f + '|' + String(area || '')]);
}

/** First use: the reference productivity rates. */
async function ensureDprRates(s: Site) {
  if ((await s.property('DPR_RATES_SEEDED')) === 'Yes') return;
  const byCode: Record<string, boolean> = {};
  (await s.read('DPR_Productivity_Rates')).forEach((row) => { byCode[String(row.Activity_Code || '').trim().toUpperCase()] = true; });
  const missing = DPR_DEFAULT_RATES.filter((rate) => !byCode[rate.Activity_Code]);
  if (missing.length) await s.appendMany('DPR_Productivity_Rates', missing);
  s.setProperty('DPR_RATES_SEEDED', 'Yes');
}

// ---------- small rules ----------

export function dprEngineerEntryOpen(workDate: string, today: string) {
  return workDate <= today && today <= addDaysKey(workDate, 1);
}
export function dprIsSubmitted(daily: Row | null) {
  if (!daily) return false;
  const status = String(daily.Report_Status || '').trim().toUpperCase();
  return status === 'SUBMITTED' || status === 'EOD UPDATED' || Boolean(daily.EOD_Submitted_At);
}
export function dprIsSiteOff(daily: Row | null) {
  return Boolean(daily) && (String(daily!.Site_Off_Status || '').toUpperCase() === 'YES' || String(daily!.Plan_Status || '').toUpperCase() === 'SITE OFF' || String(daily!.Report_Status || '').toUpperCase() === 'SITE OFF');
}
export function dprIsNotStarted(daily: Row | null) {
  return Boolean(daily) && (String(daily!.Not_Started_Status || '').toUpperCase() === 'YES' || String(daily!.Plan_Status || '').toUpperCase() === 'NOT STARTED' || String(daily!.Report_Status || '').toUpperCase() === 'NOT STARTED');
}
export function dprIsEntryExempt(daily: Row | null) { return dprIsSiteOff(daily) || dprIsNotStarted(daily); }
function dprHasEngineerProgress(daily: Row | null) {
  return Boolean(daily && (daily.Morning_Updated_At || daily.Evening_Updated_At || daily.EOD_Submitted_At || dprIsSubmitted(daily)));
}
function dprShiftCode(value: any, label: string) {
  const code = String(value || '').trim().toUpperCase().replace(/[^0-9.]/g, '');
  if (['8', '9.5', '10'].indexOf(code) < 0) throw new SiteError(label + ' must be 8 hours, 9.5 hours or 10 hours.');
  return code;
}
const dprVendor = (value: any, label: string) => dprText(value, label, 160, true);
export function dprTimeProgress(actualOutput: any, plannedTarget: any, plannedHours: any, effectiveHours: any) {
  const adjustedTarget = Number(plannedHours || 0) > 0 ? Math.round((Number(plannedTarget || 0) * Number(effectiveHours || 0) / Number(plannedHours)) * 100) / 100 : 0;
  const achievement = adjustedTarget > 0 ? Math.round((Number(actualOutput || 0) / adjustedTarget) * 10000) / 100 : 0;
  const hourUse = Number(plannedHours || 0) > 0 ? Math.round((Number(effectiveHours || 0) / Number(plannedHours)) * 10000) / 100 : 0;
  return {adjustedTarget, achievementPercent: achievement, hourUsePercent: hourUse};
}
const dprCrewPairs = (m: any, l: any) => Math.min(Number(m || 0), Number(l || 0));
function dprQuantitativeProgress(actualQuantity: any, plannedTarget: any) {
  const achievement = Number(plannedTarget || 0) > 0 ? Math.round((Number(actualQuantity || 0) / Number(plannedTarget)) * 10000) / 100 : 0;
  return {completionPercent: Math.min(100, achievement), achievementPercent: achievement};
}

export async function dprProjectDate(s: Site, projectId: any, workDate: any) {
  const key = dateKey(workDate);
  if (!isValidDateKey(key)) throw new SiteError('Select a valid work date.');
  const daily = (await s.filter('DPR_Daily', (row) => String(row.Project_ID || '') === String(projectId || '') && dateKey(row.Work_Date) === key))
    .sort((a, b) => Number(b._row || 0) - Number(a._row || 0))[0] || null;
  return {key, daily};
}

async function refreshDprLaborSummary(s: Site, projectId: any) {
  const project = (await s.find('Projects', 'Project_ID', projectId)) || {} as Row;
  const rows = await s.filter('DPR_Results', (row) => String(row.Project_ID || '') === String(projectId || '') && Number(row.Planned_Hours || 0) > 0);
  let planned = 0, effective = 0, adjustedTotal = 0, adjustedCount = 0, reduced = 0, latest = '';
  rows.forEach((row) => {
    planned += Number(row.Planned_Hours || 0);
    effective += Number(row.Effective_Hours || 0);
    if (row.Time_Adjusted_Achievement_Percent !== '' && row.Time_Adjusted_Achievement_Percent !== null) { adjustedTotal += Number(row.Time_Adjusted_Achievement_Percent || 0); adjustedCount++; }
    if (Number(row.Effective_Hours || 0) < Number(row.Planned_Hours || 0)) reduced++;
    const key = dateKey(row.Work_Date);
    if (key > latest) latest = key;
  });
  const changes = {
    Project_ID: projectId, Project_Number: project.Project_Number || '', Client: project.Client || '', Project_Manager: project.PM_Name || '',
    PM_Email: normaliseEmail(project.PM_Email), Activity_Records: rows.length, Total_Planned_Hours: materialRound(planned), Total_Effective_Hours: materialRound(effective),
    Planned_Hours_Used_Percent: planned > 0 ? Math.round(effective / planned * 10000) / 100 : 0,
    Average_Time_Adjusted_Achievement_Percent: adjustedCount ? Math.round(adjustedTotal / adjustedCount * 100) / 100 : 0,
    Reduced_Hours_Activities: reduced, Latest_Work_Date: latest ? parseDateKey(latest) : '', Updated_At: s.now(),
  };
  if (await s.find('DPR_Labor_Summary', 'Project_ID', projectId)) await s.update('DPR_Labor_Summary', 'Project_ID', projectId, changes);
  else await s.append('DPR_Labor_Summary', changes);
  return changes;
}

// ---------- shapes sent to the page ----------

function dprClientDaily(daily: Row | null) {
  if (!daily) return null;
  const n = (v: any) => (v === '' ? '' : Number(v || 0));
  return {
    dprId: String(daily.DPR_ID || ''), workDate: dateKey(daily.Work_Date),
    plannedMasons: Number(daily.Planned_Masons || 0), plannedLabourers: Number(daily.Planned_Labourers || 0),
    plannedWorkerTotal: Number(daily.Planned_Worker_Total || 0), plannedCrewPairs: Number(daily.Planned_Crew_Pairs || 0),
    plannedShiftCode: String(daily.Planned_Shift_Code || '8'), plannedVendor: String(daily.Planned_Vendor || ''),
    planVersion: Number(daily.Plan_Version || 0), planStatus: String(daily.Plan_Status || ''),
    isSiteOff: dprIsSiteOff(daily), isNotStarted: dprIsNotStarted(daily),
    siteOffCategory: String(daily.Site_Off_Category || ''), siteOffReason: String(daily.Site_Off_Reason || ''),
    siteOffSetAt: daily.Site_Off_Set_At || '', siteOffSetBy: String(daily.Site_Off_Set_By || ''),
    notStartedReason: String(daily.Not_Started_Reason || ''), notStartedSetAt: daily.Not_Started_Set_At || '', notStartedSetBy: String(daily.Not_Started_Set_By || ''),
    morningMasons: n(daily.Morning_Masons), morningLabourers: n(daily.Morning_Labourers), morningWorkerTotal: n(daily.Morning_Worker_Total),
    morningRemarks: String(daily.Morning_Remarks || ''),
    actualShiftCode: String(daily.Actual_Shift_Code || daily.Planned_Shift_Code || '8'), actualVendor: String(daily.Actual_Vendor || daily.Planned_Vendor || ''),
    morningUpdatedAt: daily.Morning_Updated_At || '', eveningRemarks: String(daily.Evening_Remarks || ''), eveningUpdatedAt: daily.Evening_Updated_At || '',
    reportStatus: String(daily.Report_Status || 'PLANNED'),
    dayFolderUrl: String(daily.DPR_Day_Folder_URL || ''), workEvidenceFolderUrl: String(daily.Work_Evidence_Folder_URL || ''),
    materialEvidenceFolderUrl: String(daily.Material_Evidence_Folder_URL || ''),
    workPhotoCount: Number(daily.Work_Photo_Count || 0), materialPhotoCount: Number(daily.Material_Photo_Count || 0),
    evidenceUploadStatus: String(daily.Evidence_Upload_Status || (dprIsSubmitted(daily) ? 'COMPLETE' : '')),
    evidenceExpectedCount: Number(daily.Evidence_Expected_Count || 0), evidenceUploadedCount: Number(daily.Evidence_Uploaded_Count || 0),
    evidenceUploadLastError: String(daily.Evidence_Upload_Last_Error || ''), lastEodRequestId: String(daily.Last_EOD_Request_ID || ''),
    submissionVersion: Number(daily.EOD_Submission_Version || (dprIsSubmitted(daily) ? 1 : 0)),
    submittedAt: daily.EOD_Submitted_At || daily.Evening_Updated_At || '', submittedBy: String(daily.EOD_Submitted_By || daily.Evening_Updated_By || ''),
    isSubmitted: dprIsSubmitted(daily), resubmitStatus: String(daily.Resubmit_Status || 'NONE').toUpperCase(),
    resubmitRequestReason: String(daily.Resubmit_Request_Reason || ''), resubmitRequestedAt: daily.Resubmit_Requested_At || '',
    resubmitRequestedBy: String(daily.Resubmit_Requested_By || ''), resubmitApprovedAt: daily.Resubmit_Approved_At || '', resubmitApprovedBy: String(daily.Resubmit_Approved_By || ''),
    wastageReviewed: String(daily.Wastage_Reviewed || '').toUpperCase() === 'YES', wastageReviewedAt: daily.Wastage_Reviewed_At || '', wastageReviewedBy: String(daily.Wastage_Reviewed_By || ''),
    qualityAssuranceAccepted: String(daily.Quality_Assurance_Accepted || '').toUpperCase() === 'YES', qualityAssuranceDeclaration: String(daily.Quality_Assurance_Declaration || ''),
    qualityAssuranceSignedName: String(daily.Quality_Assurance_Signed_Name || ''), qualityAssuranceSignedBy: String(daily.Quality_Assurance_Signed_By || ''),
    qualityAssuranceSignedAt: daily.Quality_Assurance_Signed_At || '', qualityAssuranceSubmissionVersion: Number(daily.Quality_Assurance_Submission_Version || 0),
  };
}

async function dprDailyWastage(s: Site, projectId: any, workDate: string) {
  return (await s.recentProjectRows('Material_Wastage_Daily', projectId, 500))
    .filter((row) => dateKey(row.Waste_Date) === workDate && String(row.Status || 'COMMITTED').toUpperCase() === 'COMMITTED')
    .map((row) => ({batchId: String(row.Waste_Batch_ID || ''), materialName: String(row.Material_Name || ''), variant: String(row.Variant || ''),
      enteredQuantity: Number(row.Entered_Quantity || 0), enteredUnit: String(row.Entered_Unit || ''), wasteQuantity: Number(row.Waste_Quantity || 0),
      stockUnit: String(row.Stock_Unit || ''), reason: String(row.Reason || ''), remarks: String(row.Remarks || ''), recordedAt: row.Recorded_At || '', recordedBy: String(row.Recorded_By || '')}));
}

async function legacyKeyOf(s: Site, row: Row) {
  let code = String(row.Material_Code || '').trim().toUpperCase(), variant = '';
  if (/^STEEL_\d+MM$/.test(code)) { variant = code.replace(/^STEEL_/, '').replace(/MM$/, ' mm'); code = 'STEEL'; } else if (code === 'SAND') code = 'RIVER_SAND';
  const d = await materialDefinition(s, code);
  return materialKey(code, d ? d.name : row.Material_Name, variant, d ? d.stockUnit : row.Unit);
}

// ---------- the Daily DPR / Daily Targets page ----------

export async function getDprWorkspace(s: Site, projectId: any, workDate: any) {
  const user = s.requireRole(['PM', 'SITE_ENGINEER', 'QC', 'ADMIN', 'GM']);
  await ensureDprRates(s);
  if (user.role === 'QC') await assertSiteOperationsProjectAccess(s, user, projectId);
  const resolved = await dprProjectDate(s, projectId, workDate);
  const today = s.todayKey();
  if (resolved.key < today) { if (user.role !== 'QC') await assertProjectArchiveAccess(s, user, projectId); }
  else if (user.role !== 'QC') await assertSiteOperationsProjectAccess(s, user, projectId);
  const project = await s.find('Projects', 'Project_ID', projectId);
  if (!project) throw new SiteError('Project not found.');
  const daily = resolved.daily;
  const engineerEntryOpen = dprEngineerEntryOpen(resolved.key, today);
  const engineerDeadline = addDaysKey(resolved.key, 1);
  const planLockedByProgress = dprHasEngineerProgress(daily);
  const dprId = daily ? String(daily.DPR_ID || '') : '';
  const targets = dprId ? (await s.filter('DPR_Targets', (row) => String(row.DPR_ID || '') === dprId && String(row.Status || 'ACTIVE').toUpperCase() === 'ACTIVE'))
    .sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0)) : [];
  const targetIds: Record<string, boolean> = {};
  targets.forEach((t) => { targetIds[String(t.Target_ID || '')] = true; });
  const results = dprId ? await s.filter('DPR_Results', (row) => Boolean(targetIds[String(row.Target_ID || '')])) : [];
  const evidenceMap: Record<string, Row> = {};
  if (dprId) (await s.filter('DPR_Activity_Evidence', (row) => String(row.DPR_ID || '') === dprId)).forEach((row) => { evidenceMap[String(row.Target_ID || '')] = row; });
  const materialMap: Record<string, Row> = {};
  if (dprId) for (const row of await s.filter('DPR_Materials', (r) => String(r.DPR_ID || '') === dprId)) materialMap[String(row.Material_Key || '') || await legacyKeyOf(s, row)] = row;
  const materials = (await materialRowsForDpr(s, project)).map((d) => {
    const row = materialMap[d.materialKey] || {};
    const savedUsed = row.Used_Quantity === '' || row.Used_Quantity === undefined ? 0 : Number(row.Used_Quantity || 0);
    return {materialKey: d.materialKey, materialCode: d.code, materialName: d.name, variant: d.variant, sizeMm: d.sizeMm, unit: d.unit,
      usedQuantity: row.Used_Quantity === '' || row.Used_Quantity === undefined ? '' : Number(row.Used_Quantity),
      balanceQuantity: d.balanceQuantity, availableBeforeDay: materialRound(d.balanceQuantity + savedUsed), lowStockThreshold: d.threshold, stockStatus: d.status, remarks: String(row.Remarks || '')};
  });
  const siteEngineerRegistered = (await s.read('Users_Roles')).some((row) => {
    const role = String(row.Role || '').trim().toUpperCase();
    if (String(row.Active || '').trim().toLowerCase() !== 'yes') return false;
    return (role === 'SITE_ENGINEER' || role === 'QC') && projectSiteOperationsMatches(project, {role, email: row.Email, name: '', allowedProjects: ''});
  });
  const siteOperationsActor = user.role === 'SITE_ENGINEER' || user.role === 'QC';
  const rates = (await s.filter('DPR_Productivity_Rates', (row) => String(row.Active || '').trim().toLowerCase() === 'yes')).map((row) => ({
    activityCode: String(row.Activity_Code || ''), activityName: String(row.Activity_Name || ''), measurementType: String(row.Measurement_Type || ''), unit: String(row.Unit || ''),
    productivityRatePerPair: Number(row.Productivity_Rate_Per_Pair || 0), masonRatio: Number(row.Mason_Ratio || 1), labourerRatio: Number(row.Labourer_Ratio || 1)}));
  const n = (v: any) => (v === '' ? '' : Number(v || 0));
  return clientSafe({
    project: dprClientProject(project), workDate: resolved.key, today, engineerEntryDeadline: engineerDeadline, daily: dprClientDaily(daily),
    targets: targets.map((row) => ({
      targetId: String(row.Target_ID || ''), sequence: Number(row.Sequence || 0), activityCode: String(row.Activity_Code || ''), activityNumber: String(row.Activity_Number || ''),
      milestone: String(row.Milestone || ''), activityCategory: String(row.Activity_Category || 'LEGACY'), activityName: String(row.Activity_Name || ''),
      materialType: String(row.Material_Type || ''), floor: String(row.Floor || ''), workArea: String(row.Work_Area || ''), workStage: String(row.Work_Stage || ''),
      plasterType: String(row.Plaster_Type || ''), locationRoom: String(row.Location_Room || ''), measurementType: String(row.Measurement_Type || ''), unit: String(row.Unit || ''),
      productivityRatePerPair: Number(row.Productivity_Rate_Per_Pair || 0), plannedCrewPairs: Number(row.Planned_Crew_Pairs || 0), calculatedTarget: Number(row.Calculated_Target || 0),
      plannedTarget: Number(row.Planned_Target || 0), plannedHours: Number(row.Planned_Hours || 0), plannedActivityMasons: Number(row.Planned_Activity_Masons || 0),
      plannedActivityLabourers: Number(row.Planned_Activity_Labourers || 0), plannedActivityWorkers: Number(row.Planned_Activity_Workers || 0),
      plannedWorkerHours: Number(row.Planned_Worker_Hours || 0), pmRemarks: String(row.PM_Remarks || ''),
      evidenceFolderUrl: String((evidenceMap[String(row.Target_ID || '')] || {}).Folder_URL || ''), evidencePhotoCount: Number((evidenceMap[String(row.Target_ID || '')] || {}).Photo_Count || 0),
    })),
    results: results.map((row) => ({
      targetId: String(row.Target_ID || ''), actualQuantity: n(row.Actual_Quantity), completionPercent: n(row.Completion_Percent), achievementPercent: n(row.Achievement_Percent),
      plannedHours: n(row.Planned_Hours), effectiveHours: n(row.Effective_Hours), hourUsePercent: n(row.Hour_Use_Percent), timeAdjustedTarget: n(row.Time_Adjusted_Target),
      timeAdjustedAchievementPercent: n(row.Time_Adjusted_Achievement_Percent), actualActivityMasons: n(row.Actual_Activity_Masons), actualActivityLabourers: n(row.Actual_Activity_Labourers),
      actualActivityWorkers: n(row.Actual_Activity_Workers), hoursPerWorker: n(row.Hours_Per_Worker), actualWorkerHours: n(row.Actual_Worker_Hours),
      overtimeHoursPerWorker: n(row.Overtime_Hours_Per_Worker), overtimeWorkerHours: n(row.Overtime_Worker_Hours), cappedAchievementPercent: n(row.Capped_Achievement_Percent),
      reducedHoursReason: String(row.Reduced_Hours_Reason || ''), outputDescription: String(row.Output_Description || ''), shortfallReason: String(row.Shortfall_Reason || ''),
    })),
    checkins: await dprCheckins(s, dprId), checkinSlots: DPR_CHECKIN_SLOTS,
    materials, rates, dailyWastage: await dprDailyWastage(s, project.Project_ID, resolved.key),
    wasteMaterials: MATERIAL_MAJOR_DEFINITIONS.filter((item) => !item.ginOnly).map((item) => ({code: item.code, name: item.name, category: item.category, stockUnit: item.stockUnit, inputUnits: item.inputUnits, variants: item.variants || []})),
    wasteMiscUnits: MATERIAL_MISC_UNITS.slice(), activityCatalogue: DPR_ACTIVITY_CATALOGUE.map((i) => ({...i})), siteOffCategories: DPR_SITE_OFF_CATEGORIES,
    masonryMaterials: DPR_MASONRY_MATERIALS, siteEngineerRegistered,
    permissions: {
      canEditPlan: user.role === 'PM' && resolved.key >= today && !planLockedByProgress,
      canEditMorning: siteOperationsActor && engineerEntryOpen && Boolean(daily) && !dprIsEntryExempt(daily) && !dprIsSubmitted(daily),
      canEditEvening: siteOperationsActor && engineerEntryOpen && Boolean(daily) && !dprIsEntryExempt(daily) && (!dprIsSubmitted(daily) || String(daily!.Resubmit_Status || '').toUpperCase() === 'APPROVED'),
      canRequestResubmit: siteOperationsActor && engineerEntryOpen && dprIsSubmitted(daily) && ['REQUESTED', 'APPROVED'].indexOf(String(daily!.Resubmit_Status || '').toUpperCase()) < 0,
      canApproveResubmit: user.role === 'PM' && engineerEntryOpen && dprIsSubmitted(daily) && String(daily!.Resubmit_Status || '').toUpperCase() === 'REQUESTED',
      canViewPast: user.role === 'PM' || user.role === 'ADMIN' || user.role === 'GM', role: user.role,
      lockReason: user.role === 'PM' && resolved.key < today ? 'PM target entry closed at the end of the work date.'
        : (user.role === 'PM' && planLockedByProgress ? 'The target is locked because the Site Engineer has started this DPR.'
          : (siteOperationsActor && resolved.key > today ? 'DPR entry opens on the work date.'
            : (siteOperationsActor && today > engineerDeadline ? 'Site operations entry closed at the end of ' + engineerDeadline + ' (work date + 1 day).'
              : (['ADMIN', 'GM'].indexOf(user.role) >= 0 ? user.role + ' access is view-only for DPR records.' : '')))),
    },
  });
}

// ---------- PM: daily target ----------

export async function saveDprPlan(s: Site, payload: any) {
  const user = s.requireRole(['PM']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertProjectAccess(s, user, payload.projectId);
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  await ensureProjectMaterialBalances(s, project);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate)) throw new SiteError('Select a valid work date.');
  if (workDate < s.todayKey()) throw new SiteError('Past work dates are locked. Project Managers can create or edit a target through the end of its work date.');
  const siteOff = payload.siteOff === true || String(payload.siteOff || '').toUpperCase() === 'YES';
  const notStarted = payload.notStarted === true || String(payload.notStarted || '').toUpperCase() === 'YES';
  if (siteOff && notStarted) throw new SiteError('Choose only one daily status: Site Off or Not Started.');
  const entryExempt = siteOff || notStarted;
  const siteOffCategory = siteOff ? String(payload.siteOffCategory || '').trim().toUpperCase() : '';
  const siteOffReason = siteOff ? dprText(payload.siteOffReason, 'Site Off reason', 1500, siteOffCategory === 'MISCELLANEOUS / OTHER') : '';
  if (siteOff && DPR_SITE_OFF_CATEGORIES.indexOf(siteOffCategory) < 0) throw new SiteError('Select a valid Site Off category.');
  const notStartedReason = notStarted ? dprText(payload.notStartedReason, 'Not Started reason', 1500, true) : '';
  const siteEngineerEmail = normaliseEmail(String(project.Site_Engineer_Email || '').split(/[;,]/)[0]) || normaliseEmail(String(project.Site_QC_Email || '').split(/[;,]/)[0]);
  if (!entryExempt && !siteEngineerEmail) throw new SiteError('The selected project has no site engineer or site QC in Project configuration. Add one before saving a target.');
  const plannedMasons = entryExempt ? 0 : dprInteger(payload.plannedMasons, 'Planned masons');
  const plannedLabourers = entryExempt ? 0 : dprInteger(payload.plannedLabourers, 'Planned labourers');
  const plannedShiftCode = entryExempt ? '8' : dprShiftCode(payload.plannedShiftCode, 'Planned shift');
  const plannedVendor = entryExempt ? '' : dprVendor(payload.plannedVendor, 'Planned labor vendor');
  const crewPairs = dprCrewPairs(plannedMasons, plannedLabourers);
  const inputTargets = Array.isArray(payload.targets) ? payload.targets : [];
  if (!entryExempt && !inputTargets.length) throw new SiteError('Add at least one planned activity.');
  if (inputTargets.length > 20) throw new SiteError('A daily plan may contain at most 20 activities.');
  const targets = (entryExempt ? [] : inputTargets).map((input: any, index: number) => {
    const category = String(input.activityCategory || 'OTHER').trim().toUpperCase();
    if (['BRICKWORK', 'PLASTERING', 'OTHER', 'LEGACY'].indexOf(category) < 0) throw new SiteError('Activity ' + (index + 1) + ' has an invalid category.');
    const floor = String(input.floor || '').trim().toUpperCase();
    if (category !== 'LEGACY' && ['', 'GROUND_FLOOR', 'FIRST_FLOOR', 'SECOND_FLOOR', 'THIRD_FLOOR', 'FOURTH_FLOOR'].indexOf(floor) < 0) throw new SiteError('Activity ' + (index + 1) + ' has an invalid floor.');
    if ((category === 'BRICKWORK' || category === 'PLASTERING') && !floor) throw new SiteError('Select the floor for activity ' + (index + 1) + '.');
    const materialType = dprText(input.materialType, 'Activity ' + (index + 1) + ' masonry material', 80, category === 'BRICKWORK');
    if (category === 'BRICKWORK' && DPR_MASONRY_MATERIALS.indexOf(materialType) < 0) throw new SiteError('Select Red brick, Laterite stone, 6-inch cement blocks or 4-inch cement blocks for activity ' + (index + 1) + '.');
    const workArea = dprText(input.workArea, 'Activity ' + (index + 1) + ' room or work area', 200, true);
    let workStage = String(input.workStage || '').trim().toUpperCase();
    const plasterType = dprText(input.plasterType, 'Activity ' + (index + 1) + ' plastering type', 100, category === 'PLASTERING');
    if (category === 'PLASTERING' && plasterType === 'Plastering with parapet') workStage = 'PARAPET';
    let catalogue = null as ReturnType<typeof dprCatalogueItem>;
    if (category === 'BRICKWORK') catalogue = dprBrickActivity(floor, workStage);
    else if (category === 'PLASTERING') catalogue = dprPlasterActivity(floor, workStage);
    else if (category === 'OTHER') catalogue = dprCatalogueItem(input.activityNumber);
    if (category !== 'LEGACY' && !catalogue) throw new SiteError('Select a valid floor/stage/activity for activity ' + (index + 1) + '.');
    const activityName = category === 'LEGACY' ? dprText(input.activityName, 'Activity ' + (index + 1) + ' name', 200, true)
      : category === 'BRICKWORK' ? materialType + ' brickwork'
        : (category === 'PLASTERING' ? plasterType + ' - ' + (upperFloors.indexOf(floor) >= 0 ? floor.replace(/_/g, ' ') + ' (' + catalogue!.name + ')' : catalogue!.name) : catalogue!.name);
    const locationRoom = dprText((floor ? floor.replace(/_/g, ' ') + ' — ' : '') + workArea, 'Activity ' + (index + 1) + ' location', 240, true);
    const measurementType = String(input.measurementType || 'QUANTITY').trim().toUpperCase();
    if (['QUANTITY', 'PERCENTAGE'].indexOf(measurementType) < 0) throw new SiteError('Activity ' + (index + 1) + ' has an invalid measurement type.');
    const unit = measurementType === 'PERCENTAGE' ? '%' : String(input.unit || '').trim();
    if (!unit) throw new SiteError('Activity ' + (index + 1) + ' requires a unit.');
    const plannedTarget = dprNumber(input.plannedTarget, 'Planned target for activity ' + (index + 1), false);
    if (plannedTarget <= 0) throw new SiteError('Planned target for activity ' + (index + 1) + ' must be greater than 0.');
    const plannedHours = dprHours(input.plannedHours, 'Planned hours for activity ' + (index + 1), false);
    const activityMasons = dprInteger(input.plannedActivityMasons, 'Planned masons for activity ' + (index + 1));
    const activityLabourers = dprInteger(input.plannedActivityLabourers, 'Planned labourers for activity ' + (index + 1));
    const activityWorkers = activityMasons + activityLabourers;
    if (!activityWorkers) throw new SiteError('Plan at least one mason or labourer for activity ' + (index + 1) + '.');
    if (activityMasons > plannedMasons || activityLabourers > plannedLabourers) throw new SiteError('Activity ' + (index + 1) + ' manpower cannot exceed the daily planned masons or labourers.');
    if (plannedHours > Number(plannedShiftCode)) throw new SiteError('Planned hours for activity ' + (index + 1) + ' cannot exceed the selected ' + plannedShiftCode + '-hour shift.');
    return {
      sequence: index + 1, activityCode: category === 'LEGACY' ? String(input.activityCode || 'LEGACY') : 'ACTIVITY_' + catalogue!.number,
      activityNumber: catalogue ? catalogue.number : String(input.activityNumber || ''), milestone: catalogue ? catalogue.milestone : String(input.milestone || ''),
      activityCategory: category, activityName, materialType, floor, workArea, workStage, plasterType, locationRoom, measurementType, unit,
      productivityRatePerPair: 0, plannedCrewPairs: crewPairs, calculatedTarget: plannedTarget, plannedTarget, plannedHours,
      plannedActivityMasons: activityMasons, plannedActivityLabourers: activityLabourers, plannedActivityWorkers: activityWorkers,
      plannedWorkerHours: materialRound(activityWorkers * plannedHours),
      pmRemarks: dprText(input.pmRemarks, 'PM photo-angle instructions for activity ' + (index + 1), 1500, true),
    };
  });
  const plannedCapacity = (plannedMasons + plannedLabourers) * Number(plannedShiftCode);
  const plannedAllocatedWorkerHours = targets.reduce((sum: number, t: any) => sum + Number(t.plannedWorkerHours || 0), 0);
  if (plannedAllocatedWorkerHours > plannedCapacity + 0.001) {
    throw new SiteError('Activity manpower allocates ' + materialRound(plannedAllocatedWorkerHours) + ' worker-hours, above the daily capacity of ' + materialRound(plannedCapacity) + '. Reduce activity workers/hours or increase the planned daily workforce.');
  }
  const resolved = await dprProjectDate(s, payload.projectId, workDate);
  const existing = resolved.daily;
  if (dprHasEngineerProgress(existing)) throw new SiteError('The target is locked because the Site Engineer has started this DPR.');
  const requestId = String(payload.clientRequestId || '').trim();
  if (requestId.length > 120) throw new SiteError('Invalid daily-plan request identifier. Reload the DPR page and retry.');
  if (existing && requestId && String(existing.Last_Plan_Request_ID || '') === requestId) return getDprWorkspace(s, payload.projectId, workDate);
  const expectedPlanVersion = Number(payload.expectedPlanVersion || 0);
  const currentPlanVersion = existing ? Number(existing.Plan_Version || 0) : 0;
  if (expectedPlanVersion !== currentPlanVersion) throw new SiteError('This daily target changed in another tab or session. Reload the daily record before editing so no saved activity is overwritten.');
  const dprId = existing ? String(existing.DPR_ID) : ('DPR-' + workDate.replace(/-/g, '') + '-' + crypto.randomUUID().slice(0, 8).toUpperCase());
  const planVersion = existing ? Number(existing.Plan_Version || 0) + 1 : 1;
  const dailyChanges = {
    Project_ID: project.Project_ID, Project_Number: project.Project_Number, Client: project.Client, Work_Date: parseDateKey(workDate), PM_Email: user.email,
    Site_Engineer_Name: project.Site_Engineer_Name || project.Site_QC_Name || '', Site_Engineer_Email: siteEngineerEmail,
    Planned_Masons: plannedMasons, Planned_Labourers: plannedLabourers, Planned_Worker_Total: plannedMasons + plannedLabourers, Planned_Crew_Pairs: crewPairs,
    Planned_Shift_Code: plannedShiftCode, Planned_Vendor: plannedVendor, Plan_Version: planVersion,
    Plan_Status: siteOff ? 'SITE OFF' : (notStarted ? 'NOT STARTED' : 'PLANNED'), Site_Off_Status: siteOff ? 'YES' : 'NO', Site_Off_Category: siteOffCategory,
    Site_Off_Reason: siteOffReason, Site_Off_Set_At: siteOff ? s.now() : '', Site_Off_Set_By: siteOff ? user.email : '',
    Not_Started_Status: notStarted ? 'YES' : 'NO', Not_Started_Reason: notStartedReason, Not_Started_Set_At: notStarted ? s.now() : '', Not_Started_Set_By: notStarted ? user.email : '',
    Last_Plan_Request_ID: requestId, Updated_At: s.now(), Updated_By: user.email, Report_Status: siteOff ? 'SITE OFF' : (notStarted ? 'NOT STARTED' : 'PLANNED'),
  };
  if (existing) await s.update('DPR_Daily', 'DPR_ID', dprId, dailyChanges);
  else await s.append('DPR_Daily', {DPR_ID: dprId, Created_At: s.now(), Created_By: user.email, Morning_Masons: '', Morning_Labourers: '', Morning_Worker_Total: '', Morning_Remarks: '',
    Morning_Updated_At: '', Morning_Updated_By: '', Evening_Remarks: '', Evening_Updated_At: '', Evening_Updated_By: '', ...dailyChanges});
  await s.updateWhere('DPR_Targets', (row) => String(row.DPR_ID || '') === dprId && String(row.Status || 'ACTIVE').toUpperCase() === 'ACTIVE', {Status: 'SUPERSEDED', Superseded_At: s.now(), Superseded_By: user.email});
  await s.appendMany('DPR_Targets', targets.map((t: any) => ({
    Target_ID: shortId('DPT-'), DPR_ID: dprId, Project_ID: project.Project_ID, Work_Date: parseDateKey(workDate), Sequence: t.sequence,
    Activity_Code: t.activityCode, Activity_Number: t.activityNumber, Milestone: t.milestone, Activity_Category: t.activityCategory, Activity_Name: t.activityName,
    Material_Type: t.materialType, Floor: t.floor, Work_Area: t.workArea, Work_Stage: t.workStage, Plaster_Type: t.plasterType, Location_Room: t.locationRoom,
    Measurement_Type: t.measurementType, Unit: t.unit, Productivity_Rate_Per_Pair: t.productivityRatePerPair, Planned_Crew_Pairs: t.plannedCrewPairs,
    Calculated_Target: t.calculatedTarget, Planned_Target: t.plannedTarget, Planned_Hours: t.plannedHours, Planned_Activity_Masons: t.plannedActivityMasons,
    Planned_Activity_Labourers: t.plannedActivityLabourers, Planned_Activity_Workers: t.plannedActivityWorkers, Planned_Worker_Hours: t.plannedWorkerHours,
    PM_Remarks: t.pmRemarks, Status: 'ACTIVE', Created_At: s.now(), Created_By: user.email, Superseded_At: '', Superseded_By: '',
  })));
  await s.audit('DPR_PLAN_SAVED', 'DPR', dprId, existing ? ('PLAN V' + existing.Plan_Version) : '', 'PLAN V' + planVersion, {
    projectId: project.Project_ID, workDate, plannedMasons, plannedLabourers, plannedShiftCode, plannedVendor, plannedWorkerHours: plannedAllocatedWorkerHours,
    crewPairs, targetCount: targets.length, siteOff, siteOffCategory, siteOffReason, notStarted, notStartedReason,
  });
  return getDprWorkspace(s, payload.projectId, workDate);
}

// ---------- Site Engineer: morning ----------

export async function saveDprMorning(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate) || !dprEngineerEntryOpen(workDate, s.todayKey())) throw new SiteError('Morning manpower can be entered only on the work date or the following day.');
  const masons = dprInteger(payload.masons, 'Available masons');
  const labourers = dprInteger(payload.labourers, 'Available labourers');
  const actualShiftCode = dprShiftCode(payload.actualShiftCode, 'Actual shift');
  const actualVendor = dprVendor(payload.actualVendor, 'Actual labor vendor');
  const remarks = dprText(payload.remarks, 'Morning remarks', 2000, false);
  const resolved = await dprProjectDate(s, payload.projectId, workDate);
  if (!resolved.daily) throw new SiteError('The Project Manager has not set a target for this project and date.');
  if (dprIsEntryExempt(resolved.daily)) throw new SiteError('This date is marked ' + (dprIsNotStarted(resolved.daily) ? 'Not Started' : 'Site Off') + ' by the Project Manager. A DPR is not required.');
  if (dprIsSubmitted(resolved.daily)) throw new SiteError('DPR for the day is already submitted and locked.');
  const previous = {masons: resolved.daily.Morning_Masons, labourers: resolved.daily.Morning_Labourers, remarks: resolved.daily.Morning_Remarks};
  await s.update('DPR_Daily', 'DPR_ID', resolved.daily.DPR_ID, {
    Morning_Masons: masons, Morning_Labourers: labourers, Morning_Worker_Total: masons + labourers, Actual_Shift_Code: actualShiftCode, Actual_Vendor: actualVendor,
    Morning_Remarks: remarks, Morning_Updated_At: s.now(), Morning_Updated_By: user.email,
    Report_Status: String(resolved.daily.Report_Status || '').toUpperCase() === 'EOD UPDATED' ? 'EOD UPDATED' : 'MORNING UPDATED', Updated_At: s.now(), Updated_By: user.email,
  });
  await s.audit('DPR_MORNING_UPDATED', 'DPR', resolved.daily.DPR_ID, JSON.stringify(previous), 'MORNING UPDATED', {projectId: payload.projectId, workDate, masons, labourers, actualShiftCode, actualVendor});
  return getDprWorkspace(s, payload.projectId, workDate);
}

// ---------- photos ----------

const DPR_PHOTO_RULES = {singleActivityMinimum: 3, multipleActivityMinimum: 2, materialMinimum: 1, maxFilesPerGroup: 12, maxActivityPhotosPerGroup: 8, maxActivityPhotosPerSubmission: 60, maxBytesPerFile: 10 * 1024 * 1024};

function dayPrefix(project: Row, workDate: string) { return 'site/' + String(project.Project_ID) + '/dpr/' + workDate; }
function activityFolderName(target: Row) {
  const sequence = String(Number(target.Sequence || 0)).padStart(2, '0');
  return safeName(sequence + ' - Activity ' + String(target.Activity_Number || target.Sequence || '') + ' - ' + String(target.Activity_Name || 'Work'), sequence + ' - Activity');
}

/** Store the day's photos (archiveDprEvidence_). Files written here are removed if the save fails. */
async function archiveDprEvidence(s: Site, project: Row, daily: Row, workDate: string, targets: Row[], activityPhotos: any, materialPhotos: any) {
  if (!targets.length) throw new SiteError('The DPR has no planned activities. Reload and retry.');
  const submittedMap: Record<string, any> = {};
  (Array.isArray(activityPhotos) ? activityPhotos : []).forEach((group: any) => {
    const targetId = String(group && group.targetId || '');
    if (!targetId || submittedMap[targetId]) throw new SiteError('Activity photo evidence contains a missing or duplicate activity. Reload and retry.');
    submittedMap[targetId] = group;
  });
  const targetMap: Record<string, boolean> = {};
  targets.forEach((t) => { targetMap[String(t.Target_ID || '')] = true; });
  Object.keys(submittedMap).forEach((id) => { if (!targetMap[id]) throw new SiteError('Activity photo evidence does not match the current PM target. Reload and retry.'); });
  const existingMap: Record<string, Row> = {};
  (await s.filter('DPR_Activity_Evidence', (row) => String(row.DPR_ID || '') === String(daily.DPR_ID || ''))).forEach((row) => { existingMap[String(row.Target_ID || '')] = row; });
  const minimum = targets.length === 1 ? DPR_PHOTO_RULES.singleActivityMinimum : DPR_PHOTO_RULES.multipleActivityMinimum;
  let activityNewTotal = 0;
  const prepared = targets.map((target, index) => {
    const targetId = String(target.Target_ID || '');
    const raw = submittedMap[targetId] && Array.isArray(submittedMap[targetId].photos) ? submittedMap[targetId].photos : [];
    if (raw.length > DPR_PHOTO_RULES.maxActivityPhotosPerGroup) throw new SiteError('Activity ' + (index + 1) + ' accepts at most ' + DPR_PHOTO_RULES.maxActivityPhotosPerGroup + ' new photos per submission.');
    const decoded = raw.map((photo: any, i: number) => decodeDataUrl(photo, 'Activity ' + (index + 1) + ' evidence photo ' + (i + 1), ALLOWED_PHOTO_MIME, DPR_PHOTO_RULES.maxBytesPerFile));
    activityNewTotal += decoded.length;
    const existing = existingMap[targetId] || {};
    const existingCount = Number(existing.Photo_Count || 0);
    if (existingCount + decoded.length < minimum) throw new SiteError('Upload at least ' + minimum + ' photos for activity ' + (index + 1) + ': ' + String(target.Activity_Name || 'planned activity') + '.');
    return {target, decoded: decoded as DecodedFile[], existing, existingCount};
  });
  if (activityNewTotal > DPR_PHOTO_RULES.maxActivityPhotosPerSubmission) throw new SiteError('Too many activity photos were selected together. Upload at most ' + DPR_PHOTO_RULES.maxActivityPhotosPerSubmission + ' per submission.');
  const materialList = Array.isArray(materialPhotos) ? materialPhotos : [];
  if (materialList.length > DPR_PHOTO_RULES.maxFilesPerGroup) throw new SiteError('Material-balance evidence accepts at most ' + DPR_PHOTO_RULES.maxFilesPerGroup + ' photos per submission.');
  const decodedMaterials = materialList.map((p: any, i: number) => decodeDataUrl(p, 'Material-balance evidence photo ' + (i + 1), ALLOWED_PHOTO_MIME, DPR_PHOTO_RULES.maxBytesPerFile));
  const decodedWork = prepared.reduce((all: DecodedFile[], a) => all.concat(a.decoded), []);
  const totalBytes = decodedWork.concat(decodedMaterials).reduce((sum, p) => sum + p.bytes.length, 0);
  if (totalBytes > 25 * 1024 * 1024) throw new SiteError('The DPR photo evidence is too large together. Upload fewer photos or reduce their size.');
  const existingWork = Number(daily.Work_Photo_Count || 0), existingMaterials = Number(daily.Material_Photo_Count || 0);
  if (existingMaterials + decodedMaterials.length < DPR_PHOTO_RULES.materialMinimum) throw new SiteError('Upload at least one material-balance photo before saving the end-of-day DPR.');
  const day = dayPrefix(project, workDate), work = day + '/01 - Work Done', material = day + '/02 - Materials';
  const created: string[] = [];
  s.onError.push(() => removeFiles(created));
  const activities = [];
  for (const a of prepared) {
    const folder = a.existing.Folder_ID ? String(a.existing.Folder_ID) : work + '/' + activityFolderName(a.target);
    created.push(...await storeFiles(folder, a.decoded, 'ACTIVITY-' + String(a.target.Activity_Number || a.target.Sequence || ''), s.now()));
    activities.push({targetId: String(a.target.Target_ID || ''), activityNumber: String(a.target.Activity_Number || ''), activityName: String(a.target.Activity_Name || ''),
      sequence: Number(a.target.Sequence || 0), folderId: folder, folderUrl: folderUrl(folder), photoCount: a.existingCount + a.decoded.length, newPhotoCount: a.decoded.length});
  }
  created.push(...await storeFiles(material, decodedMaterials, 'MATERIAL', s.now()));
  return {
    dayFolderId: day, dayFolderUrl: folderUrl(day), workFolderId: work, workFolderUrl: folderUrl(work), materialFolderId: material, materialFolderUrl: folderUrl(material),
    workPhotoCount: existingWork + decodedWork.length, materialPhotoCount: existingMaterials + decodedMaterials.length,
    newWorkCount: decodedWork.length, newMaterialCount: decodedMaterials.length, activities, deferred: false, expectedCount: 0,
  };
}

/** Check a deferred-upload manifest without storing files during the data save. */
async function reserveDeferredDprEvidence(s: Site, daily: Row, targets: Row[], manifest: any) {
  const groupMap: Record<string, number> = {};
  (Array.isArray(manifest && manifest.activities) ? manifest.activities : []).forEach((group: any) => {
    const targetId = String(group && group.targetId || '');
    if (!targetId || Object.prototype.hasOwnProperty.call(groupMap, targetId)) throw new SiteError('Activity photo selection contains a missing or duplicate activity. Reload and retry.');
    groupMap[targetId] = Math.max(0, Number(group.count || 0));
  });
  const existingMap: Record<string, Row> = {};
  (await s.filter('DPR_Activity_Evidence', (row) => String(row.DPR_ID || '') === String(daily.DPR_ID || ''))).forEach((row) => { existingMap[String(row.Target_ID || '')] = row; });
  const minimum = targets.length === 1 ? DPR_PHOTO_RULES.singleActivityMinimum : DPR_PHOTO_RULES.multipleActivityMinimum;
  let activityExpected = 0;
  const activities = targets.map((target, index) => {
    const targetId = String(target.Target_ID || '');
    const expected = groupMap[targetId] || 0;
    const existing = existingMap[targetId] || {};
    if (Number(existing.Photo_Count || 0) + expected < minimum) throw new SiteError('Select at least ' + minimum + ' photos for activity ' + (index + 1) + ': ' + String(target.Activity_Name || 'planned activity') + '.');
    activityExpected += expected;
    return {targetId, activityNumber: String(target.Activity_Number || ''), activityName: String(target.Activity_Name || ''), sequence: Number(target.Sequence || 0),
      folderId: String(existing.Folder_ID || ''), folderUrl: String(existing.Folder_URL || ''), photoCount: Number(existing.Photo_Count || 0), newPhotoCount: 0};
  });
  const materialExpected = Math.max(0, Number(manifest && manifest.materialCount || 0));
  if (Number(daily.Material_Photo_Count || 0) + materialExpected < DPR_PHOTO_RULES.materialMinimum) throw new SiteError('Select at least one material-balance photo before submitting the DPR.');
  return {
    deferred: true, expectedCount: activityExpected + materialExpected,
    dayFolderId: String(daily.DPR_Day_Folder_ID || ''), dayFolderUrl: String(daily.DPR_Day_Folder_URL || ''),
    workFolderId: String(daily.Work_Evidence_Folder_ID || ''), workFolderUrl: String(daily.Work_Evidence_Folder_URL || ''),
    materialFolderId: String(daily.Material_Evidence_Folder_ID || ''), materialFolderUrl: String(daily.Material_Evidence_Folder_URL || ''),
    workPhotoCount: Number(daily.Work_Photo_Count || 0), materialPhotoCount: Number(daily.Material_Photo_Count || 0), newWorkCount: 0, newMaterialCount: 0, activities,
  };
}

/** Finish a committed DPR's deferred photo upload. Safe to retry. */
export async function uploadDeferredDprEvidence(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC']);
  if (!payload || !payload.projectId) throw new SiteError('The photo upload is missing its project. Reopen the DPR and retry.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  const resolved = await dprProjectDate(s, payload.projectId, workDate);
  if (!resolved.daily || !dprIsSubmitted(resolved.daily)) throw new SiteError('Submit the DPR data before uploading its photos.');
  if (String(resolved.daily.Last_EOD_Request_ID || '') !== String(payload.clientRequestId || '')) throw new SiteError('These photos belong to an older DPR submission. Reopen the current DPR before retrying.');
  if (String(resolved.daily.Evidence_Upload_Status || '').toUpperCase() === 'COMPLETE') return {status: 'COMPLETE', uploadedCount: Number(resolved.daily.Evidence_Uploaded_Count || 0)};
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  const targets = (await s.filter('DPR_Targets', (row) => String(row.DPR_ID || '') === String(resolved.daily!.DPR_ID || '') && String(row.Status || 'ACTIVE').toUpperCase() === 'ACTIVE'))
    .sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  let evidence;
  try {
    evidence = await archiveDprEvidence(s, project!, resolved.daily, workDate, targets, payload.activityPhotos, payload.materialPhotos);
  } catch (err) {
    // Record the failure on its own, so the site can see the upload needs a retry.
    const message = String((err as Error)?.message || err).slice(0, 1000);
    s.failureWrites.push(async (f: Site) => {
      await f.update('DPR_Daily', 'DPR_ID', resolved.daily!.DPR_ID, {Evidence_Upload_Status: 'RETRY REQUIRED', Evidence_Upload_Last_Error: message, Updated_At: f.now(), Updated_By: user.email});
    });
    throw err;
  }
  for (const a of evidence.activities) {
    const existing = await s.find('DPR_Activity_Evidence', 'Target_ID', a.targetId);
    if (existing) await s.update('DPR_Activity_Evidence', 'Activity_Evidence_ID', existing.Activity_Evidence_ID, {Folder_ID: a.folderId, Folder_URL: a.folderUrl, Photo_Count: a.photoCount, Updated_At: s.now(), Updated_By: user.email});
  }
  const uploaded = evidence.workPhotoCount + evidence.materialPhotoCount;
  await s.update('DPR_Daily', 'DPR_ID', resolved.daily.DPR_ID, {
    DPR_Day_Folder_ID: evidence.dayFolderId, DPR_Day_Folder_URL: evidence.dayFolderUrl, Work_Evidence_Folder_ID: evidence.workFolderId, Work_Evidence_Folder_URL: evidence.workFolderUrl,
    Material_Evidence_Folder_ID: evidence.materialFolderId, Material_Evidence_Folder_URL: evidence.materialFolderUrl, Work_Photo_Count: evidence.workPhotoCount,
    Material_Photo_Count: evidence.materialPhotoCount, Evidence_Upload_Status: 'COMPLETE', Evidence_Uploaded_Count: uploaded, Evidence_Upload_Last_Error: '',
    Evidence_Upload_Completed_At: s.now(), Updated_At: s.now(), Updated_By: user.email,
  });
  await s.audit('DPR_EVIDENCE_UPLOAD_COMPLETED', 'DPR', resolved.daily.DPR_ID, 'UPLOAD PENDING', 'COMPLETE', {requestId: payload.clientRequestId, uploadedCount: uploaded});
  return {status: 'COMPLETE', uploadedCount: uploaded};
}

// ---------- Site Engineer: end of day ----------

// ---------- three photo check-ins a day ----------

/** Morning, noon and evening: live photos of progress, labour on site and material available. */
export const DPR_CHECKIN_SLOTS = [
  {slot: 'MORNING', label: 'Morning', from: '06:00', to: '11:59'},
  {slot: 'NOON', label: 'Noon', from: '12:00', to: '15:59'},
  {slot: 'EVENING', label: 'Evening', from: '16:00', to: '23:59'},
];
const istTime = (d: Date) => d.toLocaleTimeString('en-GB', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false});
export async function dprCheckins(s: Site, dprId: string) {
  return dprId ? (await s.filter('DPR_Checkins', (r) => String(r.DPR_ID || '') === dprId)).map((r) => ({
    checkinId: String(r.Checkin_ID || ''), slot: String(r.Slot || ''), onTime: String(r.On_Time || '') === 'YES', masons: Number(r.Masons || 0), labourers: Number(r.Labourers || 0),
    progressPercent: r.Progress_Percent === '' ? '' : Number(r.Progress_Percent), progressNote: String(r.Progress_Note || ''),
    materials: (() => { try { return JSON.parse(String(r.Materials_JSON || '[]')); } catch { return []; } })(),
    photoCount: Number(r.Photo_Count || 0), photoFolderUrl: folderUrl(String(r.Photo_Folder || '')), capturedAt: String(r.Captured_At || ''), createdAt: String(r.Created_At || ''), createdBy: String(r.Created_By || ''),
  })) : [];
}
export async function saveDprCheckin(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate) || workDate !== s.todayKey()) throw new SiteError('Check-in photos are taken live on the work day.');
  const slot = DPR_CHECKIN_SLOTS.find((x) => x.slot === String(payload.slot || '').toUpperCase());
  if (!slot) throw new SiteError('Choose morning, noon or evening.');
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid check-in. Reload and retry.');
  const resolved = await dprProjectDate(s, payload.projectId, workDate);
  if (!resolved.daily) throw new SiteError('The Project Manager has not set a target for this project and date.');
  if (dprIsEntryExempt(resolved.daily)) throw new SiteError('This date is marked Site Off / Not Started. No check-in is needed.');
  const dprId = String(resolved.daily.DPR_ID);
  const existing = await s.filter('DPR_Checkins', (r) => String(r.DPR_ID || '') === dprId && String(r.Slot || '') === slot.slot);
  if (existing.some((r) => String(r.Request_ID || '') === requestId)) return getDprWorkspace(s, payload.projectId, workDate);
  if (existing.length) throw new SiteError('The ' + slot.label.toLowerCase() + ' check-in is already saved for today.');
  const masons = dprInteger(payload.masons, 'Masons on site');
  const labourers = dprInteger(payload.labourers, 'Labourers on site');
  const progressNote = dprText(payload.progressNote, 'Progress', 1000, true);
  const progressPercent = payload.progressPercent === '' || payload.progressPercent == null ? '' : dprPercent(payload.progressPercent, 'Progress %');
  const materials = (Array.isArray(payload.materials) ? payload.materials : []).slice(0, 60).map((m: any, i: number) => ({
    materialKey: String(m.materialKey || '').slice(0, 200), materialName: String(m.materialName || '').slice(0, 200), unit: String(m.unit || '').slice(0, 30),
    available: dprNumber(m.available, 'Available quantity ' + (i + 1)),
  }));
  const photos: any[] = Array.isArray(payload.photos) ? payload.photos : [];
  if (!photos.length) throw new SiteError('Take at least one live photo for the ' + slot.label.toLowerCase() + ' check-in.');
  if (photos.length > 8) throw new SiteError('Up to 8 photos per check-in.');
  const decoded: DecodedFile[] = photos.map((ph, i) => decodeDataUrl(ph, slot.label + ' photo ' + (i + 1), ALLOWED_PHOTO_MIME, DPR_PHOTO_RULES.maxBytesPerFile));
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  const folder = dayPrefix(project, workDate) + '/00 - Check-ins/' + slot.label;
  const created = await storeFiles(folder, decoded, slot.slot, s.now());
  s.onError.push(() => removeFiles(created));
  // On time when taken inside its window (the phone's capture time if sent, else now).
  const captured = dateKey(payload.capturedAt) === workDate ? new Date(String(payload.capturedAt)) : s.now();
  const t = istTime(isNaN(captured.getTime()) ? s.now() : captured);
  await s.append('DPR_Checkins', {
    Checkin_ID: shortId('CHK-'), Request_ID: requestId, DPR_ID: dprId, Project_ID: String(project.Project_ID), Work_Date: workDate, Slot: slot.slot,
    On_Time: t >= slot.from && t <= slot.to ? 'YES' : 'NO', Masons: masons, Labourers: labourers, Progress_Percent: progressPercent, Progress_Note: progressNote,
    Materials_JSON: JSON.stringify(materials), Photo_Folder: folder, Photo_Count: decoded.length, Captured_At: isNaN(captured.getTime()) ? '' : captured.toISOString(),
    Created_At: s.now(), Created_By: user.email,
  });
  await s.audit('DPR_CHECKIN_SAVED', 'DPR', dprId, '', slot.slot, {projectId: project.Project_ID, workDate, masons, labourers, photos: decoded.length, onTime: t});
  return getDprWorkspace(s, payload.projectId, workDate);
}

export async function saveDprEvening(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate) || !dprEngineerEntryOpen(workDate, s.todayKey())) throw new SiteError('End-of-day progress can be entered only on the work date or the following day.');
  const resolved = await dprProjectDate(s, payload.projectId, workDate);
  if (!resolved.daily) throw new SiteError('The Project Manager has not set a target for this project and date.');
  if (dprIsEntryExempt(resolved.daily)) throw new SiteError('This date is marked ' + (dprIsNotStarted(resolved.daily) ? 'Not Started' : 'Site Off') + ' by the Project Manager. A DPR is not required.');
  if (!resolved.daily.Morning_Updated_At) throw new SiteError('Save the morning manpower update before entering end-of-day progress.');
  {
    const done = (await dprCheckins(s, String(resolved.daily.DPR_ID))).map((c) => c.slot);
    const missing = DPR_CHECKIN_SLOTS.filter((x) => !done.includes(x.slot)).map((x) => x.label.toLowerCase());
    if (missing.length) throw new SiteError('Take the ' + missing.join(', ') + ' check-in photos before submitting the end-of-day DPR.');
  }
  const requestId = String(payload.clientRequestId || '').trim();
  if (!requestId || requestId.length > 120) throw new SiteError('Invalid end-of-day request. Reload the DPR page and retry.');
  if (payload.wastageReviewed !== true) throw new SiteError('Review daily material wastage and confirm the declaration before submitting the DPR.');
  if (payload.qualityAssuranceAccepted !== true) throw new SiteError('Digital quality sign-off is required. Confirm that the construction work was verified against the applicable drawings and Bilara quality standards.');
  if (String(resolved.daily.Last_EOD_Request_ID || '') === requestId) return getDprWorkspace(s, payload.projectId, workDate);
  const current = resolved.daily;
  const approvedResubmission = dprIsSubmitted(current) && String(current.Resubmit_Status || '').toUpperCase() === 'APPROVED';
  if (dprIsSubmitted(current) && !approvedResubmission) throw new SiteError('DPR for the day is already submitted and locked. Request resubmission and wait for Project Manager approval.');
  const project = await s.find('Projects', 'Project_ID', payload.projectId);
  if (!project) throw new SiteError('Project not found.');
  await ensureProjectMaterialBalances(s, project);
  const dprId = String(current.DPR_ID);
  const targets = (await s.filter('DPR_Targets', (row) => String(row.DPR_ID || '') === dprId && String(row.Status || 'ACTIVE').toUpperCase() === 'ACTIVE'))
    .sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  const resultMap: Record<string, any> = {};
  (Array.isArray(payload.results) ? payload.results : []).forEach((r: any) => { resultMap[String(r.targetId || '')] = r; });
  if (targets.some((t) => !resultMap[String(t.Target_ID || '')])) throw new SiteError('Enter the end-of-day output for every planned activity.');
  const preparedResults = targets.map((target, index) => {
    const input = resultMap[String(target.Target_ID || '')];
    const measurement = String(target.Measurement_Type || '').toUpperCase();
    let actualQuantity: any = '', completionPercent: any = '', achievementPercent: any = '';
    const plannedHours = dprHours(target.Planned_Hours || input.plannedHours, 'Planned hours for activity ' + (index + 1), false);
    const hoursPerWorker = dprHours(input.hoursPerWorker !== undefined ? input.hoursPerWorker : input.effectiveHours, 'Hours per worker for activity ' + (index + 1), true);
    const effectiveHours = hoursPerWorker;
    const actualActivityMasons = dprInteger(input.actualActivityMasons, 'Actual masons for activity ' + (index + 1));
    const actualActivityLabourers = dprInteger(input.actualActivityLabourers, 'Actual labourers for activity ' + (index + 1));
    const actualActivityWorkers = actualActivityMasons + actualActivityLabourers;
    const actualWorkerHours = materialRound(actualActivityWorkers * hoursPerWorker);
    // A longer day is valid: hours above the planned shift are recorded as overtime.
    const plannedShiftHours = Number(current.Planned_Shift_Code || 8);
    const overtimeHoursPerWorker = materialRound(Math.max(0, hoursPerWorker - plannedShiftHours));
    const overtimeWorkerHours = materialRound(actualActivityWorkers * overtimeHoursPerWorker);
    if (actualActivityMasons > Number(current.Morning_Masons || 0) || actualActivityLabourers > Number(current.Morning_Labourers || 0)) {
      throw new SiteError('Activity ' + (index + 1) + ' manpower cannot exceed the morning available masons or labourers.');
    }
    if (!actualActivityWorkers && hoursPerWorker > 0) throw new SiteError('Activity ' + (index + 1) + ' has hours but no workers.');
    if (measurement === 'PERCENTAGE') { completionPercent = dprPercent(input.completionPercent, 'Completion for activity ' + (index + 1)); achievementPercent = completionPercent; }
    else {
      actualQuantity = dprNumber(input.actualQuantity, 'Actual output for activity ' + (index + 1), false);
      const progress = dprQuantitativeProgress(actualQuantity, target.Planned_Target);
      achievementPercent = progress.achievementPercent; completionPercent = progress.completionPercent;
    }
    const timeOutput = measurement === 'PERCENTAGE' ? completionPercent : actualQuantity;
    if (effectiveHours === 0 && Number(timeOutput || 0) > 0) throw new SiteError('Activity ' + (index + 1) + ' cannot have output when effective hours are 0.');
    const timeProgress = dprTimeProgress(timeOutput, target.Planned_Target, plannedHours, hoursPerWorker);
    const reducedHoursReason = dprText(input.reducedHoursReason, 'Reduced-hours reason for activity ' + (index + 1), 1500, effectiveHours < plannedHours);
    const outputDescription = dprText(input.outputDescription, 'Work output description for activity ' + (index + 1), 1500, false);
    if (measurement === 'PERCENTAGE' && !outputDescription) throw new SiteError('Describe the completed work for percentage activity ' + (index + 1) + '.');
    const shortfallReason = dprText(input.shortfallReason, 'Shortfall reason for activity ' + (index + 1), 1500, false);
    if (Number(achievementPercent) < 100 && !shortfallReason) throw new SiteError('Enter the shortfall reason for activity ' + (index + 1) + '.');
    return {target, actualQuantity, completionPercent, achievementPercent, plannedHours, effectiveHours: hoursPerWorker, hourUsePercent: timeProgress.hourUsePercent,
      timeAdjustedTarget: timeProgress.adjustedTarget, timeAdjustedAchievementPercent: timeProgress.achievementPercent, reducedHoursReason, actualActivityMasons,
      actualActivityLabourers, actualActivityWorkers, hoursPerWorker, actualWorkerHours, cappedAchievementPercent: Math.min(100, Number(achievementPercent || 0)),
      overtimeHoursPerWorker, overtimeWorkerHours, outputDescription, shortfallReason};
  });
  const actualShiftHours = Number(current.Actual_Shift_Code || current.Planned_Shift_Code || 8);
  const maximumReportedHours = preparedResults.reduce((m, r) => Math.max(m, Number(r.hoursPerWorker || 0)), actualShiftHours);
  const workforceCapacityHours = Math.max(actualShiftHours, maximumReportedHours);
  const actualMasonHours = preparedResults.reduce((sum, r) => sum + Number(r.actualActivityMasons || 0) * Number(r.hoursPerWorker || 0), 0);
  const actualLabourerHours = preparedResults.reduce((sum, r) => sum + Number(r.actualActivityLabourers || 0) * Number(r.hoursPerWorker || 0), 0);
  if (actualMasonHours > Number(current.Morning_Masons || 0) * workforceCapacityHours + 0.001 || actualLabourerHours > Number(current.Morning_Labourers || 0) * workforceCapacityHours + 0.001) {
    throw new SiteError('Activity labor-hours exceed the morning workforce capacity, including reported overtime. Check whether the same workers were allocated to overlapping activities.');
  }
  const submittedMaterialMap: Record<string, any> = {};
  (Array.isArray(payload.materials) ? payload.materials : []).forEach((m: any) => {
    const key = String(m.materialKey || '');
    if (!key || submittedMaterialMap[key]) throw new SiteError('The DPR contains a missing or duplicate material line. Reload and retry.');
    submittedMaterialMap[key] = m;
  });
  const definitionMap: Record<string, any> = {};
  (await materialRowsForDpr(s, project)).forEach((d) => { definitionMap[d.materialKey] = d; });
  const preparedMaterials = Object.keys(submittedMaterialMap).map((key) => {
    const definition = definitionMap[key];
    const input = submittedMaterialMap[key];
    if (!definition) throw new SiteError('A DPR material is not part of this project inventory. Reload and retry.');
    return {definition, usedQuantity: dprNumber(input.usedQuantity, definition.name + ' used quantity', false), remarks: dprText(input.remarks, definition.name + ' material remarks', 500, false)} as any;
  });
  const evidence: any = payload.deferredEvidenceManifest
    ? await reserveDeferredDprEvidence(s, current, targets, payload.deferredEvidenceManifest)
    : await archiveDprEvidence(s, project, current, workDate, targets, payload.activityPhotos, payload.materialPhotos);
  const existingMaterialMap: Record<string, Row> = {};
  for (const row of await s.filter('DPR_Materials', (r) => String(r.DPR_ID || '') === dprId)) existingMaterialMap[String(row.Material_Key || '') || await legacyKeyOf(s, row)] = row;
  await applyDprMaterialConsumption(s, project, dprId, workDate, preparedMaterials, existingMaterialMap, user.email, requestId);
  for (const r of preparedResults) {
    const existing = await s.find('DPR_Results', 'Target_ID', r.target.Target_ID);
    const changes = {
      DPR_ID: dprId, Project_ID: payload.projectId, Work_Date: parseDateKey(workDate), Actual_Quantity: r.actualQuantity, Completion_Percent: r.completionPercent,
      Achievement_Percent: r.achievementPercent, Planned_Hours: r.plannedHours, Effective_Hours: r.effectiveHours, Hour_Use_Percent: r.hourUsePercent,
      Time_Adjusted_Target: r.timeAdjustedTarget, Time_Adjusted_Achievement_Percent: r.timeAdjustedAchievementPercent, Reduced_Hours_Reason: r.reducedHoursReason,
      Output_Description: r.outputDescription, Actual_Activity_Masons: r.actualActivityMasons, Actual_Activity_Labourers: r.actualActivityLabourers,
      Actual_Activity_Workers: r.actualActivityWorkers, Hours_Per_Worker: r.hoursPerWorker, Actual_Worker_Hours: r.actualWorkerHours,
      Capped_Achievement_Percent: r.cappedAchievementPercent, Overtime_Hours_Per_Worker: r.overtimeHoursPerWorker, Overtime_Worker_Hours: r.overtimeWorkerHours,
      Shortfall_Reason: r.shortfallReason, Updated_At: s.now(), Updated_By: user.email,
    };
    if (existing) await s.updateBatch('DPR_Results', [{record: existing, changes}]);
    else await s.append('DPR_Results', {Result_ID: shortId('DPRR-'), Target_ID: r.target.Target_ID, ...changes});
  }
  for (const m of preparedMaterials) {
    const existing = existingMaterialMap[m.definition.materialKey];
    const changes = {
      DPR_ID: dprId, Project_ID: payload.projectId, Work_Date: parseDateKey(workDate), Material_Key: m.definition.materialKey, Material_Code: m.definition.code,
      Material_Name: m.definition.name, Variant: m.definition.variant, Size_mm: m.definition.sizeMm, Unit: m.definition.unit, Used_Quantity: m.usedQuantity,
      Balance_Before: m.balanceBefore, Balance_Quantity: m.balanceAfter, Inventory_Transaction_ID: m.inventoryTransactionId || '', Remarks: m.remarks, Updated_At: s.now(), Updated_By: user.email,
    };
    if (existing) await s.updateBatch('DPR_Materials', [{record: existing, changes}]);
    else await s.append('DPR_Materials', {Material_Record_ID: shortId('DPM-'), ...changes});
  }
  for (const a of evidence.activities) {
    const existing = await s.find('DPR_Activity_Evidence', 'Target_ID', a.targetId);
    const changes = {DPR_ID: dprId, Target_ID: a.targetId, Project_ID: payload.projectId, Work_Date: parseDateKey(workDate), Activity_Number: a.activityNumber,
      Activity_Name: a.activityName, Sequence: a.sequence, Folder_ID: a.folderId, Folder_URL: a.folderUrl, Photo_Count: a.photoCount, Updated_At: s.now(), Updated_By: user.email};
    if (existing) await s.updateBatch('DPR_Activity_Evidence', [{record: existing, changes}]);
    else await s.append('DPR_Activity_Evidence', {Activity_Evidence_ID: shortId('DPAE-'), ...changes});
  }
  const submissionVersion = Number(current.EOD_Submission_Version || (dprIsSubmitted(current) ? 1 : 0)) + 1;
  const qualityDeclaration = 'I confirm that I inspected the construction work recorded in this DPR and verified that it was executed as per the applicable drawings and Bilara quality standards.';
  await s.update('DPR_Daily', 'DPR_ID', dprId, {
    Evening_Remarks: dprText(payload.eveningRemarks, 'End-of-day remarks', 2000, false), Evening_Updated_At: s.now(), Evening_Updated_By: user.email,
    Report_Status: 'SUBMITTED', Last_EOD_Request_ID: requestId, EOD_Submission_Version: submissionVersion, EOD_Submitted_At: s.now(), EOD_Submitted_By: user.email,
    Resubmit_Status: approvedResubmission ? 'USED' : 'NONE', Resubmit_Used_At: approvedResubmission ? s.now() : '',
    Wastage_Reviewed: 'YES', Wastage_Reviewed_At: s.now(), Wastage_Reviewed_By: user.email,
    Quality_Assurance_Accepted: 'YES', Quality_Assurance_Declaration: qualityDeclaration, Quality_Assurance_Signed_Name: user.name,
    Quality_Assurance_Signed_By: user.email, Quality_Assurance_Signed_At: s.now(), Quality_Assurance_Submission_Version: submissionVersion,
    DPR_Day_Folder_ID: evidence.dayFolderId, DPR_Day_Folder_URL: evidence.dayFolderUrl, Work_Evidence_Folder_ID: evidence.workFolderId, Work_Evidence_Folder_URL: evidence.workFolderUrl,
    Work_Photo_Count: evidence.workPhotoCount, Material_Evidence_Folder_ID: evidence.materialFolderId, Material_Evidence_Folder_URL: evidence.materialFolderUrl,
    Material_Photo_Count: evidence.materialPhotoCount, Evidence_Upload_Status: evidence.deferred ? 'UPLOAD PENDING' : 'COMPLETE',
    Evidence_Expected_Count: evidence.expectedCount || evidence.workPhotoCount + evidence.materialPhotoCount,
    Evidence_Uploaded_Count: evidence.deferred ? 0 : evidence.workPhotoCount + evidence.materialPhotoCount, Evidence_Upload_Last_Error: '',
    Evidence_Upload_Completed_At: evidence.deferred ? '' : s.now(), Updated_At: s.now(), Updated_By: user.email,
  });
  await s.audit('DPR_EOD_SUBMITTED', 'DPR', dprId, current.Report_Status || '', 'SUBMITTED V' + submissionVersion, {
    projectId: payload.projectId, workDate, resultCount: preparedResults.length, materialCount: preparedMaterials.length,
    wastageLineCount: (await dprDailyWastage(s, payload.projectId, workDate)).length, qualityAssuranceSigned: true, qualityAssuranceSubmissionVersion: submissionVersion,
    newWorkPhotos: evidence.newWorkCount, newMaterialPhotos: evidence.newMaterialCount, evidenceUploadStatus: evidence.deferred ? 'UPLOAD PENDING' : 'COMPLETE',
    overtimeWorkerHours: preparedResults.reduce((sum, r) => sum + Number(r.overtimeWorkerHours || 0), 0),
  });
  await refreshDprLaborSummary(s, payload.projectId);
  if (payload.deferredEvidenceManifest) {
    return clientSafe({committed: true, dprId, workDate, reportStatus: 'SUBMITTED', evidenceUploadStatus: 'UPLOAD PENDING', evidenceExpectedCount: Number(evidence.expectedCount || 0), submissionVersion});
  }
  return getDprWorkspace(s, payload.projectId, workDate);
}

// Labour records, payables and the Purchase view read the DPR tables directly, so there is no
// separate post-commit queue to process any more; this stays for the page's existing call.
export async function scheduleDprPostCommitTrigger(s: Site) { s.requireRole(['SITE_ENGINEER', 'QC']); return {status: 'COMPLETE'}; }

// ---------- resubmission ----------

export async function requestDprResubmission(s: Site, payload: any) {
  const user = s.requireRole(['SITE_ENGINEER', 'QC']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertSiteOperationsProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate) || !dprEngineerEntryOpen(workDate, s.todayKey())) throw new SiteError('A resubmission can be requested only on the work date or the following day.');
  const reason = dprText(payload.reason, 'Resubmission reason', 1000, true);
  const daily = (await dprProjectDate(s, payload.projectId, workDate)).daily;
  if (!daily || !dprIsSubmitted(daily)) throw new SiteError('Submit the DPR before requesting a resubmission.');
  const status = String(daily.Resubmit_Status || '').toUpperCase();
  if (status === 'REQUESTED') return getDprWorkspace(s, payload.projectId, workDate);
  if (status === 'APPROVED') throw new SiteError('The Project Manager has already approved resubmission.');
  await s.update('DPR_Daily', 'DPR_ID', daily.DPR_ID, {Resubmit_Status: 'REQUESTED', Resubmit_Request_Reason: reason, Resubmit_Requested_At: s.now(), Resubmit_Requested_By: user.email,
    Resubmit_Approved_At: '', Resubmit_Approved_By: '', Updated_At: s.now(), Updated_By: user.email});
  await s.audit('DPR_RESUBMIT_REQUESTED', 'DPR', daily.DPR_ID, status || 'NONE', 'REQUESTED', {projectId: payload.projectId, workDate, reason});
  return getDprWorkspace(s, payload.projectId, workDate);
}

export async function approveDprResubmission(s: Site, payload: any) {
  const user = s.requireRole(['PM']);
  if (!payload || !payload.projectId) throw new SiteError('Select a project.');
  await assertProjectAccess(s, user, payload.projectId);
  const workDate = dateKey(payload.workDate);
  if (!isValidDateKey(workDate) || !dprEngineerEntryOpen(workDate, s.todayKey())) throw new SiteError('A resubmission can be approved only on the work date or the following day.');
  const daily = (await dprProjectDate(s, payload.projectId, workDate)).daily;
  if (!daily || !dprIsSubmitted(daily)) throw new SiteError('The DPR has not been submitted.');
  if (String(daily.Resubmit_Status || '').toUpperCase() !== 'REQUESTED') throw new SiteError('There is no pending resubmission request.');
  await s.update('DPR_Daily', 'DPR_ID', daily.DPR_ID, {
    Resubmit_Status: 'APPROVED', Resubmit_Approved_At: s.now(), Resubmit_Approved_By: user.email, Wastage_Reviewed: '', Wastage_Reviewed_At: '', Wastage_Reviewed_By: '',
    Quality_Assurance_Accepted: '', Quality_Assurance_Declaration: '', Quality_Assurance_Signed_Name: '', Quality_Assurance_Signed_By: '', Quality_Assurance_Signed_At: '',
    Quality_Assurance_Submission_Version: '', Updated_At: s.now(), Updated_By: user.email,
  });
  await s.audit('DPR_RESUBMIT_APPROVED', 'DPR', daily.DPR_ID, 'REQUESTED', 'APPROVED', {projectId: payload.projectId, workDate, requestReason: String(daily.Resubmit_Request_Reason || '')});
  return getDprWorkspace(s, payload.projectId, workDate);
}
