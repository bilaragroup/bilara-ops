import {cents} from './calculations';

// Purchase plan arithmetic shared by the Purchase Plan screen, the Audit
// review screen and the audit decision endpoint. Money is returned in paise.

const positive=(v:any)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:null;};
const round2=(n:number)=>Math.round(n*100)/100;

/** Approved quantity the purchase plan prices: BOQ quantity for planned requests, request quantity for ad hoc. */
export function planQty(r:any){return positive(r.kind==='plan'?r.boqQty:r.qty)??0;}

/** Confidential BOQ (estimate) unit rate. Only Super Admin, GM, BOQ Team and Audit receive boqOriginalRate. */
export function boqUnitRate(r:any){return positive(r.boqOriginalRate)??positive(r.kind==='plan'?r.boqRate:r.estimateRate);}

/** Purchasing target unit rate (normally 5% below BOQ). This is what the purchase team sees. */
export function targetUnitRate(r:any){
 const original=positive(r.boqOriginalRate),reduction=Number(r.targetDiscountPercent);
 if(original&&Number.isFinite(reduction))return round2(original*(1-reduction/100));
 return positive(r.kind==='plan'?r.boqRate:r.estimateRate);
}

export type LineSaving={qty:number;vendorRate:number|null;boqRate:number|null;targetRate:number|null;vendorValue:number|null;boqValue:number|null;targetValue:number|null;savingVsBoq:number|null;savingVsTarget:number|null;aboveBoq:boolean;aboveTarget:boolean;missingRate:boolean};

export function lineSaving(r:any):LineSaving{
 const qty=planQty(r),vendorRate=positive(r.quoteRate),boqRate=boqUnitRate(r),targetRate=targetUnitRate(r);
 const vendorValue=vendorRate===null?null:cents(qty*vendorRate),boqValue=boqRate===null?null:cents(qty*boqRate),targetValue=targetRate===null?null:cents(qty*targetRate);
 return {qty,vendorRate,boqRate,targetRate,vendorValue,boqValue,targetValue,
  savingVsBoq:vendorValue===null||boqValue===null?null:boqValue-vendorValue,
  savingVsTarget:vendorValue===null||targetValue===null?null:targetValue-vendorValue,
  aboveBoq:vendorRate!==null&&boqRate!==null&&vendorRate>boqRate,
  aboveTarget:vendorRate!==null&&targetRate!==null&&vendorRate>targetRate,
  missingRate:vendorRate===null};
}

/** Totals over a set of lines. Lines without a vendor rate or BOQ rate are counted, not guessed. */
export function planTotals(rows:any[]){
 let vendor=0,boq=0,target=0,savingVsBoq=0,savingVsTarget=0,aboveBoq=0,aboveTarget=0,missing=0,unpriced=0;
 for(const r of rows){const s=lineSaving(r);if(s.missingRate){missing++;continue;}
  vendor+=s.vendorValue!;if(s.boqValue===null)unpriced++;else{boq+=s.boqValue;savingVsBoq+=s.savingVsBoq!;}
  if(s.targetValue!==null){target+=s.targetValue;savingVsTarget+=s.savingVsTarget!;}
  if(s.aboveBoq)aboveBoq++;if(s.aboveTarget)aboveTarget++;}
 return {lines:rows.length,vendor,boq,target,savingVsBoq,savingVsTarget,savingPercent:boq>0?Math.round(savingVsBoq/boq*10000)/100:null,aboveBoq,aboveTarget,missing,unpriced};
}
