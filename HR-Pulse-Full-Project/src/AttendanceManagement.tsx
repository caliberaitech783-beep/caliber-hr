import {downloadExcel} from './excelFiles';
import {hrAsset,inPulseII} from './hr-paths';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {api,type Lookup,type Module} from './api';
import BiometricMachines,{type Machine} from './BiometricMachines';
import PunctualitySummary from './PunctualitySummary';
import ShiftMaster from './ShiftMaster';
import MisAttendance from './MisAttendance';
import AttendanceRegister from './AttendanceRegister';
import type {BridgePc} from './BridgePcs';
import {AttendanceRosterPage} from './AttendanceRoster';
import AttendancePolicySettings,{usePolicy} from './AttendancePolicy';
import HRCalendar from './HRCalendar';
import {LeaveRequests} from './LeaveMaster';
import type {AttendancePolicy} from '../server/attendance-policy.mjs';
import './attendance.css';

/* Attendance Management main menu: three groups of sub menus plus the policy
   settings. Each item opens the existing screen where one exists. */
export const ATTENDANCE_MENU=[
 {group:'Attendance fetch',items:['Biometric integration','Trip card and logbook']},
 {group:'Attendance regularization',items:['Late come / early going','OD (on duty)','Miss punch','Gate pass','Overtime','Weekly off and holiday']},
 {group:'Shift management',items:['Shift roster','Monthly attendance register','Weekly and daily attendance register','Site-wise attendance']},
 {group:'Settings',items:['HR policy · attendance']},
] as const;
export type AttendanceView=typeof ATTENDANCE_MENU[number]['items'][number];
export const attendanceViews:string[]=ATTENDANCE_MENU.flatMap(g=>[...g.items]);
export const attendanceGroup=(view:string)=>ATTENDANCE_MENU.find(g=>(g.items as readonly string[]).includes(view))?.group||'';
/** The legacy sheet-upload module opened on one view, rating days with the saved policy. */
export const legacyModuleUrl=(view:string,policy?:AttendancePolicy)=>hrAsset('attendance-module.html')+'?'+new URLSearchParams({view,...(policy?{grace:String(policy.graceMinutes),full:String(policy.fullDutyHours),absent:String(policy.absentBelowHours),lunch:String(policy.lunchMinutes),perCut:String(policy.lateEarlyPerHalfCut)}:{})});

/* Punches come from the site fingerprint/face machines. Azure cannot reach a
   machine on a site network, so "Fetch attendance" raises a request that the
   bridge PC at the site picks up; this page then waits for it to finish.
   "Machine punches" shows what the machines actually recorded; the legacy
   sheet-upload module (public/attendance-module.html) still handles ESSL
   Excel exports and the biometric vs trip card comparison. */
export type Punch={id:string;deviceSerial:string;deviceName:string;siteName:string;biometricId:string;date:string;time:string;verify:string;punchType:string;employeeId:string;employeeCode:string;employeeName:string;machineName:string};
export type FetchRequest={id:string;state:'PENDING'|'RUNNING'|'DONE'|'FAILED';punchesReceived:number;newPunches:number;error:string;requestedAt:string;completedAt:string|null};
type Status={configured:boolean;bridgeOnline:boolean;bridgeLastSeen:string|null;devices:Machine[];bridges?:BridgePc[];lastFetch:FetchRequest|null;canLink:boolean;canManageDevices:boolean};
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

type AttendanceProps={grant:string;view?:string;onNavigate?:(view:AttendanceView)=>void;shiftModule?:Module;config?:Record<string,Module>;actor?:string;canApprove?:boolean;notice?:(message:string)=>void};

export default function AttendanceManagement({grant,view='Biometric integration',onNavigate,shiftModule,config={},actor='',canApprove=false,notice=()=>{}}:AttendanceProps){
 const [policyState]=usePolicy(grant);
 const policy=policyState?.policy;
 const [shiftView,setShiftView]=useState<'duties'|'settings'>('duties');
 const current=(attendanceViews.includes(view)?view:'Biometric integration') as AttendanceView;
 return <section className="attendance-module attendance" aria-label="Attendance Management">
  <div className="attendance-head">
   <div><h1>Attendance Management</h1><p className="attendance-crumb">{attendanceGroup(current)} › {current}</p></div>
  </div>
  {current==='Biometric integration'&&<BiometricIntegration grant={grant} policy={policy} onNavigate={onNavigate}/>}
  {current==='Trip card and logbook'&&<MisAttendance grant={grant} policy={policy}/>}
  {current==='Late come / early going'&&<PunctualitySummary grant={grant} initialMonth={indiaToday().slice(0,7)}/>}
  {current==='OD (on duty)'&&<LeaveRequests grant={grant} focus="od" odModule={config.outDutyRequests} actor={actor} canApprove={canApprove} notice={notice}/>}
  {current==='Miss punch'&&<AttendanceRegister grant={grant} mode="miss"/>}
  {current==='Gate pass'&&<><LeaveRequests grant={grant} focus="gate" gateModule={config.gatePasses} actor={actor} canApprove={canApprove} notice={notice}/><AttendanceRegister grant={grant} mode="gate"/></>}
  {current==='Overtime'&&<MisAttendance grant={grant} overtimeOnly policy={policy}/>}
  {current==='Weekly off and holiday'&&<><p className="help-text">Weekly off: offices take Sunday off; sites run all 7 days on shift rotation. Holidays come from the holiday list of each site below and show as H in the attendance register.</p><HRCalendar grant={grant} config={config}/></>}
  {current==='Shift roster'&&<>
   {shiftModule&&<div className="module-tabs" aria-label="Shift views">
    <button aria-pressed={shiftView==='duties'} className={shiftView==='duties'?'selected':''} onClick={()=>setShiftView('duties')}>Shift attendance</button>
    <button aria-pressed={shiftView==='settings'} className={shiftView==='settings'?'selected':''} onClick={()=>setShiftView('settings')}>Shift settings</button>
   </div>}
   {shiftView==='settings'&&shiftModule?<ShiftMaster grant={grant} module={shiftModule}/>:<MisAttendance grant={grant} shiftManagement policy={policy}/>}
  </>}
  {current==='Monthly attendance register'&&<AttendanceRegister grant={grant} mode="month"/>}
  {current==='Weekly and daily attendance register'&&<AttendanceRegister grant={grant} mode="week-day"/>}
  {current==='Site-wise attendance'&&<AttendanceRegister grant={grant} mode="site"/>}
  {current==='HR policy · attendance'&&<AttendancePolicySettings grant={grant}/>}
 </section>;
}

