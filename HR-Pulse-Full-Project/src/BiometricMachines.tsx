import {useState,type FormEvent} from 'react';
import {Pencil,Plus,RefreshCw} from 'lucide-react';
import {api,type Lookup} from './api';

/* Biometric machines register: every ESSL machine on every site, with where it
   stands, its name, serial number, IP address, status, last contact and the logs it has
   recorded today. HR administrators without a site restriction add machines to
   a site and change their site, location or name. */
export type Machine={serial:string;name:string;location:string;ipAddress?:string;siteId:string|null;siteName:string;online:boolean;lastContact:string|null;lastSeen:string|null;logsToday:number;lastPunch:string|null};
export type MachineStatus='Online'|'Offline'|'Awaiting contact';
export const ALL_SITES='',UNASSIGNED='unassigned';
const OCTET='(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** IPv4 address: four numbers 0-255 separated by dots (the server checks it again). */
export const IP_PATTERN=`(${OCTET}\\.){3}${OCTET}`;

/** Online only while both the machine and the bridge PC are in touch. */
export const machineStatus=(machine:Pick<Machine,'online'|'lastContact'>,bridgeOnline:boolean):MachineStatus=>machine.online&&bridgeOnline?'Online':machine.lastContact?'Offline':'Awaiting contact';
export const machinesForSite=(machines:Machine[],site:string)=>site===ALL_SITES?machines:machines.filter(m=>(m.siteId||UNASSIGNED)===site);
export const formatContact=(stamp:string|null)=>stamp?new Date(stamp).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'—';
export const formatLastPunch=(stamp:string|null)=>stamp?stamp.slice(0,10).split('-').reverse().join('-')+stamp.slice(10):'';
/** Sites to filter by: the site list when it has loaded, plus any site a machine already belongs to. */
export function siteOptions(sites:Lookup[],machines:Machine[]){
 const options=new Map(sites.map(s=>[s.id,s.name]));
 for(const m of machines)if(m.siteId&&!options.has(m.siteId))options.set(m.siteId,m.siteName||'Site');
 return [...options].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
}

type Props={grant:string;machines:Machine[];sites:Lookup[];bridgeOnline:boolean;configured:boolean;canManage:boolean;fetching:boolean;
 onFetch:(serial:string)=>void;onSaved:(message:string)=>Promise<void>|void;onError:(message:string)=>void};

