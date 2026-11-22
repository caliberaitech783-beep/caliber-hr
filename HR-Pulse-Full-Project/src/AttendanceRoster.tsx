import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {Download} from 'lucide-react';
import {api} from './api';
import {mapMisAttendance,type AttendanceRow} from './misAttendanceModel';
import {buildRoster,codeLabel,lineTotals,type LineTotals,type RosterGroup} from './rosterModel';
import type {RegisterRow} from './AttendanceRegister';
import {DEFAULT_POLICY,type AttendancePolicy} from '../server/attendance-policy.mjs';

/* Monthly / weekly roster (owner, 22 Nov 2026): for every employee a "Trip Card" line and a "Bio Matric" line,
   each with a coloured code per date and its totals, and "Diff. of Trip Card and Bio-matric": the days the two
   lines disagree. Pressing that number opens the days below the table. Built in rosterModel.ts. */
export const ROSTER_CODES:[string,string][]=[['P','Present'],['HD','Half day'],['A','Absent'],['WO','Weekly off'],['H','Holiday'],['CO','Comp off'],['L','Leave'],['OD','On duty'],['MP','Miss punch'],['IN','In, no Out yet'],['?','Trip card not verified yet']];
export const ROSTER_TOTALS:[keyof LineTotals,string][]=[['totalDays','Total days'],['present','Present'],['half','Half day'],['absent','Absent'],['weeklyOff','Weekly off'],['holiday','Holiday'],['compOff','Comp off'],['leave','Leave'],['onDuty','On duty'],['missPunch','Miss punch'],['lateEarly','Late / early'],['cuts','Half duty cuts'],['paidDays','Paid days']];
export const DIFF_HEADING='Diff. of Trip Card and Bio-matric';
const FIRST_TRIP_DATE='2026-11-01';
const WEEKDAY=['Su','Mo','Tu','We','Th','Fr','Sa'];
export const weekday=(date:string)=>WEEKDAY[new Date(date+'T00:00:00Z').getUTCDay()];
const show=(date:string)=>date.split('-').reverse().join('-');
const codeClass=(code:string)=>'code-'+(code==='?'?'Q':code||'none');
const money=(n:number)=>n?'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';

export function bioTotals(group:RosterGroup,dates:string[]){
 const days=group.bio?.days||[];
 return lineTotals(group.bioCodes,dates,{lateEarly:days.filter(d=>d.late||d.early).length,cuts:group.bio?.summary.halfDutyCuts||0});
}
export const tripTotals=(group:RosterGroup,dates:string[])=>lineTotals(group.tripCodes,dates);
export const diffText=(group:RosterGroup,tripsLoaded:boolean)=>!tripsLoaded?'—':!group.hasTripCards?'No trip card':String(group.mismatches.length);

