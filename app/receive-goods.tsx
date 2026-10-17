'use client';
import {useEffect,useMemo,useState} from 'react';
import {has} from '@/lib/permissions';
import {inPeriod,recordWindow,weekLabel,type Period} from '@/lib/weekly';
import {acceptedQty,pendingQty,receipts} from '@/lib/grn';
import {siteCall,requestId,istToday,fmt} from '@/lib/site-client';
import {steelKg} from './site-stock';

// Receive goods (GRN), joined with the QC app's site GRN (decisions 3 and 5, 15 Oct 2026):
//  - The site records each delivery against its purchase order: how much arrived, how much was
//    accepted, the vehicle, and signs it. The GRN number is generated (GRN-<project>-<sequence>);
//    the paper GRN book number can be kept as a reference. Saving also puts the accepted goods
//    into site stock and schedules payment for the accepted quantity only.
//  - Goods that arrive without a PO can still be received. They go into stock, but nothing is
//    paid until Purchase links the GRN to a PO here.
//  - Purchase can close a line short when the vendor will not send the rest.
const q=(n:number)=>Math.round(n*1000)/1000;
const LORRY=['AGGREGATE','M_SAND','P_SAND'];
const UNIT_ALIASES:Record<string,string>={bag:'bags',bags:'bags',no:'nos',nos:'nos','no.':'nos',number:'nos',numbers:'nos',pcs:'nos',piece:'pieces',pieces:'pieces',cft:'cft',kg:'kg',kgs:'kg',t:'tonnes',ton:'tonnes',tons:'tonnes',tonne:'tonnes',tonnes:'tonnes',mt:'tonnes',set:'sets',sets:'sets',sheet:'sheets',sheets:'sheets'};
const nu=(u:any)=>{const k=String(u||'').trim().toLowerCase();return UNIT_ALIASES[k]||k;};
/** Same as the server's unitFactor: can the PO unit be turned into the stock unit? */
function unitFactor(po:any,stock:any){const a=nu(po),b=nu(stock);if(a&&a===b)return 1;if(a==='tonnes'&&b==='kg')return 1000;if(a==='kg'&&b==='tonnes')return .001;return null;}

/** Steel by bundles and sand/aggregate by lorry, the QC app's site measurements. */
function Measure({m,v,set}:any){
 if(!m)return null;
 if(m.code==='STEEL')return <>
  <label className="field"><span>Diameter *</span><select required value={v.variant||''} onChange={e=>set({variant:e.target.value})}><option value="">Select…</option>{(m.variants||[]).map((x:string)=><option key={x}>{x}</option>)}</select></label>
  <label className="field"><span>Counted by</span><select value={v.inputUnit||'KG'} onChange={e=>set({inputUnit:e.target.value})}><option value="KG">Weight (kg)</option><option value="BUNDLES">Bundles and bars</option></select></label>
  {v.inputUnit==='BUNDLES'&&<>
   <label className="field"><span>Full bundles</span><input type="number" min={0} step={1} value={v.fullBundles||''} onChange={e=>set({fullBundles:e.target.value})}/></label>
   <label className="field"><span>Bars per bundle</span><input type="number" min={0} step={1} value={v.barsPerBundle||''} onChange={e=>set({barsPerBundle:e.target.value})}/></label>
   <label className="field"><span>Loose bars</span><input type="number" min={0} step={1} value={v.looseBars||''} onChange={e=>set({looseBars:e.target.value})}/></label>
   <label className="field"><span>Bar length *</span><input required type="number" min={0} step="any" value={v.barLength||''} onChange={e=>set({barLength:e.target.value})}/></label>
   <label className="field"><span>Length unit</span><select value={v.barLengthUnit||'M'} onChange={e=>set({barLengthUnit:e.target.value})}><option value="M">metres</option><option value="FT">feet</option></select></label>
   <p className="muted">{steelKg({...v,barLengthUnit:v.barLengthUnit||'M'})}</p>
  </>}
 </>;
 if(LORRY.includes(m.code)){
  const unit=v.dimensionUnit||'FT',r=String(v.depthReadings||'').split(/[,\s]+/).map(Number).filter(n=>n>0),k=unit==='M'?3.2808399:1;
  const cft=Number(v.lorryLength)>0&&Number(v.lorryWidth)>0&&r.length>=2?Number(v.lorryLength)*k*Number(v.lorryWidth)*k*(r.reduce((a,b)=>a+b,0)/r.length)*k:0;
  return <>
   <label className="field"><span>Lorry measured in</span><select value={unit} onChange={e=>set({dimensionUnit:e.target.value})}><option value="FT">feet</option><option value="M">metres</option></select></label>
   <label className="field"><span>Lorry length *</span><input required type="number" min={0} step="any" value={v.lorryLength||''} onChange={e=>set({lorryLength:e.target.value})}/></label>
   <label className="field"><span>Lorry width *</span><input required type="number" min={0} step="any" value={v.lorryWidth||''} onChange={e=>set({lorryWidth:e.target.value})}/></label>
   <label className="field"><span>Depth readings * (2 to 10, comma separated)</span><input required value={v.depthReadings||''} onChange={e=>set({depthReadings:e.target.value})} placeholder="2.1, 2.3, 2.0"/></label>
   <p className="muted">{cft?`≈ ${fmt(cft,1)} CFT goes into stock`:'Stock is measured from the lorry.'}</p>
  </>;
 }
 return null;
}
const measured=(m:any,v:any)=>m&&((m.code==='STEEL'&&v.inputUnit==='BUNDLES')||LORRY.includes(m.code));
const lineOut=(v:any)=>({...v,depthReadings:String(v.depthReadings||'').split(/[,\s]+/).filter(Boolean)});

