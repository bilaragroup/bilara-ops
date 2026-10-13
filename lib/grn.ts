import {purchaseCost} from './calculations';

// Goods received (GRN), payment on accepted quantity, and the bill check.
// Money is in paise. Quantities are the PO line's unit.

export const BILL_OK=['Matched','Approved'];
const EPS=1e-9;

export function receipts(p:any):any[]{return Array.isArray(p?.receipts)?p.receipts:[];}
export function acceptedQty(p:any){return receipts(p).reduce((n,r)=>n+Number(r.accepted||0),0);}
export function receivedQty(p:any){return receipts(p).reduce((n,r)=>n+Number(r.received||0),0);}
export function rejectedQty(p:any){return receipts(p).reduce((n,r)=>n+Number(r.rejected||0),0);}
/** Quantity still expected from the vendor. */
export function pendingQty(p:any){return p?.shortClose?0:Math.max(0,Number(p?.qty||0)-acceptedQty(p));}

/** Ordered line value (paise) as the PO states it, before any short close. */
export function orderedValue(p:any){return Number.isFinite(Number(p?.orderedTotal))?Number(p.orderedTotal):purchaseCost(p).cash;}
/** Value of a quantity of this line: line value × qty / ordered qty, rounded once from the cumulative figure. */
export function valueOf(p:any,qty:number){const ordered=Number(p?.originalQty||p?.qty||0);if(!(ordered>0))return 0;return Math.round(orderedValue(p)*Math.min(qty,ordered)/ordered);}
export function acceptedValue(p:any){return valueOf(p,acceptedQty(p));}

export function bills(p:any):any[]{return Array.isArray(p?.bills)?p.bills:[];}
export function billedQty(p:any){return bills(p).reduce((n,b)=>n+Number(b.qty||0),0);}
export function billedAmount(p:any){return bills(p).reduce((n,b)=>n+Number(b.amount||0),0);}

/** Compare everything billed so far with what was ordered and accepted. Amounts in paise. */
export function billIssues(p:any){
 const issues:string[]=[];const acc=acceptedQty(p),bq=billedQty(p),ba=billedAmount(p),av=acceptedValue(p),rate=Number(p.rate);
 if(bq>acc+EPS)issues.push(`Billed quantity ${round(bq)} ${p.unit} is more than the ${round(acc)} ${p.unit} accepted at site.`);
 for(const b of bills(p))if(Number(b.rate)>rate+0.005)issues.push(`Bill ${b.billNo}: rate ₹${b.rate} is above the PO rate ₹${rate}.`);
 if(ba>av+100)issues.push(`Billed amount ₹${(ba/100).toFixed(2)} is more than the accepted value ₹${(av/100).toFixed(2)}.`);
 return issues;
}
export function billStatus(p:any){if(!bills(p).length)return 'Not checked';if(p.billApproval?.billsCount===bills(p).length)return 'Approved';return billIssues(p).length?'Mismatch':'Matched';}

const round=(n:number)=>Math.round(n*1000)/1000;

/**
 * Can this payment schedule be paid now? GRN-based schedules need a matched (or approved) bill,
 * and the total paid on the line's GRN schedules may not exceed what was billed.
 */
export function paymentBlock(schedule:any,records:any[],value:number){
 if(schedule?.basis!=='GRN')return null;
 const p=records.find(r=>r.id===schedule.parent);if(!p)return null;
 const status=billStatus(p);
 if(!BILL_OK.includes(status))return `${p.item}: ${status==='Mismatch'?'the vendor bill does not match the PO and GRN; GM or Audit must approve it':'check the vendor bill against the PO and GRN'} before paying.`;
 const paidGrn=records.filter(r=>r.kind==='payment'&&r.parent===p.id&&r.basis==='GRN').reduce((n,r)=>n+Number(r.paid||0),0);
 if(paidGrn+Number(p.advanceApplied||0)+value>billedAmount(p)+100)return `${p.item}: payment would exceed the billed amount ₹${(billedAmount(p)/100).toFixed(2)}.`;
 return null;
}
