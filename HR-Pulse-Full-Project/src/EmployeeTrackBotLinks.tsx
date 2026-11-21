import {useEffect,useState} from 'react';
import {api} from './api';
import {deliveryText,botName} from './TrialStatusBotLinks';

/* Approval Master › Employee Track bot (owner, 21 Nov 2026). New employees go out on the CALIBER Employee Track bot, one step at a time:
   Site HR initiates → Site PM → Office HR → Regional HR → Directors (approve, or OTP as backup) → employee Active (OB / COAL sites, owner 21 Nov 2026). Everyone on the route is listed with a personal
   join link: sent through an HR bot they already use, or copied to forward on WhatsApp. */
type Delivery={state:'DELIVERED'|'WAITING'|'FAILED'|'FORWARD'|'EXPIRED';bot:string;at:string;error:string}|null;
type Person={actor:string;name?:string;stage:string;roles:string[];connected:boolean;via:string;status?:string;url?:string;delivery?:Delivery};
type Roster={people:Person[];botUsername:string;configured?:boolean};
export const EMPLOYEE_TRACK_ROUTE=['Site HR','PM / HOD','Office HR','Regional HR','Directors (OTP)'];

export default function EmployeeTrackBotLinks({grant}:{grant:string}){
 const[data,setData]=useState<Roster|null>(null),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const[stage,setStage]=useState('All'),[search,setSearch]=useState(''),[forward,setForward]=useState<Record<string,{url:string;copied:boolean}>>({}),[making,setMaking]=useState('');
 async function load(){setError('');try{setData(await api<Roster>(grant,'telegram/employee-track-links'));setSent(false);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 async function send(){setBusy(true);setError('');try{setData(await api<Roster>(grant,'telegram/employee-track-links','POST',{}));setSent(true);setConfirming(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function forwardLink(p:Person){setMaking(p.actor);setError('');
  try{const r=await api<{url:string;message:string}>(grant,'telegram/employee-track-link','POST',{actor:p.actor});
   let copied=false;try{await navigator.clipboard.writeText(r.message);copied=true;}catch{/* shown to copy by hand */}
   setForward(f=>({...f,[p.actor]:{url:r.url,copied}}));}
  catch(e){setError((e as Error).message);}finally{setMaking('');}}
 const people=data?.people||[],waiting=people.filter(p=>!p.connected),reachable=waiting.filter(p=>p.via);
 const term=search.trim().toLowerCase();
 const shown=people.filter(p=>(stage==='All'||p.roles.some(role=>role.startsWith(stage+' ·')))&&(!term||p.actor.includes(term)||String(p.name||'').toLowerCase().includes(term)||p.roles.join(' ').toLowerCase().includes(term)));
 const linkCell=(p:Person)=>{
  if(sent)return <>{p.status}{p.url&&<> <input readOnly aria-label={`Join link for ${p.actor}`} value={p.url} onFocus={e=>e.currentTarget.select()} style={{width:'14em'}}/></>}</>;
  if(p.connected)return '—';
  return <>{deliveryText(p.delivery)}<div className="addition-forward">{forward[p.actor]
   ?<><input readOnly aria-label={`Forward link for ${p.actor}`} value={forward[p.actor].url} onFocus={e=>e.currentTarget.select()} style={{width:'14em'}}/> <span role="status">{forward[p.actor].copied?'Copied with a note – paste it on WhatsApp':'Select the link and copy it'}</span></>
   :<button disabled={making===p.actor||data?.configured===false} onClick={()=>void forwardLink(p)}>{making===p.actor?'Making link…':'Copy link to forward'}</button>}</div></>;};
 return <section className="data-card" aria-label="Employee Track bot">
  <div className="data-heading"><div><h2>Employee Track bot{data?.botUsername?` · @${data.botUsername}`:''}</h2>
   <p className="help-text">Site HR starts every new employee in HRMS › Employee Management. At OB / COAL sites the form then goes on this bot to the Site PM, then Office HR, then Regional HR, each with Approve / Reject buttons (the two offices go straight to their HR Manager). When Regional HR approves, the Directors get Approve / Reject and an OTP here: any one Director approves directly, or, when out of station, tells the OTP to Regional HR, who enters it in HRMS. Either way the employee becomes Active and shows in Completed Form. Site HR is told the result. Each person must open their own join link once and tap Start.</p></div>
   <button disabled={busy} onClick={()=>void load()}>Refresh</button></div>
  <ol className="trial-route-strip" aria-label="New employee approval route">{EMPLOYEE_TRACK_ROUTE.map(step=><li key={step}>{step}</li>)}<li className="done">Active</li></ol>
  {error&&<p className="error" role="alert">{error}</p>}
  {data?.configured===false&&<p className="error" role="alert">The Employee Track bot is not configured on the server (TELEGRAM_EMPLOYEE_TRACK_BOT_TOKEN and _USERNAME).</p>}
  {data&&!sent&&<p role="status"><b>{people.length-waiting.length}</b> of {people.length} joined · <b>{reachable.length}</b> can be sent a link on Telegram · <b>{waiting.length-reachable.length}</b> are on no HR bot (copy their link to forward).</p>}
  {sent&&<p role="status">Links sent. Telegram delivers them within a few minutes; people on no HR bot are listed with a link to forward. Press Refresh to see the Link delivery column.</p>}
  {data&&!sent&&waiting.length>0&&(confirming
   ?<p className="addition-confirm">Send an Employee Track join link to {waiting.length} {waiting.length===1?'person':'people'} ({reachable.length} on Telegram, {waiting.length-reachable.length} to forward)? <button className="primary" disabled={busy} onClick={()=>void send()}>{busy?'Sending…':'Yes, send'}</button> <button disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button></p>
   :<button className="primary" disabled={busy||data.configured===false} onClick={()=>setConfirming(true)}>Send join links to all ({waiting.length})</button>)}
  {data&&!waiting.length&&<p>Everyone on the route has joined the Employee Track bot.</p>}
  {data&&<div className="module-tabs" aria-label="Show step">{['All',...EMPLOYEE_TRACK_ROUTE].map(name=><button key={name} type="button" className={stage===name?'selected':''} aria-pressed={stage===name} onClick={()=>setStage(name)}>{name}</button>)}</div>}
  {data&&<label>Search<input type="search" value={search} placeholder="Login, name or site" onChange={e=>setSearch(e.target.value)}/></label>}
  {data&&<div className="table-scroll" role="region" aria-label="People on the new employee route" tabIndex={0}><table><thead><tr><th scope="col">Pulse login</th><th scope="col">Name</th><th scope="col">Step · site</th><th scope="col">Employee Track bot</th><th scope="col">{sent?'Result':'Can reach on'}</th>{!sent&&<th scope="col">Link delivery</th>}</tr></thead>
   <tbody>{shown.map(p=><tr key={p.actor}><td>{p.actor}</td><td>{p.name||'—'}</td><td>{p.roles.map(role=><div key={role}>{role}</div>)}</td><td>{p.connected?'✅ Joined':'Not yet'}</td>
    {sent?<td>{linkCell(p)}</td>:<><td>{p.connected?'—':botName(p.via)||'No HR bot'}</td><td>{linkCell(p)}</td></>}</tr>)}</tbody></table></div>}
 </section>;
}
