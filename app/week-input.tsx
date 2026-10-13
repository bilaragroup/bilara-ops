 'use client';
import {useEffect,useState} from 'react';
import {validWindow} from '@/lib/weekly';
export default function WeekInput({value,onChange,min,readOnly=false,required=false,name}: {value:string;onChange:(value:string)=>void;min?:string;readOnly?:boolean;required?:boolean;name?:string}){
 const [draft,setDraft]=useState(value),[error,setError]=useState('');
 useEffect(()=>{setDraft(value);setError('');},[value]);
 return <><input type="date" name={name} min={min||"1970-01-01"} step={7} readOnly={readOnly} required={required} value={draft} aria-invalid={!!error} onChange={e=>{const next=e.target.value;setDraft(next);if(validWindow(next)&&(!min||next>=min)){onChange(next);setError('');}}} onBlur={e=>{const next=e.currentTarget.value;if(!validWindow(next)||(min&&next<min)){setDraft(value);setError(min?'Choose a Thursday on or after '+min+'. The previous week is still selected.':'Choose a Thursday. The previous week is still selected.');}else{setDraft(next);onChange(next);setError('');}}}/>{error&&<small role="alert">{error}</small>}</>;
}
