'use client';
import {useEffect,useState} from 'react';
import {Moon,Sun} from 'lucide-react';
export default function ThemeToggle(){
 const [dark,setDark]=useState(false);
 useEffect(()=>{let saved=null;try{saved=localStorage.getItem('bilara-theme');}catch{}const enabled=saved?saved==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',enabled);setDark(enabled);},[]);
 function toggle(){const next=!dark;setDark(next);document.documentElement.classList.toggle('dark',next);try{localStorage.setItem('bilara-theme',next?'dark':'light');}catch{}}
 return <button className="secondary theme-toggle" onClick={toggle} aria-pressed={dark} aria-label={dark?'Switch to light mode':'Switch to dark mode'}>{dark?<Sun size={17}/>:<Moon size={17}/>}<span>{dark?'Light mode':'Dark mode'}</span></button>;
}
