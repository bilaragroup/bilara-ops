import {dateValid,purchaseCost} from './calculations';
export function addDays(date:string,n:number){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function thursday(date:string){const d=new Date(date+'T00:00:00Z');return addDays(date,-((d.getUTCDay()+3)%7));}
export function indiaToday(){return new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});}
export function planningWindow(date=indiaToday()){return addDays(thursday(date),7);}
export function validWindow(date:any){return dateValid(date)&&new Date(date+'T00:00:00Z').getUTCDay()===4;}
export const stageNames=['Submitted','BOQ priced','Vendors finalized','Audit approved'];
export function milestones(window:string){return [{date:addDays(window,-12),label:'Submission cutoff · 9 a.m. IST',owner:'Project managers'},{date:addDays(window,-6),label:'BOQ rates',owner:'Estimation / BOQ'},{date:addDays(window,-3),label:'Vendors finalized',owner:'Purchase team'},{date:addDays(window,-2),label:'Audit approval',owner:'Audit team'},{date:addDays(window,-1),label:'POs & cash forecast',owner:'Purchase / Accounts'},{date:window,label:'Execution begins',owner:'Site / Purchase'}];}
export function recordWindow(r:any,records:any[]):string|null{if(validWindow(r.window))return r.window;if(r.kind==='purchase'){const parent=records.find(x=>x.id===r.parent);return parent?recordWindow(parent,records):null;}return r.due&&dateValid(r.due)?thursday(r.due):null;}
export function weekData(records:any[],window:string,project='all'){
 const chosen=records.filter(r=>(project==='all'||r.project===project)&&recordWindow(r,records)===window);
 const requirements=chosen.filter(r=>['plan','request'].includes(r.kind));const purchases=chosen.filter(r=>r.kind==='purchase');const payments=chosen.filter(r=>r.kind==='payment');
 const projects=[...new Set(chosen.map(r=>r.project))].sort().map(project=>{const rs=requirements.filter(r=>r.project===project),bs=purchases.filter(r=>r.project===project),ps=payments.filter(r=>r.project===project);return {project,requirements:rs.length,pending:rs.filter(r=>r.stage!=='Audit approved'&&r.stage!=='Rejected').length,cash:ps.reduce((n,p)=>n+p.total-p.paid,0),paid:ps.reduce((n,p)=>n+p.paid,0),scheduled:ps.reduce((n,p)=>n+p.total,0),commitment:bs.reduce((n,p)=>n+purchaseCost(p).cash,0)};});
 return {requirements,purchases,payments,projects,total:payments.reduce((n,p)=>n+p.total-p.paid,0),paid:payments.reduce((n,p)=>n+p.paid,0)};
}
