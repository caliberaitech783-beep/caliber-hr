import {useEffect,useState} from 'react';
import {api} from './api';
import {DEFAULT_POLICY,policyRules,validatePolicy,type AttendancePolicy} from '../server/attendance-policy.mjs';

export type PolicyState={policy:AttendancePolicy;version:number;updatedBy:string;updatedAt:string|null;canEdit:boolean};
export const defaultPolicy=():AttendancePolicy=>({...DEFAULT_POLICY,exemptRoles:[...DEFAULT_POLICY.exemptRoles],workingHoursSites:[...DEFAULT_POLICY.workingHoursSites]});

/** Loads the saved attendance policy; falls back to the defaults if it cannot be read. */
export function usePolicy(grant:string){
 const[state,setState]=useState<PolicyState|null>(null);
 useEffect(()=>{let live=true;api<PolicyState>(grant,'attendance/policy').then(value=>{if(live)setState(value);}).catch(()=>{if(live)setState({policy:defaultPolicy(),version:0,updatedBy:'',updatedAt:null,canEdit:false});});return()=>{live=false;};},[grant]);
 return [state,setState] as const;
}

const FIELDS:[keyof Omit<AttendancePolicy,'exemptRoles'|'workingHoursSites'>,string,string,number][]=[
 ['lunchMinutes','Lunch break excluded from working hours','minutes',1],
 ['absentBelowHours','Absent when working hours are under','hours',0.25],
 ['fullDutyHours','Full duty from (half duty in between)','hours',0.25],
 ['graceMinutes','Late come grace after shift start','minutes',1],
 ['lateEarlyPerHalfCut','Late comings + early goings per half duty cut','per month',1],
 ['gatePassFreeMinutes','Free gate pass time per day','minutes',1],
];

const formValues=(policy:AttendancePolicy):Record<string,string>=>Object.fromEntries([...FIELDS.map(([key])=>[key,String(policy[key])]),['exemptRoles',policy.exemptRoles.join(', ')],
 ['workingHoursSites',(policy.workingHoursSites||[]).join(', ')]]);

export default function AttendancePolicySettings({grant}:{grant:string}){
 const[state,setState]=usePolicy(grant);
 // Unsaved edits; null shows the saved policy.
 const[edits,setEdits]=useState<Record<string,string>|null>(null);
 const[error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 if(!state)return <p role="status">Loading the attendance policy…</p>;
 const draft=edits??formValues(state.policy);
 const setDraft=(change:(d:Record<string,string>)=>Record<string,string>)=>setEdits(change(draft));
 let preview=state.policy,invalid='';
 try{preview=validatePolicy({...draft,exemptRoles:draft.exemptRoles??'',workingHoursSites:draft.workingHoursSites??''});}catch(e){invalid=(e as Error).message;}
 let saved=state.policy;try{saved=validatePolicy(state.policy);}catch{/* keep as stored */}
 const changed=JSON.stringify(preview)!==JSON.stringify(saved);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!state||invalid||saving)return;
  setSaving(true);setError('');setMessage('');
  try{const saved=await api<Omit<PolicyState,'canEdit'>>(grant,'attendance/policy','POST',{version:state.version,policy:preview});setState({...saved,canEdit:state.canEdit});setEdits(null);setMessage('Attendance policy saved. The register uses it from now on.');}
  catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 return <section className="data-card attendance-policy" aria-labelledby="attendance-policy-title">
  <h2 id="attendance-policy-title">HR policy · attendance</h2>
  <p className="help-text">Attendance comes from two sources only: biometric machines (ESSL, through the site bridge PC) and the trip card / logbook for operators and drivers. These rules decide each day in the attendance register.</p>
  <ol className="policy-rules">{policyRules(preview).map(([title,text])=><li key={title}><b>{title}</b><span>{text}</span></li>)}</ol>
  <form onSubmit={save} className="policy-form" aria-label="Attendance policy settings">
   <h3>Policy settings</h3>
   {!state.canEdit&&<p className="help-text">Only an HR administrator without a site restriction can change these values.</p>}
   <div className="policy-grid">
    {FIELDS.map(([key,label,unit,step])=><label key={key}>{label}<span><input type="number" min={0} step={step} value={draft[key]??''} disabled={!state.canEdit||saving} onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/> {unit}</span></label>)}
    <label className="policy-roles">Exempt roles (comma separated)<input value={draft.exemptRoles??''} disabled={!state.canEdit||saving} onChange={e=>setDraft(d=>({...d,exemptRoles:e.target.value}))}/></label>
    <label className="policy-roles">Working-hours rules: Manual Biometric sites switched on (comma separated, e.g. Gauri Pauni OB 2nd)<input value={draft.workingHoursSites??''} placeholder="No site switched on" disabled={!state.canEdit||saving} onChange={e=>setDraft(d=>({...d,workingHoursSites:e.target.value}))}/></label>
   </div>
   {invalid&&<p className="error" role="alert">{invalid}</p>}
   {error&&<p className="error" role="alert">{error}</p>}
   {message&&<p className="attendance-success" role="status">{message}</p>}
   {state.canEdit&&<div className="attendance-actions">
    <button className="primary" disabled={!changed||!!invalid||saving}>{saving?'Saving…':'Save policy'}</button>
    <button type="button" disabled={saving} onClick={()=>setEdits(formValues(defaultPolicy()))}>Restore defaults</button>
   </div>}
   <p className="help-text">{state.updatedBy?`Last changed by ${state.updatedBy}${state.updatedAt?' on '+new Date(state.updatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}):''}.`:'Using the approved default values.'}</p>
  </form>
 </section>;
}
