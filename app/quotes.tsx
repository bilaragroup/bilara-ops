'use client';
import {useMemo,useState} from 'react';
import {has} from '@/lib/permissions';
import {money} from '@/lib/calculations';
import {addDays,indiaToday,inPeriod,weekLabel,type Period} from '@/lib/weekly';
import {TRADES,budgetFor,cheapestQuote,committed,orderFor,quoteList,selectedQuote} from '@/lib/quotes';

// Plumbing & electrical: the site sends a photo of the handwritten list, Purchase collects
// vendor quotes, BOQ picks the best one within the project's budget, Audit approves, Purchase
// issues the PO. Delivery, bill check and payment then run as for every other material.
const stageTone:Record<string,string>={'Awaiting quotes':'amber','With BOQ':'amber','BOQ selected':'amber','Audit approved':'green',Rejected:'red',Cancelled:''};
const rupees=(paise:number)=>money(paise);

async function api(body:any){const r=await fetch('/api/quotes',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Unable to save');return d;}
async function upload(file:File,meta:any){const f=new FormData();f.set('file',file);f.set('metadata',JSON.stringify(meta));const r=await fetch('/api/documents',{method:'POST',signal:AbortSignal.timeout(60000),body:f});const d:any=await r.json();if(!r.ok)throw Error(d.error||'Upload failed');return d.id as string;}

function useAction(refresh:any){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function run(fn:()=>Promise<any>,done?:string,docs=false){setBusy(true);setError('');setMessage('');try{await fn();if(done)setMessage(done);await refresh(docs?{}:{skipDocuments:true});return true;}catch(e:any){setError(e?.name==='TimeoutError'?'Saving timed out. Refresh and check before retrying.':e.message);return false;}finally{setBusy(false);}}
 return {busy,error,message,run};
}

function Budgets({records,projects,project,user,refresh,trade}:any){
 const canSet=has(user,'BOQ Team','GM');
 // Project list: configured projects this person can see, plus any project that already has a request or budget.
 const codes=[...new Set<string>([...projects.filter((p:any)=>p.active).map((p:any)=>p.project),...records.filter((r:any)=>['quote','budget'].includes(r.kind)).map((r:any)=>r.project)])].filter(c=>project==='all'||c===project).sort();
 const list=codes.map(c=>({project:c,name:projects.find((p:any)=>p.project===c)?.name||''}));
 const [edit,setEdit]=useState<string>(''),[amount,setAmount]=useState(''),[note,setNote]=useState('');const act=useAction(refresh);
 if(!list.length)return null;
 return <section className="panel quote-budgets">
  <div className="tablebar"><div><h2>{trade} budget per house</h2><p>Set once per project by BOQ. Every quote BOQ chooses is taken from what is left.</p></div></div>
  <div className="plan-scroll"><table className="grn-table budget-table"><thead><tr><th>Project</th><th className="num">Budget</th><th className="num">Chosen</th><th className="num">Left</th>{canSet&&<th></th>}</tr></thead><tbody>
   {list.map((p:any)=>{const b=budgetFor(records,p.project,trade),used=committed(records,p.project,trade),key=p.project+'|'+trade;return <tr key={p.project}>
    <td><b>{p.project}</b><small>{p.name}</small></td>
    {b?<><td className="num">{rupees(b.amount)}</td><td className="num">{rupees(used)}</td><td className="num"><b className={b.amount-used<0?'neg':''}>{rupees(b.amount-used)}</b></td></>:<td colSpan={3} className="muted-inline">Not set</td>}
    {canSet&&<td>{edit===key?<form className="quote-inline" onSubmit={async e=>{e.preventDefault();if(await act.run(()=>api({action:'budget',project:p.project,trade,amount:Number(amount),note,version:b?.version||0}),`${trade} budget for ${p.project} saved.`))setEdit('');}}>
     <input className="plan-input num" type="number" min={1} step="0.01" required placeholder="Budget ₹" aria-label={`${trade} budget, project ${p.project}`} value={amount} onChange={e=>setAmount(e.target.value)}/>
     <input className="plan-input" placeholder="Note (optional)" value={note} onChange={e=>setNote(e.target.value)}/>
     <button className="secondary" disabled={act.busy}>Save</button><button type="button" className="textbutton" onClick={()=>setEdit('')}>Cancel</button>
    </form>:<button className="textbutton" onClick={()=>{setEdit(key);setAmount(b?String(b.amount/100):'');setNote('');}}>{b?'Change':'Set budget'}</button>}</td>}
   </tr>;})}
  </tbody></table></div>
  {act.error&&<p className="alert red quote-msg" role="alert">{act.error}</p>}{act.message&&<p className="alert green quote-msg" role="status">{act.message}</p>}
 </section>;
}

function NewRequest({projects,project,user,refresh,trade='Plumbing'}:any){
 const mine=projects.filter((p:any)=>p.active);
 const [f,setF]=useState({project:project!=='all'?project:(mine[0]?.project||''),trade,neededBy:addDays(indiaToday(),14),activity:'',note:''});
 const [files,setFiles]=useState<File[]>([]),[open,setOpen]=useState(false);const act=useAction(refresh);
 async function submit(e:any){e.preventDefault();if(!files.length)return;
  const ok=await act.run(async()=>{const d=await api({action:'create',...f});for(const file of files)await upload(file,{project:f.project,window:d.window,vendor:f.trade,type:'Site list',recordIds:[d.id],reference:f.activity||`${f.trade} list`,uploadedBy:user.name});},'Sent to Purchase with the photo.',true);
  if(ok){setFiles([]);setF({...f,activity:'',note:''});setOpen(false);}}
 return <section className="panel quote-new">
  <div className="tablebar"><div><h2>New plumbing / electrical request</h2><p>Take a clear photo of the plumber's or electrician's list. It goes straight to Purchase for vendor quotes.</p></div><button className={open?'secondary':'primary'} onClick={()=>setOpen(!open)}>{open?'Close':'Upload a list'}</button></div>
  {open&&<form className="formgrid quote-form" onSubmit={submit}>
   <label className="field"><span>Project *</span><select required value={f.project} onChange={e=>setF({...f,project:e.target.value})}>{mine.map((p:any)=><option key={p.project} value={p.project}>{p.project} · {p.name}</option>)}</select></label>
   <label className="field"><span>Trade *</span><select value={f.trade} onChange={e=>setF({...f,trade:e.target.value})}>{TRADES.map(t=><option key={t}>{t}</option>)}</select></label>
   <label className="field"><span>Needed at site by *</span><input type="date" required min={indiaToday()} value={f.neededBy} onChange={e=>setF({...f,neededBy:e.target.value})}/></label>
   <label className="field"><span>Work / location</span><input maxLength={200} placeholder="e.g. First floor bathrooms" value={f.activity} onChange={e=>setF({...f,activity:e.target.value})}/></label>
   <label className="field full"><span>Photo of the list * (one or more pages; JPG, PNG or PDF, up to 10 MB each)</span><input type="file" required multiple accept="image/jpeg,image/png,application/pdf" onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,6))}/></label>
   <label className="field full"><span>Note for Purchase</span><textarea maxLength={2000} placeholder="Anything the photo doesn't say: brand asked by client, urgent items…" value={f.note} onChange={e=>setF({...f,note:e.target.value})}/></label>
   <div className="full quote-actions"><button className="primary" disabled={act.busy||!files.length||!f.project}>{act.busy?'Sending…':'Send to Purchase'}</button></div>
  </form>}
  {act.error&&<p className="alert red quote-msg" role="alert">{act.error}</p>}{act.message&&<p className="alert green quote-msg" role="status">{act.message}</p>}
 </section>;
}