export default function BiometricMachines({grant,machines,sites,bridgeOnline,configured,canManage,fetching,onFetch,onSaved,onError}:Props){
 const [site,setSite]=useState(ALL_SITES);
 const [adding,setAdding]=useState(false),[editing,setEditing]=useState(''),[busy,setBusy]=useState(false);
 const options=siteOptions(sites,machines);
 const rows=machinesForSite(machines,site);
 const online=rows.filter(m=>machineStatus(m,bridgeOnline)==='Online').length;

 async function save(event:FormEvent<HTMLFormElement>,route:'devices'|'devices/register',serial?:string){
  event.preventDefault();if(busy)return;
  const fields=new FormData(event.currentTarget);
  const body={serial:serial??String(fields.get('serial')||'').trim(),siteId:String(fields.get('siteId')||''),name:String(fields.get('name')||''),location:String(fields.get('location')||''),ipAddress:String(fields.get('ipAddress')||'').trim()};
  setBusy(true);onError('');
  try{
   await api(grant,'attendance/'+route,'POST',body);
   setAdding(false);setEditing('');
   if(route==='devices/register'&&body.siteId)setSite(body.siteId);
   await onSaved(route==='devices/register'?`Machine ${body.serial} added. Its status shows once the bridge PC reaches it.`:`Machine ${body.serial} updated.`);
  }catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 const siteSelect=(value:string,label:string)=><select name="siteId" aria-label={label} defaultValue={value} required disabled={busy}>
  <option value="">Choose site…</option>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
 </select>;
 const ipInput=(value:string)=><input name="ipAddress" defaultValue={value} maxLength={15} inputMode="decimal" placeholder="e.g. 192.168.1.201"
  pattern={IP_PATTERN} title="Four numbers 0-255 separated by dots, e.g. 192.168.1.201"/>;

 return <div className="data-card biometric-machines">
  <h2>Biometric machines</h2>
  <p className="help-text">Every fingerprint / face machine on each site. {canManage?'Add a machine to its site with the serial number printed on it; the bridge PC at that site then reports its status and logs.':'Machines of your sites.'}</p>
  <div className="attendance-filters">
   <label>Site<select value={site} disabled={busy} onChange={e=>{setSite(e.target.value);setAdding(false);setEditing('');}}>
    <option value={ALL_SITES}>All sites</option>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    {canManage&&<option value={UNASSIGNED}>Not assigned to a site</option>}
   </select></label>
   <span role="status">{rows.length} machine{rows.length===1?'':'s'} · {online} online · {rows.length-online} not online</span>
   {canManage&&<button type="button" className="primary" disabled={busy||adding} onClick={()=>{setAdding(true);setEditing('');onError('');}}><Plus/>Add machine</button>}
  </div>
  {adding&&canManage&&<form className="attendance-filters machine-form" aria-label="Add biometric machine" onSubmit={e=>void save(e,'devices/register')}>
   <label>Site{siteSelect(site===ALL_SITES||site===UNASSIGNED?'':site,'Site')}</label>
   <label>Machine location<input name="location" maxLength={80} placeholder="e.g. Main gate, Workshop"/></label>
   <label>Machine name<input name="name" maxLength={80} placeholder="e.g. ESSL K90 gate"/></label>
   <label>Serial no.<input name="serial" required maxLength={40} pattern="[A-Za-z0-9_\-]{1,40}" title="Letters, numbers, - or _" placeholder="Printed on the machine"/></label>
   <label>IP address{ipInput('')}</label>
   <button className="primary" disabled={busy}>{busy?'Saving…':'Save machine'}</button>
   <button type="button" disabled={busy} onClick={()=>setAdding(false)}>Cancel</button>
  </form>}
  <div className="attendance-table"><table>
   <thead><tr>{['Site','Machine location','Machine name','Serial no.','IP address','Status','Last contact','Active logs','Action'].map(x=><th key={x}>{x}</th>)}</tr></thead>
   <tbody>
    {!rows.length&&<tr><td colSpan={9} className="attendance-empty">{site===ALL_SITES?'No machines yet.':'No machines on this site yet.'}{canManage?' Click Add machine to add one.':''}</td></tr>}
    {rows.map(m=>{
     const status=machineStatus(m,bridgeOnline);
     if(editing===m.serial)return <tr key={m.serial}><td colSpan={9}>
      <form className="attendance-filters machine-form" aria-label={`Edit machine ${m.serial}`} onSubmit={e=>void save(e,'devices',m.serial)}>
       <label>Site{siteSelect(m.siteId||'',`Site for machine ${m.serial}`)}</label>
       <label>Machine location<input name="location" maxLength={80} defaultValue={m.location}/></label>
       <label>Machine name<input name="name" maxLength={80} defaultValue={m.name}/></label>
       <label>Serial no.<input value={m.serial} readOnly/></label>
       <label>IP address{ipInput(m.ipAddress||'')}</label>
       <button className="primary" disabled={busy}>{busy?'Saving…':'Save'}</button>
       <button type="button" disabled={busy} onClick={()=>setEditing('')}>Cancel</button>
      </form>
     </td></tr>;
     return <tr key={m.serial}>
      <td>{m.siteName||<span className="attendance-unlinked">Not assigned</span>}</td>
      <td>{m.location||'—'}</td>
      <td>{m.name||'—'}</td>
      <td className="machine-serial">{m.serial}</td>
      <td className="machine-serial">{m.ipAddress||'—'}</td>
      <td><span className={'machine-status '+status.split(' ')[0].toLowerCase()}>{status}</span></td>
      <td>{formatContact(m.lastContact)}</td>
      <td><strong>{m.logsToday}</strong> today{m.lastPunch&&<small className="machine-last-punch">Last punch {formatLastPunch(m.lastPunch)}</small>}</td>
      <td className="machine-actions">
       <button type="button" disabled={fetching||!configured||status!=='Online'} onClick={()=>onFetch(m.serial)}><RefreshCw/>Fetch log</button>
       {canManage&&<button type="button" disabled={busy} aria-label={`Edit machine ${m.serial}`} onClick={()=>{setEditing(m.serial);setAdding(false);onError('');}}><Pencil/>Edit</button>}
      </td>
     </tr>;
    })}
   </tbody>
  </table></div>
 </div>;
}
