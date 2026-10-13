'use client';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import WeekInput from './week-input';
import {PERIOD_OPTIONS,makePeriod,periodLabel,shiftPeriod,type Period} from '@/lib/weekly';

// Choose which Thursday–Wednesday weeks to look at: a quick preset, one week, or a range.
export default function PeriodPicker({period,onChange}:{period:Period;onChange:(p:Period)=>void}){
 const bounded=!!period.from&&!!period.to;
 return <div className="period-picker">
  <label className="field"><span>Weeks</span>
   <select className="period-select" value={period.key} onChange={e=>onChange(makePeriod(e.target.value,undefined,period.from||undefined,period.to||undefined))}>
    {PERIOD_OPTIONS.map(([k,l])=><option key={k} value={k}>{l}</option>)}
   </select>
  </label>
  {period.key==='week'&&<label className="field"><span>Week containing</span><WeekInput value={period.from!} onChange={v=>onChange(makePeriod('week',undefined,v))}/></label>}
  {period.key==='range'&&<>
   <label className="field"><span>From</span><WeekInput value={period.from!} onChange={v=>onChange(makePeriod('range',undefined,v,period.to!))}/></label>
   <label className="field"><span>To</span><WeekInput value={period.to!} onChange={v=>onChange(makePeriod('range',undefined,period.from!,v))}/></label>
  </>}
  <div className="period-nav">
   <button type="button" className="icon-btn" aria-label="Earlier weeks" disabled={!bounded} onClick={()=>onChange(shiftPeriod(period,-1))}><ChevronLeft size={16}/></button>
   <span className="period-label">{periodLabel(period)}</span>
   <button type="button" className="icon-btn" aria-label="Later weeks" disabled={!bounded} onClick={()=>onChange(shiftPeriod(period,1))}><ChevronRight size={16}/></button>
  </div>
 </div>;
}
