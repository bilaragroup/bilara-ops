'use client';
import {useEffect,useState} from 'react';
import Control from './control';
function LocalUserSwitch({current}:any){
 const [users,setUsers]=useState<any[]>([]),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 useEffect(()=>{fetch('/api/test-session').then(r=>r.ok?r.json():null).then((d:any)=>d&&setUsers(d.users));},[]);
 if(!users.length)return null;
 async function choose(email:string){setBusy(true);const r=await fetch('/api/test-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});if(r.ok)location.reload();else setBusy(false);}
 return <div className="test-user-switch"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}><span>Testing as</span><b>{current.name}</b><small>{current.roles.join(', ')}</small></button>{open&&<div className="test-user-menu"><strong>Switch test user</strong>{users.map(u=><button type="button" key={u.email} disabled={busy||u.email===current.email} onClick={()=>choose(u.email)}><span>{u.name}</span><small>{u.roles.join(', ')} · {u.email}</small></button>)}</div>}</div>;
}
export default function AccessGate(){const [user,setUser]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);useEffect(()=>{fetch('/api/me').then(async r=>{const d:any=await r.json();if(!r.ok)throw Error(d.error);setUser(d.user);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);return user?<Control user={user} testUserSwitch={<LocalUserSwitch current={user}/>}/>:<main className="access-gate"><img src="/bilara-logo-black.png" alt="Bilara Group"/><h1>{loading?'Opening your workspace…':'Bilara sign-in'}</h1>{error&&<p role="alert">{error}</p>}{!loading&&<a className="primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a>}</main>;}
