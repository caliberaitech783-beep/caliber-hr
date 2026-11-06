import {useEffect,useRef,useState} from 'react';
import {Send,X} from 'lucide-react';
import {api,savedSession} from './api';
import './trial-form.css';
/* Joining approval: when HR clicks Save & Continue on Joining & Personal Details, an approval request with a 6-digit OTP
   goes to the configured approvers on Telegram (leave bot). The step unlocks when HR enters the OTP or the approver taps Approve. */
export type JoiningApprovalState={status:'APPROVED'|'PENDING'|'REJECTED'|'NONE';approvedBy?:string;approvedAt?:string};
type Status={required:boolean;status?:string;approvedBy?:string;approvedAt?:string;expires?:string;expired?:boolean;issues?:string[];approvers?:string[];connected?:string[];notConnected?:string[]};
const KEY='hrPulse.joiningApproval.';
export function loadJoiningApproval(draftId:string):JoiningApprovalState{try{return JSON.parse(localStorage.getItem(KEY+draftId)||'null')||{status:'NONE'};}catch{return {status:'NONE'};}}
export function saveJoiningApproval(draftId:string,state:JoiningApprovalState){try{localStorage.setItem(KEY+draftId,JSON.stringify(state));}catch{/* ignore */}}
export function clearJoiningApproval(draftId:string){try{localStorage.removeItem(KEY+draftId);}catch{/* ignore */}}
export async function joiningApprovalRequired():Promise<boolean>{const grant=savedSession()?.grant;if(!grant)return false;try{const r=await api<{enabled:boolean}>(grant,'telegram/joining-approvers');return !!r.enabled;}catch{return false;}}

export function JoiningApprovalGate({draftId,info,onApproved,onClose}:{draftId:string;info:{candidate:string;post:string;site:string;company:string};onApproved:(state:JoiningApprovalState)=>void;onClose:()=>void}){
 const[status,setStatus]=useState<Status|null>(null),[otp,setOtp]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const done=useRef(false);
 const grant=()=>{const g=savedSession()?.grant;if(!g)throw new Error('Sign in again before requesting approval.');return g;};
 async function request(resend=false){setBusy(true);setError('');try{const r=await api<Status>(grant(),'telegram/joining-approval','POST',{draftId,...info});setStatus(r);if(!r.required){finish({status:'APPROVED',approvedBy:'Approval not required'});return;}if(r.status==='APPROVED'){finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});return;}setNote(resend?'New OTP sent.':'');setOtp('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function finish(state:JoiningApprovalState){if(done.current)return;done.current=true;saveJoiningApproval(draftId,state);onApproved(state);}
 async function verify(){if(otp.replace(/\D/g,'').length!==6){setError('Enter the 6-digit OTP.');return;}setBusy(true);setError('');try{const r=await api<{status:string;approvedBy:string;approvedAt:string}>(grant(),'telegram/joining-approval/verify','POST',{draftId,otp});finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void request();},[]);
 useEffect(()=>{const t=setInterval(async()=>{if(done.current)return;try{const r=await api<Status>(grant(),'telegram/joining-approval/status','POST',{draftId});if(r.status==='APPROVED'){finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});return;}setStatus(s=>({...(s||{required:true}),...r}));}catch{/* keep polling */}},5000);return()=>clearInterval(t);},[draftId]);
 const rejected=status?.status==='REJECTED',expired=!!status?.expired;
 return <div className="salary-ov" onClick={onClose}><div className="salary-md tf-tg ja-box" role="dialog" aria-label="Joining approval" onClick={e=>e.stopPropagation()}>
  <div className="salary-mh"><h4><Send/> Joining approval – Telegram</h4><button type="button" className="salary-x" aria-label="Close" onClick={onClose}><X/></button></div>
  <p>Approval request for <b>{info.candidate||'candidate'}</b>{info.post?` · ${info.post}`:''}{info.site?` · ${info.site}`:''} has been sent to {status?.approvers?.length?status.approvers.join(', '):'the approver'} on Telegram with a one-time OTP. The approver can tap <b>Approve</b> in Telegram, or tell you the OTP to enter below.</p>
  {status?.notConnected?.length?<p className="employee-import-error">Not connected to Telegram yet: {status.notConnected.join(', ')} – they must open the HR Pulse bot and tap Start (Telegram Hierarchy → Connect).</p>:null}
  {status?.issues?.length?<p className="employee-import-error">{status.issues.join(' · ')}</p>:null}
  {rejected?<p className="employee-import-error" role="alert">Rejected by {status?.approvedBy||'approver'}. Correct the details and click Save &amp; Continue again to resend.</p>:
  <div className="ja-otp"><label>OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} placeholder="6-digit OTP" onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void verify();}}}/></label>
   <button type="button" className="next" disabled={busy||expired} onClick={()=>void verify()}>Verify OTP</button>
   <button type="button" disabled={busy} onClick={()=>void request(true)}>Resend OTP</button></div>}
  {expired&&!rejected&&<p className="employee-import-error">OTP expired – click Resend OTP.</p>}
  {error&&<p className="employee-import-error" role="alert">{error}</p>}{note&&<p className="employee-import-status">{note}</p>}
  <p className="help-text">Waiting for approval… this box updates automatically when the approver taps Approve.</p>
 </div></div>;
}

