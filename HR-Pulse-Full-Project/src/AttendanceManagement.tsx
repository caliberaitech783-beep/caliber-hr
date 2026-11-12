import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {api,csv,download,type Lookup} from './api';
import './attendance.css';

/* Punches come from the site fingerprint/face machines. Azure cannot reach a
   machine on a site network, so "Fetch attendance" raises a request that the
   bridge PC at the site picks up; this page then waits for it to finish.
   The existing attendance module (public/attendance-module.html) stays as its
   own tab; "Machine punches" shows what the machines actually recorded. */
export type Punch={id:string;deviceSerial:string;deviceName:string;siteName:string;biometricId:string;date:string;time:string;verify:string;punchType:string;employeeId:string;employeeCode:string;employeeName:string;machineName:string};
export type FetchRequest={id:string;state:'PENDING'|'RUNNING'|'DONE'|'FAILED';punchesReceived:number;newPunches:number;error:string;requestedAt:string;completedAt:string|null};
type Device={serial:string;name:string;siteId:string|null;siteName:string;lastSeen:string|null};
type Status={configured:boolean;bridgeOnline:boolean;bridgeLastSeen:string|null;devices:Device[];lastFetch:FetchRequest|null;canLink:boolean;canManageDevices:boolean};
type Unlinked={deviceSerial:string;biometricId:string;punches:number;lastPunch:string;machineName:string;siteName:string};
type PunchList={from:string;to:string;truncated:boolean;rows:Punch[]};

const VERIFY:Record<string,string>={'0':'Password','1':'Fingerprint','2':'Card','3':'Password','4':'Card','15':'Face','25':'Palm'};
const PUNCH_TYPE:Record<string,string>={'0':'Check-In','1':'Check-Out','2':'Break-Out','3':'Break-In','4':'Overtime-In','5':'Overtime-Out'};
export const verifyLabel=(code:string)=>VERIFY[code]||(code?`Other (${code})`:'—');
export const punchTypeLabel=(code:string)=>PUNCH_TYPE[code]||(code?`Other (${code})`:'—');
export const indiaToday=(now=new Date())=>new Date(now.getTime()+5.5*3600_000).toISOString().slice(0,10);
export const displayDate=(iso:string)=>/^\d{4}-\d{2}-\d{2}$/.test(iso)?iso.split('-').reverse().join('-'):iso;
export function fetchMessage(request:FetchRequest){
 if(request.state==='FAILED')return request.error||'The fetch did not finish. Try again.';
 if(request.state!=='DONE')return 'Fetching attendance from the machine…';
 const added=Number(request.newPunches),received=Number(request.punchesReceived);
 if(!received)return 'Fetch complete. The machine had no new punches.';
 return `Fetch complete. ${added} new punch${added===1?'':'es'} added${received>added?` (${received-added} already saved)`:''}.`;
}
export const employeeLabel=(punch:Pick<Punch,'employeeCode'|'employeeName'|'machineName'>)=>punch.employeeName?`${punch.employeeCode} · ${punch.employeeName}`:punch.machineName?`Not linked (${punch.machineName})`:'Not linked';

