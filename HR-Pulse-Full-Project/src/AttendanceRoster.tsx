import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {api,type Lookup} from './api';
import type {AttendanceRow} from './misAttendanceModel';
import {buildRoster,cardSummary,codeLabel,lineTotals,type LineTotals,type RosterGroup} from './rosterModel';
import {FIRST_TRIP_DATE,fetchBiometric,fetchTripCards} from './rosterData';
import type {Register,RegisterRow} from './AttendanceRegister';
import {DEFAULT_POLICY,type AttendancePolicy} from '../server/attendance-policy.mjs';

/* Attendance roster (owner, 22 Nov 2026). Three views of the same roster format, built in rosterModel.ts:
   - Trip card (VLB · ELB · LMV): one line per employee from MIS trip cards, job cards and vehicle log books;
   - Biometric: one line per employee from the biometric punches;
   - Trip card vs Biometric: both lines and "Diff. of Trip Card and Bio-matric", the days the two disagree,
     which opens those days below the table.
   The user chooses the site and dates first; each tab fetches only its own source for that site. */
export type RosterView='trip'|'bio'|'compare';
export const ROSTER_CODES:[string,string][]=[['P','Present'],['HD','Half day'],['A','Absent'],['WO','Weekly off'],['H','Holiday'],['CO','Comp off'],['L','Leave'],['OD','On duty'],['MP','Miss punch'],['IN','In, no Out yet'],['?','Trip card not verified yet']];
export const ROSTER_TOTALS:[keyof LineTotals,string][]=[['totalDays','Total days'],['present','Present'],['half','Half day'],['absent','Absent'],['weeklyOff','Weekly off'],['holiday','Holiday'],['compOff','Comp off'],['leave','Leave'],['onDuty','On duty'],['missPunch','Miss punch'],['lateEarly','Late / early'],['cuts','Half duty cuts'],['paidDays','Paid days']];
export const DIFF_HEADING='Diff. of Trip Card and Bio-matric';
export const VIEW_TABS:[RosterView,string][]=[['trip','Trip card (VLB · ELB · LMV)'],['bio','Biometric'],['compare','Trip card vs Biometric']];
const WEEKDAY=['Su','Mo','Tu','We','Th','Fr','Sa'];
export const weekday=(date:string)=>WEEKDAY[new Date(date+'T00:00:00Z').getUTCDay()];
const show=(date:string)=>date.split('-').reverse().join('-');
const codeClass=(code:string)=>'code-'+(code==='?'?'Q':code||'none');
const money=(n:number)=>n?'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
const india=()=>new Date(Date.now()+330*60_000).toISOString().slice(0,10);
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86_400_000).toISOString().slice(0,10);
const datesBetween=(from:string,to:string)=>{const out:string[]=[];for(let d=from;d<=to;d=addDays(d,1))out.push(d);return out;};
export const MAX_ROSTER_DAYS=31;

export function bioTotals(group:RosterGroup,dates:string[]){
 const days=group.bio?.days||[];
 return lineTotals(group.bioCodes,dates,{lateEarly:days.filter(d=>d.late||d.early).length,cuts:group.bio?.summary.halfDutyCuts||0});
}
export const tripTotals=(group:RosterGroup,dates:string[])=>lineTotals(group.tripCodes,dates);
export const diffText=(group:RosterGroup,tripsLoaded:boolean)=>!tripsLoaded?'—':!group.hasTripCards?'No trip card':String(group.mismatches.length);
/** The groups a view lists: trip card people, biometric people, or everyone. */
export const viewGroups=(groups:RosterGroup[],view:RosterView)=>groups.filter(g=>view==='trip'?g.hasTripCards:view==='bio'?Boolean(g.bio):true);

export type TripState={status:'idle'|'loading'|'ready'|'error';message:string;rows:AttendanceRow[]|null};
type TableProps={groups:RosterGroup[];dates:string[];view:RosterView;trip:TripState;monthly:boolean;from:string;to:string;loading?:boolean;error?:string;emptyText?:string};

