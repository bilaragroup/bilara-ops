'use client';
import {useMemo,useState} from 'react';
import {has} from '@/lib/permissions';
import {indiaToday,inPeriod,recordWindow,weekLabel,type Period} from '@/lib/weekly';
import {acceptedQty,pendingQty,receipts} from '@/lib/grn';

// Site engineer (or PM / Purchase) records each delivery against its PO: GRN number,
// quantity received, how much was accepted, what was rejected. Partial deliveries are fine;
// the rest stays pending. Purchase can close a line short when the vendor will not send the rest.
const q=(n:number)=>Math.round(n*1000)/1000;

function PoCard({po,lines,user,refresh}:any){
 const open=lines.filter((p:any)=>pendingQty(p)>0);
 const [grnNo,setGrnNo]=useState(''),[date,setDate]=useState(indiaToday()),[challan,setChallan]=useState(''),[vehicle,setVehicle]=useState(''),[remarks,setRemarks]=useState('');
 const [qty,setQty]=useState<Record<string,{received:string;accepted:string;note:string}>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[shortFor,setShortFor]=useState(''),[shortReason,setShortReason]=useState('');
 const canShort=has(user,'Purchase Manager','Purchase Team');
 const set=(id:string,k:'received'|'accepted'|'note',v:string)=>setQty(x=>{const cur=x[id]||{received:'',accepted:'',note:''};const next={...cur,[k]:v};if(k==='received'&&(cur.accepted===''||cur.accepted===cur.received))next.accepted=v;return {...x,[id]:next};});
 const filled=open.filter((p:any)=>Number(qty[p.id]?.received)>0);
 async function post(body:any){setBusy(true);setError('');setMessage('');try{const r=await fetch('/api/grn',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json();if(!r.ok)throw Error(d.error);return d;}catch(e:any){setError(e?.name==='TimeoutError'?'Saving timed out. Refresh and check before retrying.':e.message);return null;}finally{setBusy(false);}}
 async function save(e:any){e.preventDefault();const d=await post({action:'receive',grnNo,date,challan,vehicle,remarks,items:filled.map((p:any)=>({id:p.id,version:p.version,received:Number(qty[p.id].received),accepted:Number(qty[p.id].accepted===''?qty[p.id].received:qty[p.id].accepted),note:qty[p.id].note}))});if(d){setMessage(`GRN ${grnNo} saved. ${d.schedules?'Payment scheduled for the accepted quantity.':'Nothing accepted, so nothing to pay.'}`);setGrnNo('');setChallan('');setVehicle('');setRemarks('');setQty({});await refresh({skipDocuments:true});}}
 async function closeShort(p:any){const d=await post({action:'shortClose',reason:shortReason,items:[{id:p.id,version:p.version}]});if(d){setMessage(`${p.item} closed at ${q(acceptedQty(p))} ${p.unit}. The rest can be ordered again or cancelled on the request.`);setShortFor('');setShortReason('');await refresh({skipDocuments:true});}}
 const first=lines[0];
 return <section className="panel grn-card">
  <div className="grn-head"><div><h3>{first.po||'PO'} · {first.vendor}</h3><small>Project {first.project} · week {weekLabel(first.window)} · expected {first.expectedDelivery||first.due||'—'}</small></div>{open.length?<span className="tag amber">{open.length} line{open.length===1?'':'s'} pending</span>:<span className="tag green">All received</span>}</div>
  <div className="plan-scroll"><table className="grn-table"><thead><tr><th>Item</th><th>Ordered</th><th>Accepted so far</th><th>Pending</th>{open.length>0&&<><th>Received now</th><th>Accepted now</th><th>Rejected</th><th>Note</th></>}</tr></thead><tbody>
   {lines.map((p:any)=>{const pend=pendingQty(p),v=qty[p.id]||{received:'',accepted:'',note:''},rej=Number(v.received||0)-Number(v.accepted===''?v.received:v.accepted||0);return <tr key={p.id}>
    <td><b>{p.item}</b>{receipts(p).map((r:any)=><small key={r.grnNo}>{r.grnNo} · {r.date} · {r.accepted} accepted{r.rejected?` · ${r.rejected} rejected`:''} · {r.by}</small>)}{p.shortClose&&<small className="neg">Closed short: {p.shortClose.reason}</small>}</td>
    <td className="nw">{p.originalQty??p.qty} {p.unit}</td><td className="nw">{q(acceptedQty(p))} {p.unit}</td><td className="nw">{pend>0?<b>{q(pend)} {p.unit}</b>:'—'}</td>
    {open.length>0&&(pend>0?<>
     <td><input className="plan-input num" type="number" min={0} step="any" aria-label={'Received now, '+p.item} value={v.received} onChange={e=>set(p.id,'received',e.target.value)}/></td>
     <td><input className="plan-input num" type="number" min={0} step="any" aria-label={'Accepted now, '+p.item} value={v.accepted} onChange={e=>set(p.id,'accepted',e.target.value)}/></td>
     <td className="nw">{rej>0?<span className="neg">{q(rej)} {p.unit}</span>:'0'}</td>
     <td><input className="plan-input" aria-label={'Note, '+p.item} placeholder="e.g. 10 bags torn" value={v.note} maxLength={500} onChange={e=>set(p.id,'note',e.target.value)}/>{canShort&&acceptedQty(p)>0&&(shortFor===p.id?<span className="short-box"><input className="plan-input" placeholder="Why the rest won't come" value={shortReason} onChange={e=>setShortReason(e.target.value)}/><button type="button" className="secondary" disabled={busy||shortReason.trim().length<3} onClick={()=>closeShort(p)}>Close at {q(acceptedQty(p))}</button></span>:<button type="button" className="textbutton" onClick={()=>{setShortFor(p.id);setShortReason('');}}>Vendor won't send the rest?</button>)}</td>
    </>:<td colSpan={4}/>)}
   </tr>;})}
  </tbody></table></div>
  {open.length>0&&<form className="grn-form" onSubmit={save}>
   <label className="field"><span>GRN number *</span><input required maxLength={60} value={grnNo} onChange={e=>setGrnNo(e.target.value)} placeholder="From the site GRN book"/></label>
   <label className="field"><span>Date received *</span><input type="date" required max={indiaToday()} value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label className="field"><span>Challan no.</span><input maxLength={60} value={challan} onChange={e=>setChallan(e.target.value)}/></label>
   <label className="field"><span>Vehicle no.</span><input maxLength={40} value={vehicle} onChange={e=>setVehicle(e.target.value)}/></label>
   <label className="field grn-remarks"><span>Remarks</span><input maxLength={1000} value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
   <button className="primary" disabled={busy||!filled.length||!grnNo.trim()}>{busy?'Saving…':`Save GRN · ${filled.length} line${filled.length===1?'':'s'}`}</button>
  </form>}
  {error&&<p className="alert red" role="alert">{error}</p>}{message&&<p className="alert green" role="status">{message}</p>}
 </section>;
}

export default function ReceiveGoods({records,project,period,refresh,user}:any){
 const [showDone,setShowDone]=useState(false);
 const groups=useMemo(()=>{
  const lines=records.filter((r:any)=>r.kind==='purchase'&&r.status!=='Cancelled'&&(project==='all'||r.project===project)&&inPeriod(recordWindow(r,records),period as Period)).map((r:any)=>({...r,window:recordWindow(r,records)}));
  const by=new Map<string,any[]>();for(const p of lines){const k=p.orderId||p.id;by.set(k,[...(by.get(k)||[]),p]);}
  return [...by.entries()].map(([k,ls])=>({k,lines:ls.sort((a,b)=>(a.orderLine||0)-(b.orderLine||0)),open:ls.some(p=>pendingQty(p)>0)})).sort((a,b)=>String(a.lines[0].expectedDelivery||a.lines[0].due).localeCompare(String(b.lines[0].expectedDelivery||b.lines[0].due)));
 },[records,project,period]);
 const open=groups.filter(g=>g.open),done=groups.filter(g=>!g.open);
 return <section className="receive-goods">
  <p className="muted">Record each delivery against its purchase order: the GRN number from site, how much arrived and how much was accepted. Payment is scheduled only for the accepted quantity.</p>
  {!open.length&&<div className="panel empty"><h3>No deliveries waiting</h3><p>Purchase orders for the selected weeks and project appear here once issued.</p></div>}
  {open.map(g=><PoCard key={g.k} po={g.k} lines={g.lines} user={user} refresh={refresh}/>)}
  {done.length>0&&<details className="panel grn-done" open={showDone} onToggle={e=>setShowDone((e.currentTarget as HTMLDetailsElement).open)}><summary>Fully received · {done.length} PO{done.length===1?'':'s'}</summary>{showDone&&done.map(g=><PoCard key={g.k} po={g.k} lines={g.lines} user={user} refresh={refresh}/>)}</details>}
 </section>;
}
