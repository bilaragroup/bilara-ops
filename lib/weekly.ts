import {dateValid,purchaseCost} from './calculations';
export function addDays(date:string,n:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function thursday(date:string){const d=new Date(date+'T00:00:00Z');return addDays(date,-((d.getUTCDay()+3)%7));}
export function indiaToday(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});}
export function planningWindow(date=indiaToday()){return addDays(thursday(date),7);}
export function validWindow(date:any){return dateValid(date)&&new Date(date+'T00:00:00Z').getUTCDay()===4;}
export const stageNames=['Submitted','BOQ priced','Vendors finalized','Audit approved'];
export function milestones(window:string){return [{date:addDays(window,-12),label:'Submission cutoff · 9 a.m. IST',owner:'Project managers'},{date:addDays(window,-6),label:'BOQ rates',owner:'Estimation / BOQ'},{date:addDays(window,-3),label:'Vendors finalized',owner:'Purchase team'},{date:addDays(window,-2),label:'Audit approval',owner:'Audit team'},{date:addDays(window,-1),label:'POs & cash forecast',owner:'Purchase / Accounts'},{date:window,label:'Execution begins',owner:'Site / Purchase'}];}
export function recordWindow(r:any,records:any[]):string|null{if(validWindow(r.window))return r.window;if(r.kind==='purchase'){const parent=records.find(x=>x.id===r.parent);return parent?recordWindow(parent,records):null;}return r.due&&dateValid(r.due)?thursday(r.due):null;}
export function weekData(records:any[],window:string|Period,project='all'){
 const inSel=(w:string|null)=>typeof window==='string'?w===window:inPeriod(w,window);
 const chosen=records.filter(r=>(project==='all'||r.project===project)&&inSel(recordWindow(r,records)));
 const requirements=chosen.filter(r=>['plan','request'].includes(r.kind));const purchases=chosen.filter(r=>r.kind==='purchase');const payments=chosen.filter(r=>r.kind==='payment');
 const projects=[...new Set(chosen.map(r=>r.project))].sort().map(project=>{const rs=requirements.filter(r=>r.project===project),bs=purchases.filter(r=>r.project===project),ps=payments.filter(r=>r.project===project);return {project,requirements:rs.length,pending:rs.filter(r=>r.stage!=='Audit approved'&&r.stage!=='Rejected').length,cash:ps.reduce((n,p)=>n+p.total-p.paid,0),paid:ps.reduce((n,p)=>n+p.paid,0),scheduled:ps.reduce((n,p)=>n+p.total,0),commitment:bs.reduce((n,p)=>n+purchaseCost(p).cash,0)};});
 return {requirements,purchases,payments,projects,total:payments.reduce((n,p)=>n+p.total-p.paid,0),paid:payments.reduce((n,p)=>n+p.paid,0)};
}

// ---- Periods: view several Thursday weeks at once ----
// Weeks stay Thursday–Wednesday; a period is a range of those weeks (open-ended when from/to is null).
export type Period={key:string;from:string|null;to:string|null};
export const PERIOD_OPTIONS:[string,string][]=[['this','This week'],['next','Next week'],['after','Week after next'],['next4','Next 4 weeks'],['upcoming','All upcoming'],['all','All weeks'],['week','Pick a week'],['range','Date range']];
export function makePeriod(key:string,today=indiaToday(),from?:string,to?:string):Period{
 const cur=thursday(today);
 switch(key){
  case 'this':return {key,from:cur,to:cur};
  case 'next':return {key,from:addDays(cur,7),to:addDays(cur,7)};
  case 'after':return {key,from:addDays(cur,14),to:addDays(cur,14)};
  case 'next4':return {key,from:cur,to:addDays(cur,21)};
  case 'upcoming':return {key,from:cur,to:null};
  case 'all':return {key,from:null,to:null};
  case 'week':{const w=thursday(from||cur);return {key,from:w,to:w};}
  case 'range':{const a=thursday(from||cur),b=thursday(to||from||cur);return {key,from:a<=b?a:b,to:a<=b?b:a};}
  default:return {key:'next4',from:cur,to:addDays(cur,21)};
 }
}
export function inPeriod(week:string|null|undefined,p:Period){return !!week&&(!p.from||week>=p.from)&&(!p.to||week<=p.to);}
export function singleWeek(p:Period){return !!p.from&&p.from===p.to?p.from:null;}
export function periodWeeks(p:Period){if(!p.from||!p.to)return null;return Math.round((Date.parse(p.to)-Date.parse(p.from))/6048e5)+1;}
const short=(d:string)=>new Date(d+'T00:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
export function weekLabel(w:string){return `${short(w)} – ${short(addDays(w,6))}`;}
export function periodLabel(p:Period){
 if(!p.from&&!p.to)return 'Every week';
 if(!p.to)return `From week of ${short(p.from!)} onward`;
 const n=periodWeeks(p)!;return `Thu ${short(p.from!)} – Wed ${short(addDays(p.to,6))} · ${n} week${n===1?'':'s'}`;
}
/** Shift a bounded period by its own length (‹ › buttons). */
export function shiftPeriod(p:Period,dir:1|-1):Period{
 if(!p.from||!p.to)return p;const n=periodWeeks(p)!*7*dir;
 return {key:p.from===p.to?'week':'range',from:addDays(p.from,n),to:addDays(p.to,n)};
}