function Meta({meta,setMeta,supplier}:any){
 return <div className="grn-form site-meta">
  <label className="field"><span>Date received *</span><input type="date" required max={istToday()} value={meta.receivedDate} onChange={e=>setMeta({...meta,receivedDate:e.target.value})}/></label>
  {supplier&&<label className="field"><span>Supplier *</span><input required maxLength={160} value={meta.supplier} onChange={e=>setMeta({...meta,supplier:e.target.value})}/></label>}
  <label className="field"><span>Vehicle no. *</span><input required maxLength={60} value={meta.vehicleNo} onChange={e=>setMeta({...meta,vehicleNo:e.target.value})}/></label>
  <label className="field"><span>Delivery note / challan</span><input maxLength={100} value={meta.deliveryNoteNo} onChange={e=>setMeta({...meta,deliveryNoteNo:e.target.value})}/></label>
  <label className="field"><span>Invoice no.</span><input maxLength={100} value={meta.invoiceNo} onChange={e=>setMeta({...meta,invoiceNo:e.target.value})}/></label>
  <label className="field"><span>Site GRN book no. (optional)</span><input maxLength={60} value={meta.siteGrnBookNo} onChange={e=>setMeta({...meta,siteGrnBookNo:e.target.value})}/></label>
 </div>;
}
const blankMeta=()=>({receivedDate:istToday(),supplier:'',vehicleNo:'',deliveryNoteNo:'',invoiceNo:'',siteGrnBookNo:'',remarks:''});

