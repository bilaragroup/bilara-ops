import {addDays,thursday,validWindow} from './weekly';
export function cutoffFor(window:string){return addDays(window,-12)+'T09:00:00+05:30';}
export function requestPolicy(now=new Date()){
 const today=now.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 const currentThursday=thursday(today),first=addDays(currentThursday,7);
 let normal=first;
 while(new Date(cutoffFor(normal)).getTime()<=now.getTime())normal=addDays(normal,7);
 // Keep one future Thursday available as a late planned request. It is routed
 // to the General Manager; anything earlier belongs in the ad hoc flow.
 const earliestException=addDays(currentThursday,today===currentThursday?7:14);
 return {today,normal,late:[addDays(normal,-7),earliestException].sort().at(-1)!,cutoff:cutoffFor(normal)};
}
export function plannedWindowRoute(window:string,now=new Date()){
 const p=requestPolicy(now);
 if(!validWindow(window)||window<=p.today||window<p.late)return 'adhoc' as const;
 return window<p.normal?'gm' as const:'standard' as const;
}
export function requestDateIssue(kind:string,data:any,old:any,now=new Date()){
 if(!['plan','request'].includes(kind))return null;
 const p=requestPolicy(now),changed=!old||data.window!==old.window||data.due!==old.due;
 if(changed&&data.due<p.today)return 'Required delivery cannot be before today. Historical dates stay on existing records.';
 if(kind==='plan'&&(!old||data.window!==old.window)){
  if(!validWindow(data.window))return 'Select a Thursday execution week.';
  if(data.window<=p.today)return 'Planned execution must be in the future. Use an ad hoc request for an immediate requirement.';
  if(plannedWindowRoute(data.window,now)==='adhoc')return 'This execution week is too early for a planned request. Use Ad hoc requests.';
 }
 return null;
}
