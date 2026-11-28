import {useEffect,useState} from 'react';
import {Clock3,Plus,RefreshCw} from 'lucide-react';
import {api,type Module,type RecordRow} from './api';
import {setWorkingHours} from '../server/working-hours.mjs';
import './shift-master.css';

/* Working Hour Master (owner, 28 Nov 2026: "add working hour master and it should be same for both corporate and coal").
   One list of working hours for Corporate / HO and OB / COAL: the joining form, Edit employee details, both Excel
   formats, the register's Edit and the hour-wise Excel update offer and accept only its active hours. Switching a line
   off keeps the hours already saved on employees; they are only no longer offered. */
type Listing={rows:RecordRow[];total:number};
const hoursOf=(row:RecordRow)=>Number(row.code);

export default function WorkingHourMaster({grant,module,onChange}:{grant:string;module?:Module;onChange?:(hours:readonly number[])=>void}){
 const[rows,setRows]=useState<RecordRow[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0),[hours,setHours]=useState(''),[remarks,setRemarks]=useState('');
 const canWrite=Boolean(module?.canWrite);
 useEffect(()=>{let live=true;setLoading(true);setError('');(async()=>{
  const all:RecordRow[]=[];
  for(let page=1;page<=20;page++){const result=await api<Listing>(grant,`records/workingHours?page=${page}`);all.push(...result.rows);if(all.length>=result.total||!result.rows.length)break;}
  if(!live)return;
  setRows(all.sort((a,b)=>hoursOf(a)-hoursOf(b)));
  const active=all.filter(row=>row.status==='ACTIVE').map(hoursOf).sort((a,b)=>a-b);
  const inUse=setWorkingHours(all.length?active:undefined);
  onChange?.(inUse);
 })().catch(e=>{if(live)setError((e as Error).message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[grant,reload]);

 const run=async(action:()=>Promise<unknown>,done:string)=>{setBusy(true);setError('');setMessage('');try{await action();setMessage(done);setReload(x=>x+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const add=(e:React.FormEvent)=>{e.preventDefault();const value=hours.trim();
  if(!/^\d{1,2}$/.test(value)||Number(value)<1||Number(value)>24){setError('Enter whole hours from 1 to 24.');return;}
  const old=rows.find(row=>hoursOf(row)===Number(value));
  if(old?.status==='ACTIVE'){setError(`${old.name} is already in the list.`);return;}
  void run(()=>old?api(grant,`records/workingHours/${old.id}`,'PUT',{code:value,remarks:remarks.trim(),version:old.version}):api(grant,'records/workingHours','POST',{code:value,remarks:remarks.trim()}),`${Number(value)} hours added. Corporate / HO and OB / COAL offer it now.`).then(()=>{setHours('');setRemarks('');});
 };
 const switchOff=(row:RecordRow)=>run(()=>api(grant,`records/workingHours/${row.id}/deactivate`,'POST',{version:row.version}),`${row.name} switched off. Employees who already have it keep it; it is no longer offered.`);
 const switchOn=(row:RecordRow)=>run(()=>api(grant,`records/workingHours/${row.id}`,'PUT',{code:row.code,remarks:String(row.data.remarks||''),version:row.version}),`${row.name} switched on again.`);
 const active=rows.filter(row=>row.status==='ACTIVE');

 return <section className="shift-master" aria-label="Working Hour Master"><div className="shift-title"><span className="shift-icon"><Clock3/></span><div><small>MASTER CONFIGURATION</small><h1>Working Hour Master</h1><p>One list of working hours for Corporate / HO and OB / COAL. Every Working Hours field offers only these hours.</p></div>
  <button type="button" className="shift-refresh" aria-label="Refresh working hours" disabled={loading||busy} onClick={()=>setReload(x=>x+1)}><RefreshCw size={16}/></button></div>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="shift-success" role="status">{message}</p>}
  <div className="shift-grid"><section className="shift-card"><h2>Working hours · {active.length} active</h2><div className="shift-table-wrap" role="region" aria-label="Working hours" tabIndex={0}><table><thead><tr>{['Hours','Shown as','Used for','Remarks','Status','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
   {loading?<tr><td colSpan={6} className="shift-empty">Loading…</td></tr>:!rows.length?<tr><td colSpan={6} className="shift-empty">No working hours yet. Until one is added, 8, 9, 10, 11 and 12 hours are used.</td></tr>
    :rows.map(row=><tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>Corporate / HO and OB / COAL</td><td>{String(row.data.remarks||'')}</td><td>{row.status==='ACTIVE'?'Active':'Switched off'}</td>
     <td>{canWrite&&(row.status==='ACTIVE'?<button type="button" className="shift-remove" disabled={busy} onClick={()=>void switchOff(row)}>Switch off</button>:<button type="button" className="shift-remove" disabled={busy} onClick={()=>void switchOn(row)}>Switch on</button>)}</td></tr>)}
  </tbody></table></div><p className="shift-footnote">Switching hours off does not change any employee: those who already have them keep them until HR changes them. Pulse-II gets every employee's hours as before.</p></section>
  <section className="shift-card"><h2>Add working hours</h2>{!canWrite&&<p className="shift-help">Only a head office login (one with every HR site) changes this list. Your account can view it.</p>}
   <form onSubmit={add}><fieldset disabled={busy||loading||!canWrite}><div className="shift-fields"><label>Hours<input aria-label="Hours" inputMode="numeric" placeholder="e.g. 7" value={hours} onChange={e=>setHours(e.target.value)}/></label><label>Remarks<input aria-label="Remarks" value={remarks} onChange={e=>setRemarks(e.target.value)}/></label></div>
   <button className="shift-add primary" type="submit"><Plus size={16}/>{busy?'Saving…':'Add hours'}</button></fieldset></form></section></div>
 </section>;
}
