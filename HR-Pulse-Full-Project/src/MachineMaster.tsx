import {useState,type FormEvent} from 'react';
import {Download,Pencil,Plus,Trash2} from 'lucide-react';
import {api,type Lookup} from './api';
import {downloadExcel} from './excelFiles';
import {ALL_SITES,IP_PATTERN,UNASSIGNED,machinesForSite,siteOptions,type Machine} from './BiometricMachines';
import MachineDeleteDialog from './MachineDeleteDialog';

/* Machine master (owner, 23 Nov 2026): one record per biometric machine — site, machine no., name, location, serial no.,
   IP address, make and model. The machine no. is the Device ID set on the machine (Menu › Comm. › Device ID); its USB
   download is named <no.>_attlog.dat, so Upload machine log finds the machine from the file name. One machine no. per
   site (the server checks). HR administrators without a site restriction add, edit and delete; others see their sites. */
type Props={grant:string;machines:Machine[];sites:Lookup[];canManage:boolean;onSaved:(message:string)=>Promise<void>|void;onError:(message:string)=>void};
type Draft={siteId:string;machineNo:string;name:string;location:string;serial:string;ipAddress:string;make:string;model:string};
const FIELDS:[keyof Draft,string,string][]=[['machineNo','Machine no.','Device ID on the machine, e.g. 1'],['name','Machine name','e.g. STAFF 1'],['location','Machine location','e.g. Main gate'],
 ['serial','Serial no.','Printed on the machine'],['ipAddress','IP address','e.g. 192.168.16.11'],['make','Make','e.g. eSSL'],['model','Model','e.g. K90, ZMM220']];
const empty=(siteId=''):Draft=>({siteId,machineNo:'',name:'',location:'',serial:'',ipAddress:'',make:'',model:''});
const draftOf=(m:Machine):Draft=>({siteId:m.siteId||'',machineNo:m.machineNo||'',name:m.name,location:m.location,serial:m.serial,ipAddress:m.ipAddress||'',make:m.make||'',model:m.model||''});
const byNo=(a:Machine,b:Machine)=>(a.siteName||'~').localeCompare(b.siteName||'~')||(Number(a.machineNo)||999)-(Number(b.machineNo)||999)||a.serial.localeCompare(b.serial);

