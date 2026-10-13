import {recordWindow} from './weekly';
export function orderGroups(records:any[]){
 const groups=new Map<string,any[]>();
 for(const r of records.filter(r=>r.kind==='purchase')){const key=r.orderId||r.id;groups.set(key,[...(groups.get(key)||[]),r]);}
 return [...groups].map(([id,items])=>({id,items,first:items[0],total:items.reduce((n,r)=>n+r.total,0)}));
}
export function linkedPlanItems(records:any[],project:string,window:string){
 return records.filter(r=>['plan','request'].includes(r.kind)&&r.project===project&&recordWindow(r,records)===window).map(r=>{
  const purchases=records.filter(p=>p.kind==='purchase'&&p.parent===r.id);
  const payments=records.filter(p=>p.kind==='payment'&&purchases.some(b=>b.id===p.parent));
  return {...r,purchases,payments,ordered:purchases.filter(p=>p.status!=='Cancelled').reduce((n,p)=>n+Number(p.qty),0),committed:purchases.reduce((n,p)=>n+p.total,0),paid:payments.reduce((n,p)=>n+p.paid,0)};
 });
}
