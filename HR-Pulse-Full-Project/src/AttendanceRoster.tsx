import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,Download,Printer,RefreshCw,Save} from 'lucide-react';
import {api,type Lookup} from './api';
import type {AttendanceRow} from './misAttendanceModel';
import {buildRoster,cardSummary,codeLabel,lineTotals,type LineTotals,type RosterGroup} from './rosterModel';
import {FIRST_TRIP_DATE,streamBiometric,joinBiometricDays,type BioDayUpdate,fetchFromMachines,type SiteRegister,type SiteMachine,fetchTripCards,readSavedTripCards,saveTripCards,readSavedBiometric,saveBiometricDays,streamTripCards,tripDays,type DayState,type DayUpdate,type SavedInfo} from './rosterData';
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

/** "06:05 (+1)" → "06:05 +1"; no Out → "—". */
const NEWLINE=String.fromCharCode(10);
export const outText=(out?:string)=>out?out.replace(' (+1)',' +1'):'—';
/** The month's worked hours (lunch already taken off by the HR policy), as h:mm. */
export const workedHours=(g:RosterGroup)=>{const m=(g.bio?.days||[]).reduce((s,d)=>s+(d.workedMinutes||0),0);return m?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`:'—';};
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
/** The Biometric tab's day-by-day reading (owner, 22 Nov 2026): each day's state, punches read and error. */
export type BioState={running:boolean;message:string;days:Record<string,DayState>;counts:Record<string,number>;errors:Record<string,string>;failed:string[];onRetry?:(days:string[])=>void;
 /** Save biometric (owner, 23 Nov 2026): the button's text, whether it can be pressed, and the note on what is saved. */
 onSave?:()=>void;saveLabel?:string;canSave?:boolean;savedNote?:string;saveError?:string;saved?:Record<string,SavedInfo>};
const BIO_DAY_STATE:Record<DayState,string>={queued:'Waiting to be read',loading:'Reading punches…',retrying:'Busy · trying again…',done:'Read',failed:'Could not be read'};
type TableProps={groups:RosterGroup[];dates:string[];view:RosterView;trip:TripState;bio?:BioState;monthly:boolean;from:string;to:string;loading?:boolean;error?:string;emptyText?:string};

/** The roster table, its toolbar, the difference drill-down and Export Excel. */
export function RosterTable({groups,dates,view,trip,bio,monthly,from,to,loading=false,error='',emptyText}:TableProps){
 const [onlyDiff,setOnlyDiff]=useState(false),[open,setOpen]=useState(''),[exporting,setExporting]=useState(false),[exportOpen,setExportOpen]=useState(false),[times,setTimes]=useState(true);
 const drill=useRef<HTMLDivElement>(null);
 const rosterTable=useRef<HTMLTableElement>(null);
 const compare=view==='compare',tripsLoaded=trip.rows!==null,tripRunning=trip.status==='loading';
 const shown=viewGroups(groups,view).filter(g=>!compare||!onlyDiff||g.mismatches.length>0);
 const openGroup=compare?shown.find(g=>g.key===open):undefined;
 const openKey=openGroup?.key||'';
 useEffect(()=>{if(openKey)drill.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[openKey]);
 const diffCount=shown.filter(g=>g.mismatches.length).length;
 const lines=(['trip','bio'] as const).filter(line=>compare||view===line);
 // Biometric by site: the machine and ID column, In / Out under each day's code, and the month's worked hours.
 const machineCol=view!=='trip'&&shown.some(g=>g.machines.length>0),showTimes=times&&view!=='trip',hoursCol=view!=='trip';
 const span=dates.length+ROSTER_TOTALS.length+(monthly?1:0)+(view==='trip'?1:0)+(hoursCol?1:0);

 async function exportExcel(){
  setExporting(true);
  try{const {downloadRosterExcel}=await import('./attendanceRosterExcel');await downloadRosterExcel({groups:shown,dates,tripsLoaded,monthly,from,to,view});setExportOpen(false);}
  finally{setExporting(false);}
 }
 function printRoster(){
  const table=rosterTable.current;if(!table)return;
  const popup=window.open('','_blank');if(!popup){window.alert('The print window was blocked. Allow pop-ups for this site, then try Print/Export again.');return;}
  const title=`Attendance roster · ${show(from)} to ${show(to)} · ${VIEW_TABS.find(([key])=>key===view)?.[1]||''}`;
  popup.document.open();popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
   @page{size:A3 landscape;margin:8mm}body{font:10px Arial;color:#18122b}button{padding:8px 14px;margin-bottom:10px}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;color:#665b76}table{border-collapse:collapse;width:100%;font-size:8px}th,td{border:1px solid #cfc5db;padding:3px;text-align:center;vertical-align:middle;white-space:nowrap}th{background:#f2eaf8}td:nth-child(-n+6),th:nth-child(-n+6){text-align:left}.register-sub,small{display:block;font-size:7px}.register-cell{display:inline-block;min-width:18px;padding:2px;border-radius:4px}.code-P{background:#eaf3de}.code-HD{background:#fff0d5}.code-A{background:#fde5e3}.code-WO{background:#eeece5}.code-H{background:#ebe8ff}.code-L{background:#fde8ef}.code-OD{background:#e6f1ff}.code-MP{background:#ffe8dc}.roster-day-mark,.roster-diff-open{display:none}@media print{button{display:none}thead{display:table-header-group}tr{break-inside:avoid}}
  </style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>${title}</h1><p>${shown.length} employee${shown.length===1?'':'s'} · generated ${new Date().toLocaleString('en-IN')}</p>${table.outerHTML}</body></html>`);
  popup.document.close();popup.focus();setExportOpen(false);
 }
 const cells=(codes:Record<string,string>,group:RosterGroup,isTrip:boolean)=>dates.map(date=>{
  const code=codes[date]||'',bio=group.bio?.days.find(d=>d.date===date),tripDay=group.tripDays[date];
  const miss=compare&&group.mismatches.some(m=>m.date===date);
  const title=show(date)+' · '+(isTrip?(tripDay?tripDay.duties.map(d=>[d.cards.join('/'),d.shift,d.equipment,d.time,d.output].filter(Boolean).join(' · ')).join(' | '):codeLabel(code)):
   (bio?`${codeLabel(code)}${bio.in?` · ${bio.in}–${bio.out||'?'}`:''}${bio.note?' · '+bio.note:''}`:codeLabel(code)));
  const punches=!isTrip&&bio?.punches?.length?NEWLINE+bio.punches.join(NEWLINE):'';
  if(!isTrip&&showTimes)return <td key={date} className={'roster-day'+(miss?' roster-miss':'')}><span className={'register-cell roster-code roster-times '+codeClass(code)} title={title+punches}><b>{code}</b>
   <small className={bio?.late?'roster-late':undefined}>{bio?.in||'—'}</small><small className={bio?.early?'roster-early':undefined}>{outText(bio?.out)}</small></span></td>;
  return <td key={date} className={'roster-day'+(miss?' roster-miss':'')}><span className={'register-cell roster-code '+codeClass(code)} title={title+punches}>{code}{!isTrip&&(bio?.late||bio?.early)&&<sup>{bio.late?'L':''}{bio.early?'E':''}</sup>}</span></td>;
 });
 const totals=(t:LineTotals)=>ROSTER_TOTALS.map(([key])=><td key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{key==='paidDays'||key==='totalDays'?<strong>{t[key]}</strong>:t[key]}</td>);
 const lineCells=(g:RosterGroup,line:'trip'|'bio')=>line==='trip'
  ?(tripsLoaded&&g.hasTripCards?<>{cells(g.tripCodes,g,true)}{totals(tripTotals(g,dates))}{monthly&&<td className="roster-total">—</td>}{hoursCol&&<td className="roster-total">—</td>}{view==='trip'&&<td className="roster-text roster-cards">{cardSummary(g,dates)||'—'}</td>}</>:
   <td colSpan={span} className="roster-nolink">{tripRunning?'No trip card in the days read so far':trip.status==='error'?'Trip cards unavailable':'No trip card or log book in these dates'}</td>)
  :(g.bio?<>{cells(g.bioCodes,g,false)}{totals(bioTotals(g,dates))}{monthly&&<td className="roster-total">{g.linked?money(g.bio.summary.gatePassDeduction):'—'}</td>}{hoursCol&&<td className="roster-total">{workedHours(g)}</td>}</>:
   <td colSpan={span} className="roster-nolink">Biometric ID not linked in Biometric integration</td>);
 const bioRunning=view!=='trip'&&Boolean(bio?.running);
 const status=view==='bio'&&bioRunning?bio!.message+` · ${shown.length} employee${shown.length===1?'':'s'} so far`:view==='bio'&&bio?.message?`${shown.length} employee${shown.length===1?'':'s'} · ${bio.message}`:view!=='bio'&&tripRunning?(trip.message||'Reading trip cards…')+(tripsLoaded?` · ${shown.length} employee${shown.length===1?'':'s'} so far`:''):view!=='bio'&&trip.status==='error'?`Trip cards unavailable: ${trip.message}`:
  loading?'Reading biometric punches…':`${shown.length} employee${shown.length===1?'':'s'}`+(compare?` · ${diffCount} with a difference`:'');
 const empty=<tr><td colSpan={60} className="attendance-empty">{bioRunning&&view==='bio'?'Reading punches… the muster fills in as each day arrives.':loading||(tripRunning&&view!=='bio')?'Loading attendance… the muster fills in as each day arrives from MIS.':error?'Attendance is unavailable.':onlyDiff&&compare?'No employee has a difference between trip card and biometric.':emptyText||'No attendance for this selection.'}</td></tr>;

 return <>
  <div className="roster-legend" aria-label="Day codes">{ROSTER_CODES.filter(([code])=>view!=='bio'||code!=='?').map(([code,label])=><span key={code}><b className={'register-cell '+codeClass(code)}>{code}</b> {label}</span>)}{view!=='trip'&&<span><sup className="roster-sup">L</sup> late come · <sup className="roster-sup">E</sup> early going</span>}{compare&&<span><i className="roster-miss-key"/> day where trip card and biometric differ</span>}</div>
  {view!=='trip'&&bio&&!bio.running&&bio.failed.length>0&&<div className="roster-warn" role="alert">Biometric punches could not be read for {bio.failed.map(show).join(', ')}, even after trying each day again ({[...new Set(bio.failed.map(d=>bio.errors[d]).filter(Boolean))].join('; ')}). Those days are blank.
   {bio.onRetry&&<button type="button" className="roster-retry" onClick={()=>bio.onRetry!(bio.failed)}><RefreshCw/>Retry these days</button>}</div>}
  {view!=='bio'&&trip.status==='ready'&&(trip.failed?.length||0)>0&&<div className="roster-warn" role="alert">Trip cards could not be read from MIS for {trip.failed!.map(show).join(', ')}, even after trying each day again{trip.errors?` (MIS: ${[...new Set(trip.failed!.map(d=>trip.errors![d]).filter(Boolean))].join('; ')})`:''}. Those days are blank.
   {trip.onRetry&&<button type="button" className="roster-retry" onClick={()=>trip.onRetry!(trip.failed!)}><RefreshCw/>Retry these days</button>}</div>}
  {view!=='bio'&&trip.status==='ready'&&!(trip.rows||[]).length&&(trip.misSites?.length||0)>0&&<p className="roster-warn" role="alert">MIS has trip cards in these dates for {trip.misSites!.join(', ')}, but none for this site. If one of them is this site, its name is written differently in HR and MIS.</p>}
  {view!=='bio'&&trip.savedNote&&<p className="roster-saved" role="status">{trip.savedNote}</p>}
  {view!=='bio'&&trip.saveError&&<p className="roster-warn" role="alert">{trip.saveError}</p>}
  {view==='bio'&&bio?.savedNote&&<p className="roster-saved" role="status">{bio.savedNote}</p>}
  {view==='bio'&&bio?.saveError&&<p className="roster-warn" role="alert">{bio.saveError}</p>}
  <div className="roster-bar">
   {compare&&<label className="roster-check"><input type="checkbox" checked={onlyDiff} onChange={e=>setOnlyDiff(e.target.checked)}/>Only employees with a difference</label>}
   <span role="status">{status}</span>
   {view!=='trip'&&<span className="roster-seg" role="group" aria-label="Day boxes"><button type="button" aria-pressed={!times} onClick={()=>setTimes(false)}>Codes only</button><button type="button" aria-pressed={times} onClick={()=>setTimes(true)}>Codes + In / Out</button></span>}
   {view!=='bio'&&trip.onSave&&<button type="button" className="roster-save" disabled={!trip.canSave} onClick={trip.onSave}><Save/>{trip.saveLabel||'Save trip cards'}</button>}
   {view==='bio'&&bio?.onSave&&<button type="button" className="roster-save" disabled={!bio.canSave} onClick={bio.onSave}><Save/>{bio.saveLabel||'Save biometric'}</button>}
   <div className="roster-export">
    <button type="button" aria-haspopup="menu" aria-expanded={exportOpen} disabled={!shown.length||exporting} onClick={()=>setExportOpen(value=>!value)}><Download/>{exporting?'Preparing…':'Print/Export'}<ChevronDown/></button>
    {exportOpen&&<div className="roster-export-menu" role="menu">
     <button type="button" role="menuitem" onClick={printRoster}><Download/>Download as PDF</button>
     <button type="button" role="menuitem" onClick={printRoster}><Printer/>Smart Print</button>
     <button type="button" role="menuitem" onClick={()=>void exportExcel()}><Download/>Download as Excel</button>
    </div>}
   </div>
  </div>
  <div className="attendance-table"><table ref={rosterTable} className={'register-grid roster-grid'+(compare?'':' roster-nosrc')} aria-label="Attendance roster">
   <thead><tr>{compare&&<th className="roster-fixed roster-src">Source</th>}<th className={'roster-fixed roster-sr'+(compare?'':' roster-first')}>Sr. No.</th><th className="roster-fixed roster-id">Employee ID</th><th className="roster-fixed roster-name">Name</th><th className="roster-text">Site</th><th className="roster-text">Department</th><th className="roster-text">Designation</th>{machineCol&&<th className="roster-text roster-machine">Machine · ID</th>}
    {dates.map(d=>{const onBio=view==='bio',state=onBio?bio?.days[d]:trip.days?.[d],label=state?(onBio?BIO_DAY_STATE:DAY_STATE)[state]:'',why=onBio?bio?.errors[d]:trip.errors?.[d];
     return <th key={d} title={show(d)+(state==='done'&&(onBio?bio?.saved:trip.saved)?.[d]?' · Saved copy':'')+(state?' · '+label+(onBio&&state==='done'?` · ${(bio?.counts[d]||0).toLocaleString('en-IN')} punches`:'')+(state==='failed'&&why?': '+why:''):'')} className={[weekday(d)==='Su'?'roster-sunday':'',state&&state!=='done'?'roster-day-'+state:''].filter(Boolean).join(' ')||undefined}>{Number(d.slice(8))}<small className="register-sub">{weekday(d)}</small>{state&&state!=='done'&&<i className="roster-day-mark" aria-label={label}/>}</th>;})}
    {ROSTER_TOTALS.map(([key,label])=><th key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{label}</th>)}{monthly&&<th className="roster-total">Gate pass</th>}{hoursCol&&<th className="roster-total">Worked hours</th>}
    {view==='trip'&&<th className="roster-text roster-cards">Cards (days)</th>}{compare&&<th className="roster-diff">{DIFF_HEADING}</th>}</tr></thead>
   <tbody>{shown.length?shown.map((g,i)=>{const picked=g.key===open,diff=diffText(g,tripsLoaded),rows=lines.length;return <Fragment key={g.key}>
    {lines.map((line,j)=><tr key={line} className={(line==='trip'?'roster-trip':'roster-bio')+(rows===1?' roster-single':'')+(picked?' roster-picked':'')+(g.linked?'':' roster-unlinked')}>
     {compare&&<th scope="row" className="roster-fixed roster-src">{line==='trip'?'Trip Card':'Bio Matric'}</th>}
     {j===0&&<><td rowSpan={rows} className={'roster-fixed roster-sr'+(compare?'':' roster-first')}>{i+1}</td><td rowSpan={rows} className={'roster-fixed roster-id'+(g.linked?'':' roster-unlinked-id')}>{g.linked?g.code:'Not linked'}</td>
      <td rowSpan={rows} className="roster-fixed roster-name"><strong>{g.name}</strong>{(g.shift||g.exempt)&&<small className="register-sub">{[g.shift,g.exempt?'Exempt':''].filter(Boolean).join(' · ')}</small>}</td>
      <td rowSpan={rows} className="roster-text">{g.site||'—'}</td><td rowSpan={rows} className="roster-text">{g.department||'—'}</td><td rowSpan={rows} className="roster-text">{g.designation||'—'}</td>{machineCol&&<td rowSpan={rows} className="roster-text roster-machine">{g.machines.length?g.machines.map(m=><span key={m}>{m}</span>):'—'}</td>}</>}
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
  <p className="help-text">{view==='bio'?'Biometric: every punch on this site’s machines (Biometric machines), rated with the attendance policy: In is the first punch of the shift, Out the last; +1 is the next morning. Orange In is late come, red Out is early going. Hover a day for every punch and its machine. Machine IDs not linked to an employee show the name on the machine; link them in Machine punches. ':'Trip card: MIS VLB trip cards, ELB job cards and LMV vehicle log books, rated with the attendance policy hours rule (? until the MIS batch is closed). '}
   {compare?'Bio Matric: every punch on this site’s machines (Biometric machines). ':''}Weekly off, holiday, leave, comp off and OD come from HR records{compare?' and show on both lines':''}. Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty.</p>
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

/** The chosen site's machines (Biometric machines › site): status, last punch, punches in these dates, and the bridge fetch. */
function MachinesPanel({site,machines,pull,onPull,onManage}:{site:string;machines:SiteMachine[];pull:{running:boolean;message:string;error:string}|null;onPull:()=>void;onManage?:()=>void}){
 const stamp=(at:string)=>at?at.slice(8,10)+'-'+at.slice(5,7)+' '+at.slice(11,16):'—';
 if(!machines.length)return <div className="roster-machines roster-machines-empty" role="status"><b>No biometric machine is added for {site} yet.</b> Add the site’s machines with their serial numbers in Biometric machines; the roster then reads every punch from them.
  {onManage&&<button type="button" className="roster-save" onClick={onManage}>Add machine</button>}</div>;
 const online=machines.filter(m=>m.online).length;
 return <div className="roster-machines" aria-label={`${site} biometric machines`}>
  <div className="roster-machines-head"><h3>{site} · {machines.length} biometric machine{machines.length===1?'':'s'}</h3><span>{online} online · {machines.length-online} not online</span><span className="roster-grow"/>
   <button type="button" className="roster-save" disabled={pull?.running} onClick={onPull}><RefreshCw className={pull?.running?'spin':''}/>{pull?.running?'Fetching…':'Fetch from these machines'}</button>
   {onManage&&<button type="button" onClick={onManage}>Manage machines</button>}</div>
  {pull&&(pull.message||pull.error)&&<p className={pull.error?'roster-warn':'roster-saved'} role="status">{pull.message}{pull.error?' '+pull.error:''}</p>}
  <div className="attendance-table"><table aria-label="Site machines"><thead><tr>{['Machine location','Machine name','Serial no.','IP address','Bridge PC','Status','Last punch','Punches in these dates'].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{machines.map(m=><tr key={m.serial}><td>{m.location||'—'}</td><td>{m.name||'—'}</td><td><code>{m.serial}</code></td><td><code>{m.ipAddress||'—'}</code></td><td>{m.bridgeName||'No bridge PC yet'}</td>
    <td><span className={m.online?'roster-online':'roster-offline'}>{m.online?'Online':'Not online'}</span></td><td>{stamp(m.lastPunch)}</td><td>{m.punches.toLocaleString('en-IN')}</td></tr>)}</tbody></table></div>
 </div>;
}
/** The Biometric tab's reading, day by day: each day's state, result (one day of the site register) and error. */
type BioStream={key:string;days:Record<string,DayState>;results:Record<string,SiteRegister>;errors:Record<string,string>;runs:number;
 /** saved: days opened from (or written to) the saved copy; fresh: days read from the punches and not saved yet. */
 saved?:Record<string,SavedInfo>;fresh?:string[];save?:{running:boolean;done:number;total:number;failed:string[];error:string}|null};
const noBio:BioStream={key:'',days:{},results:{},errors:{},runs:0,saved:{},fresh:[],save:null};
export function applyBioDay(stream:BioStream,u:BioDayUpdate):BioStream{
 const errors={...stream.errors};if(u.state==='failed')errors[u.day]=u.error||'HR did not answer';else if(u.state==='done')delete errors[u.day];
 const done=u.state==='done'&&Boolean(u.result),fresh=stream.fresh||[],saved=stream.saved||{};
 return {...stream,days:{...stream.days,[u.day]:u.state},errors,results:done?{...stream.results,[u.day]:u.result!}:stream.results,
  saved:done?Object.fromEntries(Object.entries(saved).filter(([d])=>d!==u.day)):saved,fresh:done&&!fresh.includes(u.day)?[...fresh,u.day]:fresh};
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
export function AttendanceRosterPage({grant,onManageMachines}:{grant:string;onManageMachines?:()=>void}){
 const today=india();
 const [sites,setSites]=useState<string[]|null>(null),[departments,setDepartments]=useState<string[]>([]),[lookupError,setLookupError]=useState('');
 const [site,setSite]=useState(''),[from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today);
 const [department,setDepartment]=useState(''),[employee,setEmployee]=useState('');
 const [view,setView]=useState<RosterView|''>('');
 const [trip,setTrip]=useState<TripStream>(noStream),[bio,setBio]=useState<BioStream>(noBio);
 const bioRef=useRef('');
 const [pull,setPull]=useState<{running:boolean;message:string;error:string}|null>(null),[bioReload,setBioReload]=useState(0);
 const keyRef=useRef(''),forceMis=useRef(false),forceBio=useRef(false);
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
  if(forceMis.current){forceMis.current=false;readTrip(all,true);return;}
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
 function readTrip(list:string[],refresh=false){
  const runKey=key;keyRef.current=runKey;
  setTrip(t=>t.key===runKey?{...t,runs:t.runs+1}:t);
  void streamTripCards(grant,list,site,u=>setTrip(t=>t.key===runKey?applyDay(t,u):t),()=>keyRef.current===runKey,refresh)
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
 const bioKey=key+'|'+bioReload;
 // Biometric, day by day like the trip cards: the muster fills in as each day of the site's machines arrives.
 useEffect(()=>{
  if(!wantBio||bio.key===bioKey)return;
  setBio({...noBio,key:bioKey});
  const runKey=bioKey,all=datesBetween(from,to);
  bioRef.current=runKey;
  // "Fetch again" and "Fetch from these machines" read every day's punches; otherwise the saved days open at once and
  // the punches are read for the rest (today is always read: its punches are still coming in).
  if(forceBio.current){forceBio.current=false;readBio(all);return;}
  setBio(b=>b.key===runKey?{...b,runs:b.runs+1}:b);
  readSavedBiometric(grant,site,from,to).then(saved=>{
   if(bioRef.current!==runKey)return;
   const have=saved.filter(d=>all.includes(d.day)&&d.day<today);
   setBio(b=>b.key!==runKey?b:{...b,days:{...b.days,...Object.fromEntries(have.map(d=>[d.day,'done' as DayState]))},results:{...b.results,...Object.fromEntries(have.map(d=>[d.day,d.register]))},
    saved:{...b.saved,...Object.fromEntries(have.map(d=>[d.day,{savedBy:d.savedBy,savedAt:d.savedAt}]))}});
   const missing=all.filter(d=>!have.some(x=>x.day===d));
   if(missing.length)readBio(missing);
  }).catch(()=>{if(bioRef.current===runKey)readBio(all);})
   .finally(()=>setBio(b=>b.key===runKey?{...b,runs:b.runs-1}:b));
 },[wantBio,bioKey]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(bioRef.current&&bioRef.current!==bioKey)bioRef.current='';},[bioKey]);
 function readBio(list:string[]){
  const runKey=bioKey;bioRef.current=runKey;
  setBio(b=>b.key===runKey?{...b,runs:b.runs+1}:b);
  void streamBiometric(grant,list,site,u=>setBio(b=>b.key===runKey?applyBioDay(b,u):b),()=>bioRef.current===runKey)
   .finally(()=>setBio(b=>b.key===runKey?{...b,runs:b.runs-1}:b));
 }
 /** Save biometric: every finished day read from the punches and not saved yet (not today), one day per request. */
 function saveBio(){
  const runKey=bioKey,list=(bio.fresh||[]).filter(d=>bio.days[d]==='done'&&d<today).sort();
  if(!list.length)return;
  setBio(b=>({...b,save:{running:true,done:0,total:list.length,failed:[],error:''}}));
  void saveBiometricDays(grant,site,list,(day,info,error)=>setBio(b=>{
   if(b.key!==runKey||!b.save)return b;
   const save={...b.save,done:b.save.done+1,failed:info?b.save.failed:[...b.save.failed,day],error:b.save.error||error||''};
   return info?{...b,save,saved:{...b.saved,[day]:{savedBy:info.savedBy,savedAt:info.savedAt}},fresh:(b.fresh||[]).filter(d=>d!==day)}:{...b,save};
  })).finally(()=>setBio(b=>b.key===runKey&&b.save?{...b,save:{...b.save,running:false}}:b));
 }
 /** Fetch from these machines: the bridge PC reads each machine of the site in turn, then the roster is read again. */
 async function pullMachines(machines:SiteMachine[]){
  // Only machines that report to a bridge PC can be read; the others wait until the site's bridge PC is added and running.
  const reachable=machines.filter(m=>m.bridgeName),waiting=machines.filter(m=>!m.bridgeName);
  const noBridge=waiting.length?`${waiting.map(m=>m.location&&m.location!==m.name?`${m.location} · ${m.name||m.serial}`:m.name||m.serial).join(', ')}: no bridge PC yet. Add a bridge PC for ${site} in Biometric machines › Bridge PCs and run it on a PC at the site.`:'';
  if(!reachable.length){setPull({running:false,message:'',error:noBridge});return;}
  setPull({running:true,message:`Asking the bridge PC to read ${reachable.length} machine${reachable.length===1?'':'s'}…`,error:''});
  let added=0;const errors:string[]=noBridge?[noBridge]:[];
  await fetchFromMachines(grant,reachable.map(m=>m.serial),(serial,request,error)=>{
   const label=reachable.find(m=>m.serial===serial)?.name||reachable.find(m=>m.serial===serial)?.location||serial;
   if(error)errors.push(`${label}: ${error}`);
   else if(request?.state==='FAILED')errors.push(`${label}: ${request.error||'the machine did not answer'}`);
   else if(request?.state==='DONE')added+=Number(request.newPunches)||0;
   setPull(p=>p&&{...p,message:`Reading ${label}…`});
  });
  setPull({running:false,message:`${added} new punch${added===1?'':'es'} received.`,error:[...new Set(errors)].join(' · ')});
  forceBio.current=true;setBioReload(n=>n+1);
 } // eslint-disable-line react-hooks/exhaustive-deps
 const dates=useMemo(()=>ready?datesBetween(from,to):[],[ready,from,to]);
 const tripList=useMemo(()=>trip.key===key?Object.values(trip.rows).flat():[],[trip.key,trip.rows,key]);
 const tripRead=useMemo(()=>new Set(trip.key===key?Object.keys(trip.rows):[]),[trip.key,trip.rows,key]);
 const bioResults=useMemo(()=>bio.key===bioKey?Object.values(bio.results):[],[bio.key,bio.results,bioKey]);
 const bioRead=useMemo(()=>new Set(bio.key===bioKey?Object.keys(bio.results):[]),[bio.key,bio.results,bioKey]);
 const bioData=useMemo(()=>joinBiometricDays(bioResults,bioResults[0]?.policy?.lateEarlyPerHalfCut),[bioResults]);
 const tripRows=trip.key===key&&tripRead.size?tripList:null;
 const policy=bioData?.policy||DEFAULT_POLICY;
 const groups=useMemo(()=>buildRoster(bioData?.rows||[],view==='bio'?null:tripRows,dates,today,policy,tripRead,bioRead).map(g=>({...g,site:g.site||site})),[bioData,tripRows,dates,today,policy,view,site,tripRead,bioRead]);
 const people=groups.filter(g=>view?viewGroups([g],view).length>0:false);
 const shown=people.filter(g=>(!department||g.department===department)&&(!employee||g.key===employee));
 const dayList=trip.key===key?Object.entries(trip.days):[],total=dayList.length,finished=dayList.filter(([,st])=>st==='done'||st==='failed').length;
 const failedDays=dayList.filter(([,st])=>st==='failed').map(([d])=>d).sort(),retrying=dayList.filter(([,st])=>st==='retrying').length;
 const running=wantTrip&&(trip.key!==key||trip.runs>0);
 const tripState:TripState={status:running?'loading':total&&failedDays.length===total?'error':trip.key===key?'ready':'idle',
  message:`Reading trip cards from MIS · ${finished} of ${total||'…'} days${retrying?` · ${retrying} retrying`:''}${failedDays.length?` · ${failedDays.length} not read`:''}`,
  rows:tripRows,failed:failedDays,misSites:trip.key===key?trip.sites:[],days:trip.key===key?trip.days:undefined,errors:trip.key===key?trip.errors:undefined,
  onRetry:list=>readTrip(list,true)};
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
 const bioDays=bio.key===bioKey?Object.entries(bio.days):[],bioTotal=bioDays.length,bioDone=bioDays.filter(([,st])=>st==='done'||st==='failed').length;
 const bioFailed=bioDays.filter(([,st])=>st==='failed').map(([d])=>d).sort(),bioNow=bioDays.filter(([,st])=>st==='loading'||st==='retrying').map(([d])=>d).sort();
 const bioCounts=Object.fromEntries(Object.entries(bio.key===bioKey?bio.results:{}).map(([d,r])=>[d,r.machines.reduce((n,m)=>n+(m.punches||0),0)]));
 const bioPunches=Object.values(bioCounts).reduce((a,b)=>a+b,0);
 const bioRunning=wantBio&&(bio.key!==bioKey||bio.runs>0);
 const bioState:BioState={running:bioRunning,days:bio.key===bioKey?bio.days:{},counts:bioCounts,errors:bio.key===bioKey?bio.errors:{},failed:bioFailed,onRetry:list=>readBio(list),
  message:bioRunning?`Reading biometric punches · ${bioDone} of ${bioTotal||'…'} days${bioNow.length?` · now ${bioNow.map(d=>show(d).slice(0,5)).join(', ')}`:''} · ${bioPunches.toLocaleString('en-IN')} punch${bioPunches===1?'':'es'} so far${bioFailed.length?` · ${bioFailed.length} not read`:''}`
   :bioTotal?`${bioDone-bioFailed.length} of ${bioTotal} days read · ${bioPunches.toLocaleString('en-IN')} punch${bioPunches===1?'':'es'}${bioFailed.length?` · ${bioFailed.length} not read`:''}`:''};
 const bioSaved=bio.key===bioKey?Object.entries(bio.saved||{}):[],bioFresh=bio.key===bioKey?(bio.fresh||[]).filter(d=>bio.days[d]==='done'&&d<today):[],bioSave=bio.key===bioKey?bio.save:null;
 const bioLatest=bioSaved.map(([,info])=>info).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)))[0];
 const pastDays=datesBetween(from,to).filter(d=>d<today).length;
 bioState.onSave=saveBio;
 bioState.saved=bio.key===bioKey?bio.saved:undefined;
 bioState.canSave=!bioRunning&&!bioSave?.running&&bioFresh.length>0;
 bioState.saveLabel=bioSave?.running?`Saving ${bioSave.done} of ${bioSave.total} days…`:bioFresh.length?`Save biometric (${bioFresh.length} day${bioFresh.length===1?'':'s'})`:bioSaved.length?'Saved':'Save biometric';
 bioState.savedNote=bioSaved.length?`Saved biometric logs: ${bioSaved.length} of ${pastDays} day${pastDays===1?'':'s'} (last saved ${bioLatest?when(bioLatest.savedAt):''}${bioLatest?.savedBy?' by '+bioLatest.savedBy:''}).`+
  (bioFresh.length?` ${bioFresh.length} day${bioFresh.length===1?'':'s'} read from the punches ${bioFresh.length===1?'is':'are'} not saved yet.`:' Today is always read live; press Fetch again to read every day from the punches.'):'';
 bioState.saveError=bioSave&&!bioSave.running&&bioSave.failed.length?`Could not save ${bioSave.failed.map(show).join(', ')}: ${bioSave.error}`:'';
 const bioLoading=view!=='trip'&&bioRunning&&!bioData;
 const bioError=!bioRunning&&bioTotal>0&&bioFailed.length===bioTotal?bio.errors[bioFailed[0]]||'HR did not answer':'';
 const unlinkedCount=(bioData?.rows||[]).filter(r=>r.linked===false).length;
 const choose=(next:RosterView)=>{setView(next);setEmployee('');};
 const busy=tripState.status==='loading'||(view!=='trip'&&bioRunning);

 return <section className="data-card attendance-register attendance-roster" aria-label="Attendance roster">
  <h2>Attendance roster</h2>
  <p className="help-text">Choose the site and dates, then press Trip card to read MIS (VLB, ELB and LMV) or Biometric to read the machine punches. Trip card vs Biometric shows both lines and the days they differ.</p>
  <div className="attendance-filters roster-filters">
   <label>Site<select value={site} required aria-invalid={!site} onChange={e=>{setSite(e.target.value);setEmployee('');}}><option value="">{sites===null?'Loading sites…':'Select a site'}</option>{(sites||[]).map(s=><option key={s}>{s}</option>)}</select></label>
   <label>From<input type="date" value={from} max={to||today} onChange={e=>setFrom(e.target.value)}/></label>
   <label>To<input type="date" value={to} min={from} max={today} onChange={e=>setTo(e.target.value)}/></label>
   <label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">All departments</option>{departments.map(d=><option key={d}>{d}</option>)}</select></label>
   <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)} disabled={!people.length}><option value="">All employees</option>{people.filter(g=>!department||g.department===department).map(g=><option key={g.key} value={g.key}>{g.linked?g.code:'Not linked'} · {g.name}</option>)}</select></label>
   <button type="button" disabled={!ready||!view||busy} onClick={()=>{forceMis.current=view!=='bio';forceBio.current=true;setReload(n=>n+1);}}><RefreshCw className={busy?'spin':''}/>Fetch again</button>
  </div>
  {lookupError&&<p className="error" role="alert">Sites could not be loaded: {lookupError}</p>}
  {sites&&!sites.length&&!lookupError&&<p className="error" role="alert">No site is assigned to your login.</p>}
  {rangeError&&<p className="error" role="alert">{rangeError}</p>}
  <div className="module-tabs roster-tabs" aria-label="Roster source">{VIEW_TABS.map(([id,label])=><button key={id} type="button" className={view===id?'selected':''} aria-pressed={view===id} disabled={!site} title={site?undefined:'Select a site first'} onClick={()=>choose(id)}>{label}</button>)}</div>
  {!site?<p className="roster-hint">Select a site first.</p>:!view?<p className="roster-hint">Press <b>Trip card</b> to fetch from MIS, or <b>Biometric</b> to fetch the machine punches, for {site} · {show(from)} to {show(to)}.</p>:
   ready&&<>{view!=='trip'&&bioError&&<p className="error" role="alert">Biometric punches unavailable: {bioError}</p>}
   {view!=='trip'&&bioData&&<MachinesPanel site={site} machines={bioData.machines} pull={pull} onPull={()=>void pullMachines(bioData.machines)} onManage={onManageMachines}/>}
   {view!=='trip'&&bioData&&unlinkedCount>0&&<p className="roster-warn" role="alert">{unlinkedCount} machine ID{unlinkedCount===1?'':'s'} punched at {site} but {unlinkedCount===1?'is':'are'} not linked to an employee yet. {unlinkedCount===1?'It is':'They are'} shown with the name on the machine; link them in Machine punches to see the employee code.</p>}
   <RosterTable key={view} groups={shown} dates={dates} view={view} trip={tripState} bio={bioState} monthly={from.slice(8)==='01'&&days>=28} from={from} to={to} loading={bioLoading} error={view!=='trip'?bioError:''}
    emptyText={view==='trip'?`No VLB, ELB or LMV card at ${site} in these dates.`:view==='bio'?(bioData&&!bioData.machines.length?`No biometric machine is added for ${site} yet.`:`No punch on ${site}’s machines in these dates.`):undefined}/></>}
 </section>;
}
