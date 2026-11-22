import {useState,type FormEvent} from 'react';
import {Copy,Download,KeyRound,Plus,Trash2} from 'lucide-react';
import {api,downloadBlob,type Lookup} from './api';
import bridgeProgram from '../integrations/attendance-bridge/hr_pulse_bridge.py?raw';

/* Bridge PCs per site (owner, 22 Nov 2026; server/attendance-bridges.mjs). Each site's bridge PC has its own key; a
   machine belongs to the bridge PC it reports to and a fetch goes only to that bridge PC. The key is shown once, when it
   is made, with the setup steps and the bridge program to download with the key already filled in. */
export type BridgePc={id:string;name:string;siteId:string|null;siteName:string;keyHint:string;lastSeen:string|null;online:boolean;machines:string[];main:boolean};
type NewKey={bridge:{id:string;name:string};key:string};

/** The bridge program with this key filled in (the line BRIDGE_KEY = "..." at the top of the file). */
export const programWithKey=(key:string)=>bridgeProgram.replace(/^BRIDGE_KEY = "[^"\n]*"/m,`BRIDGE_KEY = "${key}"`);
const seen=(stamp:string|null)=>stamp?new Date(stamp).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
const download=(name:string,text:string)=>downloadBlob(name,new Blob([text],{type:'text/x-python'}));

export default function BridgePcs({grant,bridges,sites,canManage,onSaved,onError}:{grant:string;bridges:BridgePc[];sites:Lookup[];canManage:boolean;onSaved:(message:string)=>Promise<void>|void;onError:(message:string)=>void}){
 const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[made,setMade]=useState<NewKey|null>(null),[copied,setCopied]=useState(false);
 async function run(path:string,body:unknown,done:(result:NewKey&{removed?:boolean})=>string){
  setBusy(true);onError('');setCopied(false);
  try{const result=await api<NewKey&{removed?:boolean}>(grant,path,'POST',body);if(result.key)setMade(result);else setMade(null);setAdding(false);await onSaved(done(result));}
  catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 function add(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const f=new FormData(event.currentTarget);
  void run('attendance/bridges',{siteId:String(f.get('siteId')||''),name:String(f.get('name')||'')},r=>`Bridge PC "${r.bridge.name}" added. Copy its key now; it is shown only once.`);
 }
 async function copy(){if(!made)return;try{await navigator.clipboard.writeText(made.key);setCopied(true);}catch{onError('Copy the key by selecting it.');}}
 return <div className="data-card bridge-pcs">
  <div className="bridge-head"><div><h2>Bridge PCs</h2>
   <p className="help-text">One bridge PC per site. Each has its own key; Fetch attendance for a machine goes only to the bridge PC that machine reports to.</p></div>
   <span className="bridge-grow"/>
   <button type="button" onClick={()=>download('hr_pulse_bridge.py',bridgeProgram)}><Download/>Download bridge program</button>
   {canManage&&<button type="button" className="primary" disabled={busy||adding} onClick={()=>{setAdding(true);setMade(null);onError('');}}><Plus/>Add bridge PC</button>}
  </div>
  {adding&&canManage&&<form className="attendance-filters machine-form" aria-label="Add bridge PC" onSubmit={add}>
   <label>Site<select name="siteId" required disabled={busy} defaultValue=""><option value="">Choose site…</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Bridge PC name<input name="name" required maxLength={80} placeholder="e.g. Sasti weighbridge PC"/></label>
   <button className="primary" disabled={busy}>{busy?'Saving…':'Add bridge PC'}</button>
   <button type="button" disabled={busy} onClick={()=>setAdding(false)}>Cancel</button>
  </form>}
  {made&&<div className="bridge-key" role="alert">
   <b>Key for “{made.bridge.name}” (shown only once, copy it now):</b> <code>{made.key}</code>
   <button type="button" onClick={()=>void copy()}><Copy/>{copied?'Copied':'Copy key'}</button>
   <button type="button" onClick={()=>download('hr_pulse_bridge.py',programWithKey(made.key))}><Download/>Download bridge program with this key</button>
   <ol>
    <li>On the site PC: install Python 3.8 or later and copy the bridge program there (the download above already has this key).</li>
    <li>Run it: <code>python hr_pulse_bridge.py</code>, and allow it through Windows Firewall.</li>
    <li>On each machine of the site: Menu → Comm. → Cloud Server Setting (ADMS): Server Address = this PC’s IP address, Server Port = 8081.</li>
    <li>Within a minute the bridge PC shows Online here and its machines appear under it.</li>
   </ol>
   <button type="button" onClick={()=>setMade(null)}>I have saved the key</button>
  </div>}
  <div className="attendance-table"><table aria-label="Bridge PCs">
   <thead><tr>{['Site','Bridge PC','Status','Machines reporting','Key','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{!bridges.length&&<tr><td colSpan={6} className="attendance-empty">No bridge PC yet.{canManage?' Click Add bridge PC to add one for a site.':''}</td></tr>}
    {bridges.map(b=><tr key={b.id}>
     <td>{b.main?<span className="attendance-unlinked">First bridge PC</span>:b.siteName||'—'}</td>
     <td>{b.name}</td>
     <td><span className={'machine-status '+(b.online?'online':b.lastSeen?'offline':'awaiting')}>{b.online?'Online':b.lastSeen?'Offline':'Waiting for first contact'}</span>{b.lastSeen&&<small className="machine-last-punch">{b.online?'Seen':'Last seen'} {seen(b.lastSeen)}</small>}</td>
     <td>{b.machines.length?b.machines.length>3?`${b.machines.length} machines`:b.machines.join(', '):'—'}</td>
     <td>{b.main?'Azure setting (existing)':`•••• ${b.keyHint}`}</td>
     <td className="machine-actions">{canManage&&!b.main?<>
      <button type="button" disabled={busy} aria-label={`New key for ${b.name}`} onClick={()=>{if(window.confirm(`Make a new key for "${b.name}"? The old key stops working at once.`))void run(`attendance/bridges/${b.id}/key`,{},()=>`New key made for "${b.name}". Copy it now; it is shown only once.`);}}><KeyRound/>New key</button>
      <button type="button" disabled={busy} aria-label={`Remove ${b.name}`} onClick={()=>{if(window.confirm(`Remove "${b.name}"? Its key stops working and its machines wait for a bridge PC again.`))void run(`attendance/bridges/${b.id}/remove`,{},()=>`Bridge PC "${b.name}" removed.`);}}><Trash2/>Remove</button></>:'—'}</td>
    </tr>)}</tbody>
  </table></div>
 </div>;
}
