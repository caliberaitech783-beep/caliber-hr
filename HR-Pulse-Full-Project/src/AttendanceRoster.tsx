import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {Download,RefreshCw,Save} from 'lucide-react';
import {api,type Lookup} from './api';
import type {AttendanceRow} from './misAttendanceModel';
import {buildRoster,cardSummary,codeLabel,lineTotals,type LineTotals,type RosterGroup} from './rosterModel';
import {FIRST_TRIP_DATE,fetchBiometric,fetchTripCards,readSavedTripCards,saveTripCards,streamTripCards,tripDays,type DayState,type DayUpdate,type SavedInfo} from './rosterData';
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

/** rows: the trip cards read so far (shown while the other days are still being read); days: each day's reading state. */
export type TripState={status:'idle'|'loading'|'ready'|'error';message:string;rows:AttendanceRow[]|null;failed?:string[];misSites?:string[];days?:Record<string,DayState>;errors?:Record<string,string>;onRetry?:(days:string[])=>void;
 /** Save trip cards: the button's text, whether it can be pressed, and the note on what is saved. */
 onSave?:()=>void;saveLabel?:string;canSave?:boolean;savedNote?:string;saveError?:string;saved?:Record<string,SavedInfo>};
const DAY_STATE:Record<DayState,string>={queued:'Waiting to be read from MIS',loading:'Reading from MIS…',retrying:'MIS was busy · trying again…',done:'Read from MIS',failed:'Could not be read from MIS'};
type TableProps={groups:RosterGroup[];dates:string[];view:RosterView;trip:TripState;monthly:boolean;from:string;to:string;loading?:boolean;error?:string;emptyText?:string};

