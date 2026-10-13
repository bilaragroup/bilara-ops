'use client';
import {useEffect,useMemo,useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {money} from '@/lib/calculations';
import {inPeriod,periodLabel,singleWeek,weekLabel,type Period} from '@/lib/weekly';
import {lineSaving,planTotals,targetUnitRate} from '@/lib/purchase-plan';
import CarryForward from './carry-forward';

// Purchase team's weekly purchase plan: every BOQ-released item for the week in
// one table. They enter the vendor and rate for each line, see the saving against
// the purchasing target, and send the lines to Audit. Rows save one by one through
// the existing audited record API, so every existing rule and permission applies.

type Edit={vendor:string;vendorPhone:string;quoteRate:string;quoteReference:string;entity:string;version?:number};
const editable=(r:any)=>r.stage==='BOQ priced'&&r.closure?.state!=='Closed';
const fromRecord=(r:any):Edit=>({version:r.version,vendor:r.vendor||'',vendorPhone:r.vendorPhone||'',quoteRate:r.quoteRate===''||r.quoteRate==null?'':String(r.quoteRate),quoteReference:r.quoteReference||'',entity:r.entity||'GROUP'});
const stageTag=(r:any)=>r.stage==='Audit approved'?<span className="tag green">Audit approved</span>:r.stage==='Vendors finalized'?<span className="tag amber">With Audit</span>:r.stage==='Rejected'?<span className="tag red">Rejected</span>:r.auditReturn?<span className="tag red">Sent back by Audit</span>:<span className="tag">To price</span>;

export default function PurchasePlan({records,project,window,period,refresh,openRecord}:any){
 const per:Period=period||{key:'week',from:window,to:window},multi=!singleWeek(per);
 const rows=useMemo(()=>records.filter((r:any)=>['plan','request'].includes(r.kind)&&inPeriod(r.window,per)&&(project==='all'||r.project===project)&&['BOQ priced','Vendors finalized','Audit approved'].includes(r.stage)).sort((a:any,b:any)=>String(a.window).localeCompare(String(b.window))||a.project.localeCompare(b.project)||String(a.item).localeCompare(String(b.item))),[records,project,per.from,per.to]);
 const [edits,setEdits]=useState<Record<string,Edit>>({}),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[results,setResults]=useState<{ok:number;errors:string[]}|null>(null);
 // Keep unsaved typing for lines that did not change on the server (e.g. after a partial save).
 useEffect(()=>{setEdits(prev=>Object.fromEntries(rows.filter(editable).map((r:any)=>[r.id,prev[r.id]?.version===r.version?prev[r.id]:fromRecord(r)])));setSelected(s=>s.filter(id=>rows.some((r:any)=>r.id===id&&editable(r))));},[rows]);
 const draft=(r:any)=>({...r,...(edits[r.id]||{}),quoteRate:edits[r.id]?.quoteRate===''?'':Number(edits[r.id]?.quoteRate??r.quoteRate)});
 const changed=(r:any)=>{const e=edits[r.id];if(!e)return false;const o=fromRecord(r);return (['vendor','vendorPhone','quoteRate','quoteReference','entity'] as const).some(k=>e[k]!==o[k]);};
 const set=(id:string,k:Exclude<keyof Edit,'version'>,v:string)=>setEdits(x=>({...x,[id]:{...x[id],[k]:v}}));
 const toPrice=rows.filter(editable),withAudit=rows.filter((r:any)=>r.stage==='Vendors finalized'),approved=rows.filter((r:any)=>r.stage==='Audit approved');
 const totals=planTotals(rows.map(draft));
 const ready=(r:any)=>{const e=edits[r.id];return !!e&&!!e.vendor.trim()&&e.quoteRate!==''&&Number(e.quoteRate)>=0&&!!e.quoteReference.trim();};
 async function save(ids:string[],send:boolean){
  setBusy(true);setResults(null);const errors:string[]=[];let ok=0;
  for(const id of ids){const r=rows.find((x:any)=>x.id===id),e=edits[id];if(!r||!e)continue;
   if(!send&&!changed(r))continue;
   if(send&&!ready(r)){errors.push(`${r.item} (Project ${r.project}): enter vendor, rate and quotation reference first.`);continue;}
   try{const res=await fetch('/api/records',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.id,version:r.version,vendor:e.vendor.trim(),vendorPhone:e.vendorPhone.trim(),quoteRate:e.quoteRate===''?'':Number(e.quoteRate),quoteReference:e.quoteReference.trim(),entity:e.entity,...(send?{stage:'Vendors finalized'}:{})})});
    const d:any=await res.json();if(!res.ok)throw Error(d.error);ok++;}
   catch(err:any){errors.push(`${r.item} (Project ${r.project}): ${err?.name==='TimeoutError'?'timed out, refresh and retry':err.message}`);}
  }
  setResults({ok,errors});setSelected([]);await refresh({skipDocuments:true});setBusy(false);
 }
 const dirty=toPrice.filter(changed).map((r:any)=>r.id);
 const allSelected=!!toPrice.length&&selected.length===toPrice.length;
 return <section className="purchase-plan">
  <div className="metrics plan-metrics">
   <div className="metric"><p>Plan value at vendor rates</p><strong>{money(totals.vendor)}</strong><small>{rows.length-totals.missing} of {rows.length} lines priced · {periodLabel(per)}</small></div>
   <div className="metric"><p>Saving against target</p><strong className={totals.savingVsTarget<0?'neg':''}>{money(totals.savingVsTarget)}</strong><small>Target budget {money(totals.target)}</small></div>
   <div className="metric"><p>Lines above target</p><strong>{totals.aboveTarget}</strong><small>Audit will see these flagged</small></div>
   <div className="metric"><p>Progress</p><strong>{approved.length}/{rows.length}</strong><small>{toPrice.length} to price · {withAudit.length} with Audit</small></div>
  </div>
  <div className="panel tablepanel">
   <div className="tablebar"><div><h2>Purchase plan</h2><p>Enter the vendor and rate for every BOQ-approved item, then send the plan to Audit. Lines sent back by Audit return here.</p></div>
    <div className="actions"><button className="secondary" disabled={busy||!dirty.length} onClick={()=>save(dirty,false)}>{busy?'Saving…':`Save ${dirty.length||''} change${dirty.length===1?'':'s'}`}</button><button className="primary" disabled={busy||!selected.length} onClick={()=>save(selected,true)}>Send {selected.length||''} to Audit</button></div></div>
   {!rows.length?<div className="empty"><h3>Nothing to price for this week</h3><p>Items appear here after the BOQ team approves the request. Change the execution week or project above.</p></div>:
   <div className="plan-scroll"><Table><TableHeader><TableRow>
    <TableHead><Checkbox aria-label="Select all lines to send" checked={allSelected} disabled={!toPrice.length} onCheckedChange={(v)=>setSelected(v?toPrice.map((r:any)=>r.id):[])}/></TableHead>
    <TableHead>Project / item</TableHead><TableHead>Qty</TableHead><TableHead>Target rate</TableHead><TableHead>Vendor</TableHead><TableHead>Vendor rate</TableHead><TableHead>Quote ref.</TableHead><TableHead>Entity</TableHead><TableHead>Value</TableHead><TableHead>Saving vs target</TableHead>
   </TableRow></TableHeader><TableBody>{rows.map((r:any)=>{const e=edits[r.id],can=editable(r)&&!!e,d=draft(r),s=lineSaving(d);return <TableRow key={r.id} className={s.aboveTarget?'row-warn':''}>
    <TableCell>{can&&<Checkbox aria-label={'Select '+r.item} checked={selected.includes(r.id)} onCheckedChange={(v)=>setSelected(v?[...selected,r.id]:selected.filter(x=>x!==r.id))}/>}</TableCell>
    <TableCell><button className="rowlink" onClick={()=>openRecord(r)}><b>{r.item}</b><span>Project {r.project} · M{r.milestone} · Act {r.activity} {r.activityName}{r.kind==='request'?' · Ad hoc':''}{multi?' · Week '+weekLabel(r.window):''}</span></button><div className="plan-status">{stageTag(r)}{r.reschedule?.from&&<span className="tag">Moved from {r.reschedule.from}</span>}</div>{r.auditReturn&&r.stage==='BOQ priced'&&<small className="audit-note">Audit: {r.auditReturn.note}</small>}</TableCell>
    <TableCell className="nw">{s.qty} {r.unit}</TableCell>
    <TableCell className="nw">{targetUnitRate(r)??'—'}</TableCell>
    <TableCell>{can?<><input className="plan-input" aria-label="Vendor" placeholder="Vendor" value={e.vendor} maxLength={200} onChange={x=>set(r.id,'vendor',x.target.value)}/><input className="plan-input small" aria-label="Vendor phone" placeholder="Phone" value={e.vendorPhone} maxLength={40} onChange={x=>set(r.id,'vendorPhone',x.target.value)}/></>:<>{r.vendor||'—'}<small>{r.vendorPhone}</small></>}</TableCell>
    <TableCell>{can?<input className="plan-input num" aria-label="Vendor unit rate" inputMode="decimal" type="number" min={0} step="0.01" value={e.quoteRate} onChange={x=>set(r.id,'quoteRate',x.target.value)}/>:(r.quoteRate??'—')}</TableCell>
    <TableCell>{can?<input className="plan-input small" aria-label="Quotation reference" placeholder="Quote ref" value={e.quoteReference} maxLength={200} onChange={x=>set(r.id,'quoteReference',x.target.value)}/>:(r.quoteReference||'—')}</TableCell>
    <TableCell>{can?<select className="plan-input small" aria-label="Purchasing entity" value={e.entity} onChange={x=>set(r.id,'entity',x.target.value)}><option value="GROUP">Group</option><option value="BUILDERS">Builders</option></select>:(r.entity==='BUILDERS'?'Builders':'Group')}</TableCell>
    <TableCell className="nw">{money(s.vendorValue)}</TableCell>
    <TableCell className="nw"><span className={s.savingVsTarget==null?'':s.savingVsTarget<0?'neg':'pos'}>{money(s.savingVsTarget)}</span>{s.aboveTarget&&<small className="neg">Above target</small>}</TableCell>
   </TableRow>})}</TableBody></Table></div>}
  </div>
  <CarryForward records={records} project={project} window={window} period={per} refresh={refresh}/>
  {results&&<p className={'alert '+(results.errors.length?'amber':'green')} role="status">{results.ok} line{results.ok===1?'':'s'} saved.{results.errors.length?' Not saved: '+results.errors.join(' · '):''}</p>}
 </section>;
}
