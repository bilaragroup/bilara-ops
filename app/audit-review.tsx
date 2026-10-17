'use client';
import {useMemo,useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {money} from '@/lib/calculations';
import {inPeriod,periodLabel,singleWeek,weekLabel,type Period} from '@/lib/weekly';
import {lineSaving,planTotals} from '@/lib/purchase-plan';

// Audit's view of the week's purchase plan: BOQ rate against the purchase team's
// vendor rate for every line, the saving per line, per project and in total, and
// one batch decision. Nothing can be ordered until Audit approves.

const pct=(saving:number|null,base:number|null)=>saving==null||!base?'—':(Math.round(saving/base*1000)/10)+'%';

export default function AuditReview({records,project,window,period,refresh,openRecord}:any){
 const per:Period=period||{key:'week',from:window,to:window},multi=!singleWeek(per);
 const scoped=useMemo(()=>records.filter((r:any)=>['plan','request'].includes(r.kind)&&inPeriod(r.window,per)&&(project==='all'||r.project===project)),[records,project,per.from,per.to]);
 const pending=scoped.filter((r:any)=>r.stage==='Vendors finalized'&&r.closure?.state!=='Closed').sort((a:any,b:any)=>String(a.window).localeCompare(String(b.window))||a.project.localeCompare(b.project)||String(a.item).localeCompare(String(b.item)));
 const approved=scoped.filter((r:any)=>r.stage==='Audit approved');
 const waiting=scoped.filter((r:any)=>['Submitted','BOQ priced'].includes(r.stage)).length;
 const [selected,setSelected]=useState<string[]>([]),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const chosen=pending.filter((r:any)=>selected.includes(r.id));
 const totals=planTotals(pending),chosenTotals=planTotals(chosen);
 // Saving recorded at approval time; fall back to current values for older approvals.
 const approvedSaving=approved.reduce((n:number,r:any)=>n+((r.auditSavings?.savingVsBoq)??(lineSaving(r).savingVsBoq??0)),0);
 const projects=[...new Set<string>(pending.map((r:any)=>r.project))].map(p=>({project:p,...planTotals(pending.filter((r:any)=>r.project===p))}));
 async function decide(decision:'Approved'|'Returned'|'ReturnQty'|'ReturnPrice'|'Rejected'){
  if(!chosen.length||!note.trim()||!confirmed)return;setBusy(true);setError('');setMessage('');
  try{const res=await fetch('/api/audit-decision',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:chosen.map((r:any)=>r.id),versions:Object.fromEntries(chosen.map((r:any)=>[r.id,r.version])),decision,note,confirmed})});
   const d:any=await res.json();if(!res.ok)throw Error(d.error);
   setMessage(`${d.count} line${d.count===1?'':'s'} ${decision==='Approved'?'approved, ready for purchase orders':decision==='Returned'?'sent back to Purchase':decision==='ReturnQty'?'sent back to the PM for the quantity':decision==='ReturnPrice'?'sent back to the BOQ team for the price':'rejected'}.`);
   setSelected([]);setNote('');setConfirmed(false);await refresh({skipDocuments:true});
  }catch(e:any){setError(e?.name==='TimeoutError'?'The decision timed out. Refresh and check before retrying.':e.message);}finally{setBusy(false);}
 }
 const allSelected=!!pending.length&&selected.length===pending.length;
 return <section className="audit-review">
  <div className="metrics plan-metrics">
   <div className="metric"><p>Saving against BOQ (waiting)</p><strong className={totals.savingVsBoq<0?'neg':''}>{money(totals.savingVsBoq)}</strong><small>{totals.savingPercent==null?'No BOQ value':totals.savingPercent+'% of BOQ '+money(totals.boq)}</small></div>
   <div className="metric"><p>Vendor value (waiting)</p><strong>{money(totals.vendor)}</strong><small>{pending.length} line{pending.length===1?'':'s'} · {periodLabel(per)}</small></div>
   <div className="metric"><p>Above BOQ rate</p><strong>{totals.aboveBoq}</strong><small>{totals.aboveTarget} above the purchasing target</small></div>
   <div className="metric"><p>{multi?'Approved in these weeks':'Approved this week'}</p><strong>{approved.length}</strong><small>Saving {money(approvedSaving)} · {waiting} still with BOQ / Purchase</small></div>
  </div>
  {projects.length>1&&<div className="panel tablepanel"><div className="tablebar"><div><h2>Saving by project</h2></div></div><div className="scroll-x"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Lines</TableHead><TableHead>BOQ value</TableHead><TableHead>Vendor value</TableHead><TableHead>Saving</TableHead><TableHead>Saving %</TableHead><TableHead>Above BOQ</TableHead></TableRow></TableHeader><TableBody>{projects.map(p=><TableRow key={p.project}><TableCell><b>{p.project}</b></TableCell><TableCell>{p.lines}</TableCell><TableCell>{money(p.boq)}</TableCell><TableCell>{money(p.vendor)}</TableCell><TableCell><span className={p.savingVsBoq<0?'neg':'pos'}>{money(p.savingVsBoq)}</span></TableCell><TableCell>{p.savingPercent==null?'—':p.savingPercent+'%'}</TableCell><TableCell>{p.aboveBoq?<span className="tag red">{p.aboveBoq}</span>:'0'}</TableCell></TableRow>)}</TableBody></Table></div></div>}
  <div className="panel tablepanel">
   <div className="tablebar"><div><h2>Purchase plan for audit</h2><p>Compare each vendor rate with the BOQ rate. Approve to release for purchase orders, or send lines back to Purchase to negotiate.</p></div>
    <button className="secondary" disabled={busy||!pending.length} onClick={()=>setSelected(allSelected?[]:pending.map((r:any)=>r.id))}>{allSelected?'Clear selection':'Select all'}</button></div>
   {!pending.length?<div className="empty"><h3>Nothing waiting for audit this week</h3><p>Lines appear here once Purchase sends vendor rates. {approved.length?approved.length+' line(s) already approved.':''}</p></div>:
   <div className="plan-scroll"><Table><TableHeader><TableRow><TableHead><Checkbox aria-label="Select all lines" checked={allSelected} onCheckedChange={(v)=>setSelected(v?pending.map((r:any)=>r.id):[])}/></TableHead><TableHead>Project / item</TableHead><TableHead>Qty</TableHead><TableHead>BOQ rate</TableHead><TableHead>Target</TableHead><TableHead>Vendor rate</TableHead><TableHead>Vendor</TableHead><TableHead>BOQ value</TableHead><TableHead>Vendor value</TableHead><TableHead>Saving</TableHead></TableRow></TableHeader>
   <TableBody>{pending.map((r:any)=>{const s=lineSaving(r),qc=r.quantityControl;return <TableRow key={r.id} className={s.aboveBoq?'row-bad':s.aboveTarget?'row-warn':''}>
    <TableCell><Checkbox aria-label={'Select '+r.item} checked={selected.includes(r.id)} onCheckedChange={(v)=>setSelected(v?[...selected,r.id]:selected.filter(x=>x!==r.id))}/></TableCell>
    <TableCell><button className="rowlink" onClick={()=>openRecord(r)}><b>{r.item}</b><span>Project {r.project} · M{r.milestone} · Act {r.activity} {r.activityName}{r.kind==='request'?' · Ad hoc':''}{multi?' · Week '+weekLabel(r.window):''}</span></button><div className="plan-status">{qc?.excess?<span className="tag amber">+{qc.excess} {r.unit} over activity BOQ</span>:<span className="tag green">Within activity BOQ</span>}</div></TableCell>
    <TableCell className="nw">{s.qty} {r.unit}</TableCell>
    <TableCell className="nw">{s.boqRate??'—'}</TableCell><TableCell className="nw">{s.targetRate??'—'}</TableCell>
    <TableCell className="nw"><b className={s.aboveBoq?'neg':''}>{s.vendorRate??'—'}</b>{s.aboveBoq?<small className="neg">Above BOQ</small>:s.aboveTarget?<small className="warn">Above target</small>:null}</TableCell>
    <TableCell>{r.vendor}<small>{r.quoteReference}{r.entity==='BUILDERS'?' · Builders':' · Group'}</small></TableCell>
    <TableCell>{money(s.boqValue)}</TableCell><TableCell className="nw">{money(s.vendorValue)}</TableCell>
    <TableCell className="nw"><span className={s.savingVsBoq==null?'':s.savingVsBoq<0?'neg':'pos'}>{money(s.savingVsBoq)}</span><small>{pct(s.savingVsBoq,s.boqValue)}</small></TableCell>
   </TableRow>})}</TableBody></Table></div>}
   {!!pending.length&&<div className="approval-actions audit-actions">
    <p className="muted">{chosen.length?`${chosen.length} selected · vendor ${money(chosenTotals.vendor)} · saving ${money(chosenTotals.savingVsBoq)}${chosenTotals.aboveBoq?` · ${chosenTotals.aboveBoq} above BOQ`:''}`:'Select lines to decide.'}</p>
    <label className="field"><span>Decision note *</span><input value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} placeholder="e.g. Rates checked against BOQ and quotations"/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm I am authorized to record this audit decision.</label>
    <div className="actions"><button className="primary" disabled={busy||!chosen.length||!note.trim()||!confirmed} onClick={()=>decide('Approved')}>Approve {chosen.length||''}</button><button className="secondary" disabled={busy||!chosen.length||!note.trim()||!confirmed} onClick={()=>decide('ReturnQty')} title="The PM corrects the quantity, then BOQ releases again">Quantity issue → PM</button><button className="secondary" disabled={busy||!chosen.length||!note.trim()||!confirmed} onClick={()=>decide('ReturnPrice')} title="The BOQ team re-checks the rate">Price issue → BOQ</button><button className="secondary" disabled={busy||!chosen.length||!note.trim()||!confirmed} onClick={()=>decide('Returned')}>Renegotiate → Purchase</button><button className="secondary danger" disabled={busy||!chosen.length||!note.trim()||!confirmed} onClick={()=>decide('Rejected')}>Reject</button></div>
   </div>}
  </div>
  {error&&<p className="alert red" role="alert">{error}</p>}{message&&<p className="alert green" role="status">{message}</p>}
 </section>;
}
