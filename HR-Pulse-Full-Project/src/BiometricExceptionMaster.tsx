import {useEffect,useState,type FormEvent} from 'react';
import {Fingerprint,Plus,RefreshCw,Search} from 'lucide-react';
import {api} from './api';
import './shift-master.css';

/* Biometric Exception Master (owner, 28 Nov 2026): employees taken from Employee Master by Employee ID who are exempt
   from biometric punching. The attendance register marks them present by itself (server/biometric-exceptions.mjs). */
type Entry={id:string;employeeId:string;name:string;site:string;department:string;designation:string;fromDate:string;toDate:string;reason:string;
 addedBy:string;addedAt:string;removedBy:string;removedAt:string|null;removeReason:string};
type Person={employeeId:string;name:string;site:string;department:string;designation:string;status:string;onList:boolean;driver:boolean};
const dmy=(value:string)=>/^\d{4}-\d{2}-\d{2}/.test(value||'')?`${value.slice(8,10)}-${value.slice(5,7)}-${value.slice(0,4)}`:'';
const when=(value:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';

export default function BiometricExceptionMaster({grant}:{grant:string}){
 const[entries,setEntries]=useState<Entry[]>([]),[today,setToday]=useState(''),[showRemoved,setShowRemoved]=useState(false);
 const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const[find,setFind]=useState(''),[people,setPeople]=useState<Person[]|null>(null),[picked,setPicked]=useState<Person|null>(null);
 const[fromDate,setFromDate]=useState(''),[reason,setReason]=useState('');
 const[removing,setRemoving]=useState<Entry|null>(null),[removeReason,setRemoveReason]=useState('');
 async function load(removed=showRemoved){
  setLoading(true);setError('');
  try{const result=await api<{entries:Entry[];today:string}>(grant,'biometric-exceptions'+(removed?'?removed=1':''));setEntries(result.entries);setToday(result.today);setFromDate(current=>current||result.today);}
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 }
 useEffect(()=>{void load(showRemoved);},[grant,showRemoved]);
 async function search(event:FormEvent){
  event.preventDefault();
  const text=find.trim();
  if(text.length<2){setError('Type an Employee ID or at least two letters of the name.');return;}
  setBusy(true);setError('');setMessage('');setPicked(null);
  try{setPeople((await api<{employees:Person[]}>(grant,'biometric-exceptions?find='+encodeURIComponent(text))).employees);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function add(event:FormEvent){
  event.preventDefault();
  if(!picked||busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await api<{name:string;employeeId:string;fromDate:string}>(grant,'biometric-exceptions','POST',{employeeId:picked.employeeId,fromDate,reason});
   setMessage(`${result.name} (${result.employeeId}) is exempt from biometric punching from ${dmy(result.fromDate)}. Attendance will be marked present by the system.`);
   setPicked(null);setPeople(null);setFind('');setReason('');
   await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function remove(){
  if(!removing||busy)return;
  setBusy(true);setError('');setMessage('');
  try{
   const result=await api<{lastDay:string}>(grant,`biometric-exceptions/${removing.id}/remove`,'POST',{reason:removeReason});
   setMessage(`${removing.name} (${removing.employeeId}) is off the exception list. Exempt up to ${dmy(result.lastDay)}; from today biometric punching applies again.`);
   setRemoving(null);setRemoveReason('');
   await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const active=entries.filter(entry=>!entry.removedAt).length;
 return <section className="shift-master" aria-labelledby="biometric-exception-title">
  <div className="shift-title"><span className="shift-icon"><Fingerprint/></span><div><small>MASTER CONFIGURATION</small><h1 id="biometric-exception-title">Biometric Exception Master</h1>
   <p>Employees on this list do not have to punch. The system marks them present on every working day; holidays, approved leave and OD still show. Everyone else follows the biometric process.</p></div></div>
  <div className="shift-site"><span>{loading?'Loading…':`${active.toLocaleString('en-IN')} employee${active===1?'':'s'} on the list`}</span>
   <label><input type="checkbox" checked={showRemoved} onChange={event=>setShowRemoved(event.target.checked)}/> Show removed</label>
   <button type="button" aria-label="Refresh the exception list" disabled={loading||busy} onClick={()=>void load()}><RefreshCw/></button></div>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="shift-success" role="status">{message}</p>}
  <div className="shift-grid">
   <section className="shift-card"><h2>Exception list</h2>
    <div className="table-scroll" role="region" aria-label="Biometric exception list" tabIndex={0}><table>
     <thead><tr>{['Sr. No.','Employee ID','Name','Site / office','Designation','Exempt from','Exempt up to','Reason','Added by','Actions'].map(heading=><th key={heading} scope="col">{heading}</th>)}</tr></thead>
     <tbody>{entries.map((entry,index)=><tr key={entry.id}>
      <td>{index+1}</td><td>{entry.employeeId}</td><td>{entry.name}</td><td>{entry.site}</td><td>{entry.designation}</td>
      <td>{dmy(entry.fromDate)}</td><td>{entry.removedAt?dmy(entry.toDate):'On the list'}</td>
      <td>{entry.reason}{entry.removedAt&&<><br/><small>Removed: {entry.removeReason}</small></>}</td>
      <td>{entry.addedBy}<br/><small>{when(entry.addedAt)}</small>{entry.removedAt&&<><br/><small>Removed by {entry.removedBy}, {when(entry.removedAt)}</small></>}</td>
      <td>{entry.removedAt?'Removed':<button type="button" disabled={busy} aria-label={`Remove ${entry.name} from the exception list`} onClick={()=>{setRemoving(entry);setRemoveReason('');setMessage('');setError('');}}>Remove</button>}</td>
     </tr>)}</tbody>
    </table>{!loading&&!entries.length&&<p className="shift-help">No employee is on the exception list. Everyone follows the biometric process.</p>}</div>
    {removing&&<div className="shift-confirm" role="alert">
     <p>Take {removing.name} ({removing.employeeId}) off the exception list? From today biometric punching applies again; the days already marked stay as they are.</p>
     <label>Why<input value={removeReason} maxLength={500} disabled={busy} onChange={event=>setRemoveReason(event.target.value)} placeholder="Reason for removing"/></label>
     <button type="button" disabled={busy||removeReason.trim().length<5} onClick={()=>void remove()}>{busy?'Removing…':'Confirm removal'}</button>
     <button type="button" disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button>
    </div>}
   </section>
   <section className="shift-card"><h2>Add employee</h2>
    <form onSubmit={search} aria-label="Find employee in Employee Master"><div className="shift-fields">
     <label>Employee ID or name<input value={find} maxLength={100} disabled={busy} placeholder="CMLL1234 or name" onChange={event=>setFind(event.target.value)}/></label>
    </div><button className="shift-add" disabled={busy||find.trim().length<2}><Search/> Find in Employee Master</button></form>
    {people&&!people.length&&<p className="shift-help">No employee of Employee Master matches. Check the Employee ID.</p>}
    {people&&people.length>0&&!picked&&<ul className="shift-help" aria-label="Employees found">{people.map(person=>{
     const blocked=person.onList?'Already on the list':person.driver?'Driver: attendance from trip card':person.status==='LEFT'?'Has left':'';
     return <li key={person.employeeId+person.name}><strong>{person.employeeId}</strong> {person.name} · {person.site} · {person.designation||'—'} {blocked
      ?<em>({blocked})</em>
      :<button type="button" disabled={busy} aria-label={`Select ${person.name} (${person.employeeId})`} onClick={()=>{setPicked(person);setError('');}}>Select</button>}</li>;
    })}</ul>}
    {picked&&<form onSubmit={add} aria-label="Add to the exception list"><fieldset disabled={busy}>
     <p className="shift-help"><strong>{picked.employeeId}</strong> {picked.name}<br/>{picked.site} · {picked.department||'—'} · {picked.designation||'—'}</p>
     <div className="shift-fields">
      <label>Exempt from<input type="date" required value={fromDate} onChange={event=>setFromDate(event.target.value)}/></label>
      <label>Reason<input required minLength={5} maxLength={500} value={reason} placeholder="Why this employee does not punch" onChange={event=>setReason(event.target.value)}/></label>
     </div>
     <button className="shift-add" disabled={busy||reason.trim().length<5||!fromDate}><Plus/> Add to exception list</button>
     <button type="button" disabled={busy} onClick={()=>setPicked(null)}>Choose another</button>
    </fieldset></form>}
    <p className="shift-help">A driver is not taken: a driver's attendance comes from the trip card and logbook. A biometric day that was already saved keeps its saved sheet until it is saved again.</p>
   </section>
  </div>
 </section>;
}
