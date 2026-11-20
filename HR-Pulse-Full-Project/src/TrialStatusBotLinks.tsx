import {useEffect,useState} from 'react';
import {api} from './api';

/* Approval Master › Trial Status bot (owner, 20 Nov 2026): replaces the Employee Addition bot tab.
   Vehicle trial forms go out on @CMLLTrialStatusBot one stage at a time, only to that stage's people for the form's site:
   Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors. Everyone on those routes is listed here with
   their personal connect link: sent through an HR bot they already use, or copied to forward on WhatsApp. */
type Delivery={state:'DELIVERED'|'WAITING'|'FAILED'|'FORWARD'|'EXPIRED';bot:string;at:string;error:string}|null;
type Person={actor:string;stage:string;roles:string[];connected:boolean;via:string;status?:string;url?:string;delivery?:Delivery};
type Roster={people:Person[];botUsername:string;configured?:boolean};
export const TRIAL_ROUTE=['Site HR','Driver Trainer','PM','Office HR','Regional HR','Director'];
const when=(at:string)=>at?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(new Date(at)):'';
const botName=(via:string)=>via==='mt'?'CMLL HR bot':via==='leave'?'Leave bot':via==='joining'?'Joining Approval bot':via==='trial'?'Vehicle Trial bot':'';
export function deliveryText(d:Delivery|undefined){
 if(!d)return 'No link sent';
 if(d.state==='DELIVERED')return `✅ Delivered on ${botName(d.bot)} · ${when(d.at)}`;
 if(d.state==='WAITING')return `⏳ Waiting on ${botName(d.bot)}${d.error?` – ${d.error}`:''}`;
 if(d.state==='FAILED')return `❌ Failed on ${botName(d.bot)}${d.error?` – ${d.error}`:''}`;
 if(d.state==='FORWARD')return `🔗 Link given to forward · valid till ${when(d.at)}`;
 return '⌛ Forwarded link expired – make a new one';
}

export default function TrialStatusBotLinks({grant}:{grant:string}){
 const[data,setData]=useState<Roster|null>(null),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false);
 const[stage,setStage]=useState('All'),[forward,setForward]=useState<Record<string,{url:string;copied:boolean}>>({}),[making,setMaking]=useState('');
 async function load(){setError('');try{setData(await api<Roster>(grant,'telegram/trial-status-links'));setSent(false);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 async function send(){setBusy(true);setError('');try{setData(await api<Roster>(grant,'telegram/trial-status-links','POST',{}));setSent(true);setConfirming(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 /* A fresh personal link for one person, copied with a short note, to send on WhatsApp. */
 async function forwardLink(p:Person){setMaking(p.actor);setError('');
  try{const r=await api<{url:string;message:string}>(grant,'telegram/trial-status-link','POST',{actor:p.actor});
   let copied=false;try{await navigator.clipboard.writeText(r.message);copied=true;}catch{/* shown to copy by hand */}
   setForward(f=>({...f,[p.actor]:{url:r.url,copied}}));}
  catch(e){setError((e as Error).message);}finally{setMaking('');}}
 const people=data?.people||[],waiting=people.filter(p=>!p.connected),reachable=waiting.filter(p=>p.via);
 const shown=stage==='All'?people:people.filter(p=>p.roles.some(role=>role.startsWith(stage+' ·')));
 const linkCell=(p:Person)=>{
  if(sent)return <>{p.status}{p.url&&<> <input readOnly aria-label={`Connect link for ${p.actor}`} value={p.url} onFocus={e=>e.currentTarget.select()} style={{width:'14em'}}/></>}</>;
  if(p.connected)return '—';
  return <>{deliveryText(p.delivery)}<div className="addition-forward">{forward[p.actor]
   ?<><input readOnly aria-label={`Forward link for ${p.actor}`} value={forward[p.actor].url} onFocus={e=>e.currentTarget.select()} style={{width:'14em'}}/> <span role="status">{forward[p.actor].copied?'Copied with a note – paste it on WhatsApp':'Select the link and copy it'}</span></>
   :<button disabled={making===p.actor||data?.configured===false} onClick={()=>void forwardLink(p)}>{making===p.actor?'Making link…':'Copy link to forward'}</button>}</div></>;};
 return <section className="data-card" aria-label="Trial Status bot">
  <div className="data-heading"><div><h2>Trial Status bot{data?.botUsername?` · @${data.botUsername}`:''}</h2>
   <p className="help-text">Vehicle trial forms come on this bot one step at a time. When Site HR starts a form, only that site's Driver Trainer gets it; after the trial PASS / FAIL only the PM; after the PM approves only Office HR; then Regional HR (NCL – Vinod Pinjarkar, WCL – Virat Singh); then the Directors. Each person must open their own link once and tap Start.</p></div>
   <button disabled={busy} onClick={()=>void load()}>Refresh</button></div>
  <ol className="trial-route-strip" aria-label="Trial approval route">{TRIAL_ROUTE.map(step=><li key={step}>{step}</li>)}<li className="done">Active</li></ol>
  {error&&<p className="error" role="alert">{error}</p>}
  {data?.configured===false&&<p className="error" role="alert">The Trial Status bot is not configured on the server (TELEGRAM_TRIAL_STATUS_BOT_TOKEN and _USERNAME).</p>}
  {data&&!sent&&<p role="status"><b>{people.length-waiting.length}</b> of {people.length} connected · <b>{reachable.length}</b> can be sent a link on Telegram · <b>{waiting.length-reachable.length}</b> are on no HR bot (copy their link to forward).</p>}
  {sent&&<p role="status">Links sent. Telegram delivers them within a minute; people on no HR bot are listed with a link to forward. Press Refresh to see the Link delivery column.</p>}
  {data&&!sent&&waiting.length>0&&(confirming
   ?<p className="addition-confirm">Send a Trial Status connect link to {waiting.length} {waiting.length===1?'person':'people'} ({reachable.length} on Telegram, {waiting.length-reachable.length} to forward)? <button className="primary" disabled={busy} onClick={()=>void send()}>{busy?'Sending…':'Yes, send'}</button> <button disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button></p>
   :<button className="primary" disabled={busy||data.configured===false} onClick={()=>setConfirming(true)}>Send connect links ({waiting.length})</button>)}
  {data&&!waiting.length&&<p>Everyone on the trial routes is connected.</p>}
  {data&&<div className="module-tabs" aria-label="Show step">{['All',...TRIAL_ROUTE].map(name=><button key={name} type="button" className={stage===name?'selected':''} aria-pressed={stage===name} onClick={()=>setStage(name)}>{name}</button>)}</div>}
  {data&&<div className="table-scroll" role="region" aria-label="People on the vehicle trial routes" tabIndex={0}><table><thead><tr><th scope="col">Pulse login</th><th scope="col">Step · site</th><th scope="col">Trial Status bot</th><th scope="col">{sent?'Result':'Can reach on'}</th>{!sent&&<th scope="col">Link delivery</th>}</tr></thead>
   <tbody>{shown.map(p=><tr key={p.actor}><td>{p.actor}</td><td>{p.roles.map(role=><div key={role}>{role}</div>)}</td><td>{p.connected?'✅ Connected':'Not yet'}</td>
    {sent?<td>{linkCell(p)}</td>:<><td>{p.connected?'—':botName(p.via)||'No HR bot'}</td><td>{linkCell(p)}</td></>}</tr>)}</tbody></table></div>}
 </section>;
}
