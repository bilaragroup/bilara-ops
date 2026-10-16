'use client';
import {useEffect,useMemo,useState} from 'react';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {money} from '@/lib/calculations';
import {inPeriod,periodLabel,singleWeek,weekLabel,type Period} from '@/lib/weekly';
import {lineSaving,planTotals,targetUnitRate} from '@/lib/purchase-plan';

// Purchase team's weekly purchase plan: BOQ-released items grouped by project. Review opens a
// project's lines; Edit lets Purchase enter vendor, rate, quote ref and entity; Save draft keeps
// the typing, Send to Audit saves and sends every complete line in one step (incomplete lines are
// kept as a draft). Rows save one by one through the existing audited record API, so every rule
// and permission applies. GM and Audit see the plan read only.

type Edit={vendor:string;vendorPhone:string;quoteRate:string;quoteReference:string;entity:string;version?:number};
const editable=(r:any)=>r.stage==='BOQ priced'&&r.closure?.state!=='Closed';
const fromRecord=(r:any):Edit=>({version:r.version,vendor:r.vendor||'',vendorPhone:r.vendorPhone||'',quoteRate:r.quoteRate===''||r.quoteRate==null?'':String(r.quoteRate),quoteReference:r.quoteReference||'',entity:r.entity||'GROUP'});
const stageTag=(r:any)=>r.stage==='Audit approved'?<span className="tag green">Audit approved</span>:r.stage==='Vendors finalized'?<span className="tag amber">With Audit</span>:r.stage==='Rejected'?<span className="tag red">Rejected</span>:r.stage==='Cancelled'?<span className="tag red">Cancelled</span>:r.auditReturn?<span className="tag red">Sent back by Audit</span>:<span className="tag">To price</span>;