/** The roster table, its toolbar, the difference drill-down and Export Excel. */
export function RosterTable({groups,dates,view,trip,monthly,from,to,loading=false,error='',emptyText}:TableProps){
 const [onlyDiff,setOnlyDiff]=useState(false),[open,setOpen]=useState(''),[exporting,setExporting]=useState(false);
 const drill=useRef<HTMLDivElement>(null);
 const compare=view==='compare',tripsLoaded=trip.rows!==null,tripRunning=trip.status==='loading';
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
   <td colSpan={span} className="roster-nolink">{tripRunning?'No trip card in the days read so far':trip.status==='error'?'Trip cards unavailable':'No trip card or log book in these dates'}</td>)
  :(g.bio?<>{cells(g.bioCodes,g,false)}{totals(bioTotals(g,dates))}{monthly&&<td className="roster-total">{money(g.bio.summary.gatePassDeduction)}</td>}</>:
   <td colSpan={span} className="roster-nolink">Biometric ID not linked in Biometric integration</td>);
 const status=view!=='bio'&&tripRunning?(trip.message||'Reading trip cards…')+(tripsLoaded?` · ${shown.length} employee${shown.length===1?'':'s'} so far`:''):view!=='bio'&&trip.status==='error'?`Trip cards unavailable: ${trip.message}`:
  loading?'Reading biometric punches…':`${shown.length} employee${shown.length===1?'':'s'}`+(compare?` · ${diffCount} with a difference`:'');
 const empty=<tr><td colSpan={60} className="attendance-empty">{loading||(tripRunning&&view!=='bio')?'Loading attendance… the muster fills in as each day arrives from MIS.':error?'Attendance is unavailable.':onlyDiff&&compare?'No employee has a difference between trip card and biometric.':emptyText||'No attendance for this selection.'}</td></tr>;

 return <>
  <div className="roster-legend" aria-label="Day codes">{ROSTER_CODES.filter(([code])=>view!=='bio'||code!=='?').map(([code,label])=><span key={code}><b className={'register-cell '+codeClass(code)}>{code}</b> {label}</span>)}{view!=='trip'&&<span><sup className="roster-sup">L</sup> late come · <sup className="roster-sup">E</sup> early going</span>}{compare&&<span><i className="roster-miss-key"/> day where trip card and biometric differ</span>}</div>
  {view!=='bio'&&trip.status==='ready'&&(trip.failed?.length||0)>0&&<div className="roster-warn" role="alert">Trip cards could not be read from MIS for {trip.failed!.map(show).join(', ')}, even after trying each day again{trip.errors?` (MIS: ${[...new Set(trip.failed!.map(d=>trip.errors![d]).filter(Boolean))].join('; ')})`:''}. Those days are blank.
   {trip.onRetry&&<button type="button" className="roster-retry" onClick={()=>trip.onRetry!(trip.failed!)}><RefreshCw/>Retry these days</button>}</div>}
  {view!=='bio'&&trip.status==='ready'&&!(trip.rows||[]).length&&(trip.misSites?.length||0)>0&&<p className="roster-warn" role="alert">MIS has trip cards in these dates for {trip.misSites!.join(', ')}, but none for this site. If one of them is this site, its name is written differently in HR and MIS.</p>}
  {view!=='bio'&&trip.savedNote&&<p className="roster-saved" role="status">{trip.savedNote}</p>}
  {view!=='bio'&&trip.saveError&&<p className="roster-warn" role="alert">{trip.saveError}</p>}
  <div className="roster-bar">
   {compare&&<label className="roster-check"><input type="checkbox" checked={onlyDiff} onChange={e=>setOnlyDiff(e.target.checked)}/>Only employees with a difference</label>}
   <span role="status">{status}</span>
   {view!=='bio'&&trip.onSave&&<button type="button" className="roster-save" disabled={!trip.canSave} onClick={trip.onSave}><Save/>{trip.saveLabel||'Save trip cards'}</button>}
   <button type="button" disabled={!shown.length||exporting} onClick={exportExcel}><Download/>{exporting?'Preparing…':'Export Excel'}</button>
  </div>
  <div className="attendance-table"><table className={'register-grid roster-grid'+(compare?'':' roster-nosrc')} aria-label="Attendance roster">
   <thead><tr>{compare&&<th className="roster-fixed roster-src">Source</th>}<th className={'roster-fixed roster-sr'+(compare?'':' roster-first')}>Sr. No.</th><th className="roster-fixed roster-id">Employee ID</th><th className="roster-fixed roster-name">Name</th><th className="roster-text">Site</th><th className="roster-text">Department</th><th className="roster-text">Designation</th>
    {dates.map(d=>{const state=view!=='bio'?trip.days?.[d]:undefined;return <th key={d} title={show(d)+(state==='done'&&trip.saved?.[d]?' · Saved copy':'')+(state?' · '+DAY_STATE[state]+(state==='failed'&&trip.errors?.[d]?': '+trip.errors[d]:''):'')} className={[weekday(d)==='Su'?'roster-sunday':'',state&&state!=='done'?'roster-day-'+state:''].filter(Boolean).join(' ')||undefined}>{Number(d.slice(8))}<small className="register-sub">{weekday(d)}</small>{state&&state!=='done'&&<i className="roster-day-mark" aria-label={DAY_STATE[state]}/>}</th>;})}
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
  fetchTripCards(grant,from,tripTo,'',(done,total)=>{if(live&&done<total)setTrip(t=>t.key===key?{...t,message:`Reading trip cards from MIS · ${done} of ${total} days…`}:t);}).then(r=>{if(live)setTrip({key,status:'ready',message:'',rows:r.rows,failed:r.failed,misSites:r.misSites});}).catch(e=>{if(live)setTrip({key,status:'error',message:(e as Error).message,rows:null});});
  return()=>{live=false;};
 },[grant,from,tripTo,key]);
 const tripState=trip.key===key?trip:{status:'loading' as const,message:'Reading trip cards…',rows:null};
 const groups=useMemo(()=>buildRoster(rows,tripState.rows,dates,today,policy),[rows,tripState.rows,dates,today,policy]);
 const needle=search.trim().toLowerCase();
 const shown=groups.filter(g=>(!site||g.site===site)&&(!department||g.department===department)&&(!needle||[g.name,g.code,g.designation,g.department].some(v=>v?.toLowerCase().includes(needle))));
 return <RosterTable groups={shown} dates={dates} view="compare" trip={tripState} monthly={monthly} from={from} to={to} loading={loading} error={error}/>;
}

type Source<T>={key:string;status:'idle'|'loading'|'ready'|'error';message:string;data:T|null};
/** The Trip card tab's reading, day by day: each day's state, rows and MIS error, and the site names MIS returned. */
type TripStream={key:string;days:Record<string,DayState>;rows:Record<string,AttendanceRow[]>;errors:Record<string,string>;sites:string[];runs:number;
 /** saved: days opened from (or written to) the saved copy; fresh: days read from MIS and not saved yet. */
 saved:Record<string,SavedInfo>;fresh:string[];save:{running:boolean;done:number;total:number;failed:string[];error:string}|null};