export default function MachineMaster({grant,machines,sites,canManage,onSaved,onError}:Props){
 const [site,setSite]=useState(ALL_SITES),[search,setSearch]=useState('');
 const [form,setForm]=useState<{mode:'add'|'edit';draft:Draft}|null>(null),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Machine|null>(null);
 const options=siteOptions(sites,machines);
 const words=search.trim().toLowerCase();
 const rows=machinesForSite(machines,site).filter(m=>!words||[m.siteName,m.machineNo,m.name,m.location,m.serial,m.ipAddress,m.make,m.model].join(' ').toLowerCase().includes(words)).sort(byNo);

 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!form||busy)return;
  const d=form.draft,body={...d,serial:d.serial.trim(),ipAddress:d.ipAddress.trim(),machineNo:d.machineNo.trim()};
  setBusy(true);onError('');
  try{
   await api(grant,'attendance/'+(form.mode==='add'?'devices/register':'devices'),'POST',body);
   setForm(null);if(form.mode==='add')setSite(body.siteId);
   await onSaved(form.mode==='add'?`Machine ${body.serial} added to Machine master.`:`Machine ${body.serial} updated.`);
  }catch(e){onError((e as Error).message);}finally{setBusy(false);}
 }
 const set=(field:keyof Draft,value:string)=>setForm(f=>f&&{...f,draft:{...f.draft,[field]:value}});
 function exportExcel(){
  const heads=['Site','Machine no.','Machine name','Machine location','Serial no.','IP address','Make','Model'];
  downloadExcel('machine-master.xlsx',heads,rows.map(m=>({Site:m.siteName,'Machine no.':m.machineNo||'','Machine name':m.name,'Machine location':m.location,'Serial no.':m.serial,'IP address':m.ipAddress||'',Make:m.make||'',Model:m.model||''})));
 }

 return <div className="data-card machine-master">
  <h2>Machine master</h2>
  <p className="help-text">One record per biometric machine. Machine no. is the Device ID set on the machine (Menu › Comm. › Device ID); a USB download from it is named like <code>1_attlog.dat</code>, so Upload machine log in the Attendance roster finds the machine by itself. Give each machine of a site its own number.</p>
  <div className="attendance-filters">
   <label>Site<select value={site} disabled={busy} onChange={e=>{setSite(e.target.value);setForm(null);}}>
    <option value={ALL_SITES}>All sites</option>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    {canManage&&<option value={UNASSIGNED}>Not assigned to a site</option>}
   </select></label>
   <label>Search<input type="search" value={search} placeholder="Name, serial, IP, make…" onChange={e=>setSearch(e.target.value)}/></label>
   <span role="status">{rows.length} machine{rows.length===1?'':'s'}</span>
   <button type="button" disabled={!rows.length} onClick={exportExcel}><Download/>Export Excel</button>
   {canManage&&<button type="button" className="primary" disabled={busy||form?.mode==='add'} onClick={()=>{setForm({mode:'add',draft:empty(site===ALL_SITES||site===UNASSIGNED?'':site)});onError('');}}><Plus/>Add machine</button>}
  </div>

  {form&&canManage&&<form className="machine-master-form" aria-label={form.mode==='add'?'Add machine':`Edit machine ${form.draft.serial}`} onSubmit={e=>void save(e)}>
   <h3>{form.mode==='add'?'Add machine':`Edit machine ${form.draft.serial}`}</h3>
   <div className="machine-master-grid">
    <label>Site<select value={form.draft.siteId} required disabled={busy} onChange={e=>set('siteId',e.target.value)}>
     <option value="">Choose site…</option>{options.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {FIELDS.map(([field,label,hint])=><label key={field}>{label}<input value={form.draft[field]} placeholder={hint} disabled={busy} readOnly={field==='serial'&&form.mode==='edit'}
     required={field==='serial'} maxLength={field==='serial'?40:field==='ipAddress'?15:field==='machineNo'?3:80}
     {...(field==='serial'?{pattern:'[A-Za-z0-9_\\-]{1,40}',title:'Letters, numbers, - or _'}:field==='ipAddress'?{pattern:IP_PATTERN,inputMode:'decimal' as const,title:'Four numbers 0-255 separated by dots'}:field==='machineNo'?{pattern:'0*[1-9][0-9]{0,2}',inputMode:'numeric' as const,title:'A number from 1 to 999'}:{})}
     onChange={e=>set(field,e.target.value)}/></label>)}
   </div>
   <div className="machine-master-actions">
    <button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button>
    <button className="primary" disabled={busy}>{busy?'Saving…':'Save machine'}</button>
   </div>
  </form>}

  <div className="attendance-table"><table aria-label="Machine master">
   <thead><tr>{['Site','Machine no.','Machine name','Machine location','Serial no.','IP address','Make','Model',...(canManage?['Action']:[])].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>
    {!rows.length&&<tr><td colSpan={canManage?9:8} className="attendance-empty">{words?'No machine matches the search.':site===ALL_SITES?'No machines yet.':'No machines on this site yet.'}{canManage&&!words?' Click Add machine to add one.':''}</td></tr>}
    {rows.map(m=><tr key={m.serial}>
     <td>{m.siteName||<span className="attendance-unlinked">Not assigned</span>}</td>
     <td>{m.machineNo||<span className="attendance-unlinked">—</span>}</td>
     <td>{m.name||'—'}</td><td>{m.location||'—'}</td>
     <td className="machine-serial">{m.serial}</td><td className="machine-serial">{m.ipAddress||'—'}</td>
     <td>{m.make||'—'}</td><td>{m.model||'—'}</td>
     {canManage&&<td className="machine-actions">
      <button type="button" disabled={busy} aria-label={`Edit machine ${m.serial}`} onClick={()=>{setForm({mode:'edit',draft:draftOf(m)});onError('');}}><Pencil/>Edit</button>
      <button type="button" className="machine-delete" disabled={busy} aria-label={`Delete machine ${m.serial}`} onClick={()=>{setDeleting(m);setForm(null);onError('');}}><Trash2/>Delete</button>
     </td>}
    </tr>)}
   </tbody>
  </table></div>
  {deleting&&<MachineDeleteDialog grant={grant} machine={deleting} onClose={()=>setDeleting(null)} onDeleted={message=>void onSaved(message)}/>}
 </div>;
}
