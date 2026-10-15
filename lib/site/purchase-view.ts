// What Purchase used to get in the separate "Bilara Site Purchase" Google workbook, now live in
// the app: GRN arrivals, daily material usage, wastage, current site stock, a summary per item,
// and the GRN follow-up list where Purchase records its review (from PurchaseMaterialIncoming.gs).
import {Site, Row, SiteError, clientSafe, dateKey, storedDate} from './core';
import {dprText, materialRound} from './util';

const show = (v: any) => (v instanceof Date ? storedDate(v) : v);
const pick = (row: Row, headers: string[]) => {
  const o: Row = {};
  headers.forEach((h) => { o[h] = show(row[h] ?? ''); });
  return o;
};

export const PURCHASE_USAGE_HEADERS = ['Usage_ID', 'Work_Date', 'Project_ID', 'Project_Number', 'Client', 'DPR_ID', 'Material_Code', 'Material_Name', 'Variant', 'Quantity_Used', 'Unit', 'Balance_After', 'Entry_Type', 'Remarks', 'Recorded_By', 'Recorded_At'];
export const PURCHASE_BALANCE_HEADERS = ['Project_ID', 'Project_Number', 'Client', 'Material_Code', 'Material_Name', 'Material_Category', 'Material_Subcategory', 'Variant', 'Stock_Unit', 'Opening_Quantity', 'Total_Received', 'Total_Consumed', 'Total_Adjusted', 'Balance_Quantity', 'Low_Stock_Threshold', 'Status', 'Updated_At'];
export const PURCHASE_WASTAGE_HEADERS = ['Waste_Record_ID', 'Waste_Batch_ID', 'Waste_Date', 'Project_ID', 'Project_Number', 'Client', 'Material_Code', 'Material_Name', 'Variant', 'Entered_Quantity', 'Entered_Unit', 'Waste_Quantity', 'Stock_Unit', 'Steel_Diameter_mm', 'Steel_Piece_Count', 'Steel_Total_Length_ft', 'Steel_Total_Length_m', 'Reason', 'Remarks', 'Source_DPR_ID', 'Entry_Source', 'Recorded_By', 'Recorded_At'];
export const PURCHASE_SUMMARY_HEADERS = ['Project_ID', 'Project_Number', 'Client', 'Material_Code', 'Material_Name', 'Variant', 'Material_Category', 'Material_Subcategory', 'Stock_Unit', 'Total_Received', 'Total_Used', 'Total_Wasted', 'Wastage_Percent', 'Current_Balance', 'Low_Stock_Threshold', 'Stock_Status', 'Last_Updated_At'];
export const PURCHASE_FOLLOWUP_HEADERS = ['GRN_No', 'Project_Number', 'Client', 'Received_Date', 'Supplier', 'Delivery_Note_No', 'Invoice_No', 'Vehicle_No', 'Line_Count', 'Site_Signed_By', 'Purchase_Email_Status', 'Purchase_Email_Recipients', 'Purchase_PO_No', 'Purchase_Review_Status', 'Invoice_Match', 'Exception_Details', 'Purchase_Remarks', 'Purchase_Updated_By', 'Purchase_Updated_At'];
export const REVIEW_STATUSES = ['Pending', 'Verified', 'Exception', 'Closed'];
export const INVOICE_MATCH = ['Pending', 'Matched', 'Mismatch'];

