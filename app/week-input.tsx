'use client';
import {useEffect,useState} from 'react';
import {validWindow,thursday} from '@/lib/weekly';
import {dateValid} from '@/lib/calculations';

// Weeks run Thursday to Wednesday and are stored as their Thursday.
// Any date can be picked; it snaps to the Thursday that starts its week
// (e.g. Tuesday 13 Oct → week of Thursday 8 Oct).
export default function WeekInput({value,onChange,min,readOnly=false,required=false,name}: {value:string;onChange:(value:string)=>void;min?:string;readOnly?:boolean;required?:boolean;name?:string}){
 const [draft,setDraft]=useState(value),[error,setError]=useState('');
 useEffect(()=>{setDraft(value);setError('');},[value]);
 function apply(picked:string,final:boolean){
  if(!dateValid(picked)){if(final){setDraft(value);setError('Choose a date. The previous week is still selected.');}return;}
  const week=validWindow(picked)?picked:thursday(picked);
  if(min&&week<min){if(final){setDraft(value);setError('Choose a week starting on or after '+min+'. The previous week is still selected.');}return;}
  setDraft(week);setError('');if(week!==value)onChange(week);
 }
 return <><input type="date" name={name} min={min?thursday(min):undefined} readOnly={readOnly} required={required} value={draft} aria-invalid={!!error} title="Any date picks its Thursday-to-Wednesday week" onChange={e=>{setDraft(e.target.value);apply(e.target.value,false);}} onBlur={e=>apply(e.currentTarget.value,true)}/>{error&&<small role="alert">{error}</small>}</>;
}
