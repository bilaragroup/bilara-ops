import {protect} from '@/lib/access';
import {Actor,has,inProject,visible} from '@/lib/permissions';
import {database,decode} from '@/lib/database';
import {cents,dateValid} from '@/lib/calculations';
import {indiaToday} from '@/lib/weekly';
import {acceptedQty,acceptedValue,billIssues,billStatus,billedQty,bills} from '@/lib/grn';

// The vendor's bill, checked line by line against the PO and the GRN.
//  action 'add' (Accounts or Purchase): bill number, date, quantity, rate, amount for one PO line.
//    The app compares billed quantity with the accepted quantity, the bill rate with the PO rate
//    and the billed amount with the accepted value. Matched bills can be paid; a mismatch blocks
//    payment of that line's GRN schedules.
//  action 'approve' (GM, Audit or Super Admin): accept a mismatched bill with a reason.
const fail=(error:string,status=400)=>Response.json({error},{status});
const SYSTEM=['id','kind','parent','sourceId','version','total','paid','updated'];

async function handlePOST(req:Request,a:Actor){try{
 const b=JSON.parse(await req.text()),db=database(),now=new Date().toISOString();
 const raw=await db.prepare('SELECT * FROM records WHERE id=?').bind(String(b.id||'')).first<any>();if(!raw)return fail('PO line not found.',404);
 const p=decode(raw);if(p.kind!=='purchase')return fail('Choose a PO line.');
 if(p.version!==Number(b.version))return fail('This line changed. Refresh and try again.',409);
 if(!visible(a,p)||!inProject(a,p.project))return fail('This PO is outside your projects.',403);
 const data=JSON.parse(raw.data);for(const k of SYSTEM)delete data[k];
 let action='Bill checked';
 if(String(b.action||'add')==='approve'){
  if(!has(a,'GM','Audit'))return fail('Only the GM or Audit can accept a bill that does not match.',403);
  const reason=String(b.reason||'').trim();if(reason.length<3||reason.length>1000)return fail('Give the reason this bill is accepted.');
  if(billStatus(p)!=='Mismatch')return fail('Only a mismatched bill needs approval.');
  data.billApproval={billsCount:bills(p).length,issues:billIssues(p),reason,by:a.name,email:a.email,at:now};action='Bill mismatch approved';
 }else{
  if(!has(a,'Accounts','Purchase Manager','Purchase Team'))return fail('Accounts or Purchase enter the vendor bill.',403);
  if(!(acceptedQty(p)>0))return fail(`${p.item}: record the GRN before checking the bill.`);
  const billNo=String(b.billNo||'').trim(),billDate=String(b.billDate||''),qty=Number(b.qty),rate=Number(b.rate),amount=cents(Number(b.amount));
  if(!billNo||billNo.length>60)return fail('Enter the bill number.');
  if(!dateValid(billDate)||billDate>indiaToday())return fail('Enter the bill date (not in the future).');
  if(!(qty>0)||!(rate>=0)||!(amount>0))return fail('Enter the billed quantity, rate and total amount.');
  const dup=(await db.prepare("SELECT data FROM records WHERE kind='purchase'").all()).results.some((r:any)=>{const d=JSON.parse(r.data);return String(d.vendor||'').trim().toLowerCase()===String(p.vendor).trim().toLowerCase()&&(d.bills||[]).some((x:any)=>String(x.billNo).trim().toLowerCase()===billNo.toLowerCase());});
  if(dup)return fail(`Bill ${billNo} from ${p.vendor} is already entered.`,409);
  // A bill covers goods already received. Once every accepted unit is billed, a new bill only comes with the next delivery.
  if(billedQty(p)>=acceptedQty(p)-0.0000001)return fail(`Everything received on ${p.po||'this PO'} is already billed. Record the next GRN before adding another bill.`);
  const bill:any={billNo,billDate,qty,rate,amount,documentId:String(b.documentId||'')||undefined,by:a.name,email:a.email,at:now};
  data.bills=[...bills(p),bill];
  const after={...p,bills:data.bills,billApproval:undefined};
  bill.result=billIssues(after).length?'Mismatch':'Matched';
  delete data.billApproval; // a new bill needs its own decision
 }
 const next={...p,...data},status=billStatus(next);
 data.billStatus=status;data.billSummary={acceptedQty:acceptedQty(next),acceptedValue:acceptedValue(next),issues:billIssues(next)};
 const result=await db.batch([
  db.prepare('INSERT INTO history (id,record_id,action,data,at) SELECT ?,id,?,?,? FROM records WHERE id=? AND version=?').bind(crypto.randomUUID(),action,JSON.stringify({status,by:a.name,bill:data.bills?.at(-1),approval:data.billApproval}),now,p.id,p.version),
  db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND version=?').bind(JSON.stringify(data),now,p.id,p.version)]);
 if(!result[1].meta.changes)return fail('This line changed. Refresh and try again.',409);
 return Response.json({ok:true,status,issues:data.billSummary.issues});
}catch{return fail('Unable to save the bill. Refresh and try again.');}}

export async function POST(req:Request){return protect(req,'bills',handlePOST);}
