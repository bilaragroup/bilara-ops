'use client';
import {useMemo,useState} from 'react';
import {has} from '@/lib/permissions';
import {money} from '@/lib/calculations';
import {indiaToday} from '@/lib/weekly';
import {acceptedQty,acceptedValue,billIssues,billStatus,billedAmount,billedQty,bills} from '@/lib/grn';

// Accounts (or Purchase) enters each vendor bill against the PO line it charges for.
// The app compares it with what was ordered and accepted at site; only a matched bill
// (or one the GM / Audit approved) can be paid.
const tone:Record<string,string>={'Not checked':'amber',Mismatch:'red',Matched:'green',Approved:'green'};
const q=(n:number)=>Math.round(n*1000)/1000;

function Row({p,user,refresh}:any){
 const st=billStatus(p),acc=acceptedQty(p),left=Math.max(0,q(acc-billedQty(p)));
 const [open,setOpen]=useState(false),[f,setF]=useState({billNo:'',billDate:indiaToday(),qty:String(left||''),rate:String(p.rate),amount:((acceptedValue(p)-billedAmount(p))/100).toFixed(2)});
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<any>(null);
 const canEnter=has(user,'Accounts','Purchase Manager','Purchase Team'),canApprove=has(user,'GM','Audit');
 async function post(body:any){setBusy(true);setError('');try{const r=await fetch('/api/bill-check',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,version:p.version,...body})});const d:any=await r.json();if(!r.ok)throw Error(d.error);setResult(d);setOpen(false);await refresh({skipDocuments:true});}catch(e:any){setError(e.message);}finally{setBusy(false);}}
 const issues=billIssues(p);
 return <div className="bill-row">
  <div className="bill-main">
   <div><b>{p.item}</b><small>{p.po} · {p.vendor} · Project {p.project}</small></div>
   <div className="nw"><small>Accepted at site</small>{q(acc)} {p.unit} · {money(acceptedValue(p))}</div>
   <div className="nw"><small>Billed</small>{bills(p).length?`${q(billedQty(p))} ${p.unit} · ${money(billedAmount(p))}`:'—'}</div>
   <div><span className={'tag '+tone[st]}>{st==='Approved'?'Approved by '+(p.billApproval?.by||'GM/Audit'):st}</span></div>
   <div className="bill-actions">{canEnter&&<button className="secondary" onClick={()=>setOpen(!open)}>{bills(p).length?'Add bill':'Enter bill'}</button>}</div>
  </div>
  {bills(p).map((b:any)=><small key={b.billNo} className="bill-line">Bill {b.billNo} · {b.billDate} · {b.qty} {p.unit} @ ₹{b.rate} · {money(b.amount)} · {b.by}</small>)}
  {st==='Mismatch'&&<ul className="bill-issues">{issues.map((i:string)=><li key={i}>{i}</li>)}</ul>}
  {st==='Mismatch'&&canApprove&&<div className="bill-approve"><input className="plan-input" placeholder="Why this bill is accepted (e.g. extra unloading agreed)" value={reason} onChange={e=>setReason(e.target.value)}/><button className="secondary" disabled={busy||reason.trim().length<3} onClick={()=>post({action:'approve',reason})}>Approve bill</button></div>}
  {open&&<form className="bill-form" onSubmit={e=>{e.preventDefault();post({action:'add',...f,qty:Number(f.qty),rate:Number(f.rate),amount:Number(f.amount)});}}>
   <label className="field"><span>Bill number *</span><input required maxLength={60} value={f.billNo} onChange={e=>setF({...f,billNo:e.target.value})}/></label>
   <label className="field"><span>Bill date *</span><input type="date" required max={indiaToday()} value={f.billDate} onChange={e=>setF({...f,billDate:e.target.value})}/></label>
   <label className="field"><span>Quantity billed ({p.unit}) *</span><input type="number" required min={0} step="any" value={f.qty} onChange={e=>setF({...f,qty:e.target.value})}/></label>
   <label className="field"><span>Rate on bill (₹) *</span><input type="number" required min={0} step="0.01" value={f.rate} onChange={e=>setF({...f,rate:e.target.value})}/></label>
   <label className="field"><span>Bill total incl. tax (₹) *</span><input type="number" required min={0} step="0.01" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})}/></label>
   <button className="primary" disabled={busy}>{busy?'Checking…':'Check and save'}</button>
  </form>}
  {result&&<p className={'alert '+(result.status==='Matched'||result.status==='Approved'?'green':'red')} role="status">{result.status==='Matched'?'Bill matches the PO and GRN. It can be paid.':result.status==='Approved'?'Bill approved. It can be paid.':'Bill does not match: '+result.issues.join(' ')}</p>}
  {error&&<p className="alert red" role="alert">{error}</p>}
 </div>;
}

export default function BillCheck({records,project,user,refresh}:any){
 const [showAll,setShowAll]=useState(false);
 const lines=useMemo(()=>records.filter((r:any)=>r.kind==='purchase'&&acceptedQty(r)>0&&(project==='all'||r.project===project)),[records,project]);
 const todo=lines.filter((p:any)=>!['Matched','Approved'].includes(billStatus(p))),done=lines.filter((p:any)=>['Matched','Approved'].includes(billStatus(p)));
 if(!lines.length)return null;
 return <section className="panel bill-check">
  <div className="tablebar"><div><h2>Bills to check <span className={'tag '+(todo.length?'amber':'green')}>{todo.length}</span></h2><p>Each bill is compared with the PO rate and the quantity accepted at site. Payment for goods received opens only when its bill matches, or the GM / Audit approves it.</p></div>{done.length>0&&<button className="secondary" onClick={()=>setShowAll(!showAll)}>{showAll?'Hide checked':'Show checked ('+done.length+')'}</button>}</div>
  {todo.map((p:any)=><Row key={p.id} p={p} user={user} refresh={refresh}/>)}
  {!todo.length&&<p className="muted bill-empty">All bills for goods received are checked.</p>}
  {showAll&&done.map((p:any)=><Row key={p.id} p={p} user={user} refresh={refresh}/>)}
 </section>;
}