export default function PurchasePlan({records,project,window,period,refresh,openRecord,canEdit=true}:any){
 const per:Period=period||{key:'week',from:window,to:window},multi=!singleWeek(per);
 const rows=useMemo(()=>records.filter((r:any)=>['plan','request'].includes(r.kind)&&inPeriod(r.window,per)&&(project==='all'||r.project===project)&&['BOQ priced','Vendors finalized','Audit approved'].includes(r.stage)).sort((a:any,b:any)=>a.project.localeCompare(b.project)||String(a.window).localeCompare(String(b.window))||String(a.item).localeCompare(String(b.item))),[records,project,per.from,per.to]);
 const [edits,setEdits]=useState<Record<string,Edit>>({}),[busy,setBusy]=useState(''),[results,setResults]=useState<{project:string;sent:number;saved:number;errors:string[]}|null>(null);
 const [open,setOpen]=useState<string[]>([]),[editing,setEditing]=useState('');
 // Keep unsaved typing for lines that did not change on the server (e.g. after a partial save).
 useEffect(()=>{setEdits(prev=>Object.fromEntries(rows.filter(editable).map((r:any)=>[r.id,prev[r.id]?.version===r.version?prev[r.id]:fromRecord(r)])));},[rows]);
 const draft=(r:any)=>({...r,...(edits[r.id]||{}),quoteRate:edits[r.id]?.quoteRate===''?'':Number(edits[r.id]?.quoteRate??r.quoteRate)});
 const changed=(r:any)=>{const e=edits[r.id];if(!e)return false;const o=fromRecord(r);return (['vendor','vendorPhone','quoteRate','quoteReference','entity'] as const).some(k=>e[k]!==o[k]);};
 const set=(id:string,k:Exclude<keyof Edit,'version'>,v:string)=>setEdits(x=>({...x,[id]:{...x[id],[k]:v}}));
 const toPrice=rows.filter(editable),withAudit=rows.filter((r:any)=>r.stage==='Vendors finalized'),approved=rows.filter((r:any)=>r.stage==='Audit approved');
 const totals=planTotals(rows.map(draft));
 const ready=(r:any)=>{const e=edits[r.id];return !!e&&!!e.vendor.trim()&&e.quoteRate!==''&&Number(e.quoteRate)>=0&&!!e.quoteReference.trim();};
 const projects=[...new Set(rows.map((r:any)=>r.project))] as string[];
 // Save draft: changed lines only. Send to Audit: every complete line is saved and sent; incomplete changed lines are kept as a draft.
 async function save(p:string,send:boolean){
  setBusy(p+(send?':send':':save'));setResults(null);const errors:string[]=[];let sent=0,saved=0;
  for(const r of toPrice.filter((x:any)=>x.project===p)){const e=edits[r.id];if(!e)continue;
   const go=send&&ready(r);if(!go&&!changed(r))continue;
   try{const res=await fetch('/api/records',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,version:r.version,vendor:e.vendor.trim(),vendorPhone:e.vendorPhone.trim(),quoteRate:e.quoteRate===''?'':Number(e.quoteRate),quoteReference:e.quoteReference.trim(),entity:e.entity,...(go?{stage:'Vendors finalized'}:{})})});
    const d:any=await res.json();if(!res.ok)throw Error(d.error);go?sent++:saved++;}
   catch(err:any){errors.push(`${r.item}: ${err?.name==='TimeoutError'?'timed out, refresh and retry':err.message}`);}
  }
  const left=send?toPrice.filter((x:any)=>x.project===p&&!ready(x)).length:0;
  if(send&&left)errors.push(`${left} line${left===1?' is':'s are'} not complete (vendor, rate and quote ref.) and stay${left===1?'s':''} here as a draft.`);
  setResults({project:p,sent,saved,errors});if(!errors.length||send)setEditing('');await refresh({skipDocuments:true});setBusy('');
 }
 const toggle=(p:string)=>{setOpen(o=>o.includes(p)?o.filter(x=>x!==p):[...o,p]);if(editing===p)setEditing('');};
 return <section className="purchase-plan">
  <div className="metrics plan-metrics">
   <div className="metric"><p>Plan value at vendor rates</p><strong>{money(totals.vendor)}</strong><small>{rows.length-totals.missing} of {rows.length} lines priced · {periodLabel(per)}</small></div>
   <div className="metric"><p>Saving against target</p><strong className={totals.savingVsTarget<0?'neg':''}>{money(totals.savingVsTarget)}</strong><small>Target budget {money(totals.target)}</small></div>
   <div className="metric"><p>Lines above target</p><strong>{totals.aboveTarget}</strong><small>Audit will see these flagged</small></div>
   <div className="metric"><p>Progress</p><strong>{approved.length}/{rows.length}</strong><small>{toPrice.length} to price · {withAudit.length} with Audit</small></div>
  </div>
  {!rows.length&&<div className="panel empty"><h3>Nothing to price for these weeks</h3><p>Items appear here after the BOQ team approves the request. Change the weeks or project above.</p></div>}
  {projects.map(p=>{
   const list=rows.filter((r:any)=>r.project===p),price=list.filter(editable),isOpen=open.includes(p),isEdit=editing===p&&canEdit,t=planTotals(list.map(draft)),dirty=price.filter(changed).length;
   return <div key={p} className="panel tablepanel plan-project">
    <div className="tablebar plan-project-bar">
     <div><h2>Project {p}</h2><p>{list.length} line{list.length===1?'':'s'} · {price.length} to price · {list.filter((r:any)=>r.stage==='Vendors finalized').length} with Audit · {list.filter((r:any)=>r.stage==='Audit approved').length} approved · {money(t.vendor)}</p></div>
     <div className="actions plan-actions">
      {isOpen&&canEdit&&!!price.length&&!isEdit&&<button className="secondary" onClick={()=>setEditing(p)}>Edit</button>}
      {isEdit&&<><button className="secondary" disabled={!!busy||!dirty} onClick={()=>save(p,false)}>{busy===p+':save'?'Saving…':'Save draft'}</button>
       <button className="primary" disabled={!!busy} onClick={()=>save(p,true)}>{busy===p+':send'?'Sending…':'Send to Audit'}</button></>}
      <button className={isOpen?'textbutton':'primary'} onClick={()=>toggle(p)}>{isOpen?'Close':'Review'}</button>
     </div>
    </div>
    {results?.project===p&&<p className={'alert plan-result '+(results.errors.length?'amber':'green')} role="status">{results.sent?`${results.sent} sent to Audit. `:''}{results.saved?`${results.saved} saved as draft. `:''}{!results.sent&&!results.saved&&!results.errors.length?'No changes to save.':''}{results.errors.join(' ')}</p>}
    {isOpen&&<div className="plan-scroll"><Table><TableHeader><TableRow>
     <TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Target rate</TableHead><TableHead>Vendor</TableHead><TableHead>Vendor rate</TableHead><TableHead>Quote ref.</TableHead><TableHead>Entity</TableHead><TableHead>Value</TableHead><TableHead>Saving vs target</TableHead>
    </TableRow></TableHeader><TableBody>{list.map((r:any)=>{const e=edits[r.id],can=isEdit&&editable(r)&&!!e,d=draft(r),s=lineSaving(d);return <TableRow key={r.id} className={s.aboveTarget?'row-warn':''}>
     <TableCell><button className="rowlink" onClick={()=>openRecord(r)}><b>{r.item}</b><span>M{r.milestone} · Act {r.activity} {r.activityName}{r.kind==='request'?' · Ad hoc':''}{multi?' · Week '+weekLabel(r.window):''}</span></button><div className="plan-status">{stageTag(r)}{changed(r)&&<span className="tag amber">Draft</span>}{r.reschedule?.from&&<span className="tag">Moved from {r.reschedule.from}</span>}</div>{r.auditReturn&&r.stage==='BOQ priced'&&<small className="audit-note">Audit: {r.auditReturn.note}</small>}</TableCell>
     <TableCell className="nw">{s.qty} {r.unit}</TableCell>
     <TableCell className="nw">{targetUnitRate(r)??'—'}</TableCell>
     <TableCell>{can?<><input className="plan-input" aria-label="Vendor" placeholder="Vendor" value={e.vendor} maxLength={200} onChange={x=>set(r.id,'vendor',x.target.value)}/><input className="plan-input small" aria-label="Vendor phone" placeholder="Phone" value={e.vendorPhone} maxLength={40} onChange={x=>set(r.id,'vendorPhone',x.target.value)}/></>:<>{d.vendor||'—'}<small>{d.vendorPhone}</small></>}</TableCell>
     <TableCell>{can?<input className="plan-input num" aria-label="Vendor unit rate" inputMode="decimal" type="number" min={0} step="0.01" value={e.quoteRate} onChange={x=>set(r.id,'quoteRate',x.target.value)}/>:(d.quoteRate===''||d.quoteRate==null?'—':d.quoteRate)}</TableCell>
     <TableCell>{can?<input className="plan-input small" aria-label="Quotation reference" placeholder="Quote ref" value={e.quoteReference} maxLength={200} onChange={x=>set(r.id,'quoteReference',x.target.value)}/>:(d.quoteReference||'—')}</TableCell>
     <TableCell>{can?<select className="plan-input small" aria-label="Purchasing entity" value={e.entity} onChange={x=>set(r.id,'entity',x.target.value)}><option value="GROUP">Group</option><option value="BUILDERS">Builders</option></select>:(d.entity==='BUILDERS'?'Builders':'Group')}</TableCell>
     <TableCell className="nw">{money(s.vendorValue)}</TableCell>
     <TableCell className="nw"><span className={s.savingVsTarget==null?'':s.savingVsTarget<0?'neg':'pos'}>{money(s.savingVsTarget)}</span>{s.aboveTarget&&<small className="neg">Above target</small>}</TableCell>
    </TableRow>})}</TableBody></Table></div>}
   </div>;})}
 </section>;
}