function DocLink({d}:{d:any}){const url='/api/documents?id='+encodeURIComponent(d.id);return d.mime?.startsWith('image/')?<a className="quote-photo" href={url} target="_blank" rel="noreferrer"><img src={url} alt={d.reference||'Site list photo'} loading="lazy"/></a>:<a className="textbutton" href={url} target="_blank" rel="noreferrer">{d.filename||'Open file'}</a>;}

function TypedList({r,editable,refresh}:any){
 const [rows,setRows]=useState<any[]>(r.typedList?.length?r.typedList.map((l:any)=>({...l,qty:String(l.qty)})):[{item:'',size:'',qty:'',unit:'NOS'}]);const [open,setOpen]=useState(false);const act=useAction(refresh);
 const set=(i:number,k:string,v:string)=>setRows(x=>x.map((l,j)=>j===i?{...l,[k]:v}:l));
 if(!editable&&!r.typedList?.length)return null;
 return <details className="quote-typed" open={open} onToggle={(e:any)=>setOpen(e.target.open)}>
  <summary>Typed list {r.typedList?.length?`· ${r.typedList.length} lines by ${r.typedBy}`:'(optional — type the photo out so every vendor quotes the same items)'}</summary>
  {editable?<form onSubmit={e=>{e.preventDefault();act.run(()=>api({action:'typedList',id:r.id,version:r.version,lines:rows.filter(l=>l.item.trim()).map(l=>({...l,qty:Number(l.qty)}))}),'Typed list saved. Share it with every vendor.');}}>
   <table className="grn-table"><thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Unit</th><th/></tr></thead><tbody>{rows.map((l,i)=><tr key={i}>
    <td><input className="plan-input" aria-label="Item" placeholder="CPVC elbow" value={l.item} onChange={e=>set(i,'item',e.target.value)}/></td>
    <td><input className="plan-input small" aria-label="Size" placeholder='3/4"' value={l.size} onChange={e=>set(i,'size',e.target.value)}/></td>
    <td><input className="plan-input num" aria-label="Quantity" type="number" min={0} step="any" value={l.qty} onChange={e=>set(i,'qty',e.target.value)}/></td>
    <td><input className="plan-input small" aria-label="Unit" value={l.unit} onChange={e=>set(i,'unit',e.target.value)}/></td>
    <td><button type="button" className="textbutton" onClick={()=>setRows(x=>x.filter((_,j)=>j!==i))}>Remove</button></td></tr>)}</tbody></table>
   <div className="quote-actions"><button type="button" className="secondary" onClick={()=>setRows(x=>[...x,{item:'',size:'',qty:'',unit:'NOS'}])}>Add line</button><button className="primary" disabled={act.busy}>Save list</button><button type="button" className="secondary" onClick={()=>window.print()}>Print to share</button></div>
  </form>:<table className="grn-table"><thead><tr><th>Item</th><th>Size</th><th>Qty</th></tr></thead><tbody>{r.typedList.map((l:any,i:number)=><tr key={i}><td>{l.item}</td><td>{l.size}</td><td className="nw">{l.qty} {l.unit}</td></tr>)}</tbody></table>}
  {act.error&&<p className="alert red quote-msg" role="alert">{act.error}</p>}{act.message&&<p className="alert green quote-msg" role="status">{act.message}</p>}
 </details>;
}

