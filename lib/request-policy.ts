import {addDays,thursday,validWindow} from './weekly';
import {dateValid} from './calculations';
/** A planned request needs this many days between sending it and the required delivery date. */
export const PLAN_LEAD_DAYS=14;
export function cutoffFor(window:string){return addDays(window,-12)+'T09:00:00+05:30';}
/**
 * Planned requests: the required delivery date may be any day of the week, as long as it is
 * at least 14 days after the request is sent. Anything sooner is an ad hoc request.
 * The execution week is the Thursday–Wednesday week that contains the delivery date.
 * earliest = first allowed delivery date; late = the week holding it; normal = first full week.
 */
export function requestPolicy(now=new Date()){
 const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 const earliest=addDays(today,PLAN_LEAD_DAYS),late=thursday(earliest);
 const normal=late===earliest?late:addDays(late,7);
 return {today,earliest,normal,late,cutoff:cutoffFor(normal)};
}
/** Week a planned request belongs to: the Thursday on or before its delivery date. */
export function planWindowFor(due:string){return thursday(due);}
export function plannedDueRoute(due:string,now=new Date()){
 return dateValid(due)&&due>=requestPolicy(now).earliest?'standard' as const:'adhoc' as const;
}
/** 'adhoc' when no day of the week is 14+ days away. ('gm' is kept for older callers; it is never returned now.) */
export function plannedWindowRoute(window:string,now=new Date()):'adhoc'|'gm'|'standard'{
 if(!validWindow(window))return 'adhoc';
 return addDays(window,6)<requestPolicy(now).earliest?'adhoc':'standard';
}
export function requestDateIssue(kind:string,data:any,old:any,now=new Date()){
 if(!['plan','request'].includes(kind))return null;
 const p=requestPolicy(now),dueChanged=!old||data.due!==old.due,changed=dueChanged||data.window!==old.window;
 if(changed&&data.due<p.today)return 'Required delivery cannot be before today. Historical dates stay on existing records.';
 if(kind==='plan'&&dueChanged&&data.due<p.earliest)return `A planned request needs at least ${PLAN_LEAD_DAYS} days: choose a delivery date on or after ${p.earliest}. Anything sooner is an ad hoc request.`;
 if(kind==='plan'&&(!old||data.window!==old.window)&&!validWindow(data.window))return 'Select a Thursday execution week.';
 return null;
}
