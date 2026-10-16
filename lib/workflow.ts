import {requestDateIssue,plannedWindowRoute,cutoffFor} from './request-policy';
import {dateValid,validProject} from './calculations';
import {validWindow,addDays,indiaToday,stageNames} from './weekly';
export function validateWorkflow(kind:string,data:any,old:any,parent?:any){
 if(kind==='purchase'){
  if(!Number.isInteger(Number(data.creditDays))||Number(data.creditDays)<0||Number(data.creditDays)>365)return 'Enter PO credit days from 0 to 365.';data.creditDays=Number(data.creditDays);
  if(!['GROUP','BUILDERS'].includes(parent?.entity||'GROUP'))return 'Choose Group or Builders on the request before purchasing.';
  if(data.delivery&&(!dateValid(data.delivery)||data.delivery>indiaToday()))return 'Actual delivery date must be valid and no later than today.';
  if(parent?.closure?.state==='Closed')return 'Reopen the closed request before ordering.';
  if(parent?.cancellation?.qty&&(!old||Number(data.qty)>Number(old.qty)))return 'The unordered balance was cancelled. Submit a new request for additional purchases.';
  if(parent?.gmApproval&&parent.gmApproval.state!=='Approved')return 'General Manager approval is required before purchasing.';
  if(parent?.stage!=='Audit approved')return 'Complete BOQ pricing, vendor finalization and audit approval before creating a PO.';
  data.window=parent.window;
  data.originalDelivery=old?.originalDelivery||parent.due;data.expectedDelivery=old?.expectedDelivery||parent.due;
  if(data.vendor&&data.vendor!==parent.vendor)return 'The PO vendor must match the audited vendor. Raise a revised requirement to change it.';
  data.vendor=parent.vendor;
  if(Number(data.rate)!==Number(parent.quoteRate)&&!String(data.exceptionReason||'').trim())return 'Record a reason for the difference between actual and audited unit rates.';
  if(data.qty>(parent.boqQty||parent.qty))return 'PO quantity exceeds the audited requirement. Raise an ad hoc request for the extra quantity.';
  if(!validWindow(data.window))return 'The requirement needs a Thursday execution window.';
  if(!old){data.poDate=indiaToday();if(data.poDate!==addDays(data.window,-1)&&!String(data.exceptionReason||'').trim())return 'POs are normally created on Wednesday before execution. Enter a reason for early or late creation.';}
  else data.poDate=old.poDate;
  if(data.actualPurchaseDate&&(!dateValid(data.actualPurchaseDate)||data.actualPurchaseDate>indiaToday()))return 'Actual purchase date must be a valid date no later than today.';
  return null;
 }
 if(!['plan','request','payment'].includes(kind))return null;
 if(!validWindow(data.window))return 'Execution window must start on a Thursday.';
 if(!dateValid(data.due)||data.due<data.window||data.due>addDays(data.window,6))return 'The planned date must fall within the selected Thursday–Wednesday window. Actual dates are recorded separately.';
 if(kind==='payment')return null;
 const dateIssue=requestDateIssue(kind,data,old);if(dateIssue)return dateIssue;
 if(kind==='plan'&&(!old||data.window!==old.window)&&plannedWindowRoute(data.window)==='gm'){const reasons=[...new Set([...(data.gmApproval?.reasons||[]),'Late planned request'])];data.gmApproval={...(data.gmApproval||{}),state:'Pending',reasons,window:data.window,cutoff:cutoffFor(data.window)};}
 if(data.gmApproval&&data.gmApproval.state!=='Approved'&&!['Submitted','Rejected'].includes(data.stage||'Submitted'))return 'Record General Manager approval before progressing this request.';
 data.stage=data.stage||'Submitted';
 if(kind==='plan'){data.demandQty=Number(data.boqQty||data.demandQty);if(!Number.isFinite(data.demandQty)||data.demandQty<=0)return 'Enter the PM requested quantity.';}
 const previous=old?.stage||'Submitted';
 if(!old&&data.stage!=='Submitted')return 'New requirements start at PM submission.';
 if(![...stageNames,'Rejected'].includes(data.stage))return 'Invalid workflow stage.';
 if(old&&previous!==data.stage&&data.stage!=='Rejected'&&stageNames.indexOf(data.stage)!==stageNames.indexOf(previous)+1&&!(previous==='Submitted'&&data.stage==='Vendors finalized'))return 'Complete the workflow one stage at a time.';
 if(old&&previous==='Audit approved'&&(data.entity||'GROUP')!==(old.entity||'GROUP'))return 'The audited purchasing entity is frozen. Submit a new request for a different entity.';
 if(old&&kind==='request'&&['BOQ priced','Vendors finalized','Audit approved'].includes(previous)&&['qty','estimateRate'].some(k=>Number(data[k])!==Number(old[k])))return 'The priced ad hoc quantity and BOQ rate are frozen.';
 if(old&&previous==='Rejected')return 'Rejected requirements are preserved. Submit a new requirement.';
 if(old&&previous==='Cancelled')return 'Cancelled requests are preserved. Submit a new requirement.';
 if(old&&['BOQ priced','Vendors finalized','Audit approved'].includes(previous)&&['boqQty','boqRate','unit','project','item','milestone','activity','activityName','activityBoqQty','window'].some(k=>String(data[k]??'')!==String(old[k]??'')))return 'The priced BOQ baseline and execution window are frozen. Submit a new change request.';
 if(old&&previous==='Audit approved'&&['qty','demandQty','quoteRate','vendor','stage'].some(k=>String(data[k]??'')!==String(old[k]??'')))return 'Audited commercial terms are frozen. Submit a new change request.';
 if(['BOQ priced','Vendors finalized','Audit approved'].includes(data.stage)){
  for(const field of kind==='plan'?['boqQty','boqRate']:['qty','estimateRate']){if(data[field]===''||data[field]===null||!Number.isFinite(Number(data[field]))||Number(data[field])<0)return 'Enter numeric BOQ quantities and rates before completing pricing.';data[field]=Number(data[field]);}
  if(Number(kind==='plan'?data.boqQty:data.qty)<=0)return 'BOQ / request quantity must be greater than zero.';
  if(!String(data.boqOwner||'').trim())return 'Enter the BOQ preparer name.';
 }
 if(['Vendors finalized','Audit approved'].includes(data.stage)){
  if(!data.entityConfirmed)return 'Purchase team must confirm Group or Builders before sending for approval.';
  if(!String(data.vendor||'').trim()||data.quoteRate===''||!Number.isFinite(Number(data.quoteRate))||Number(data.quoteRate)<0||!String(data.quoteReference||'').trim())return 'Enter the selected vendor, quoted unit rate and quotation reference.';
  data.quoteRate=Number(data.quoteRate);
 }
 if(['Audit approved','Rejected'].includes(data.stage)&&(!String(data.auditOwner||'').trim()||!String(data.reviewNote||'').trim()))return 'Enter the auditor name and decision note.';
 data.submittedAt=old?.submittedAt||new Date().toISOString();
 data.stageDates={...(old?.stageDates||{}),...(old?.stage!==data.stage?{[data.stage]:new Date().toISOString()}: {})};
 if(kind==='request')data.status=data.stage==='Audit approved'?'Approved':data.stage==='Rejected'?'Rejected':'Pending';
 if(!validProject(data.project))return 'Project number must be from 100 to 999.';
 return null;
}