function BiometricIntegration({grant,policy,onNavigate}:{grant:string;policy?:AttendancePolicy;onNavigate?:(view:AttendanceView)=>void}){
 const today=indiaToday();
 const [from,setFrom]=useState(today),[to,setTo]=useState(today);
 const [status,setStatus]=useState<Status|null>(null),[punches,setPunches]=useState<PunchList|null>(null),[unlinked,setUnlinked]=useState<Unlinked[]>([]);
 const [lookups,setLookups]=useState<Lookup[]>([]),[choice,setChoice]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(true),[fetching,setFetching]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [tab,setTab]=useState<'punches'|'machines'|'sheet'|'tripPunch'|'recon'|'roster'>('punches');
 const [selected,setSelected]=useState('');
 const live=useRef(true);
 const attendanceFrame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{
  const openView=(event:MessageEvent)=>{
   if(event.origin===(inPulseII?'null':window.location.origin)&&event.source===attendanceFrame.current?.contentWindow){
    if(event.data==='open-hr-mis-attendance')onNavigate?.('Trip card and logbook');
    if(event.data==='open-hr-shift-attendance')onNavigate?.('Shift roster');
    if(event.data?.view==='hr-punctuality')onNavigate?.('Late come / early going');
   }
  };
  window.addEventListener('message',openView);
  return()=>window.removeEventListener('message',openView);
 },[onNavigate]);

 const load=useCallback(async(showPunches:boolean,serial=selected)=>{
  setLoading(true);setError('');
  try{
   const [nextStatus,nextPunches,nextUnlinked]=await Promise.all([
    api<Status>(grant,'attendance/status'),
    showPunches?api<PunchList>(grant,`attendance/punches?from=${from}&to=${to}&deviceSerial=${encodeURIComponent(serial)}`):null,
    showPunches?api<Unlinked[]>(grant,'attendance/unlinked'):null,
   ]);
   if(!live.current)return;
   setStatus({...nextStatus,devices:Array.isArray(nextStatus?.devices)?nextStatus.devices:[]});
   if(nextPunches)setPunches({...nextPunches,rows:Array.isArray(nextPunches.rows)?nextPunches.rows:[]});
   if(nextUnlinked)setUnlinked(Array.isArray(nextUnlinked)?nextUnlinked:[]);
  }catch(e){if(live.current)setError((e as Error).message);}
  finally{if(live.current)setLoading(false);}
 },[grant,from,to,selected]);
 useEffect(()=>{void load(tab==='punches');},[load,tab]);
 useEffect(()=>{if(!status?.canLink||(tab!=='punches'&&tab!=='machines'))return;let active=true;api<Lookup[]>(grant,'lookups').then(rows=>{if(active&&Array.isArray(rows))setLookups(rows);}).catch(()=>{});return()=>{active=false;};},[grant,status?.canLink,tab]);

 useEffect(()=>{
  if(tab!=='machines')return;
  let active=true;
  const timer=setInterval(()=>{api<Status>(grant,'attendance/status').then(s=>{if(active)setStatus({...s,devices:Array.isArray(s?.devices)?s.devices:[]});}).catch(()=>{});},15000);
  return()=>{active=false;clearInterval(timer);};
 },[grant,tab]);
 async function fetchAttendance(serial=''){
  setSelected(serial);
  setFetching(true);setError('');setMessage('Asking the bridge PC to fetch attendance from the machine…');
  try{
   let request=await api<FetchRequest>(grant,'attendance/fetch','POST',{deviceSerial:serial});
   for(let i=0;i<MAX_POLLS&&live.current&&(request.state==='PENDING'||request.state==='RUNNING');i++){
    await wait(POLL_MS);
    request=await api<FetchRequest>(grant,'attendance/fetch/'+request.id);
   }
   if(!live.current)return;
   if(request.state==='DONE'){setMessage((serial?serial+' · ':'')+fetchMessage(request));if(tab==='punches')await load(true,serial);else setTab('punches');}
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
 function exportExcel(){
  const rows=(punches?.rows||[]).map(p=>({'Employee code':p.employeeCode,'Employee name':p.employeeName,'Machine ID':p.biometricId,'Name on machine':p.machineName,Date:displayDate(p.date),Time:p.time,'Verified by':verifyLabel(p.verify),'Punch type':punchTypeLabel(p.punchType),Site:p.siteName,Machine:p.deviceName||p.deviceSerial}));
  downloadExcel(`attendance-${from}-to-${to}.xlsx`,['Employee code','Employee name','Machine ID','Name on machine','Date','Time','Verified by','Punch type','Site','Machine'],rows);
 }

 const employees=lookups.filter(x=>x.kind==='employees'),sites=lookups.filter(x=>x.kind==='sites');
 const rows=punches?.rows||[];
 const bridge=!status?'':!status.configured?'Bridge not set up':status.bridgeOnline?'Bridge PC online':status.bridgeLastSeen?`Bridge PC offline · last seen ${new Date(status.bridgeLastSeen).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})}`:'Bridge PC has not connected yet';

 return <>
  <div className="attendance-head">
   <p className="help-text">Punches from the ESSL fingerprint / face machines, collected by the bridge PC at each site. Link each machine ID to an employee once; the attendance register then rates their days with the HR policy.</p>
   <div className="attendance-actions">
    {status&&<span className={'attendance-bridge '+(status.bridgeOnline?'online':'offline')} role="status">{bridge}</span>}
    <button className="primary" disabled={fetching||loading||!status?.configured} onClick={()=>void fetchAttendance()}><RefreshCw className={fetching?'spin':''}/>{fetching?'Fetching…':'Fetch attendance'}</button>
   </div>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {message&&!error&&<p className="attendance-success" role="status">{message}</p>}
  {status&&!status.configured&&<p className="help-text">The bridge key has not been added to the HR API settings yet, so attendance cannot be fetched.</p>}
  <div className="module-tabs" aria-label="Biometric views">
   <button className={tab==='punches'?'selected':''} aria-pressed={tab==='punches'} onClick={()=>setTab('punches')}>Machine punches</button>
   <button className={tab==='machines'?'selected':''} aria-pressed={tab==='machines'} onClick={()=>setTab('machines')}>Biometric machines</button>
   <button className={tab==='sheet'?'selected':''} aria-pressed={tab==='sheet'} onClick={()=>setTab('sheet')}>ESSL punch log (Excel)</button>
   <button className={tab==='tripPunch'?'selected':''} aria-pressed={tab==='tripPunch'} onClick={()=>setTab('tripPunch')}>Trip card punch</button>
   <button className={tab==='recon'?'selected':''} aria-pressed={tab==='recon'} onClick={()=>setTab('recon')}>Biometric vs trip card</button>
   <button className={tab==='roster'?'selected':''} aria-pressed={tab==='roster'} onClick={()=>setTab('roster')}>Attendance roster</button>
  </div>
  {/* Owner, 22 Nov 2026: the monthly roster (Trip Card and Bio Matric lines, difference drill-down) as a tab after Biometric vs trip card. */}
  {tab==='roster'&&<AttendanceRosterPage grant={grant} onManageMachines={()=>setTab('machines')}/>}
  {(tab==='sheet'||tab==='tripPunch'||tab==='recon')&&<iframe key={tab} ref={attendanceFrame} src={legacyModuleUrl(tab==='sheet'?'punch':tab==='tripPunch'?'tpunch':'recon',policy)} sandbox={inPulseII ? "allow-scripts allow-downloads" : undefined} title={tab==='sheet'?'ESSL punch log upload':tab==='tripPunch'?'Trip card punch':'Biometric vs trip card comparison'}/>}
  {tab==='punches'&&<>

  <div className="data-card">
   <div className="attendance-filters">
    <label>Machine<select disabled={fetching} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">All machines</option>{status?.devices.map(d=><option key={d.serial} value={d.serial}>{[d.siteName,d.location,d.serial].filter(Boolean).join(" · ")}</option>)}</select></label>
    <label>From<input type="date" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)}/></label>
    <label>To<input type="date" value={to} min={from} onChange={e=>e.target.value&&setTo(e.target.value)}/></label>
    <span>{loading?'Loading…':`${rows.length} punch${rows.length===1?'':'es'}`}</span>
    <button disabled={!rows.length} onClick={exportExcel}><Download/>Export Excel</button>
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

  </>}
  {tab==='machines'&&status&&<BiometricMachines grant={grant} machines={status.devices} sites={sites} bridges={status.bridges} bridgeOnline={status.bridgeOnline} configured={status.configured} canManage={status.canManageDevices} fetching={fetching}
   onFetch={serial=>void fetchAttendance(serial)} onError={setError} onSaved={async text=>{setError('');setMessage(text);await load(false);}}/>}
 </>;
}
