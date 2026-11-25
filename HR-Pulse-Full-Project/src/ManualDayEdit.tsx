import {useState} from 'react';
import {Save,Undo2,X} from 'lucide-react';
import {api} from './api';
import type {RegisterDay} from './AttendanceRegister';

/* Attendance roster › Manual Biometric: an HR administrator corrects one person's day (owner, 25 Nov 2026: "edit option
   only for admin in bio-matric punch daily attendance"). The server keeps the correction apart from the imported punches
   (server/manual-attendance-corrections.mjs) and refuses anyone who is not an HR administrator. */
export const EDIT_CODES:[string,string][]=[['P','Present'],['HD','Half day'],['A','Absent'],['WO','Weekly off'],['H','Holiday'],['CO','Comp off'],['L','Leave'],['OD','On duty']];
export type DayEditTarget={site:string;employeeCode:string;name:string;date:string;day?:RegisterDay};
const show=(date:string)=>date.split('-').reverse().join('-');
const plain=(time?:string)=>String(time||'').replace(/\s*\(\+1\)\s*$/,'');

export async function saveManualCorrection(grant:string,body:{site:string;day:string;employeeCode:string;status:string;in:string;out:string;reason:string}){
 return api<{savedCopyUpdated?:boolean}>(grant,'attendance/manual-biometric/corrections','POST',body);
}
export async function undoManualCorrection(grant:string,body:{site:string;day:string;employeeCode:string}){
 return api<{savedCopyUpdated?:boolean}>(grant,'attendance/manual-biometric/corrections','DELETE',body);
}

export default function ManualDayEdit({grant,target,onClose,onSaved}:{grant:string;target:DayEditTarget;onClose:()=>void;onSaved:(message:string)=>void}){
 const day=target.day,corrected=day?.corrected;
 const [mode,setMode]=useState<'times'|'code'>(corrected?.status&&!corrected.in?'code':'times');
 const [inTime,setIn]=useState(corrected?.in||plain(day?.in)),[outTime,setOut]=useState(corrected?.out||plain(day?.out));
 const [code,setCode]=useState(corrected?.status||'P'),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const was=corrected?.before||(day?{status:day.status,in:day.in,out:day.out}:null);
 const key={site:target.site,day:target.date,employeeCode:target.employeeCode};
 async function save(){
  if(reason.trim().length<3){setError('Write the reason for the correction.');return;}
  if(mode==='times'&&!inTime){setError('Give the In time.');return;}
  setBusy(true);setError('');
  try{
   const result=await saveManualCorrection(grant,{...key,status:mode==='code'?code:'',in:mode==='times'?inTime:'',out:mode==='times'?outTime:'',reason:reason.trim()});
   onSaved(`${target.name} · ${show(target.date)} corrected.${result?.savedCopyUpdated?' The saved log of that day shows it too.':''}`);
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 async function undo(){
  if(!window.confirm(`Undo the correction of ${target.name} on ${show(target.date)}? The day goes back to the imported punches.`))return;
  setBusy(true);setError('');
  try{await undoManualCorrection(grant,key);onSaved(`${target.name} · ${show(target.date)}: correction undone.`);}
  catch(e){setError((e as Error).message);}
  finally{setBusy(false);}
 }
 return <div className="modal-backdrop" role="presentation"><section className="modal manual-day-edit" role="dialog" aria-modal="true" aria-label="Correct attendance day">
  <div className="modal-heading"><h2>Correct attendance</h2><button type="button" aria-label="Close" onClick={onClose}><X/></button></div>
  <p><b>{target.name}</b> ({target.employeeCode}) · {show(target.date)}</p>
  {was&&<p className="manual-day-was">{corrected?'Before the correction':'From the punches'}: <b>{was.status||'—'}</b> · In {was.in||'—'} · Out {was.out||'—'}</p>}
  {corrected&&<p className="manual-day-was">Corrected by {corrected.by||'HR administrator'}{corrected.at?` on ${new Date(corrected.at).toLocaleString('en-IN')}`:''}: {corrected.reason}</p>}
  <div className="roster-seg" role="group" aria-label="Correct by">
   <button type="button" aria-pressed={mode==='times'} onClick={()=>setMode('times')}>In / Out time</button>
   <button type="button" aria-pressed={mode==='code'} onClick={()=>setMode('code')}>Code</button>
  </div>
  {mode==='times'?<div className="manual-day-fields">
   <label>In<input type="time" value={inTime} onChange={e=>setIn(e.target.value)} required/></label>
   <label>Out<input type="time" value={outTime} onChange={e=>setOut(e.target.value)}/></label>
   <small>An Out before the In is the next morning. The day is rated again with the attendance policy.</small>
  </div>:<label className="manual-day-fields">Code<select value={code} onChange={e=>setCode(e.target.value)}>{EDIT_CODES.map(([c,label])=><option key={c} value={c}>{c} · {label}</option>)}</select></label>}
  <label className="manual-day-fields">Reason<textarea value={reason} maxLength={300} rows={3} required placeholder="Why is this day corrected?" onChange={e=>setReason(e.target.value)}/></label>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="modal-actions">
   {corrected&&<button type="button" className="secondary" disabled={busy} onClick={()=>void undo()}><Undo2/>Undo correction</button>}
   <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
   <button type="button" className="primary" disabled={busy} onClick={()=>void save()}><Save/>{busy?'Saving…':'Save correction'}</button>
  </div>
 </section></div>;
}