/** The roster table, its toolbar, the difference drill-down and Export Excel. */
export function RosterTable({groups,dates,view,trip,monthly,from,to,loading=false,error='',emptyText}:TableProps){
 const [onlyDiff,setOnlyDiff]=useState(false),[open,setOpen]=useState(''),[exporting,setExporting]=useState(false);
 const drill=useRef<HTMLDivElement>(null);
 const compare=view==='compare',tripsLoaded=trip.status==='ready';
 const shown=viewGroups(groups,view).filter(g=>!compare||!onlyDiff||g.mismatches.length>0);
 const openGroup=compare?shown.find(g=>g.key===open):undefined;
 const openKey=openGroup?.key||'';
 useEffect(()=>{if(openKey)drill.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[openKey]);
 const diffCount=shown.filter(g=>g.mismatches.length).length;
 const lines=(['trip','bio'] as const).filter(line=>compare||view===line);
 const span=dates.length+ROSTER_TOTALS.length+(monthly?1:0)+(view==='trip'?1:0);

 async function exportExcel(){
  setExporting(true);
  try{const {downloadRosterExcel}=await import('./attendanceRosterExcel');await downloadRosterExcel({groups:shown,dates,tripsLoaded,monthly,from,to,view});}
  finally{setExporting(false);}
 }
 const cells=(codes:Record<string,string>,group:RosterGroup,isTrip:boolean)=>dates.map(date=>{
  const code=codes[date]||'',bio=group.bio?.days.find(d=>d.date===date),tripDay=group.tripDays[date];
  const miss=compare&&group.mismatches.some(m=>m.date===date);
  const title=show(date)+' · '+(isTrip?(tripDay?tripDay.duties.map(d=>[d.cards.join('/'),d.shift,d.equipment,d.time,d.output].filter(Boolean).join(' · ')).join(' | '):codeLabel(code)):
   (bio?`${codeLabel(code)}${bio.in?` · ${bio.in}–${bio.out||'?'}`:''}${bio.note?' · '+bio.note:''}`:codeLabel(code)));
  return <td key={date} className={'roster-day'+(miss?' roster-miss':'')}><span className={'register-cell roster-code '+codeClass(code)} title={title}>{code}{!isTrip&&(bio?.late||bio?.early)&&<sup>{bio.late?'L':''}{bio.early?'E':''}</sup>}</span></td>;
 });
 const totals=(t:LineTotals)=>ROSTER_TOTALS.map(([key])=><td key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{key==='paidDays'||key==='totalDays'?<strong>{t[key]}</strong>:t[key]}</td>);
 const lineCells=(g:RosterGroup,line:'trip'|'bio')=>line==='trip'
  ?(tripsLoaded&&g.hasTripCards?<>{cells(g.tripCodes,g,true)}{totals(tripTotals(g,dates))}{monthly&&<td className="roster-total">—</td>}{view==='trip'&&<td className="roster-text roster-cards">{cardSummary(g,dates)||'—'}</td>}</>:
   <td colSpan={span} className="roster-nolink">{trip.status==='loading'?trip.message||'Reading trip cards…':trip.status==='error'?'Trip cards unavailable':'No trip card or log book in these dates'}</td>)
  :(g.bio?<>{cells(g.bioCodes,g,false)}{totals(bioTotals(g,dates))}{monthly&&<td className="roster-total">{money(g.bio.summary.gatePassDeduction)}</td>}</>:
   <td colSpan={span} className="roster-nolink">Biometric ID not linked in Biometric integration</td>);
 const status=view!=='bio'&&trip.status==='loading'?trip.message||'Reading trip cards…':view!=='bio'&&trip.status==='error'?`Trip cards unavailable: ${trip.message}`:
  loading?'Reading biometric punches…':`${shown.length} employee${shown.length===1?'':'s'}`+(compare?` · ${diffCount} with a difference`:'');
 const empty=<tr><td colSpan={60} className="attendance-empty">{loading||trip.status==='loading'?'Loading attendance…':error?'Attendance is unavailable.':onlyDiff&&compare?'No employee has a difference between trip card and biometric.':emptyText||'No attendance for this selection.'}</td></tr>;

 return <>
  <div className="roster-legend" aria-label="Day codes">{ROSTER_CODES.filter(([code])=>view!=='bio'||code!=='?').map(([code,label])=><span key={code}><b className={'register-cell '+codeClass(code)}>{code}</b> {label}</span>)}{view!=='trip'&&<span><sup className="roster-sup">L</sup> late come · <sup className="roster-sup">E</sup> early going</span>}{compare&&<span><i className="roster-miss-key"/> day where trip card and biometric differ</span>}</div>
  <div className="roster-bar">
   {compare&&<label className="roster-check"><input type="checkbox" checked={onlyDiff} onChange={e=>setOnlyDiff(e.target.checked)}/>Only employees with a difference</label>}
   <span role="status">{status}</span>
   <button type="button" disabled={!shown.length||exporting} onClick={exportExcel}><Download/>{exporting?'Preparing…':'Export Excel'}</button>
  </div>
  <div className="attendance-table"><table className={'register-grid roster-grid'+(compare?'':' roster-nosrc')} aria-label="Attendance roster">
   <thead><tr>{compare&&<th className="roster-fixed roster-src">Source</th>}<th className={'roster-fixed roster-sr'+(compare?'':' roster-first')}>Sr. No.</th><th className="roster-fixed roster-id">Employee ID</th><th className="roster-fixed roster-name">Name</th><th className="roster-text">Site</th><th className="roster-text">Department</th><th className="roster-text">Designation</th>
    {dates.map(d=><th key={d} title={show(d)} className={weekday(d)==='Su'?'roster-sunday':undefined}>{Number(d.slice(8))}<small className="register-sub">{weekday(d)}</small></th>)}
    {ROSTER_TOTALS.map(([key,label])=><th key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{label}</th>)}{monthly&&<th className="roster-total">Gate pass</th>}
    {view==='trip'&&<th className="roster-text roster-cards">Cards (days)</th>}{compare&&<th className="roster-diff">{DIFF_HEADING}</th>}</tr></thead>
   <tbody>{shown.length?shown.map((g,i)=>{const picked=g.key===open,diff=diffText(g,tripsLoaded),rows=lines.length;return <Fragment key={g.key}>
    {lines.map((line,j)=><tr key={line} className={(line==='trip'?'roster-trip':'roster-bio')+(rows===1?' roster-single':'')+(picked?' roster-picked':'')}>
     {compare&&<th scope="row" className="roster-fixed roster-src">{line==='trip'?'Trip Card':'Bio Matric'}</th>}
     {j===0&&<><td rowSpan={rows} className={'roster-fixed roster-sr'+(compare?'':' roster-first')}>{i+1}</td><td rowSpan={rows} className="roster-fixed roster-id">{g.code}</td>
      <td rowSpan={rows} className="roster-fixed roster-name"><strong>{g.name}</strong>{(g.shift||g.exempt)&&<small className="register-sub">{[g.shift,g.exempt?'Exempt':''].filter(Boolean).join(' · ')}</small>}</td>
      <td rowSpan={rows} className="roster-text">{g.site||'—'}</td><td rowSpan={rows} className="roster-text">{g.department||'—'}</td><td rowSpan={rows} className="roster-text">{g.designation||'—'}</td></>}
     {lineCells(g,line)}
     {compare&&j===0&&<td rowSpan={rows} className="roster-diff">{g.mismatches.length?<button type="button" className="roster-diff-open" aria-pressed={picked} aria-label={`${g.mismatches.length} days differ for ${g.name}`} onClick={()=>setOpen(picked?'':g.key)}>{diff}</button>:
      <span className={diff==='0'?'roster-diff-ok':'roster-diff-none'}>{diff==='0'?'0 · matches':diff}</span>}{g.pending>0&&<small className="register-sub">{g.pending} not verified</small>}</td>}
    </tr>)}
   </Fragment>;}):empty}</tbody>
  </table></div>
  {openGroup&&<div ref={drill} className="roster-drill">
   <h3>Step 1 · {openGroup.name} ({openGroup.code}) · days where trip card and biometric differ</h3>
   <div className="attendance-table"><table aria-label={'Differences for '+openGroup.name}>
    <thead><tr>{['Date','Day','Trip Card','Trip card details','Bio Matric','Biometric details','Difference'].map(h=><th key={h}>{h}</th>)}</tr></thead>
    <tbody>{openGroup.mismatches.map(m=><tr key={m.date}><td>{show(m.date)}</td><td>{weekday(m.date)}</td>
     <td><span className={'register-cell roster-code '+codeClass(m.trip)}>{m.trip||'—'}</span></td><td className="roster-detail">{m.tripDetail}</td>
     <td><span className={'register-cell roster-code '+codeClass(m.bio)}>{m.bio||'—'}</span></td><td className="roster-detail">{m.bioDetail}</td><td className="roster-reason">{m.reason}</td></tr>)}</tbody>
   </table></div>
  </div>}
  <p className="help-text">{view==='bio'?'Biometric: punches of employees linked in Biometric integration, rated with the attendance policy. ':'Trip card: MIS VLB trip cards, ELB job cards and LMV vehicle log books, rated with the attendance policy hours rule (? until the MIS batch is closed). '}
   {compare?'Bio Matric: biometric punches of employees linked in Biometric integration. ':''}Weekly off, holiday, leave, comp off and OD come from HR records{compare?' and show on both lines':''}. Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty.</p>
 </>;
}

/** The Weekly attendance register's comparison: both lines for the week shown (its own register rows and filters). */
type CompareProps={grant:string;rows:RegisterRow[];dates:string[];today:string;policy?:AttendancePolicy;monthly:boolean;site:string;department:string;search:string;loading:boolean;error:string};
export default function AttendanceRoster({grant,rows,dates,today,policy=DEFAULT_POLICY,monthly,site,department,search,loading,error}:CompareProps){
 const from=dates[0]||'',to=dates[dates.length-1]||'';
 const tripTo=to>today?today:to,key=from+':'+tripTo;
 const [trip,setTrip]=useState<TripState&{key:string}>({key:'',status:'idle',message:'',rows:null});
 useEffect(()=>{
  let live=true;
  setTrip({key,status:'loading',message:'Reading trip cards…',rows:null});
  fetchTripCards(grant,from,tripTo,'').then(rows=>{if(live)setTrip({key,status:'ready',message:'',rows});}).catch(e=>{if(live)setTrip({key,status:'error',message:(e as Error).message,rows:null});});
  return()=>{live=false;};
 },[grant,from,tripTo,key]);
 const tripState=trip.key===key?trip:{status:'loading' as const,message:'Reading trip cards…',rows:null};
 const groups=useMemo(()=>buildRoster(rows,tripState.rows,dates,today,policy),[rows,tripState.rows,dates,today,policy]);
 const needle=search.trim().toLowerCase();
 const shown=groups.filter(g=>(!site||g.site===site)&&(!department||g.department===department)&&(!needle||[g.name,g.code,g.designation,g.department].some(v=>v?.toLowerCase().includes(needle))));
 return <RosterTable groups={shown} dates={dates} view="compare" trip={tripState} monthly={monthly} from={from} to={to} loading={loading} error={error}/>;
}

type Source<T>={key:string;status:'idle'|'loading'|'ready'|'error';message:string;data:T|null};
const idle={key:'',status:'idle' as const,message:'',data:null};

/** Attendance roster page: site, dates, department and employee first; then the Trip card, Biometric or comparison tab. */
export function AttendanceRosterPage({grant}:{grant:string}){
 const today=india();
 const [sites,setSites]=useState<string[]|null>(null),[departments,setDepartments]=useState<string[]>([]),[lookupError,setLookupError]=useState('');
 const [site,setSite]=useState(''),[from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today);
 const [department,setDepartment]=useState(''),[employee,setEmployee]=useState('');
 const [view,setView]=useState<RosterView|''>('');
 const [trip,setTrip]=useState<Source<AttendanceRow[]>>(idle),[bio,setBio]=useState<Source<Register>>(idle);
 const [reload,setReload]=useState(0);
 useEffect(()=>{let live=true;
  api<Lookup[]>(grant,'lookups').then(rows=>{if(!live)return;const list=Array.isArray(rows)?rows:[];
   setSites([...new Set(list.filter(r=>r.kind==='sites').map(r=>r.name).filter(Boolean))].sort());
   setDepartments([...new Set(list.filter(r=>r.kind==='departments').map(r=>r.name).filter(Boolean))].sort());})
   .catch(e=>{if(live){setSites([]);setLookupError((e as Error).message);}});
  return()=>{live=false;};},[grant]);
 const days=from&&to&&to>=from?(Date.parse(to)-Date.parse(from))/86_400_000+1:0;
 const rangeError=!from||!to?'Choose both dates.':to<from?'The end date must be on or after the start date.':days>MAX_ROSTER_DAYS?`Choose up to ${MAX_ROSTER_DAYS} days.`:to>today?'The end date cannot be after today.':view&&view!=='bio'&&to<FIRST_TRIP_DATE?'Trip cards are available from 1 November 2026.':'';
 const ready=Boolean(site)&&!rangeError;
 const key=[site,from,to,reload].join('|');
 // The Trip card tab also reads the HR employee details (department, designation, leave and holidays) from the register;
 // its day codes still come only from MIS.
 const wantTrip=ready&&(view==='trip'||view==='compare'),wantBio=ready&&Boolean(view);
 useEffect(()=>{
  if(!wantTrip||trip.key===key)return;
  let live=true;
  setTrip({key,status:'loading',message:'Reading trip cards…',data:null});
  fetchTripCards(grant,from,to,site,(done,total)=>{if(live&&done<total)setTrip(t=>t.key===key?{...t,message:`Reading trip cards from MIS · week ${done+1} of ${total}…`}:t);})
   .then(rows=>{if(live)setTrip({key,status:'ready',message:'',data:rows});})
   .catch(e=>{if(live)setTrip({key,status:'error',message:(e as Error).message,data:null});});
  return()=>{live=false;};
 },[wantTrip,key]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(!wantBio||bio.key===key)return;
  let live=true;
  setBio({key,status:'loading',message:'',data:null});
  fetchBiometric(grant,from,to,site).then(data=>{if(live)setBio({key,status:'ready',message:'',data});}).catch(e=>{if(live)setBio({key,status:'error',message:(e as Error).message,data:null});});
  return()=>{live=false;};
 },[wantBio,key]); // eslint-disable-line react-hooks/exhaustive-deps
 const dates=useMemo(()=>ready?datesBetween(from,to):[],[ready,from,to]);
 const tripRows=trip.key===key&&trip.status==='ready'?trip.data:null,bioData=bio.key===key&&bio.status==='ready'?bio.data:null;
 const policy=bioData?.policy||DEFAULT_POLICY;
 const groups=useMemo(()=>buildRoster(bioData?.rows||[],view==='bio'?null:tripRows,dates,today,policy).map(g=>({...g,site:g.site||site})),[bioData,tripRows,dates,today,policy,view,site]);
 const people=groups.filter(g=>view?viewGroups([g],view).length>0:false);
 const shown=people.filter(g=>(!department||g.department===department)&&(!employee||g.key===employee));
 const tripState:TripState=trip.key!==key?{status:wantTrip?'loading':'idle',message:'Reading trip cards…',rows:null}:{status:trip.status,message:trip.message,rows:trip.data};
 const bioLoading=view!=='trip'&&wantBio&&(bio.key!==key||bio.status==='loading');
 const choose=(next:RosterView)=>{setView(next);setEmployee('');};
 const busy=tripState.status==='loading'||bioLoading;

 return <section className="data-card attendance-register attendance-roster" aria-label="Attendance roster">
  <h2>Attendance roster</h2>
  <p className="help-text">Choose the site and dates, then press Trip card to read MIS (VLB, ELB and LMV) or Biometric to read the machine punches. Trip card vs Biometric shows both lines and the days they differ.</p>
  <div className="attendance-filters roster-filters">
   <label>Site<select value={site} required aria-invalid={!site} onChange={e=>{setSite(e.target.value);setEmployee('');}}><option value="">{sites===null?'Loading sites…':'Select a site'}</option>{(sites||[]).map(s=><option key={s}>{s}</option>)}</select></label>
   <label>From<input type="date" value={from} max={to||today} onChange={e=>setFrom(e.target.value)}/></label>
   <label>To<input type="date" value={to} min={from} max={today} onChange={e=>setTo(e.target.value)}/></label>
   <label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">All departments</option>{departments.map(d=><option key={d}>{d}</option>)}</select></label>
   <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)} disabled={!people.length}><option value="">All employees</option>{people.filter(g=>!department||g.department===department).map(g=><option key={g.key} value={g.key}>{g.code} · {g.name}</option>)}</select></label>
   <button type="button" disabled={!ready||!view||busy} onClick={()=>setReload(n=>n+1)}><RefreshCw className={busy?'spin':''}/>Fetch again</button>
  </div>
  {lookupError&&<p className="error" role="alert">Sites could not be loaded: {lookupError}</p>}
  {sites&&!sites.length&&!lookupError&&<p className="error" role="alert">No site is assigned to your login.</p>}
  {rangeError&&<p className="error" role="alert">{rangeError}</p>}
  <div className="module-tabs roster-tabs" aria-label="Roster source">{VIEW_TABS.map(([id,label])=><button key={id} type="button" className={view===id?'selected':''} aria-pressed={view===id} disabled={!site} title={site?undefined:'Select a site first'} onClick={()=>choose(id)}>{label}</button>)}</div>
  {!site?<p className="roster-hint">Select a site first.</p>:!view?<p className="roster-hint">Press <b>Trip card</b> to fetch from MIS, or <b>Biometric</b> to fetch the machine punches, for {site} · {show(from)} to {show(to)}.</p>:
   ready&&<>{view!=='trip'&&bio.key===key&&bio.status==='error'&&<p className="error" role="alert">Biometric punches unavailable: {bio.message}</p>}
   <RosterTable key={view} groups={shown} dates={dates} view={view} trip={tripState} monthly={from.slice(8)==='01'&&days>=28} from={from} to={to} loading={bioLoading} error={view!=='trip'&&bio.key===key&&bio.status==='error'?bio.message:''}
    emptyText={view==='trip'?`No VLB, ELB or LMV card at ${site} in these dates.`:view==='bio'?`No biometric punches for employees of ${site} in these dates. Only employees whose machine ID is linked in Biometric integration appear here.`:undefined}/></>}
 </section>;
}