function Card({r,records,documents,user,refresh}:any){
 const act=useAction(refresh);const quotes=quoteList(r),low=cheapestQuote(r),chosen=selectedQuote(r),po=orderFor(r,records);
 const purchase=has(user,'Purchase Manager','Purchase Team'),boq=has(user,'BOQ Team'),audit=has(user,'Audit'),seesPrice=has(user,'Purchase Manager','Purchase Team','Accounts','GM','BOQ Team','Audit');
 const budget=budgetFor(records,r.project,r.trade),left=budget?budget.amount-committed(records,r.project,r.trade,r.id):null;
 const photos=documents.filter((d:any)=>d.type==='Site list'&&d.recordIds?.includes(r.id)),quoteDocs=documents.filter((d:any)=>d.type==='Vendor quote'&&d.recordIds?.includes(r.id));
 const [q,setQ]=useState({vendor:'',phone:'',amount:'',brands:'',creditDays:'0',reference:'',notes:''}),[qFile,setQFile]=useState<File|null>(null),[adding,setAdding]=useState(false);
 const [pick,setPick]=useState(''),[reason,setReason]=useState(''),[single,setSingle]=useState(''),[note,setNote]=useState('');
 const [order,setOrder]=useState({entity:'GROUP',creditDays:String(chosen?.creditDays??0),expectedDelivery:r.neededBy}),[cancelling,setCancelling]=useState(false);
 const v={id:r.id,version:r.version};
 async function addQuote(e:any){e.preventDefault();const ok=await act.run(async()=>{let documentId;if(qFile)documentId=await upload(qFile,{project:r.project,window:r.window,vendor:q.vendor,type:'Vendor quote',recordIds:[r.id],reference:q.reference||q.vendor,uploadedBy:user.name});await api({action:'addQuote',...v,...q,amount:Number(q.amount),creditDays:Number(q.creditDays),documentId});},'Quote added.',!!qFile);if(ok){setQ({vendor:'',phone:'',amount:'',brands:'',creditDays:'0',reference:'',notes:''});setQFile(null);setAdding(false);}}
 const canCancel=!po&&!['Rejected','Cancelled'].includes(r.stage)&&(r.createdBy===user.email||has(user,'Project Manager','GM','Purchase Manager'));
 return <article className="panel quote-card">
  <div className="grn-head"><div><h3>{r.trade} · Project {r.project}{r.activity?` · ${r.activity}`:''}</h3><small>Needed by {r.neededBy} (week {weekLabel(r.window)}) · raised by {r.raisedBy} on {String(r.raisedAt||'').slice(0,10)}</small></div><span className={'tag '+(stageTone[r.stage]||'')}>{po?`PO ${po.po} · ${po.status}`:r.stage}</span></div>
  <div className="quote-body">
   <div className="quote-photos">{photos.length?photos.map((d:any)=><DocLink key={d.id} d={d}/>):<p className="alert amber">No photo uploaded yet.</p>}</div>
   <div className="quote-main">
    {r.note&&<p className="quote-note">“{r.note}”</p>}
    {r.boqReturn&&r.stage==='Awaiting quotes'&&<p className="alert amber">Returned by BOQ ({r.boqReturn.by}): {r.boqReturn.reason}</p>}
    {r.auditReturn&&r.stage==='With BOQ'&&<p className="alert amber">Returned by Audit ({r.auditReturn.by}): {r.auditReturn.note}</p>}
    {r.cancelled&&<p className="alert">Cancelled by {r.cancelled.by}: {r.cancelled.reason}</p>}
    {r.audit?.decision==='Rejected'&&<p className="alert red">Rejected by Audit ({r.audit.by}): {r.audit.note}</p>}
    <TypedList r={r} editable={purchase&&r.stage==='Awaiting quotes'} refresh={refresh}/>
    {seesPrice&&budget&&<p className="quote-budget">{r.trade} budget for project {r.project}: {rupees(budget.amount)} · <b>{rupees(left!)} left</b>{chosen?' before this quote':''}</p>}
    {seesPrice&&!budget&&['With BOQ','Awaiting quotes'].includes(r.stage)&&<p className="alert amber">No {r.trade.toLowerCase()} budget set for project {r.project}. BOQ must set it before choosing a quote.</p>}
    {quotes.length>0&&<div className="plan-scroll"><table className="grn-table"><thead><tr>{boq&&r.stage==='With BOQ'&&<th>Choose</th>}<th>Vendor</th><th>Brands / notes</th>{seesPrice&&<th>Quote incl. GST</th>}<th>Credit</th><th/></tr></thead><tbody>
     {quotes.map((x:any)=>{const file=quoteDocs.find((d:any)=>d.id===x.documentId);const over=seesPrice&&left!=null&&x.amount>left;return <tr key={x.id} className={chosen?.id===x.id?'quote-chosen':''}>
      {boq&&r.stage==='With BOQ'&&<td><input type="radio" name={'pick-'+r.id} aria-label={'Choose '+x.vendor} disabled={over} checked={pick===x.id} onChange={()=>setPick(x.id)}/></td>}
      <td><b>{x.vendor}</b>{x.phone&&<small>{x.phone}</small>}{x.reference&&<small>Ref {x.reference}</small>}</td>
      <td>{x.brands||'—'}{x.notes&&<small>{x.notes}</small>}</td>
      {seesPrice&&<td className="nw"><b>{rupees(x.amount)}</b>{low?.id===x.id&&quotes.length>1&&<span className="tag green">Lowest</span>}{over&&<span className="tag red">Over budget</span>}{chosen?.id===x.id&&<span className="tag green">Chosen</span>}</td>}
      <td className="nw">{x.creditDays?`${x.creditDays} days`:'Same day'}</td>
      <td>{file&&<DocLink d={file}/>}{purchase&&r.stage==='Awaiting quotes'&&<button className="textbutton" disabled={act.busy} onClick={()=>act.run(()=>api({action:'removeQuote',...v,quoteId:x.id}),'Quote removed.')}>Remove</button>}</td>
     </tr>;})}
    </tbody></table></div>}
    {r.selection&&<p className="quote-choice">BOQ chose <b>{r.selection.vendor}</b>{seesPrice&&r.selection.amount!=null?` at ${rupees(r.selection.amount)}`:''}{r.selection.lowest?' — the lowest quote':''}{r.selection.reason?`: “${r.selection.reason}”`:''} <small>— {r.selection.by}</small></p>}

    {purchase&&r.stage==='Awaiting quotes'&&<div className="quote-step">
     {adding?<form className="formgrid quote-form" onSubmit={addQuote}>
      <label className="field"><span>Vendor *</span><input required maxLength={120} value={q.vendor} onChange={e=>setQ({...q,vendor:e.target.value})}/></label>
      <label className="field"><span>Quoted total incl. GST (₹) *</span><input required type="number" min={1} step="0.01" value={q.amount} onChange={e=>setQ({...q,amount:e.target.value})}/></label>
      <label className="field"><span>Brands quoted</span><input maxLength={300} placeholder="e.g. Supreme pipes, Jaquar fittings" value={q.brands} onChange={e=>setQ({...q,brands:e.target.value})}/></label>
      <label className="field"><span>Credit days</span><input type="number" min={0} max={365} value={q.creditDays} onChange={e=>setQ({...q,creditDays:e.target.value})}/></label>
      <label className="field"><span>Phone</span><input maxLength={30} value={q.phone} onChange={e=>setQ({...q,phone:e.target.value})}/></label>
      <label className="field"><span>Quote reference</span><input maxLength={100} value={q.reference} onChange={e=>setQ({...q,reference:e.target.value})}/></label>
      <label className="field full"><span>Quote file (PDF or photo, optional)</span><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={e=>setQFile(e.target.files?.[0]||null)}/></label>
      <label className="field full"><span>Notes</span><input maxLength={1000} placeholder="Items left out, delivery time…" value={q.notes} onChange={e=>setQ({...q,notes:e.target.value})}/></label>
      <div className="full quote-actions"><button className="primary" disabled={act.busy}>Add quote</button><button type="button" className="secondary" onClick={()=>setAdding(false)}>Cancel</button></div>
     </form>:<div className="quote-actions"><button className="secondary" onClick={()=>setAdding(true)}>Add vendor quote</button>
      {quotes.length>0&&<>{quotes.length<2&&<input className="plan-input" placeholder="Why only one quote?" value={single} onChange={e=>setSingle(e.target.value)}/>}<button className="primary" disabled={act.busy||(quotes.length<2&&single.trim().length<3)} onClick={()=>act.run(()=>api({action:'sendToBoq',...v,singleQuoteReason:single}),'Sent to BOQ.')}>Send {quotes.length} quote{quotes.length===1?'':'s'} to BOQ</button></>}
     </div>}
    </div>}

    {boq&&r.stage==='With BOQ'&&<div className="quote-step">
     <input className="plan-input" placeholder={pick&&low&&pick!==low.id?'Why this quote over the lowest? (brand, quality, delivery) *':'Reason / note'} value={reason} onChange={e=>setReason(e.target.value)}/>
     <div className="quote-actions"><button className="primary" disabled={act.busy||!pick||(!!low&&pick!==low.id&&reason.trim().length<3)} onClick={()=>act.run(()=>api({action:'select',...v,quoteId:pick,reason}),'Quote chosen. Sent to Audit.')}>Choose this quote</button>
      <button className="secondary" disabled={act.busy||reason.trim().length<3} onClick={()=>act.run(()=>api({action:'returnToPurchase',...v,reason}),'Returned to Purchase.')}>Return to Purchase</button></div>
    </div>}

    {audit&&r.stage==='BOQ selected'&&<div className="quote-step">
     {chosen&&low&&chosen.id!==low.id&&<p className="alert amber">Chosen quote is {rupees(chosen.amount-low.amount)} above the lowest ({low.vendor}).</p>}
     <input className="plan-input" placeholder="Note (required to return or reject)" value={note} onChange={e=>setNote(e.target.value)}/>
     <div className="quote-actions">{['Approved','Returned','Rejected'].map(d=><button key={d} className={d==='Approved'?'primary':'secondary'} disabled={act.busy||(d!=='Approved'&&note.trim().length<3)} onClick={()=>act.run(()=>api({action:'audit',...v,decision:d,note}),d==='Approved'?'Approved. Purchase can issue the PO.':`${d}.`)}>{d==='Approved'?'Approve':d==='Returned'?'Return to BOQ':'Reject'}</button>)}</div>
    </div>}

    {purchase&&r.stage==='Audit approved'&&!po&&<form className="quote-step quote-inline" onSubmit={e=>{e.preventDefault();act.run(()=>api({action:'order',...v,entity:order.entity,creditDays:Number(order.creditDays),expectedDelivery:order.expectedDelivery}),'PO issued. The site records delivery under Receive goods (GRN).');}}>
     <label className="field"><span>Buyer</span><select value={order.entity} onChange={e=>setOrder({...order,entity:e.target.value})}><option value="GROUP">Bilara Group</option><option value="BUILDERS">Bilara Builders</option></select></label>
     <label className="field"><span>Credit days</span><input type="number" min={0} max={365} value={order.creditDays} onChange={e=>setOrder({...order,creditDays:e.target.value})}/></label>
     <label className="field"><span>Expected delivery</span><input type="date" value={order.expectedDelivery} onChange={e=>setOrder({...order,expectedDelivery:e.target.value})}/></label>
     <button className="primary" disabled={act.busy}>Issue PO{chosen&&seesPrice?` for ${rupees(chosen.amount)}`:''}</button>
    </form>}
    {po&&<p className="quote-choice">PO {po.po} to {po.vendor} · {po.status}{po.receipts?.length?` · GRN ${po.receipts.map((x:any)=>x.grnNo).join(', ')}`:' · waiting for delivery'}{po.billStatus?` · bill ${po.billStatus}`:''}</p>}

    {canCancel&&(cancelling?<div className="quote-actions"><input className="plan-input" placeholder="Why cancel?" value={note} onChange={e=>setNote(e.target.value)}/><button className="secondary" disabled={act.busy||note.trim().length<3} onClick={()=>act.run(()=>api({action:'cancel',...v,reason:note}),'Cancelled.')}>Cancel request</button><button className="textbutton" onClick={()=>setCancelling(false)}>Keep</button></div>:<button className="textbutton quote-cancel" onClick={()=>setCancelling(true)}>Cancel this request</button>)}
    {act.error&&<p className="alert red quote-msg" role="alert">{act.error}</p>}{act.message&&<p className="alert green quote-msg" role="status">{act.message}</p>}
   </div>
  </div>
 </article>;
}

