import {dateValid} from './calculations';
import {indiaToday} from './weekly';
export function closureChecks(r:any,records:any[],documents:any[]){
 const buys=records.filter(p=>p.kind==='purchase'&&p.parent===r.id&&p.status!=='Cancelled');
 const quantity=Number(r.boqQty||r.qty||r.demandQty||0),ordered=buys.reduce((n,p)=>n+Number(p.qty),0);
 const issues:string[]=[];
 if(r.stage!=='Audit approved')issues.push('Request must be audit approved.');
 if(Math.abs(quantity-ordered-Number(r.cancellation?.qty||0))>0.000001)issues.push('Receive all required quantities or approve cancellation of the unordered balance.');
 for(const p of buys){
  if(p.status!=='Delivered'||!dateValid(p.delivery)||p.delivery>indiaToday()||!p.grn)issues.push(p.item+': delivery and GRN are incomplete.');
  if(!documents.some(d=>d.type==='Final bill'&&d.project===r.project&&String(d.vendor).trim().toLowerCase()===String(p.vendor).trim().toLowerCase()&&d.recordIds?.includes(p.id)))issues.push(p.item+': attach the vendor final bill.');
  const payments=records.filter(s=>s.kind==='payment'&&s.parent===p.id);
  if(payments.reduce((n,s)=>n+s.total,0)!==p.total||payments.reduce((n,s)=>n+s.paid,0)!==p.total)issues.push(p.item+': settle the full PO value, including later instalments.');
 }
 return [...new Set(issues)];
}