export async function getSitePurchaseWorkspace(s: Site, filters: any) {
  s.requireRole(['PURCHASE', 'ADMIN']);
  const project = String(filters?.projectId || '');
  const inProject = (r: Row) => !project || String(r.Project_ID) === project;
  const projects = new Map((await s.read('Projects')).map((p) => [String(p.Project_ID), p]));
  const arrivals = (await s.filter('Material_Incoming', inProject)).map((r) => {
    const o: Row = {};
    Object.keys(r).forEach((k) => { if (k !== '_row') o[k] = show(r[k]); });
    return o;
  });
  const usage = (await s.filter('Material_Ledger', (r) => inProject(r) && ['CONSUMPTION', 'CONSUMPTION CORRECTION'].includes(String(r.Transaction_Type || '').toUpperCase())))
    .map((r) => {
      const p: Row = projects.get(String(r.Project_ID || '')) || {};
      return {Usage_ID: r.Transaction_ID, Work_Date: show(r.Transaction_Date), Project_ID: r.Project_ID, Project_Number: p.Project_Number || '', Client: p.Client || '',
        DPR_ID: r.Source_ID, Material_Code: r.Material_Code, Material_Name: r.Material_Name, Variant: r.Variant, Quantity_Used: materialRound(-Number(r.Quantity_Change || 0)),
        Unit: r.Stock_Unit, Balance_After: r.Balance_After, Entry_Type: String(r.Transaction_Type || '').toUpperCase(), Remarks: r.Remarks, Recorded_By: r.Created_By, Recorded_At: show(r.Created_At)};
    });
  const wasteRows = await s.filter('Material_Wastage_Daily', (r) => inProject(r) && String(r.Status || 'COMMITTED').toUpperCase() === 'COMMITTED');
  const wastage = wasteRows.map((r): Row => ({...pick(r, PURCHASE_WASTAGE_HEADERS), Entry_Source: r.Entry_Source || 'SITE MATERIALS'}))
    .sort((a, b) => String(a.Waste_Date).localeCompare(String(b.Waste_Date)) || String(a.Project_Number).localeCompare(String(b.Project_Number), undefined, {numeric: true}));
  const balanceRows = await s.filter('Material_Balances', inProject);
  const balances = balanceRows.map((r) => pick(r, PURCHASE_BALANCE_HEADERS))
    .sort((a, b) => String(a.Project_Number).localeCompare(String(b.Project_Number), undefined, {numeric: true}) || String(a.Material_Name).localeCompare(String(b.Material_Name)));
  const wasteByKey: Record<string, number> = {};
  wasteRows.forEach((r) => {
    const key = [r.Project_ID, r.Material_Code, r.Material_Name, r.Variant, r.Stock_Unit].join('|');
    wasteByKey[key] = Number(wasteByKey[key] || 0) + Number(r.Waste_Quantity || 0);
  });
  const summary = balanceRows.map((r) => {
    const key = [r.Project_ID, r.Material_Code, r.Material_Name, r.Variant, r.Stock_Unit].join('|');
    const wasted = Number(wasteByKey[key] || 0), used = Math.max(0, Number(r.Total_Consumed || 0) - wasted), handled = used + wasted;
    return {Project_ID: r.Project_ID, Project_Number: r.Project_Number, Client: r.Client, Material_Code: r.Material_Code, Material_Name: r.Material_Name, Variant: r.Variant,
      Material_Category: r.Material_Category, Material_Subcategory: r.Material_Subcategory, Stock_Unit: r.Stock_Unit, Total_Received: materialRound(r.Total_Received),
      Total_Used: materialRound(used), Total_Wasted: materialRound(wasted), Wastage_Percent: handled > 0 ? materialRound(wasted / handled * 100) : 0,
      Current_Balance: materialRound(r.Balance_Quantity), Low_Stock_Threshold: materialRound(r.Low_Stock_Threshold), Stock_Status: r.Status, Last_Updated_At: show(r.Updated_At)};
  }).sort((a, b) => String(a.Project_Number).localeCompare(String(b.Project_Number), undefined, {numeric: true}) || String(a.Material_Name).localeCompare(String(b.Material_Name)));
  const followups = await followupRows(s, project);
  return clientSafe({
    projects: [...projects.values()].map((p) => ({projectId: String(p.Project_ID), client: String(p.Client || ''), status: String(p.Status || '')})),
    arrivals, usage, wastage, balances, summary, followups, reviewStatuses: REVIEW_STATUSES, invoiceMatch: INVOICE_MATCH,
    headers: {usage: PURCHASE_USAGE_HEADERS, balances: PURCHASE_BALANCE_HEADERS, wastage: PURCHASE_WASTAGE_HEADERS, summary: PURCHASE_SUMMARY_HEADERS, followups: PURCHASE_FOLLOWUP_HEADERS},
  });
}