export default function QuoteRequests({records,documents,projects,project,period,user,refresh}:{records:any[];documents:any[];projects:any[];project:string;period:Period;user:any;refresh:any}){
 const [show,setShow]=useState('open'),[trade,setTrade]=useState<string>('Plumbing');
 const mine=(r:any)=>(r.stage==='Awaiting quotes'&&has(user,'Purchase Manager','Purchase Team'))||(r.stage==='With BOQ'&&has(user,'BOQ Team'))||(r.stage==='BOQ selected'&&has(user,'Audit'))||(r.stage==='Audit approved'&&!orderFor(r,records)&&has(user,'Purchase Manager','Purchase Team'));
 const all=useMemo(()=>records.filter(r=>r.kind==='quote'&&(project==='all'||r.project===project)),[records,project]);
 const list=useMemo(()=>all.filter(r=>r.trade===trade).sort((a,b)=>String(a.neededBy).localeCompare(String(b.neededBy))),[all,trade]);
 const open=(r:any)=>!['Rejected','Cancelled'].includes(r.stage)&&!(orderFor(r,records)?.status==='Delivered');
 const shown=list.filter(r=>show==='mine'?mine(r):show==='open'?open(r):inPeriod(r.window,period));
 const counts={mine:list.filter(mine).length,open:list.filter(open).length,period:list.filter(r=>inPeriod(r.window,period)).length};
 const seesBudget=has(user,'GM','BOQ Team','Audit','Purchase Manager','Purchase Team','Accounts');
 return <div className="quotes">
  <div className="view-switch trade-switch" role="group" aria-label="Trade">{TRADES.map(t=>{const n=all.filter(r=>r.trade===t&&mine(r)).length;return <button key={t} className={trade===t?'chosen':''} aria-pressed={trade===t} onClick={()=>setTrade(t)}>{t}{n>0&&<span className="tag amber">{n}</span>}</button>;})}</div>
  {has(user,'Site Engineer','Project Manager','GM')&&<NewRequest key={trade} trade={trade} projects={projects} project={project} user={user} refresh={refresh}/>}
  {seesBudget&&<Budgets trade={trade} records={records} projects={projects} project={project} user={user} refresh={refresh}/>}
  <div className="view-switch quote-filter">{[['mine','Waiting for me',counts.mine],['open','All open',counts.open],['period','Needed in selected weeks',counts.period]].map(([k,l,n]:any)=><button key={k} className={show===k?'chosen':''} onClick={()=>setShow(k)}>{l}<span>{n}</span></button>)}</div>
  {shown.map(r=><Card key={r.id} r={r} records={records} documents={documents} user={user} refresh={refresh}/>)}
  {!shown.length&&<div className="panel empty"><h3>Nothing here</h3><p>{show==='mine'?`No ${trade.toLowerCase()} request is waiting for you.`:`No ${trade.toLowerCase()} requests yet.`}</p></div>}
 </div>;
}
