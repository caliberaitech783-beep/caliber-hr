import {useState,type ChangeEvent} from 'react';
import {Download,Upload} from 'lucide-react';
import {downloadBlob} from './api';
import {buildRoster} from './rosterModel';
import {fetchManualBiometric} from './rosterData';
import {DEFAULT_POLICY} from '../server/attendance-policy.mjs';
import {MISMATCH_LABELS,compareAttendance,comparisonWorkbook,dmy,readAttendanceExcel,type AttendanceSheet,type ComparisonResult,type Mismatch,type MismatchKind,type OkDay} from './staffSheetCheck';
type ResultTab='mismatch'|'ok'|'all';
import './other-staff-comparison.css';

/* The Comparison tab of the attendance roster (owner, 28 Nov 2026): see staffSheetCheck.ts. */
export const COMPARISON_MAX_DAYS=31;
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86_400_000).toISOString().slice(0,10);
const many=(n:number,one:string,more=one+'s')=>`${n.toLocaleString('en-IN')} ${n===1?one:more}`;
const XLSX_TYPE='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default function OtherStaffComparison({grant,sites,today,initialSite=''}:{grant:string;sites:string[]|null;today:string;initialSite?:string}){
 const [file,setFile]=useState<{name:string;busy:boolean;error:string}>({name:'',busy:false,error:''});
 const [sheet,setSheet]=useState<AttendanceSheet|null>(null);
 const [site,setSite]=useState(initialSite),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [run,setRun]=useState<{busy:boolean;message:string;error:string}>({busy:false,message:'',error:''});
 const [result,setResult]=useState<ComparisonResult|null>(null),[book,setBook]=useState<{name:string;data:ArrayBuffer}|null>(null),[tab,setTab]=useState<ResultTab>('mismatch');
 async function choose(event:ChangeEvent<HTMLInputElement>){
  const chosen=event.target.files?.[0];event.target.value='';if(!chosen)return;
  setFile({name:chosen.name,busy:true,error:''});setSheet(null);setResult(null);setBook(null);setRun({busy:false,message:'',error:''});
  try{
   const read=await readAttendanceExcel(chosen);setSheet(read);setFile({name:chosen.name,busy:false,error:''});
   // The dates open on the sheet's marked dates, up to today and 31 days.
   const marked=read.filledDates.filter(date=>date<=today),first=marked[0]||'',last=marked.at(-1)||'';
   if(first){setFrom(first);setTo(last>addDays(first,COMPARISON_MAX_DAYS-1)?addDays(first,COMPARISON_MAX_DAYS-1):last);}
  }catch(error){setFile({name:chosen.name,busy:false,error:(error as Error).message});}
 }
 const days=from&&to&&to>=from?(Date.parse(to)-Date.parse(from))/86_400_000+1:0;
 const rangeError=!sheet?'':!from||!to?'Choose both dates.':to<from?'The To date must be on or after the From date.':days>COMPARISON_MAX_DAYS?`Choose up to ${COMPARISON_MAX_DAYS} days.`:to>today?'The To date cannot be after today.':'';
 const ready=Boolean(sheet&&site&&!rangeError);
 async function check(){
  if(!sheet||!ready)return;
  setRun({busy:true,message:'Reading Other Staff Biometric…',error:''});setResult(null);setBook(null);
  try{
   const register=await fetchManualBiometric(grant,from,to,site,progress=>{
    const done=Object.values(progress.days).filter(state=>state==='done'||state==='failed').length;
    setRun(current=>({...current,message:`Reading Other Staff Biometric… ${done} of ${days} day${days===1?'':'s'} read`}));
   },'manual2');
   const dates:string[]=[];for(let d=from;d<=to;d=addDays(d,1))dates.push(d);
   const read=new Set(dates.filter(day=>!register.failedDays?.includes(day)));
   if(!read.size)throw new Error(register.dayErrors?.[dates[0]]||'The biometric punches of these dates could not be read.');
   const groups=buildRoster(register.rows||[],null,dates,today,register.policy||DEFAULT_POLICY,undefined,read);
   const compared=compareAttendance({sheet,groups,site,from,to,read});
   const data=await comparisonWorkbook(compared,file.name);
   const name=`Other-staff-attendance-comparison-${site.replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${from}-to-${to}.xlsx`;
   setResult(compared);setTab('mismatch');setBook({name,data});setRun({busy:false,message:'',error:''});
   downloadBlob(name,new Blob([data],{type:XLSX_TYPE}));
  }catch(error){setRun({busy:false,message:'',error:(error as Error).message});}
 }
 const kinds=result?(Object.keys(MISMATCH_LABELS) as MismatchKind[]).filter(kind=>result.counts[kind]):[];
 const peopleWith=result?new Set(result.mismatches.map(m=>m.id)).size:0;
 // Mismatches / OK attendance / All (owner, 28 Nov 2026): the same check, nothing is read again.
 const lines:(Mismatch|OkDay)[]=!result?[]:tab==='mismatch'?result.mismatches:tab==='ok'?result.ok
  :[...result.mismatches,...result.ok].sort((a,b)=>(a.row??1e9)-(b.row??1e9)||a.id.localeCompare(b.id,undefined,{numeric:true})||a.date.localeCompare(b.date));
 return <div className="osc">
  <p className="osc-intro">The site's attendance Excel of the other staff is checked against <b>Other Staff Biometric</b>: the DAT punches imported in Manual Biometric, for every department and designation except Drivers and Operators. Upload the sheet (one line per employee with EMP. ID, NAME and DESIGNATION, and one column per date marked P or A), choose the site and dates and press Check. It is compared day by day, both ways: <b>biometric present, sheet not P</b>, and <b>sheet P, no biometric punch</b>. Nothing is changed in HR Pulse.</p>
  <section className="osc-step">
   <h3>1 · Import Excel attendance</h3>
   <label className={'osc-upload'+(file.busy||run.busy?' busy':'')}><Upload size={16}/>{file.busy?'Reading the file…':sheet?'Choose another Excel file':'Import Excel attendance'}<input type="file" accept=".xlsx,.xls,.xlsm" disabled={file.busy||run.busy} onChange={event=>void choose(event)}/></label>
   {sheet?<p className="osc-note" role="status"><strong>{file.name}</strong> · sheet “{sheet.sheetName}” · {many(sheet.people.length,'employee')} · {sheet.filledDates.length?`marks from ${dmy(sheet.filledDates[0])} to ${dmy(sheet.filledDates.at(-1)!)}`:'no date is marked'}{sheet.noId.length?` · ${many(sheet.noId.length,'line')} without EMP. ID`:''}</p>
    :<p className="osc-help">Only the other staff belong in this file. Drivers and Operators found in it are listed apart, not compared.</p>}
   {file.error&&<p className="error" role="alert">{file.name}: {file.error}</p>}
  </section>
  <section className="osc-step">
   <h3>2 · Site, From date and To date</h3>
   <div className="osc-fields">
    <label>Site<select value={site} onChange={event=>setSite(event.target.value)} disabled={run.busy}><option value="">{sites===null?'Loading sites…':'Select the site'}</option>{(sites||[]).map(s=><option key={s} value={s}>{s}</option>)}</select></label>
    <label>From date<input type="date" value={from} max={to||today} disabled={!sheet||run.busy} onChange={event=>setFrom(event.target.value)}/></label>
    <label>To date<input type="date" value={to} min={from} max={today} disabled={!sheet||run.busy} onChange={event=>setTo(event.target.value)}/></label>
   </div>
   {!sheet?<p className="osc-help">The dates open once the Excel file is imported in Step 1.</p>:rangeError&&<p className="error" role="alert">{rangeError}</p>}
  </section>
  <section className="osc-step">
   <h3>3 · Check</h3>
   <button type="button" className="osc-check" disabled={!ready||run.busy} onClick={()=>void check()}><Download size={16}/>{run.busy?'Checking…':'Check final attendance'}</button>
   <p className="osc-help" role="status">{run.busy?run.message:!sheet?'Import the Excel file first.':!site?'Select the site.':ready?'Compares the sheet with Other Staff Biometric and downloads the result as Excel.':''}</p>
   {run.error&&<p className="error" role="alert">Could not check: {run.error}</p>}
  </section>
  {result&&<section className="osc-step osc-result" aria-label="Comparison result">
   <div className="osc-result-head"><h3>{result.site} · {dmy(result.from)} to {dmy(result.to)} · {many(result.mismatches.length,'mismatch','mismatches')} for {many(peopleWith,'employee')}</h3>
    {book&&<button type="button" onClick={()=>downloadBlob(book.name,new Blob([book.data],{type:XLSX_TYPE}))}><Download size={15}/>Download Excel again</button>}</div>
   <p className="osc-note">{many(result.compared.length,'date')} compared{result.notInSheet.length?` · no column in the sheet for ${result.notInSheet.map(dmy).join(', ')}`:''}{result.notRead.length?` · biometric not read for ${result.notRead.map(dmy).join(', ')}`:''}{result.apart.length?` · ${many(result.apart.length,'Driver / Operator line')} listed apart`:''}</p>
   {kinds.length>0&&<div className="osc-counts">{kinds.map(kind=><span key={kind} className={'osc-kind osc-'+kind}>{MISMATCH_LABELS[kind]}: <b>{result.counts[kind]}</b></span>)}</div>}
   <div className="module-tabs osc-tabs" role="tablist" aria-label="Comparison result">
    {([['mismatch',`Mismatches (${result.mismatches.length.toLocaleString('en-IN')})`],['ok',`OK attendance (${result.ok.length.toLocaleString('en-IN')})`],['all',`All (${(result.mismatches.length+result.ok.length).toLocaleString('en-IN')})`]] as [ResultTab,string][]).map(([id,label])=>
     <button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?'selected':''} onClick={()=>setTab(id)}>{label}</button>)}
   </div>
   {lines.length?<div className="table-scroll osc-table"><table><thead><tr><th>Row</th><th>EMP. ID</th><th>Name</th><th>Designation</th><th>Date</th><th>{tab==='mismatch'?'Mismatch':'Result'}</th><th>Sheet says</th><th>Biometric says</th><th>In / Out</th></tr></thead>
    <tbody>{lines.map((m,index)=><tr key={index} className={m.kind==='ok'?'osc-ok-row':undefined}><td>{m.row??''}</td><td>{m.id}</td><td>{m.name}</td><td>{m.designation}</td><td>{dmy(m.date)}</td><td><span className={'osc-kind osc-'+m.kind}>{m.kind==='ok'?'OK':MISMATCH_LABELS[m.kind]}</span></td><td>{m.sheetSays}</td><td>{m.bioSays}</td><td>{m.inOut}</td></tr>)}</tbody></table></div>
    :<p className="roster-saved" role="status">{tab==='ok'?'No compared day agrees between the sheet and Other Staff Biometric.':'The sheet and Other Staff Biometric agree on every compared date.'}</p>}
   {result.apart.length>0&&<details className="osc-apart"><summary>Listed apart, not compared ({result.apart.length})</summary><ul>{result.apart.map(a=><li key={a.id+(a.row||'')}>{a.id} · {a.name} · {a.designation} — {a.why}</li>)}</ul></details>}
  </section>}
 </div>;
}
