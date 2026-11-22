import {downloadExcel} from './excelFiles';
import {useEffect,useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import {api} from './api';
import type {AttendancePolicy} from '../server/attendance-policy.mjs';

/* Registers built from the server day calculation (GET attendance/register),
   which applies Settings › HR policy · attendance to biometric punches. */
export type RegisterDay={date:string;status:string;note:string;in:string;out:string;workedMinutes:number|null;late:boolean;early:boolean;missPunch:boolean;gatePassMinutes:number;gatePassDeduction:number;exempt:boolean};
export type RegisterSummary={full:number;half:number;absent:number;missPunch:number;late:number;early:number;lateEarly:number;halfDutyCuts:number;duties:number;gatePassDeduction:number;H:number;L:number;CO?:number;OD:number;WO:number;IN:number};
export type RegisterRow={id:string;code:string;name:string;siteId:string;site:string;siteType:string;department?:string;shift:string;designation:string;exempt:boolean;shiftStart:string;shiftEnd:string;days:RegisterDay[];summary:RegisterSummary};
export type Register={from:string;to:string;policy:AttendancePolicy;rows:RegisterRow[]};
export type RegisterMode='month'|'week-day'|'site'|'miss'|'gate';

export const STATUS:Record<string,string>={P:'Full duty',HD:'Half duty',A:'Absent',MP:'Miss punch',L:'Leave',CO:'Comp off',OD:'On duty',H:'Holiday',WO:'Weekly off',IN:'In (no Out yet)'};
/* Monthly roster (owner, 22 Nov 2026): one line per employee with ID, name, site, department and designation,
   a coloured code for every date, then the day totals. The colours are the code-* classes in attendance.css. */
export const ROSTER_CODES:[string,string][]=[['P','Present'],['HD','Half day'],['A','Absent'],['WO','Weekly off'],['H','Holiday'],['CO','Comp off'],['L','Leave'],['OD','On duty'],['MP','Miss punch'],['IN','In, no Out yet']];
export type RosterTotals={totalDays:number;present:number;half:number;absent:number;weeklyOff:number;holiday:number;compOff:number;leave:number;onDuty:number;missPunch:number;lateEarly:number;cuts:number;paidDays:number};
export const ROSTER_TOTALS:[keyof RosterTotals,string][]=[['totalDays','Total days'],['present','Present'],['half','Half day'],['absent','Absent'],['weeklyOff','Weekly off'],['holiday','Holiday'],['compOff','Comp off'],['leave','Leave'],['onDuty','On duty'],['missPunch','Miss punch'],['lateEarly','Late / early'],['cuts','Half duty cuts'],['paidDays','Paid days']];
/** Totals of one roster line. Paid days = full duty + half duty ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty. */
export function rosterTotals(row:RegisterRow,dates:string[]):RosterTotals{
 const count=(code:string)=>row.days.filter(d=>d.status===code).length;
 const present=count('P')+count('IN'),half=count('HD'),cuts=row.summary.halfDutyCuts||0;
 const t={totalDays:dates.length,present,half,absent:count('A'),weeklyOff:count('WO'),holiday:count('H'),compOff:count('CO'),leave:count('L'),onDuty:count('OD'),missPunch:count('MP'),lateEarly:row.days.filter(d=>d.late||d.early).length,cuts,paidDays:0};
 t.paidDays=Math.max(0,Math.round((present+half/2-cuts/2+t.weeklyOff+t.holiday+t.compOff+t.leave+t.onDuty)*100)/100);
 return t;
}
const WEEKDAY=['Su','Mo','Tu','We','Th','Fr','Sa'];
const weekday=(date:string)=>WEEKDAY[new Date(date+'T00:00:00Z').getUTCDay()];
const india=()=>new Date(Date.now()+330*60_000).toISOString().slice(0,10);
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86_400_000).toISOString().slice(0,10);
export const monthRange=(month:string)=>{const[y,m]=month.split('-').map(Number);return {from:`${month}-01`,to:`${month}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`};};
export const weekStart=(date:string)=>addDays(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
export const hoursText=(minutes:number|null)=>minutes==null?'—':`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
const money=(n:number)=>n?'₹'+n.toLocaleString('en-IN',{maximumFractionDigits:2}):'—';
const show=(date:string)=>date.split('-').reverse().join('-');
const datesBetween=(from:string,to:string)=>{const out:string[]=[];for(let d=from;d<=to;d=addDays(d,1))out.push(d);return out;};

/** Counts per site for one or more days. */
export function siteTotals(rows:RegisterRow[]){
 const sites=new Map<string,{site:string;employees:number;P:number;HD:number;A:number;MP:number;leave:number;off:number;late:number;early:number}>();
 for(const row of rows){
  const s=sites.get(row.site||'No site')||{site:row.site||'No site',employees:0,P:0,HD:0,A:0,MP:0,leave:0,off:0,late:0,early:0};
  s.employees++;
  for(const d of row.days){if(d.status==='P'||d.status==='IN')s.P++;else if(d.status==='HD')s.HD++;else if(d.status==='A')s.A++;else if(d.status==='MP')s.MP++;else if(d.status==='L'||d.status==='OD')s.leave++;else s.off++;if(d.late)s.late++;if(d.early)s.early++;}
  sites.set(s.site,s);
 }
 return [...sites.values()].sort((a,b)=>a.site.localeCompare(b.site));
}

export default function AttendanceRegister({grant,mode}:{grant:string;mode:RegisterMode}){
 const today=india();
 const[month,setMonth]=useState(today.slice(0,7));
 const[day,setDay]=useState(today),[weekly,setWeekly]=useState(false);
 const[from,setFrom]=useState(mode==='miss'?today.slice(0,8)+'01':today),[to,setTo]=useState(today);
 const[site,setSite]=useState(''),[department,setDepartment]=useState(''),[search,setSearch]=useState('');
 const[data,setData]=useState<Register>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const range=mode==='month'||mode==='gate'?monthRange(month):mode==='week-day'?(weekly?{from:weekStart(day),to:addDays(weekStart(day),6)}:{from:day,to:day}):{from,to};
 useEffect(()=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(range.from)||!/^\d{4}-\d{2}-\d{2}$/.test(range.to)||range.to<range.from)return;
  let live=true;setLoading(true);setError('');
  api<Register>(grant,`attendance/register?from=${range.from}&to=${range.to}`).then(value=>{if(live)setData({...value,rows:Array.isArray(value?.rows)?value.rows:[]});}).catch(e=>{if(live)setError((e as Error).message);}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[grant,range.from,range.to]);
 const current=data&&data.from===range.from&&data.to===range.to?data:undefined;
 const sites=useMemo(()=>[...new Set((current?.rows||[]).map(r=>r.site).filter(Boolean))].sort(),[current]);
 const roster=mode==='month'||mode==='week-day'&&weekly;
 const departments=useMemo(()=>[...new Set((current?.rows||[]).filter(r=>!site||r.site===site).map(r=>r.department||'').filter(Boolean))].sort(),[current,site]);
 const needle=search.trim().toLowerCase();
 const rows=(current?.rows||[]).filter(r=>(!site||r.site===site)&&(!roster||!department||r.department===department)&&(!needle||[r.name,r.code,r.designation,r.department].some(v=>v?.toLowerCase().includes(needle))));
 const dates=datesBetween(range.from,range.to);
 const title={month:'Monthly attendance register','week-day':weekly?'Weekly attendance register':'Daily attendance register',site:'Site-wise attendance',miss:'Miss punch',gate:'Gate pass deductions'}[mode];

 function exportExcel(){
  if(roster){
   const cols=['Sr. No.','Employee ID','Name','Site','Department','Designation',...dates.map(show),...ROSTER_TOTALS.map(([,label])=>label),...(mode==='month'?['Gate pass deduction']:[])];
   downloadExcel(`attendance-roster-${range.from}-to-${range.to}.xlsx`,cols,rows.map((r,i)=>{const t=rosterTotals(r,dates);return {'Sr. No.':i+1,'Employee ID':r.code,Name:r.name,Site:r.site,Department:r.department||'',Designation:r.designation,
    ...Object.fromEntries(dates.map(d=>[show(d),r.days.find(x=>x.date===d)?.status||''])),...Object.fromEntries(ROSTER_TOTALS.map(([key,label])=>[label,t[key]])),...(mode==='month'?{'Gate pass deduction':r.summary.gatePassDeduction||0}:{})};}));
  }else{
   const cols=['Date','Employee code','Employee name','Site','Shift','In','Out','Worked','Status','Late','Early','Gate pass','Deduction','Note'];
   downloadExcel(`attendance-${mode}-${range.from}-to-${range.to}.xlsx`,cols,rows.flatMap(r=>r.days.filter(d=>mode!=='miss'||d.missPunch).filter(d=>mode!=='gate'||d.gatePassMinutes>0).map(d=>({Date:show(d.date),'Employee code':r.code,'Employee name':r.name,Site:r.site,Shift:r.shift,In:d.in,Out:d.out,Worked:hoursText(d.workedMinutes),Status:STATUS[d.status]||d.status,Late:d.late?'Yes':'',Early:d.early?'Yes':'',['Gate pass']:hoursText(d.gatePassMinutes||null),Deduction:d.gatePassDeduction||'',Note:d.note}))));
  }
 }

 const empty=<tr><td colSpan={40} className="attendance-empty">{loading?'Loading attendance…':error?'Attendance is unavailable.':'No attendance for this selection. Only employees whose machine ID is linked in Biometric integration appear here.'}</td></tr>;
 return <section className="data-card attendance-register" aria-label={title}>
  <h2>{title}</h2>
  {mode==='miss'&&<p className="help-text">Days with only one biometric punch. Ask the employee to raise an OD, leave or gate pass for the day, or correct the punch on the machine; the day is rated again when the next punch arrives.</p>}
  {mode==='gate'&&current&&<p className="help-text">Up to {current.policy.gatePassFreeMinutes} min of gate pass in a day is free. Above that the full time is deducted at daily wage ÷ 8 per hour. Times come from security's gate out and back in entries; the daily wage comes from the employee record or the salary structure ÷ days in the month.</p>}
  <div className="attendance-filters">
   {(mode==='month'||mode==='gate')&&<label>Month<input type="month" value={month} max={today.slice(0,7)} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label>}
   {mode==='week-day'&&<><div className="module-tabs" aria-label="Register period"><button type="button" aria-pressed={!weekly} className={!weekly?'selected':''} onClick={()=>setWeekly(false)}>Daily</button><button type="button" aria-pressed={weekly} className={weekly?'selected':''} onClick={()=>setWeekly(true)}>Weekly</button></div>
    <label>{weekly?'Week of':'Date'}<input type="date" value={day} max={today} onChange={e=>e.target.value&&setDay(e.target.value)}/></label></>}
   {(mode==='site'||mode==='miss')&&<><label>From<input type="date" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)}/></label><label>To<input type="date" value={to} min={from} max={today} onChange={e=>e.target.value&&setTo(e.target.value)}/></label></>}
   {mode!=='site'&&<label>Site<select value={site} onChange={e=>{setSite(e.target.value);setDepartment('');}}><option value="">All sites</option>{sites.map(s=><option key={s}>{s}</option>)}</select></label>}
   {roster&&<label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}><option value="">All departments</option>{departments.map(d=><option key={d}>{d}</option>)}</select></label>}
   {mode!=='site'&&<label>Employee<input type="search" value={search} placeholder={roster?'Name, ID, department or designation':'Name, code or designation'} onChange={e=>setSearch(e.target.value)}/></label>}
   <span>{loading?'Loading…':current?`${rows.length} employee${rows.length===1?'':'s'}`:''}</span>
   {mode!=='site'&&<button type="button" disabled={!rows.length} onClick={exportExcel}><Download/>Export Excel</button>}
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {roster&&<div className="roster-legend" aria-label="Day codes">{ROSTER_CODES.map(([code,label])=><span key={code}><b className={'register-cell code-'+code}>{code}</b> {label}</span>)}<span><sup className="roster-sup">L</sup> late come · <sup className="roster-sup">E</sup> early going</span></div>}
  {roster&&<div className="attendance-table"><table className="register-grid roster-grid" aria-label="Attendance roster">
   <thead><tr><th className="roster-fixed roster-sr">Sr. No.</th><th className="roster-fixed roster-id">Employee ID</th><th className="roster-fixed roster-name">Name</th><th className="roster-text">Site</th><th className="roster-text">Department</th><th className="roster-text">Designation</th>
    {dates.map(d=><th key={d} title={show(d)} className={weekday(d)==='Su'?'roster-sunday':undefined}>{Number(d.slice(8))}<small className="register-sub">{weekday(d)}</small></th>)}
    {ROSTER_TOTALS.map(([key,label])=><th key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{label}</th>)}{mode==='month'&&<th className="roster-total">Gate pass</th>}</tr></thead>
   <tbody>{rows.length?rows.map((r,i)=>{const t=rosterTotals(r,dates);return <tr key={r.id}>
    <td className="roster-fixed roster-sr">{i+1}</td><td className="roster-fixed roster-id">{r.code}</td><td className="roster-fixed roster-name"><strong>{r.name}</strong>{(r.shift||r.exempt)&&<small className="register-sub">{[r.shift,r.exempt?'Exempt':''].filter(Boolean).join(' · ')}</small>}</td>
    <td className="roster-text">{r.site||'—'}</td><td className="roster-text">{r.department||'—'}</td><td className="roster-text">{r.designation||'—'}</td>
    {dates.map(date=>{const d=r.days.find(x=>x.date===date);return <td key={date} className="roster-day"><span className={'register-cell roster-code code-'+(d?.status||'none')} title={d?`${show(date)} · ${STATUS[d.status]||d.status}${d.in?` · ${d.in}–${d.out||'?'}`:''}${d.late?' · late':''}${d.early?' · early going':''}${d.note?' · '+d.note:''}`:show(date)}>{d?.status||''}{(d?.late||d?.early)&&<sup>{d.late?'L':''}{d.early?'E':''}</sup>}</span></td>;})}
    {ROSTER_TOTALS.map(([key])=><td key={key} className={'roster-total'+(key==='paidDays'?' roster-paid':'')}>{key==='paidDays'||key==='totalDays'?<strong>{t[key]}</strong>:t[key]}</td>)}{mode==='month'&&<td className="roster-total">{money(r.summary.gatePassDeduction)}</td>}
   </tr>;}):empty}</tbody>
  </table></div>}
  {roster&&<p className="help-text">Every employee whose biometric ID is linked in Biometric integration. Comp off is an approved leave of a leave type named Comp off / Compensatory off. Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty.</p>}
  {(mode==='week-day'&&!weekly||mode==='miss'||mode==='gate')&&<div className="attendance-table"><table>
   <thead><tr>{['Date','Employee','Site / shift','In','Out','Worked','Status',...(mode==='gate'?['Gate pass','Deduction']:['Late','Early']),'Note'].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{(()=>{const list=rows.flatMap(r=>r.days.filter(d=>mode==='miss'?d.missPunch:mode==='gate'?d.gatePassMinutes>0:true).map(d=>({r,d})));return list.length?list.map(({r,d})=><tr key={r.id+d.date}>
    <td>{show(d.date)}</td><td><strong>{r.name}</strong><small> · {r.code}</small></td><td>{r.site}<small className="register-sub">{r.shift}{r.shiftStart?` ${r.shiftStart}–${r.shiftEnd}`:''}</small></td>
    <td>{d.in||'—'}</td><td>{d.out||'—'}</td><td>{hoursText(d.workedMinutes)}</td><td><span className={'register-cell code-'+d.status}>{STATUS[d.status]||d.status}</span></td>
    {mode==='gate'?<><td>{hoursText(d.gatePassMinutes)}</td><td>{d.gatePassDeduction?money(d.gatePassDeduction):'Free'}</td></>:<><td>{d.late?'Late':''}</td><td>{d.early?'Early':''}</td></>}
    <td>{d.note}</td>
   </tr>):empty;})()}</tbody>
  </table></div>}
  {mode==='site'&&<div className="attendance-table"><table>
   <thead><tr>{['Site','Employees','Full duty','Half duty','Absent','Miss punch','Leave / OD','Holiday / off','Late','Early going'].map(h=><th key={h}>{h}</th>)}</tr></thead>
   <tbody>{siteTotals(rows).length?siteTotals(rows).map(s=><tr key={s.site}><td><strong>{s.site}</strong></td><td>{s.employees}</td><td>{s.P}</td><td>{s.HD}</td><td>{s.A}</td><td>{s.MP}</td><td>{s.leave}</td><td>{s.off}</td><td>{s.late}</td><td>{s.early}</td></tr>):empty}</tbody>
  </table></div>}
 </section>;
}