const noStream:TripStream={key:'',days:{},rows:{},errors:{},sites:[],runs:0,saved:{},fresh:[],save:null};
export function applyDay(stream:TripStream,u:DayUpdate):TripStream{
 const days={...stream.days,[u.day]:u.state},errors={...stream.errors},rows=u.state==='done'?{...stream.rows,[u.day]:u.rows||[]}:stream.rows;
 if(u.state==='failed')errors[u.day]=u.error||'MIS did not answer';else if(u.state==='done')delete errors[u.day];
 const done=u.state==='done',saved=done?Object.fromEntries(Object.entries(stream.saved).filter(([d])=>d!==u.day)):stream.saved;
 return {...stream,days,rows,errors,saved,fresh:done&&!stream.fresh.includes(u.day)?[...stream.fresh,u.day]:stream.fresh,
  sites:u.sites?[...new Set([...stream.sites,...u.sites])].sort():stream.sites};
}
const idle={key:'',status:'idle' as const,message:'',data:null};

/** Attendance roster page: site, dates, department and employee first; then the Trip card, Biometric or comparison tab. */
export function AttendanceRosterPage({grant}:{grant:string}){
 const today=india();
 const [sites,setSites]=useState<string[]|null>(null),[departments,setDepartments]=useState<string[]>([]),[lookupError,setLookupError]=useState('');
 const [site,setSite]=useState(''),[from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today);
 const [department,setDepartment]=useState(''),[employee,setEmployee]=useState('');
 const [view,setView]=useState<RosterView|''>('');
 const [trip,setTrip]=useState<TripStream>(noStream),[bio,setBio]=useState<Source<Register>>(idle);
 const keyRef=useRef(''),forceMis=useRef(false);
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
  setTrip({...noStream,key});
  const runKey=key,all=tripDays(from,to);
  keyRef.current=runKey;
  // "Fetch again" reads every day from MIS; otherwise the saved days open at once and MIS is read for the rest.
  if(forceMis.current){forceMis.current=false;readTrip(all);return;}
  setTrip(t=>t.key===runKey?{...t,runs:t.runs+1}:t);
  readSavedTripCards(grant,site,from,to).then(saved=>{
   if(keyRef.current!==runKey)return;
   const have=saved.filter(d=>all.includes(d.day));
   setTrip(t=>t.key!==runKey?t:{...t,days:{...t.days,...Object.fromEntries(have.map(d=>[d.day,'done' as DayState]))},rows:{...t.rows,...Object.fromEntries(have.map(d=>[d.day,d.rows]))},
    saved:{...t.saved,...Object.fromEntries(have.map(d=>[d.day,{savedBy:d.savedBy,savedAt:d.savedAt}]))}});
   const missing=all.filter(d=>!have.some(x=>x.day===d));
   if(missing.length)readTrip(missing);
  }).catch(()=>{if(keyRef.current===runKey)readTrip(all);})
   .finally(()=>setTrip(t=>t.key===runKey?{...t,runs:t.runs-1}:t));
 },[wantTrip,key]); // eslint-disable-line react-hooks/exhaustive-deps
 // Switching to another tab keeps the reading going; a new site or dates stops it.
 // (Compared with the reading's own key: comparing trip.key here stopped a new reading in the render that started it.)
 useEffect(()=>{if(keyRef.current&&keyRef.current!==key)keyRef.current='';},[key]);
 /** Reads these days from MIS and fills the muster as each day arrives (also "Retry these days"). */
 function readTrip(list:string[]){
  const runKey=key;keyRef.current=runKey;
  setTrip(t=>t.key===runKey?{...t,runs:t.runs+1}:t);
  void streamTripCards(grant,list,site,u=>setTrip(t=>t.key===runKey?applyDay(t,u):t),()=>keyRef.current===runKey)
   .finally(()=>setTrip(t=>t.key===runKey?{...t,runs:t.runs-1}:t));
 }
 /** Save trip cards: every day read from MIS and not saved yet, one day per request. */
 function saveTrip(){
  const runKey=key,list=trip.fresh.filter(d=>trip.days[d]==='done').sort().map(day=>({day,rows:trip.rows[day]||[]}));
  if(!list.length)return;
  setTrip(t=>({...t,save:{running:true,done:0,total:list.length,failed:[],error:''}}));
  void saveTripCards(grant,site,list,(day,info,error)=>setTrip(t=>{
   if(t.key!==runKey||!t.save)return t;
   const save={...t.save,done:t.save.done+1,failed:info?t.save.failed:[...t.save.failed,day],error:t.save.error||error||''};
   return info?{...t,save,saved:{...t.saved,[day]:info},fresh:t.fresh.filter(d=>d!==day)}:{...t,save};
  })).finally(()=>setTrip(t=>t.key===runKey&&t.save?{...t,save:{...t.save,running:false}}:t));
 }
 useEffect(()=>{
  if(!wantBio||bio.key===key)return;
  let live=true;
  setBio({key,status:'loading',message:'',data:null});
  fetchBiometric(grant,from,to,site).then(data=>{if(live)setBio({key,status:'ready',message:'',data});}).catch(e=>{if(live)setBio({key,status:'error',message:(e as Error).message,data:null});});
  return()=>{live=false;};
 },[wantBio,key]); // eslint-disable-line react-hooks/exhaustive-deps
 const dates=useMemo(()=>ready?datesBetween(from,to):[],[ready,from,to]);
 const tripList=useMemo(()=>trip.key===key?Object.values(trip.rows).flat():[],[trip.key,trip.rows,key]);
 const tripRead=useMemo(()=>new Set(trip.key===key?Object.keys(trip.rows):[]),[trip.key,trip.rows,key]);
 const tripRows=trip.key===key&&tripRead.size?tripList:null,bioData=bio.key===key&&bio.status==='ready'?bio.data:null;
 const policy=bioData?.policy||DEFAULT_POLICY;
 const groups=useMemo(()=>buildRoster(bioData?.rows||[],view==='bio'?null:tripRows,dates,today,policy,tripRead).map(g=>({...g,site:g.site||site})),[bioData,tripRows,dates,today,policy,view,site,tripRead]);
 const people=groups.filter(g=>view?viewGroups([g],view).length>0:false);
 const shown=people.filter(g=>(!department||g.department===department)&&(!employee||g.key===employee));
 const dayList=trip.key===key?Object.entries(trip.days):[],total=dayList.length,finished=dayList.filter(([,st])=>st==='done'||st==='failed').length;
 const failedDays=dayList.filter(([,st])=>st==='failed').map(([d])=>d).sort(),retrying=dayList.filter(([,st])=>st==='retrying').length;
 const running=wantTrip&&(trip.key!==key||trip.runs>0);
 const tripState:TripState={status:running?'loading':total&&failedDays.length===total?'error':trip.key===key?'ready':'idle',
  message:`Reading trip cards from MIS · ${finished} of ${total||'…'} days${retrying?` · ${retrying} retrying`:''}${failedDays.length?` · ${failedDays.length} not read`:''}`,
  rows:tripRows,failed:failedDays,misSites:trip.key===key?trip.sites:[],days:trip.key===key?trip.days:undefined,errors:trip.key===key?trip.errors:undefined,
  onRetry:list=>readTrip(list)};
 const savedDays=trip.key===key?Object.entries(trip.saved):[],freshDone=trip.key===key?trip.fresh.filter(d=>trip.days[d]==='done'):[],save=trip.key===key?trip.save:null;
 const latest=savedDays.map(([,info])=>info).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)))[0];
 const when=(at:string)=>{const t=Date.parse(at);return Number.isFinite(t)?new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):at;};
 tripState.onSave=saveTrip;
 tripState.saved=trip.key===key?trip.saved:undefined;
 tripState.canSave=!running&&!save?.running&&freshDone.length>0;
 tripState.saveLabel=save?.running?`Saving ${save.done} of ${save.total} days…`:freshDone.length?`Save trip cards (${freshDone.length} day${freshDone.length===1?'':'s'})`:savedDays.length?'Saved':'Save trip cards';
 tripState.savedNote=savedDays.length?`Saved copy: ${savedDays.length} of ${total} days (last saved ${latest?when(latest.savedAt):''}${latest?.savedBy?' by '+latest.savedBy:''}).`+
  (freshDone.length?` ${freshDone.length} day${freshDone.length===1?'':'s'} read from MIS ${freshDone.length===1?'is':'are'} not saved yet.`:' Press Fetch again for the latest from MIS.'):'';
 tripState.saveError=save&&!save.running&&save.failed.length?`Could not save ${save.failed.map(show).join(', ')}: ${save.error}`:'';
 if(tripState.status==='error')tripState.message=trip.errors[failedDays[0]]||'The MIS attendance feed is temporarily unavailable.';
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
   <button type="button" disabled={!ready||!view||busy} onClick={()=>{forceMis.current=view!=='bio';setReload(n=>n+1);}}><RefreshCw className={busy?'spin':''}/>Fetch again</button>
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