type Props={grant:string;rows:RegisterRow[];dates:string[];today:string;policy?:AttendancePolicy;monthly:boolean;site:string;department:string;search:string;loading:boolean;error:string};
export default function AttendanceRoster({grant,rows,dates,today,policy=DEFAULT_POLICY,monthly,site,department,search,loading,error}:Props){
 const from=dates[0]||'',to=dates[dates.length-1]||'';
 const tripFrom=from<FIRST_TRIP_DATE?FIRST_TRIP_DATE:from,tripTo=to>today?today:to;
 const [trips,setTrips]=useState<{range:string;rows:AttendanceRow[]|null;error:string}>();
 const [onlyDiff,setOnlyDiff]=useState(false),[open,setOpen]=useState(''),[exporting,setExporting]=useState(false);
 const drill=useRef<HTMLDivElement>(null);
 const tripRange=tripFrom+':'+tripTo;
 useEffect(()=>{
  if(!from||tripFrom>tripTo){setTrips({range:tripRange,rows:[],error:''});return;}
  let live=true;
  api<unknown>(grant,'attendance/mis?'+new URLSearchParams({from:tripFrom,to:tripTo}))
   .then(data=>{if(live)setTrips({range:tripRange,rows:mapMisAttendance(data).filter(r=>r.date>=tripFrom&&r.date<=tripTo),error:''});})
   .catch(e=>{if(live)setTrips({range:tripRange,rows:null,error:(e as Error).message});});
  return()=>{live=false;};
 },[grant,from,tripFrom,tripTo,tripRange]);
 const tripState=trips?.range===tripRange?trips:undefined;
 const tripRows=tripState?.rows??null;
 const groups=useMemo(()=>buildRoster(rows,tripRows,dates,today,policy),[rows,tripRows,dates,today,policy]);
 const needle=search.trim().toLowerCase();
 const shown=groups.filter(g=>(!site||g.site===site)&&(!department||g.department===department)&&(!needle||[g.name,g.code,g.designation,g.department].some(v=>v?.toLowerCase().includes(needle)))&&(!onlyDiff||g.mismatches.length>0));
 const openGroup=shown.find(g=>g.key===open);
 const tripsLoaded=Boolean(tripState&&tripRows);
 const diffCount=shown.filter(g=>g.mismatches.length).length;
 const openKey=openGroup?.key||'';
 useEffect(()=>{if(openKey)drill.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[openKey]);

 async function exportExcel(){
  setExporting(true);
  try{const {downloadRosterExcel}=await import('./attendanceRosterExcel');await downloadRosterExcel({groups:shown,dates,tripsLoaded,monthly,from,to});}
  finally{setExporting(false);}
 }

 const cells=(codes:Record<string,string>,group:RosterGroup,trip:boolean)=>dates.map(date=>{
  const code=codes[date]||'',bio=group.bio?.days.find(d=>d.date===date),tripDay=group.tripDays[date];
  const miss=group.mismatches.some(m=>m.date===date);
  const title=show(date)+' · '+(trip?(tripDay?tripDay.duties.map(d=>[d.shift,d.equipment,d.time,d.output].filter(Boolean).join(' · ')).join(' | '):codeLabel(code)):
   (bio?`${codeLabel(code)}${bio.in?` · ${bio.in}–${bio.out||'?'}`:''}${bio.note?' · '+bio.note:''}`:codeLabel(code)));
  return <td key={date} className={'roster-day'+(miss?' roster-miss':'')}><span className={'register-cell roster-code '+codeClass(code)} title={title}>{code}{!trip&&(bio?.late||bio?.early)&&<sup>{bio.late?'L':''}{bio.early?'E':''}</sup>}</span></td>;
 });
 const totals=(t:LineTotals)=>ROSTER_TOTALS.map(([key])=><td key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{key==='paidDays'||key==='totalDays'?<strong>{t[key]}</strong>:t[key]}</td>);
 const empty=<tr><td colSpan={60} className="attendance-empty">{loading?'Loading attendance…':error?'Attendance is unavailable.':onlyDiff?'No employee has a difference between trip card and biometric.':'No attendance for this selection.'}</td></tr>;

 return <>
  <div className="roster-legend" aria-label="Day codes">{ROSTER_CODES.map(([code,label])=><span key={code}><b className={'register-cell '+codeClass(code)}>{code}</b> {label}</span>)}<span><sup className="roster-sup">L</sup> late come · <sup className="roster-sup">E</sup> early going</span><span><i className="roster-miss-key"/> day where trip card and biometric differ</span></div>
  <div className="roster-bar">
   <label className="roster-check"><input type="checkbox" checked={onlyDiff} onChange={e=>setOnlyDiff(e.target.checked)}/>Only employees with a difference</label>
   <span>{!tripState?'Reading trip cards…':tripState.error?`Trip cards unavailable: ${tripState.error}`:`${shown.length} employee${shown.length===1?'':'s'} · ${diffCount} with a difference`}</span>
   <button type="button" disabled={!shown.length||exporting} onClick={exportExcel}><Download/>{exporting?'Preparing…':'Export Excel'}</button>
  </div>
  <div className="attendance-table"><table className="register-grid roster-grid" aria-label="Attendance roster">
   <thead><tr><th className="roster-fixed roster-src">Source</th><th className="roster-fixed roster-sr">Sr. No.</th><th className="roster-fixed roster-id">Employee ID</th><th className="roster-fixed roster-name">Name</th><th className="roster-text">Site</th><th className="roster-text">Department</th><th className="roster-text">Designation</th>
    {dates.map(d=><th key={d} title={show(d)} className={weekday(d)==='Su'?'roster-sunday':undefined}>{Number(d.slice(8))}<small className="register-sub">{weekday(d)}</small></th>)}
    {ROSTER_TOTALS.map(([key,label])=><th key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{label}</th>)}{monthly&&<th className="roster-total">Gate pass</th>}<th className="roster-diff">{DIFF_HEADING}</th></tr></thead>
   <tbody>{shown.length?shown.map((g,i)=>{const picked=g.key===open,diff=diffText(g,tripsLoaded);return <Fragment key={g.key}>
    <tr className={'roster-trip'+(picked?' roster-picked':'')}>
     <th scope="row" className="roster-fixed roster-src">Trip Card</th>
     <td rowSpan={2} className="roster-fixed roster-sr">{i+1}</td><td rowSpan={2} className="roster-fixed roster-id">{g.code}</td>
     <td rowSpan={2} className="roster-fixed roster-name"><strong>{g.name}</strong>{(g.shift||g.exempt)&&<small className="register-sub">{[g.shift,g.exempt?'Exempt':''].filter(Boolean).join(' · ')}</small>}</td>
     <td rowSpan={2} className="roster-text">{g.site||'—'}</td><td rowSpan={2} className="roster-text">{g.department||'—'}</td><td rowSpan={2} className="roster-text">{g.designation||'—'}</td>
     {tripsLoaded&&g.hasTripCards?<>{cells(g.tripCodes,g,true)}{totals(tripTotals(g,dates))}{monthly&&<td className="roster-total">—</td>}</>:
      <td colSpan={dates.length+ROSTER_TOTALS.length+(monthly?1:0)} className="roster-nolink">{!tripState?'Reading trip cards…':tripState.error?'Trip cards unavailable':'No trip card or log book in these dates'}</td>}
     <td rowSpan={2} className="roster-diff">{g.mismatches.length?<button type="button" className="roster-diff-open" aria-pressed={picked} aria-label={`${g.mismatches.length} days differ for ${g.name}`} onClick={()=>setOpen(picked?'':g.key)}>{diff}</button>:
      <span className={diff==='0'?'roster-diff-ok':'roster-diff-none'}>{diff==='0'?'0 · matches':diff}</span>}{g.pending>0&&<small className="register-sub">{g.pending} not verified</small>}</td>
    </tr>
    <tr className={'roster-bio'+(picked?' roster-picked':'')}>
     <th scope="row" className="roster-fixed roster-src">Bio Matric</th>
     {g.bio?<>{cells(g.bioCodes,g,false)}{totals(bioTotals(g,dates))}{monthly&&<td className="roster-total">{money(g.bio.summary.gatePassDeduction)}</td>}</>:
      <td colSpan={dates.length+ROSTER_TOTALS.length+(monthly?1:0)} className="roster-nolink">Biometric ID not linked in Biometric integration</td>}
    </tr>
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
  <p className="help-text">Trip Card: MIS trip cards and log books, rated with the attendance policy hours rule (? until the MIS batch is closed). Bio Matric: biometric punches of employees linked in Biometric integration. Weekly off, holiday, leave, comp off and OD come from HR records and show on both lines. Comp off is an approved leave of a leave type named Comp off / Compensatory off. Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty.</p>
 </>;
}