const POLL_MS=2000,MAX_POLLS=60;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export default function AttendanceManagement({grant}:{grant:string}){
 const today=indiaToday();
 const [from,setFrom]=useState(today),[to,setTo]=useState(today);
 const [status,setStatus]=useState<Status|null>(null),[punches,setPunches]=useState<PunchList|null>(null),[unlinked,setUnlinked]=useState<Unlinked[]>([]);
 const [lookups,setLookups]=useState<Lookup[]>([]),[choice,setChoice]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[fetching,setFetching]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [tab,setTab]=useState<'module'|'punches'>('module');
 const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);

 const load=useCallback(async(showPunches:boolean)=>{
  setLoading(true);setError('');
  try{
   const [nextStatus,nextPunches,nextUnlinked]=await Promise.all([
    api<Status>(grant,'attendance/status'),
    showPunches?api<PunchList>(grant,`attendance/punches?from=${from}&to=${to}`):null,
    showPunches?api<Unlinked[]>(grant,'attendance/unlinked'):null,
   ]);
   if(!live.current)return;
   setStatus({...nextStatus,devices:Array.isArray(nextStatus?.devices)?nextStatus.devices:[]});
   if(nextPunches)setPunches({...nextPunches,rows:Array.isArray(nextPunches.rows)?nextPunches.rows:[]});
   if(nextUnlinked)setUnlinked(Array.isArray(nextUnlinked)?nextUnlinked:[]);
  }catch(e){if(live.current)setError((e as Error).message);}
  finally{if(live.current)setLoading(false);}
 },[grant,from,to]);
 useEffect(()=>{void load(tab==='punches');},[load,tab]);
 useEffect(()=>{if(!status?.canLink||tab!=='punches')return;let active=true;api<Lookup[]>(grant,'lookups').then(rows=>{if(active&&Array.isArray(rows))setLookups(rows);}).catch(()=>{});return()=>{active=false;};},[grant,status?.canLink,tab]);

 async function fetchAttendance(){
  setFetching(true);setError('');setMessage('Asking the bridge PC to fetch attendance from the machine…');
  try{
   let request=await api<FetchRequest>(grant,'attendance/fetch','POST',{});
   for(let i=0;i<MAX_POLLS&&live.current&&(request.state==='PENDING'||request.state==='RUNNING');i++){
    await wait(POLL_MS);
    request=await api<FetchRequest>(grant,'attendance/fetch/'+request.id);
   }
   if(!live.current)return;
   if(request.state==='DONE'){setMessage(fetchMessage(request));if(tab==='punches')await load(true);else setTab('punches');}
   else{setMessage('');setError(request.state==='FAILED'?fetchMessage(request):'The fetch is taking longer than expected. Refresh in a minute.');}
  }catch(e){if(live.current){setMessage('');setError((e as Error).message);}}
  finally{if(live.current)setFetching(false);}
 }
 async function link(row:Unlinked){
  const employeeId=choice[row.deviceSerial+'|'+row.biometricId];if(!employeeId)return;
  setBusy(true);setError('');
  try{const result=await api<{employeeCode:string;employeeName:string}>(grant,'attendance/link','POST',{deviceSerial:row.deviceSerial,biometricId:row.biometricId,employeeId});setMessage(`Machine ID ${row.biometricId} linked to ${result.employeeCode} · ${result.employeeName}.`);await load(true);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function assignSite(device:Device,siteId:string){
  setBusy(true);setError('');
  try{await api(grant,'attendance/devices','POST',{serial:device.serial,siteId,name:device.name});setMessage(`Machine ${device.serial} updated.`);await load(true);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function exportCsv(){
  const rows=(punches?.rows||[]).map(p=>({'Employee code':p.employeeCode,'Employee name':p.employeeName,'Machine ID':p.biometricId,'Name on machine':p.machineName,Date:displayDate(p.date),Time:p.time,'Verified by':verifyLabel(p.verify),'Punch type':punchTypeLabel(p.punchType),Site:p.siteName,Machine:p.deviceName||p.deviceSerial}));
  download(`attendance-${from}-to-${to}.csv`,csv(['Employee code','Employee name','Machine ID','Name on machine','Date','Time','Verified by','Punch type','Site','Machine'],rows));
 }

 const employees=lookups.filter(x=>x.kind==='employees'),sites=lookups.filter(x=>x.kind==='sites');
 const rows=punches?.rows||[];
 const bridge=!status?'':!status.configured?'Bridge not set up':status.bridgeOnline?'Bridge PC online':status.bridgeLastSeen?`Bridge PC offline · last seen ${new Date(status.bridgeLastSeen).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})}`:'Bridge PC has not connected yet';

 return <section className="attendance-module attendance" aria-label="Attendance Management">
  <div className="attendance-head">
   <h1>Attendance Management</h1>
   <div className="attendance-actions">
    {status&&<span className={'attendance-bridge '+(status.bridgeOnline?'online':'offline')} role="status">{bridge}</span>}
    <button className="primary" disabled={fetching||loading||!status?.configured} onClick={()=>void fetchAttendance()}><RefreshCw className={fetching?'spin':''}/>{fetching?'Fetching…':'Fetch attendance'}</button>
   </div>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {message&&!error&&<p className="attendance-success" role="status">{message}</p>}
  {status&&!status.configured&&<p className="help-text">The bridge key has not been added to the HR API settings yet, so attendance cannot be fetched.</p>}
  <div className="module-tabs" aria-label="Attendance views">
   <button className={tab==='module'?'selected':''} aria-pressed={tab==='module'} onClick={()=>setTab('module')}>Attendance module</button>
   <button className={tab==='punches'?'selected':''} aria-pressed={tab==='punches'} onClick={()=>setTab('punches')}>Machine punches</button>
  </div>
  {tab==='module'&&<iframe src="/attendance-module.html" title="Attendance Management module"/>}
  {tab==='punches'&&<>

  <div className="data-card">
   <div className="attendance-filters">
    <label>From<input type="date" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)}/></label>
    <label>To<input type="date" value={to} min={from} onChange={e=>e.target.value&&setTo(e.target.value)}/></label>
    <span>{loading?'Loading…':`${rows.length} punch${rows.length===1?'':'es'}`}</span>
    <button disabled={!rows.length} onClick={exportCsv}><Download/>Export CSV</button>
   </div>
   {punches?.truncated&&<p className="help-text">Showing the latest {rows.length} punches. Choose a shorter date range to see the rest.</p>}
   <div className="attendance-table"><table>
    <thead><tr>{['Employee','Machine ID','Date','Time','Verified by','Punch type','Site / machine'].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>
     {!loading&&!rows.length&&<tr><td colSpan={7} className="attendance-empty">No punches for these dates. Click Fetch attendance to get the latest from the machine.</td></tr>}
     {rows.map(p=><tr key={p.id}>
      <td className={p.employeeName?'':'attendance-unlinked'}>{employeeLabel(p)}</td><td>{p.biometricId}</td><td>{displayDate(p.date)}</td><td>{p.time}</td>
      <td>{verifyLabel(p.verify)}</td><td>{punchTypeLabel(p.punchType)}</td><td>{p.siteName||p.deviceName||p.deviceSerial}</td>
     </tr>)}
    </tbody>
   </table></div>
  </div>

  {unlinked.length>0&&<div className="data-card">
   <h2>Machine IDs not linked to an employee</h2>
   <p>Each person has a user ID on the machine. Link it to their employee record once and their punches will show their name.</p>
   <div className="attendance-table"><table>
    <thead><tr>{['Machine ID','Name on machine','Site / machine','Punches','Last punch',...(status?.canLink?['Employee','']:[])].map((x,i)=><th key={i}>{x}</th>)}</tr></thead>
    <tbody>{unlinked.map(row=>{const key=row.deviceSerial+'|'+row.biometricId;return <tr key={key}>
     <td>{row.biometricId}</td><td>{row.machineName||'—'}</td><td>{row.siteName||row.deviceSerial}</td><td>{row.punches}</td><td>{row.lastPunch}</td>
     {status?.canLink&&<><td><select aria-label={`Employee for machine ID ${row.biometricId}`} value={choice[key]||''} disabled={busy} onChange={e=>setChoice(old=>({...old,[key]:e.target.value}))}><option value="">Choose employee…</option>{employees.map(e=><option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></td>
     <td><button disabled={busy||!choice[key]} onClick={()=>void link(row)}>Link</button></td></>}
    </tr>;})}</tbody>
   </table></div>
  </div>}

  {status&&status.devices.length>0&&<div className="data-card">
   <h2>Machines</h2>
   <div className="attendance-table"><table>
    <thead><tr>{['Serial number','Site','Last upload'].map(x=><th key={x}>{x}</th>)}</tr></thead>
    <tbody>{status.devices.map(d=><tr key={d.serial}>
     <td>{d.serial}{d.name&&<small> · {d.name}</small>}</td>
     <td>{status.canManageDevices&&sites.length?<select aria-label={`Site for machine ${d.serial}`} value={d.siteId||''} disabled={busy} onChange={e=>void assignSite(d,e.target.value)}><option value="">Not assigned</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>:d.siteName||'Not assigned'}</td>
     <td>{d.lastSeen?new Date(d.lastSeen).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):'—'}</td>
    </tr>)}</tbody>
   </table></div>
   {status.canManageDevices&&<p className="help-text">Assign each machine to its site so site HR users can see its punches.</p>}
  </div>}
  </>}
 </section>;
}
