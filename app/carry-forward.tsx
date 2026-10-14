'use client';
import {useEffect,useMemo,useState} from 'react';
import {Checkbox} from '@/components/ui/checkbox';
import WeekInput from './week-input';
import {addDays,inPeriod,singleWeek,weekLabel,type Period} from '@/lib/weekly';

// "Work slipped" carry-forward: move a project's approved, not-yet-ordered lines
// from this week's purchase plan to a later week. Approvals stay as they are.
const MOVABLE=['BOQ priced','Vendors finalized','Audit approved'];
const stageLabel:Record<string,string>={'BOQ priced':'BOQ approved','Vendors finalized':'With Audit','Audit approved':'Audit approved'};

export default function CarryForward({records,project,window,period,refresh,inline=false}:any){
 const per:Period=period||{key:'week',from:window,to:window},multi=!singleWeek(per);
 const ordered=useMemo(()=>new Set(records.filter((r:any)=>r.kind==='purchase'&&r.status!=='Cancelled').map((r:any)=>r.parent)),[records]);
 const lines=useMemo(()=>records.filter((r:any)=>['plan','request'].includes(r.kind)&&inPeriod(r.window,per)&&MOVABLE.includes(r.stage)&&r.closure?.state!=='Closed'&&(!r.gmApproval||r.gmApproval.state==='Approved')).sort((a:any,b:any)=>String(a.window).localeCompare(String(b.window))),[records,per.from,per.to]);
 const projects=[...new Set<string>(lines.map((r:any)=>r.project))].sort();
 const [chosenProject,setChosenProject]=useState(''),[selected,setSelected]=useState<string[]>([]),[to,setTo]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const p=project!=='all'?project:chosenProject;
 const rows=lines.filter((r:any)=>r.project===p).sort((a:any,b:any)=>String(a.activity).localeCompare(String(b.activity),undefined,{numeric:true})||String(a.item).localeCompare(String(b.item)));
 const movable=rows.filter((r:any)=>!ordered.has(r.id)),blocked=rows.filter((r:any)=>ordered.has(r.id));
 // Default selection: the earliest week's movable lines for the project; default target: the week after them.
 const firstWeek=movable[0]?.window||'';
 useEffect(()=>{setMessage('');setError('');},[per.from,per.to]);
 useEffect(()=>{setSelected(movable.filter((r:any)=>r.window===firstWeek).map((r:any)=>r.id));},[p,firstWeek,records]);
 const latest=movable.filter((r:any)=>selected.includes(r.id)).reduce((m:string,r:any)=>r.window>m?r.window:m,'');
 useEffect(()=>{if(latest&&(!to||to<=latest))setTo(addDays(latest,7));},[latest]);
 if(!projects.length)return null;
 const chosen=movable.filter((r:any)=>selected.includes(r.id));
 async function move(e:any){e.preventDefault();if(!chosen.length)return;setBusy(true);setError('');setMessage('');
  try{const res=await fetch('/api/reschedule',{method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:chosen.map((r:any)=>r.id),versions:Object.fromEntries(chosen.map((r:any)=>[r.id,r.version])),window:to,reason})});
   const d:any=await res.json();if(!res.ok)throw Error(d.error);
   setMessage(`${d.count} line${d.count===1?'':'s'} for project ${p} moved to the week of ${to}. Approvals kept.`);setReason('');await refresh({skipDocuments:true});
  }catch(err:any){setError(err?.name==='TimeoutError'?'The move timed out. Refresh and check before retrying.':err.message);}finally{setBusy(false);}
 }
 // inline: shown inside the "Work slipped?" dialog opened from the page header.
 const Wrap:any=inline?'div':'details';
 return <Wrap className={inline?'carry-forward carry-inline':'panel carry-forward'}>
  {!inline&&<summary><b>Work slipped? Move lines to a later week</b><span className="muted"> · no new approval needed</span></summary>}
  <form onSubmit={move} className="carry-body">
   <p className="muted">If the site work for this week does not happen (for example, concreting is postponed), move that project's lines to the next purchase plan. BOQ release, vendor rates and audit approval stay as they are, and the move is recorded in the history.</p>
   <div className="formgrid">
    {project==='all'&&<label className="field"><span>Project *</span><select className="carry-select" required value={chosenProject} onChange={e=>setChosenProject(e.target.value)}><option value="">Choose project</option>{projects.map(x=><option key={x} value={x}>{x}</option>)}</select></label>}
    <label className="field"><span>Move to week starting Thursday *</span><WeekInput value={to} onChange={setTo} required/></label>
    <label className="field full"><span>Reason *</span><input required minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Concreting postponed, shuttering not ready"/></label>
   </div>
   {p&&<div className="carry-lines">
    {!rows.length&&<p className="muted">No approved lines for project {p} this week.</p>}
    {movable.map((r:any)=><label key={r.id} className="carry-line"><Checkbox checked={selected.includes(r.id)} onCheckedChange={(v)=>setSelected(v?[...selected,r.id]:selected.filter(x=>x!==r.id))} aria-label={'Move '+r.item}/><span><b>{r.item}</b> · {r.kind==='plan'?r.boqQty:r.qty} {r.unit}<small>M{r.milestone} · Act {r.activity} {r.activityName} · {stageLabel[r.stage]}{multi?` · Week ${weekLabel(r.window)}`:''}{r.reschedule?.from?` · already moved from ${r.reschedule.from}`:''}</small></span></label>)}
    {blocked.map((r:any)=><div key={r.id} className="carry-line off"><span><b>{r.item}</b> · PO already issued<small>Change its delivery date in Purchase orders instead.</small></span></div>)}
   </div>}
   {error&&<p className="alert red" role="alert">{error}</p>}{message&&<p className="alert green" role="status">{message}</p>}
   <div className="actions"><button className="primary" disabled={busy||!chosen.length||!to||to<=latest||reason.trim().length<3}>{busy?'Moving…':`Move ${chosen.length||''} line${chosen.length===1?'':'s'} to ${to}`}</button></div>
  </form>
 </Wrap>;
}
