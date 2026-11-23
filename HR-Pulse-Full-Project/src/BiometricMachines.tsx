import {useState,type FormEvent} from 'react';
import {Pencil,Plus,RefreshCw,RotateCw,Trash2} from 'lucide-react';
import {api,type Lookup} from './api';
import BridgePcs,{type BridgePc} from './BridgePcs';
import MachineDeleteDialog from './MachineDeleteDialog';

/* Biometric machines register: every ESSL machine on every site, with where it
   stands, its name, serial number, IP address, status, last contact and the logs it has
   recorded today. HR administrators without a site restriction add machines to
   a site and change their site, location or name, and delete a machine after one confirmation
   (owner, 23 Nov 2026; MachineDeleteDialog). */
export type Machine={serial:string;name:string;location:string;siteId:string|null;siteName:string;online:boolean;lastContact:string|null;lastSeen:string|null;logsToday:number;lastPunch:string|null;
 /** Owner, 22 Nov 2026: the machine's IP address (records only) and the bridge PC it reports to (null = main bridge PC). */
 ipAddress?:string;bridgeId?:string|null;bridgeName?:string;
 /** Owner, 22 Nov 2026: the machine pushes straight to HR Pulse, with no bridge PC. */
 direct?:boolean;
 /** Machine master (owner, 23 Nov 2026): the Device ID set on the machine (its USB log is <no.>_attlog.dat), make and model. */
 machineNo?:string;make?:string;model?:string};
export type MachineStatus='Online'|'Offline'|'Awaiting contact';
export const ALL_SITES='',UNASSIGNED='unassigned';
const OCTET='(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
/** IPv4 address: four numbers 0-255 separated by dots (the server checks it again). */
export const IP_PATTERN=`(${OCTET}\\.){3}${OCTET}`;
/** Where a machine without a bridge PC sends its punches (Cloud Server Setting / ADMS). */
export const DIRECT_SERVER='hr-api-cmll-783.azurewebsites.net';

/** Whether the bridge PC a machine reports to is in touch (one bridge PC per site); without the list, the one bridge PC.
    A machine that pushes straight to HR Pulse has no bridge PC in between. */
export const bridgeOnlineFor=(machine:Pick<Machine,'bridgeId'|'bridgeName'|'direct'>,bridges:BridgePc[]|undefined,fallback:boolean)=>{
 if(machine.direct)return true;
 if(!bridges?.length)return fallback;
 const bridge=bridges.find(b=>machine.bridgeId?b.id===machine.bridgeId:b.main);
 return Boolean(bridge?.online);
};
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

type Props={grant:string;machines:Machine[];sites:Lookup[];bridgeOnline:boolean;configured:boolean;canManage:boolean;fetching:boolean;bridges?:BridgePc[];
 onFetch:(serial:string)=>void;onSaved:(message:string)=>Promise<void>|void;onError:(message:string)=>void;
 /** Owner, 23 Nov 2026: Refresh next to Edit re-reads the machines' status, last contact and logs from HR Pulse. */
 onRefresh?:()=>Promise<void>|void};

