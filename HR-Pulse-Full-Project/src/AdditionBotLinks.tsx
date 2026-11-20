import {useEffect,useState} from 'react';
import {api} from './api';

/* Approval Master › Employee Addition bot (owner, 20 Nov 2026): everyone on the employee addition routes, whether they
   have connected @NagpurEmployeeAdditionBot, and one button that sends each unconnected person their personal connect
   link through an HR bot they already use. People on no HR bot get a link to forward (WhatsApp, for example). */
type Person={actor:string;roles:string[];connected:boolean;via:string;status?:string;url?:string};
type Roster={people:Person[];botUsername:string;configured?:boolean};
const botName=(via:string)=>via==='leave'?'Leave bot':via==='joining'?'Joining Approval bot':via==='trial'?'Vehicle Trial bot':'';

export default function AdditionBotLinks({grant}:{grant:string}){
 const[data,setData]=useState<Roster|null>(null),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirming,setConfirming]=useState(false),[copied,setCopied]=useState('');
 async function load(){setError('');try{setData(await api<Roster>(grant,'telegram/addition-links'));setSent(false);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 async function send(){setBusy(true);setError('');try{setData(await api<Roster>(grant,'telegram/addition-links','POST',{}));setSent(true);setConfirming(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function copy(p:Person){if(!p.url)return;try{await navigator.clipboard.writeText(p.url);setCopied(p.actor);}catch{setError('Copy failed – select the link and copy it by hand.');}}
 const people=data?.people||[],waiting=people.filter(p=>!p.connected),reachable=waiting.filter(p=>p.via);
 return <section className="data-card" aria-label="Employee Addition bot">
  <div className="data-heading"><div><h2>Employee Addition bot{data?.botUsername?` · @${data.botUsername}`:''}</h2>
   <p className="help-text">Joining approvals for site staff and office staff come on this bot with Approve / Reject buttons. Each person on the routes must open it once and tap Start. "Send connect links" sends every person not yet connected their own link through an HR bot they already use.</p></div>
   <button disabled={busy} onClick={()=>void load()}>Refresh</button></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {data&&!sent&&<p role="status"><b>{people.length-waiting.length}</b> of {people.length} connected · <b>{reachable.length}</b> can be sent a link on Telegram · <b>{waiting.length-reachable.length}</b> are on no HR bot (you get their link to forward).</p>}
  {sent&&<p role="status">Links sent. Telegram delivers them within a minute; people on no HR bot are listed with a link to forward.</p>}
  {data&&!sent&&waiting.length>0&&(confirming
   ?<p className="addition-confirm">Send a connect link to {waiting.length} {waiting.length===1?'person':'people'} ({reachable.length} on Telegram, {waiting.length-reachable.length} to forward)? <button className="primary" disabled={busy} onClick={()=>void send()}>{busy?'Sending…':'Yes, send'}</button> <button disabled={busy} onClick={()=>setConfirming(false)}>Cancel</button></p>
   :<button className="primary" disabled={busy||data.configured===false} onClick={()=>setConfirming(true)}>Send connect links ({waiting.length})</button>)}
  {data&&!waiting.length&&<p>Everyone on the routes is connected.</p>}
  {data&&<div className="table-scroll" role="region" aria-label="People on the employee addition routes" tabIndex={0}><table><thead><tr><th scope="col">Pulse login</th><th scope="col">Role</th><th scope="col">Nagpur bot</th><th scope="col">{sent?'Result':'Can reach on'}</th></tr></thead>
   <tbody>{people.map(p=><tr key={p.actor}><td>{p.actor}</td><td>{p.roles.join('; ')}</td><td>{p.connected?'✅ Connected':'Not yet'}</td>
    <td>{sent?<>{p.status}{p.url&&<> <input readOnly aria-label={`Connect link for ${p.actor}`} value={p.url} onFocus={e=>e.currentTarget.select()} style={{width:'14em'}}/> <button onClick={()=>void copy(p)}>{copied===p.actor?'Copied':'Copy link'}</button></>}</>:p.connected?'—':botName(p.via)||'No HR bot'}</td></tr>)}</tbody></table></div>}
 </section>;
}
