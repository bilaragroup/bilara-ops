'use client';
import {forecastRequests} from '@/lib/forecast-requests';
import {money} from '@/lib/calculations';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';

export default function ForecastRequests({records,window,project,query,start,addSchedule,openOrders}:any){
 const rows=forecastRequests(records,window,project).filter(({request:r})=>[r.item,r.project,r.vendor].join(' ').toLowerCase().includes(query.toLowerCase()));
 if(!rows.length)return null;
 return <section className="panel tablepanel">
  <div className="tablebar"><h2>Ready to schedule <span className="tag">{rows.length}</span></h2></div>
  <Table><TableHeader><TableRow>{['Project / item','Required / vendor','Draft amount','Next step'].map(h=><TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(({request:r,remainingQty,estimate,unscheduled})=><TableRow key={r.id}>
   <TableCell><b>{r.item}</b><small>Project {r.project} · {r.kind==='request'?'Ad hoc':'Planned'}</small></TableCell>
   <TableCell>{r.due}<small>{r.vendor||'Vendor pending'}</small></TableCell>
   <TableCell>{unscheduled.length>0&&<div>{money(unscheduled.reduce((n,p)=>n+p.remaining,0))}<small>PO balance</small></div>}{remainingQty>0&&<div>{estimate===null?'Rate pending':money(estimate)}<small>{remainingQty} {r.unit} not ordered</small></div>}</TableCell>
   <TableCell><div className="order-actions">{unscheduled.map(p=><button key={p.id} className="textbutton" onClick={()=>addSchedule(p)}>Schedule · {p.po}</button>)}{remainingQty>0&&<button className="textbutton" onClick={()=>r.stage==='Audit approved'?openOrders():start(r.kind,r)}>{r.stage==='Audit approved'?'Create PO':'Complete request'}</button>}</div></TableCell>
  </TableRow>)}</TableBody></Table>
 </section>;
}