export function JoiningApproverMaster({grant}:{grant:string}){
 const[approvers,setApprovers]=useState(''),[enabled,setEnabled]=useState(false),[linked,setLinked]=useState<string[]>([]),[bot,setBot]=useState(''),[configured,setConfigured]=useState(true),[canWrite,setCanWrite]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[error,setError]=useState('');
 async function load(){try{const r=await api<{approvers:string;enabled:boolean;linked:string[];botUsername:string;configured:boolean;canWrite:boolean}>(grant,'telegram/joining-approvers');setApprovers(r.approvers);setEnabled(r.enabled);setLinked(r.linked);setBot(r.botUsername);setConfigured(r.configured);setCanWrite(r.canWrite);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 const list=approvers.split(',').map(a=>a.trim().toLowerCase()).filter(Boolean);
 return <section className="data-card" aria-label="Joining approval"><h2>Joining approval – OTP on Telegram</h2>
  <p className="help-text">When HR clicks <b>Save &amp; Continue</b> on Joining &amp; Personal Details, the approvers below get a Telegram message with the candidate's details, a 6-digit OTP and <b>Approve / Reject</b> buttons. The form moves to Educational Details only after the OTP is entered or Approve is tapped.</p>
  {!configured&&<p className="error">The HR Pulse leave bot (TELEGRAM_BOT_TOKEN) is not configured on the server.</p>}
  {error&&<p className="error" role="alert">{error}</p>}{msg&&<p role="status">{msg}</p>}
  <form onSubmit={e=>{e.preventDefault();setBusy(true);setMsg('');void api(grant,'telegram/joining-approvers','POST',{approvers,enabled}).then(()=>{setMsg('Joining approvers saved.');return load();}).catch(err=>setError((err as Error).message)).finally(()=>setBusy(false));}}>
   <div className="record-form">
    <label>Approvers — comma-separated Pulse usernames (any one can approve)<input required value={approvers} onChange={e=>setApprovers(e.target.value)} placeholder="e.g. roushni, apurvakopulwar"/></label>
    <label>Require approval on Save &amp; Continue<select value={String(enabled)} onChange={e=>setEnabled(e.target.value==='true')}><option value="false">No — step moves on directly</option><option value="true">Yes — OTP / Approve needed</option></select></label>
   </div>
   <button className="primary" disabled={busy||!canWrite}>Save joining approvers</button>
  </form>
  {list.length>0&&<p className="help-text">Telegram status: {list.map(a=><span key={a} style={{marginRight:10}}>{a} – {linked.includes(a)?'connected ✓':`not connected (open @${bot||'the HR Pulse bot'} → Start via Telegram Hierarchy → Connect)`}</span>)}</p>}
  {!canWrite&&<p className="help-text">Editing needs Approval Management permission.</p>}
 </section>;
}