async function followupRows(s: Site, project: string) {
  const saved = new Map((await s.read('GRN_Followup')).map((r) => [String(r.GRN_No), r]));
  return (await s.filter('GRN_Register', (r) => String(r.Status || '').toUpperCase() === 'COMMITTED' && (!project || String(r.Project_ID) === project)))
    .map((r) => {
      const prior: Row = saved.get(String(r.GRN_No)) || {};
      return {GRN_No: r.GRN_No, Project_Number: r.Project_Number, Client: r.Client, Received_Date: dateKey(r.Received_Date), Supplier: r.Supplier,
        Delivery_Note_No: r.Delivery_Note_No, Invoice_No: r.Invoice_No, Vehicle_No: r.Vehicle_No, Line_Count: r.Line_Count, Site_Signed_By: r.Signed_By,
        Purchase_Email_Status: r.Purchase_Notification_Status, Purchase_Email_Recipients: r.Purchase_Notification_Recipients,
        // The PO number comes from the GRN itself now (recorded against a PO, or linked by Purchase).
        Purchase_PO_No: r.PO_No || prior.Purchase_PO_No || '', PO_Link_Status: r.PO_Link_Status || '',
        Purchase_Review_Status: prior.Purchase_Review_Status || '', Invoice_Match: prior.Invoice_Match || '', Exception_Details: prior.Exception_Details || '',
        Purchase_Remarks: prior.Purchase_Remarks || '', Purchase_Updated_By: prior.Purchase_Updated_By || '', Purchase_Updated_At: show(prior.Purchase_Updated_At || '')};
    }).sort((a, b) => String(b.Received_Date).localeCompare(String(a.Received_Date)) || String(b.GRN_No).localeCompare(String(a.GRN_No)));
}

/** Purchase's review columns on the GRN follow-up list (the editable columns of the old tab). */
export async function saveGrnFollowup(s: Site, payload: any) {
  const user = s.requireRole(['PURCHASE', 'ADMIN']);
  const grn = await s.find('GRN_Register', 'GRN_No', String(payload?.grnNo || ''));
  if (!grn) throw new SiteError('GRN not found.');
  const review = String(payload.reviewStatus || '');
  const match = String(payload.invoiceMatch || '');
  if (review && !REVIEW_STATUSES.includes(review)) throw new SiteError('Review status must be Pending, Verified, Exception or Closed.');
  if (match && !INVOICE_MATCH.includes(match)) throw new SiteError('Invoice match must be Pending, Matched or Mismatch.');
  const changes = {
    GRN_No: grn.GRN_No, Purchase_PO_No: String(grn.PO_No || ''), Purchase_Review_Status: review, Invoice_Match: match,
    Exception_Details: dprText(payload.exceptionDetails, 'Exception details', 1000, false), Purchase_Remarks: dprText(payload.remarks, 'Purchase remarks', 1000, false),
    Purchase_Updated_By: user.email, Purchase_Updated_At: s.now(),
  };
  const existing = await s.find('GRN_Followup', 'GRN_No', grn.GRN_No);
  if (existing) await s.update('GRN_Followup', 'GRN_No', grn.GRN_No, changes);
  else await s.append('GRN_Followup', changes);
  await s.audit('GRN_FOLLOWUP_UPDATED', 'GRN', grn.GRN_No, '', review || 'UPDATED', {invoiceMatch: match});
  return getSitePurchaseWorkspace(s, {projectId: payload.projectId || ''});
}
