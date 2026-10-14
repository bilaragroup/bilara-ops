// Plumbing and electrical are bought against a cost budget per project (house),
// not item by item. The site sends a photo of the handwritten list, Purchase collects
// vendor quotes, BOQ picks the best one within the budget, Audit approves, then a
// single lump-sum PO line goes through the normal GRN, bill check and payment steps.
export const TRADES=['Plumbing','Electrical'] as const;
export type Trade=typeof TRADES[number];
export const QUOTE_STAGES=['Awaiting quotes','With BOQ','BOQ selected','Audit approved','Rejected','Cancelled'] as const;
export const budgetSource=(project:string,trade:string)=>`budget:${project}:${trade}`;

export const quoteList=(r:any)=>Array.isArray(r?.quotes)?r.quotes:[];
export const selectedQuote=(r:any)=>quoteList(r).find((q:any)=>q.id===r?.selection?.quoteId)||null;
export const cheapestQuote=(r:any)=>quoteList(r).reduce((m:any,q:any)=>!m||q.amount<m.amount?q:m,null);
export const orderFor=(r:any,records:any[])=>records.find(p=>p.kind==='purchase'&&p.parent===r.id&&p.status!=='Cancelled')||null;

// Money already promised from a project's trade budget: requests BOQ has picked a quote for
// (or that are approved), at the PO value once ordered.
export function committed(records:any[],project:string,trade:string,exceptId?:string){
 return records.filter(r=>r.kind==='quote'&&r.project===project&&r.trade===trade&&r.id!==exceptId&&['BOQ selected','Audit approved'].includes(r.stage))
  .reduce((n,r)=>{const po=orderFor(r,records);return n+(po?po.total:Number(selectedQuote(r)?.amount||0));},0);
}
export function budgetFor(records:any[],project:string,trade:string){return records.find(r=>r.kind==='budget'&&r.sourceId===budgetSource(project,trade))||null;}
export function remaining(records:any[],project:string,trade:string,exceptId?:string){
 const b=budgetFor(records,project,trade);return b?Number(b.amount||0)-committed(records,project,trade,exceptId):null;
}