function PoCard({lines,ws,user,onDone}:any){
 const first=lines[0];
 const [qty,setQty]=useState<Record<string,any>>({});
 const [meta,setMeta]=useState(blankMeta());
 const [signed,setSigned]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[shortFor,setShortFor]=useState(''),[shortReason,setShortReason]=useState('');
 const [rid,setRid]=useState(()=>requestId('GRN'));
 const canShort=has(user,'Purchase Manager','Purchase Team');
 const v=(id:string)=>qty[id]||{received:'',accepted:'',note:'',materialCode:lines.find((p:any)=>p.id===id)?.suggestedMaterialCode||''};
 const set=(id:string,patch:any)=>setQty(x=>{const cur=v(id);const next={...cur,...patch};if('received' in patch&&(cur.accepted===''||cur.accepted===cur.received))next.accepted=patch.received;return {...x,[id]:next};});
 const filled=lines.filter((p:any)=>Number(v(p.id).received)>0);
 async function save(e:any){e.preventDefault();setBusy(true);setError('');
  try{
   const r=await siteCall('receivePurchaseOrder',{projectId:ws.projectId,clientRequestId:rid,...meta,qualityDeclarationAccepted:signed,
    poLines:filled.map((p:any)=>{const x=v(p.id);return lineOut({...x,id:p.id,version:p.version,received:Number(x.received),accepted:Number(x.accepted===''?x.received:x.accepted)});})});
   onDone(`${r.lastRecordedGrn} saved for ${first.po||'the PO'}: accepted goods are in site stock and payment is scheduled for the accepted quantity.`);
   setQty({});setMeta(blankMeta());setSigned(false);setRid(requestId('GRN'));
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 async function closeShort(p:any){setBusy(true);setError('');try{const r=await fetch('/api/grn',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'shortClose',reason:shortReason,items:[{id:p.id,version:p.version}]})});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Could not close the line.');onDone(`${p.item} closed at ${q(p.accepted)} ${p.unit}. The rest can be ordered again or cancelled on the request.`);setShortFor('');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <section className="panel grn-card">
  <div className="grn-head"><div><h3>{first.po||'PO'} · {first.vendor}</h3><small>Project {ws.projectId} · expected {first.delivery||'—'}</small></div><span className="tag amber">{lines.length} line{lines.length===1?'':'s'} open</span></div>
  <form onSubmit={save}>
  {lines.map((p:any)=>{const x=v(p.id),m=ws.materials.find((d:any)=>d.code===x.materialCode),rej=Number(x.received||0)-Number(x.accepted===''?x.received:x.accepted||0),conv=m&&!measured(m,x)?unitFactor(p.unit,m.stockUnit):1;
   return <div key={p.id} className="grn-line">
    <div className="grn-line-head"><b>{p.item}</b><span className="nw">ordered {q(p.ordered)} {p.unit} · accepted so far {q(p.accepted)} · <b>pending {q(p.pending)} {p.unit}</b></span>
     {p.receipts.map((r:any)=><small key={r.grnNo}>{r.grnNo} · {r.date} · {r.accepted} accepted{r.rejected?` · ${r.rejected} rejected`:''}</small>)}</div>
    <div className="grn-form">
     <label className="field"><span>Received now ({p.unit})</span><input className="num" type="number" min={0} step="any" value={x.received} onChange={e=>set(p.id,{received:e.target.value})} aria-label={'Received now, '+p.item}/></label>
     <label className="field"><span>Accepted ({p.unit})</span><input className="num" type="number" min={0} step="any" value={x.accepted} onChange={e=>set(p.id,{accepted:e.target.value})} aria-label={'Accepted now, '+p.item}/></label>
     <label className="field"><span>Rejected</span><output className={rej>0?'neg':''}>{rej>0?`${q(rej)} ${p.unit}`:'0'}</output></label>
     <label className="field"><span>Site stock</span><output className="muted">{p.stocked===false?`${p.itemCategory||'Rental'} · not added to site stock`:m?`Goes into ${m.name} (${m.stockUnit})`:`Added as ${p.item} (${p.unit})`}</output></label>
     {Number(x.received)>0&&p.stocked!==false&&<Measure m={m} v={x} set={(patch:any)=>set(p.id,patch)}/>}
     {Number(x.received)>0&&p.stocked!==false&&m&&conv===null&&<label className="field"><span>Quantity in {m.stockUnit} *</span><input required type="number" min={0} step="any" value={x.stockQuantity||''} onChange={e=>set(p.id,{stockQuantity:e.target.value})}/><small className="muted">The PO is in {p.unit}; stock is kept in {m.stockUnit}.</small></label>}
     <label className="field grn-remarks"><span>Note</span><input maxLength={500} placeholder="e.g. 10 bags torn" value={x.note} onChange={e=>set(p.id,{note:e.target.value})}/></label>
     {canShort&&p.accepted>0&&(shortFor===p.id?<span className="short-box"><input className="plan-input" placeholder="Why close short?" value={shortReason} onChange={e=>setShortReason(e.target.value)}/><button type="button" className="secondary" disabled={busy||!shortReason.trim()} onClick={()=>closeShort(p)}>Close</button></span>:<button type="button" className="textbutton" onClick={()=>setShortFor(p.id)}>Close short</button>)}
    </div>
   </div>;})}
  {filled.length>0&&<>
   <Meta meta={meta} setMeta={setMeta}/>
   <label className="site-check"><input type="checkbox" checked={signed} onChange={e=>setSigned(e.target.checked)}/> I checked these goods on arrival; the accepted quantity meets Bilara standards.</label>
  </>}
  {error&&<p className="alert red" role="alert">{error}</p>}
  <button className="primary" disabled={busy||!filled.length||!signed}>{busy?'Saving…':`Save GRN · ${filled.length} line${filled.length===1?'':'s'}`}</button>
  </form>
 </section>;
}

/** Goods that arrived without a PO: into stock now, paid only after Purchase links a PO. */
function NoPoForm({ws,onDone}:any){
 const blank=()=>({materialCode:'',variant:'',inputUnit:'',quantity:'',remarks:''});
 const [lines,setLines]=useState<any[]>([blank()]);
 const [meta,setMeta]=useState(blankMeta());
 const [signed,setSigned]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [rid,setRid]=useState(()=>requestId('GRN'));
 async function save(e:any){e.preventDefault();setBusy(true);setError('');
  try{const r=await siteCall('recordMaterialReceipt',{projectId:ws.projectId,clientRequestId:rid,...meta,qualityDeclarationAccepted:signed,lines:lines.map(lineOut)});
   onDone(`${r.lastRecordedGrn} saved without a PO. The goods are in site stock; Purchase must link it to a PO before anything is paid.`);setLines([blank()]);setMeta(blankMeta());setSigned(false);setRid(requestId('GRN'));}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <form className="panel" onSubmit={save}>
  <h3>Goods arrived without a purchase order</h3>
  <p className="muted">Only items on Purchase's item list can be received. Purchase is told the same day and must link this GRN to a PO before payment.</p>
  <Meta meta={meta} setMeta={setMeta} supplier/>
  {lines.map((l,i)=>{const m=ws.materials.find((d:any)=>d.code===l.materialCode),set=(p:any)=>setLines(lines.map((x,n)=>n===i?{...x,...p}:x));
   return <div key={i} className="grn-form site-line">
    <label className="field"><span>Item *</span><select required value={l.materialCode} onChange={e=>{const d=ws.materials.find((y:any)=>y.code===e.target.value);set({materialCode:e.target.value,variant:'',inputUnit:(d?.inputUnits||[])[0]||''});}}>
     <option value="">Select…</option>{ws.materials.map((d:any)=><option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
    {m&&m.code!=='STEEL'&&!LORRY.includes(m.code)&&(m.inputUnits||[]).length>1&&<label className="field"><span>Unit</span><select value={l.inputUnit} onChange={e=>set({inputUnit:e.target.value})}>{m.inputUnits.map((u:string)=><option key={u}>{u}</option>)}</select></label>}
    {m&&!measured(m,l)&&<label className="field"><span>Quantity * ({m.code==='STEEL'?'kg':(l.inputUnit||m.stockUnit).toLowerCase()})</span><input required type="number" min={0} step="any" value={l.quantity} onChange={e=>set({quantity:e.target.value})}/></label>}
    <Measure m={m} v={l} set={set}/>
    <label className="field grn-remarks"><span>Remarks</span><input maxLength={500} value={l.remarks} onChange={e=>set({remarks:e.target.value})}/></label>
    {lines.length>1&&<button type="button" className="textbutton" onClick={()=>setLines(lines.filter((_,n)=>n!==i))}>Remove</button>}
   </div>;})}
  <button type="button" className="secondary" onClick={()=>setLines([...lines,blank()])}>+ Add item</button>
  <label className="site-check"><input type="checkbox" checked={signed} onChange={e=>setSigned(e.target.checked)}/> I checked these goods on arrival and they meet Bilara standards.</label>
  {error&&<p className="alert red" role="alert">{error}</p>}
  <button className="primary" disabled={busy||!signed}>{busy?'Saving…':'Save GRN without PO'}</button>
 </form>;
}

/** Purchase links a GRN that arrived without a PO; this creates the receipt and payment schedule. */
function LinkGrn({g,ws,onDone}:any){
 const [open,setOpen]=useState(false),[pick,setPick]=useState<Record<string,string>>({}),[remarks,setRemarks]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function link(){setBusy(true);setError('');
  try{const lines=ws.poLines.filter((p:any)=>Number(pick[p.id])>0).map((p:any)=>({id:p.id,version:p.version,accepted:Number(pick[p.id]),received:Number(pick[p.id])}));
   const r=await siteCall('linkGrnToPo',{grnNo:g.grnNo,poLines:lines,remarks});onDone(`${r.grnNo} linked to ${r.poNo}. Payment is scheduled for the accepted quantity.`);}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <li><b>{g.grnNo}</b> · {g.receivedDate} · {g.supplier} · {g.lineCount} line{g.lineCount===1?'':'s'}
  {!open?<button className="textbutton" onClick={()=>setOpen(true)}>Link to PO</button>:<div className="panel site-link">
   {ws.poLines.length?<table className="site-table"><thead><tr><th>PO line</th><th>Pending</th><th>Accepted on this GRN</th></tr></thead><tbody>
    {ws.poLines.map((p:any)=><tr key={p.id}><td>{p.po} · {p.item} · {p.vendor}</td><td className="nw">{q(p.pending)} {p.unit}</td><td><input className="plan-input num" type="number" min={0} step="any" aria-label={'Accepted, '+p.item} value={pick[p.id]||''} onChange={e=>setPick({...pick,[p.id]:e.target.value})}/></td></tr>)}
   </tbody></table>:<p className="muted">No open PO lines for this project. Issue the PO first.</p>}
   <label className="field"><span>Remarks</span><input maxLength={500} value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
   {error&&<p className="alert red" role="alert">{error}</p>}
   <button className="primary" disabled={busy||!Object.values(pick).some(x=>Number(x)>0)} onClick={link}>{busy?'Linking…':'Link and schedule payment'}</button> <button className="secondary" onClick={()=>setOpen(false)}>Cancel</button>
  </div>}
 </li>;
}

function DoneCard({lines}:any){
 const first=lines[0];
 return <section className="panel grn-card"><div className="grn-head"><div><h3>{first.po||'PO'} · {first.vendor}</h3><small>Project {first.project} · week {weekLabel(first.window)}</small></div><span className="tag green">Received</span></div>
  <div className="plan-scroll"><table className="grn-table"><thead><tr><th>Item</th><th>Ordered</th><th>Accepted</th></tr></thead><tbody>
   {lines.map((p:any)=><tr key={p.id}><td><b>{p.item}</b>{receipts(p).map((r:any)=><small key={r.grnNo}>{r.grnNo} · {r.date} · {r.accepted} accepted{r.rejected?` · ${r.rejected} rejected`:''} · {r.by}</small>)}{p.shortClose&&<small className="neg">Closed short: {p.shortClose.reason}</small>}</td>
    <td className="nw">{p.originalQty??p.qty} {p.unit}</td><td className="nw">{q(acceptedQty(p))} {p.unit}</td></tr>)}
  </tbody></table></div></section>;
}

export default function ReceiveGoods({records,project,period,refresh,user,siteProjects=[]}:any){
 const isPurchase=has(user,'Purchase Manager','Purchase Team');
 const canReceiveWithoutPo=has(user,'Site Engineer','QC','Super Admin');
 // The site's own projects, plus any project with goods still to arrive.
 const projects=useMemo(()=>[...new Set<string>([...siteProjects.map(String),...records.filter((r:any)=>r.kind==='purchase'&&r.status!=='Cancelled'&&pendingQty(r)>0).map((r:any)=>String(r.project))])].sort(),[records,siteProjects]);
 const [chosen,setChosen]=useState('');
 const projectId=project!=='all'?project:(chosen||(projects.length===1?projects[0]:''));
 const [ws,setWs]=useState<any>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[noPo,setNoPo]=useState(false),[showDone,setShowDone]=useState(false);
 async function load(){if(!projectId){setWs(null);return;}setError('');try{setWs(await siteCall('getReceiveGoodsWorkspace',projectId));}catch(e){setWs(null);setError((e as Error).message);}}
 useEffect(()=>{load();},[projectId]);
 const done=(text:string)=>{setMessage(text);setNoPo(false);load();refresh();window.scrollTo?.({top:0,behavior:'smooth'});};
 const groups=useMemo(()=>{const by=new Map<string,any[]>();for(const p of ws?.poLines||[]){by.set(p.orderId,[...(by.get(p.orderId)||[]),p]);}return [...by.values()];},[ws]);
 const doneGroups=useMemo(()=>{
  const lines=records.filter((r:any)=>r.kind==='purchase'&&r.status!=='Cancelled'&&(!projectId||r.project===projectId)&&pendingQty(r)<=0&&inPeriod(recordWindow(r,records),period as Period)).map((r:any)=>({...r,window:recordWindow(r,records)}));
  const by=new Map<string,any[]>();for(const p of lines){const k=p.orderId||p.id;by.set(k,[...(by.get(k)||[]),p]);}return [...by.values()];
 },[records,projectId,period]);
 return <section className="receive-goods">
  <p className="muted">Record each delivery against its purchase order. The GRN number is generated when you save; accepted goods go into site stock and payment is scheduled for the accepted quantity only.</p>
  {project==='all'&&projects.length>1&&<label className="field site-inline"><span>Project</span><select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Select project…</option>{projects.map(p=><option key={p} value={p}>{p}</option>)}</select></label>}
  {message&&<p className="alert green" role="status">{message} <button className="textbutton" onClick={()=>setMessage('')}>Dismiss</button></p>}
  {error&&<p className="alert red" role="alert">{error}</p>}
  {ws&&<>
   {!groups.length&&<div className="panel empty"><h3>No deliveries waiting</h3><p>Purchase orders for project {ws.projectId} appear here once issued.</p></div>}
   {groups.map(g=><PoCard key={g[0].orderId+':'+g.map((p:any)=>p.version).join('.')} lines={g} ws={ws} user={user} onDone={done}/>)}
   {ws.awaitingPo.length>0&&<section className="panel"><h3>GRNs waiting for a PO · {ws.awaitingPo.length}</h3>
    <p className="muted">{isPurchase?'Link each one to the PO lines it belongs to. Nothing is paid until you do.':'Purchase will link these to a purchase order before payment.'}</p>
    <ul className="site-list">{ws.awaitingPo.map((g:any)=>isPurchase?<LinkGrn key={g.grnNo} g={g} ws={ws} onDone={done}/>:<li key={g.grnNo}><b>{g.grnNo}</b> · {g.receivedDate} · {g.supplier}</li>)}</ul></section>}
   {canReceiveWithoutPo&&(noPo?<NoPoForm ws={ws} onDone={done}/>:<button className="secondary" onClick={()=>setNoPo(true)}>Goods arrived without a PO?</button>)}
  </>}
  {!projectId&&projects.length>1&&<div className="panel empty"><h3>Choose a project</h3></div>}
  {!projectId&&!projects.length&&project==='all'&&<div className="panel empty"><h3>No deliveries waiting</h3><p>Purchase orders appear here once issued.</p></div>}
  {doneGroups.length>0&&<details className="panel grn-done" open={showDone} onToggle={e=>setShowDone((e.currentTarget as HTMLDetailsElement).open)}><summary>Fully received · {doneGroups.length} PO{doneGroups.length===1?'':'s'}</summary>{showDone&&doneGroups.map((g:any)=><DoneCard key={g[0].orderId||g[0].id} lines={g}/>)}</details>}
 </section>;
}
