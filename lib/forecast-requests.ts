import {cents} from './calculations';
import {recordWindow} from './weekly';
export function forecastRequests(records:any[],window:string,project='all'){
 return records.filter(r=>['plan','request'].includes(r.kind)&&r.stage!=='Rejected'&&r.closure?.state!=='Closed'&&recordWindow(r,records)===window&&(project==='all'||r.project===project)).map(r=>{
  const purchases=records.filter(p=>p.kind==='purchase'&&p.parent===r.id&&p.status!=='Cancelled');
  const unscheduled=purchases.map(p=>({...p,remaining:p.total-records.filter(s=>s.kind==='payment'&&s.parent===p.id).reduce((n,s)=>n+s.total,0)})).filter(p=>p.remaining>0);
  const quantity=Number(r.boqQty||r.qty||r.demandQty||0);
  const remainingQty=Math.max(0,quantity-Number(r.cancellation?.qty||0)-purchases.reduce((n,p)=>n+Number(p.qty),0));
  const rate=r.quoteRate!==''&&r.quoteRate!=null?r.quoteRate:r.kind==='request'?r.estimateRate:r.boqRate;
  const estimate=rate!==''&&rate!=null&&Number.isFinite(Number(rate))?cents(remainingQty*Number(rate)):null;
  return {request:r,unscheduled,remainingQty,estimate};
 }).filter(r=>r.remainingQty>0||r.unscheduled.length);
}