export default function BiometricMachines({grant,machines,sites,bridgeOnline,configured,canManage,fetching,bridges,onFetch,onSaved,onError,onRefresh}:Props){
 const statusOf=(m:Machine)=>machineStatus(m,bridgeOnlineFor(m,bridges,bridgeOnline));
 const [site,setSite]=useState(ALL_SITES);
 const [adding,setAdding]=useState(false),[editing,setEditing]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Machine|null>(null);
 const [refreshing,setRefreshing]=useState(''),[checked,setChecked]=useState<Record<string,string>>({});
 async function refresh(serial:string){
  if(refreshing||!onRefresh)return;setRefreshing(serial);onError('');
  try{await onRefresh();setChecked(c=>({...c,[serial]:new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',second:'2-digit'})}));}
  catch(e){onError((e as Error).message);}finally{setRefreshing('');}
 }
 const options=siteOptions(sites,machines);
 const rows=machinesForSite(machines,site);
 const online=rows.filter(m=>statusOf(m)==='Online').length;

 async function save(event:FormEvent<HTMLFormElement>,route:'devices'|'devices/register',serial?:string){
  event.preventDefault();if(busy)return;
  const fields=new FormData(event.currentTarget);
  const body={serial:serial??String(fields.get('serial')||'').trim(),siteId:String(fields.get('siteId')||''),name:String(fields.get('name')||''),location:String(fields.get('location')||''),ipAddress:String(fields.get('ipAddress')||'').trim()};
  setBusy(true);onError('');
  try{
   await api(grant,'attendance/'+route,'POST',body);
   setAdding(false);setEditing('');
   if(route==='devices/register'&&body.siteId)setSite(body.siteId);
   await onSaved(route==='devices/register'?`Machine ${body.serial} added. Its status shows once the machine contacts HR Pulse.`:`Machine ${body.serial} updated.`);
  }catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 const siteSelect=(value:string,label:string)=><select name="siteId" aria-label={label} defaultValue={value} required disabled={busy}>
  <option value="">Choose site…</option>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
 </select>;
 const ipInput=(value:string)=><input name="ipAddress" defaultValue={value} maxLength={15} inputMode="decimal" placeholder="e.g. 192.168.1.201"
  pattern={IP_PATTERN} title="Four numbers 0-255 separated by dots, e.g. 192.168.1.201"/>;

 return <>{bridges&&<BridgePcs grant={grant} bridges={bridges} sites={options.map(s=>({id:s.id,name:s.name,kind:'sites'} as Lookup))} canManage={canManage} onSaved={onSaved} onError={onError}/>}
 <div className="data-card biometric-machines">
  <h2>Biometric machines</h2>
  <p className="help-text">Every fingerprint / face machine on each site. {canManage?'Add a machine to its site with the serial number printed on it; the machine then reports its status and logs, straight to HR Pulse or through the bridge PC at that site.':'Machines of your sites.'}</p>
  {canManage&&<details className="help-text machine-direct-help"><summary>Connect a machine without a bridge PC</summary><ol>
   <li>Connect the machine to a network with internet. In Menu › Comm. › Ethernet give it a gateway and DNS (for example 8.8.8.8), or turn DHCP on.</li>
   <li>Menu › Comm. › Cloud Server Setting (ADMS): Enable Domain Name ON, Server Address <code>{DIRECT_SERVER}</code>, Server Port 443 with HTTPS ON (a machine without an HTTPS option: port 80), Proxy Server OFF.</li>
   <li>Add the machine here with the serial number on its label (Menu › System Info › Device Info). A machine not added here is ignored.</li>
   <li>Restart the machine. Within a minute its status turns Online, Bridge PC shows "Direct to HR Pulse", and its stored punches are sent.</li>
  </ol></details>}
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
   <thead><tr>{['Site','Machine location','Machine name','Serial no.','IP address','Bridge PC','Status','Last contact','Active logs','Action'].map(x=><th key={x}>{x}</th>)}</tr></thead>
   <tbody>
    {!rows.length&&<tr><td colSpan={10} className="attendance-empty">{site===ALL_SITES?'No machines yet.':'No machines on this site yet.'}{canManage?' Click Add machine to add one.':''}</td></tr>}
    {rows.map(m=>{
     const status=statusOf(m);
     if(editing===m.serial)return <tr key={m.serial}><td colSpan={10}>
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
      <td>{m.bridgeName||<span className="attendance-unlinked">Not connected yet</span>}</td>
      <td><span className={'machine-status '+status.split(' ')[0].toLowerCase()}>{status}</span>{checked[m.serial]&&<small className="machine-checked">Checked {checked[m.serial]}</small>}</td>
      <td>{formatContact(m.lastContact)}</td>
      <td><strong>{m.logsToday}</strong> today{m.lastPunch&&<small className="machine-last-punch">Last punch {formatLastPunch(m.lastPunch)}</small>}</td>
      <td className="machine-actions">
       <button type="button" disabled={fetching||(!configured&&!m.direct)||status!=='Online'} onClick={()=>onFetch(m.serial)}><RefreshCw/>Fetch log</button>
       {onRefresh&&<button type="button" className="machine-refresh" disabled={Boolean(refreshing)} aria-label={`Refresh machine ${m.serial}`} title="Check this machine's status, last contact and logs again" onClick={()=>void refresh(m.serial)}><RotateCw className={refreshing===m.serial?'spinning':''}/>{refreshing===m.serial?'Refreshing…':'Refresh'}</button>}
       {canManage&&<button type="button" disabled={busy} aria-label={`Edit machine ${m.serial}`} onClick={()=>{setEditing(m.serial);setAdding(false);onError('');}}><Pencil/>Edit</button>}
       {canManage&&<button type="button" className="machine-delete" disabled={busy} aria-label={`Delete machine ${m.serial}`} onClick={()=>{setDeleting(m);setAdding(false);setEditing('');onError('');}}><Trash2/>Delete</button>}
      </td>
     </tr>;
    })}
   </tbody>
  </table></div>
  {deleting&&<MachineDeleteDialog grant={grant} machine={deleting} onClose={()=>setDeleting(null)} onDeleted={message=>void onSaved(message)}/>}
 </div></>;
}
