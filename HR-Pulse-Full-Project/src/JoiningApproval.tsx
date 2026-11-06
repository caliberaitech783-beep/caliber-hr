import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Send,X} from 'lucide-react';
import {api,savedSession} from './api';
import './trial-form.css';
/* Joining approval: when HR clicks Submit Employee on Document Checklist, an approval request with a 6-digit OTP
   goes to the configured approvers on Telegram (leave bot). The employee is saved when HR enters the OTP or the approver taps Approve. */
export type JoiningApprovalState={status:'APPROVED'|'PENDING'|'REJECTED'|'NONE';approvedBy?:string;approvedAt?:string};
type Status={required:boolean;status?:string;approvedBy?:string;approvedAt?:string;expires?:string;expired?:boolean;issues?:string[];approvers?:string[];connected?:string[];notConnected?:string[]};
const KEY='hrPulse.joiningApproval.';
export function loadJoiningApproval(draftId:string):JoiningApprovalState{try{return JSON.parse(localStorage.getItem(KEY+draftId)||'null')||{status:'NONE'};}catch{return {status:'NONE'};}}
export function saveJoiningApproval(draftId:string,state:JoiningApprovalState){try{localStorage.setItem(KEY+draftId,JSON.stringify(state));}catch{/* ignore */}}
export function clearJoiningApproval(draftId:string){try{localStorage.removeItem(KEY+draftId);}catch{/* ignore */}}
export async function joiningApprovalRequired():Promise<boolean>{const grant=savedSession()?.grant;if(!grant)return false;try{const r=await api<{enabled:boolean}>(grant,'telegram/joining-approvers');return !!r.enabled;}catch{return false;}}

export function JoiningApprovalGate({draftId,info,onApproved,onClose}:{draftId:string;info:{candidate:string;post:string;site:string;company:string};onApproved:(state:JoiningApprovalState)=>void;onClose:()=>void}){
 const[status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const done=useRef(false),otpRef=useRef<HTMLInputElement>(null);
 const readOtp=()=>(otpRef.current?.value||'').replace(/\D/g,'');
 const grant=()=>{const g=savedSession()?.grant;if(!g)throw new Error('Sign in again before requesting approval.');return g;};
 async function request(resend=false){setBusy(true);setError('');try{const r=await api<Status>(grant(),'telegram/joining-approval','POST',{draftId,...info});setStatus(r);if(!r.required){finish({status:'APPROVED',approvedBy:'Approval not required'});return;}if(r.status==='APPROVED'){finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});return;}setNote(resend?'New OTP sent.':'');if(otpRef.current)otpRef.current.value='';}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function finish(state:JoiningApprovalState){if(done.current)return;done.current=true;saveJoiningApproval(draftId,state);onApproved(state);}
 async function verify(){const otp=readOtp();if(otp.length!==6){setError('Enter the 6-digit OTP.');return;}setBusy(true);setError('');try{const r=await api<{status:string;approvedBy:string;approvedAt:string}>(grant(),'telegram/joining-approval/verify','POST',{draftId,otp});finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void request();},[]);
 useEffect(()=>{const t=setInterval(async()=>{if(done.current)return;try{const r=await api<Status>(grant(),'telegram/joining-approval/status','POST',{draftId});if(r.status==='APPROVED'){finish({status:'APPROVED',approvedBy:r.approvedBy,approvedAt:r.approvedAt});return;}setStatus(s=>({...(s||{required:true}),...r}));}catch{/* keep polling */}},5000);return()=>clearInterval(t);},[draftId]);
 const rejected=status?.status==='REJECTED',expired=!!status?.expired;
 const stop=(e:{stopPropagation:()=>void})=>e.stopPropagation();
 return createPortal(<div className="salary-ov" onClick={onClose}><div className="salary-md tf-tg ja-box" role="dialog" aria-label="Joining approval" onClick={stop} onInput={stop} onChange={stop} onKeyDown={stop}>
  <div className="salary-mh"><h4><Send/> Joining approval – Telegram</h4><button type="button" className="salary-x" aria-label="Close" onClick={onClose}><X/></button></div>
  <p>Approval request for <b>{info.candidate||'candidate'}</b>{info.post?` · ${info.post}`:''}{info.site?` · ${info.site}`:''} has been sent to {status?.approvers?.length?status.approvers.join(', '):'the approver'} on Telegram with a one-time OTP. The approver can tap <b>Approve</b> in Telegram, or tell you the OTP to enter below.</p>
  {status?.notConnected?.length?<p className="employee-import-error">Not connected to Telegram yet: {status.notConnected.join(', ')} – they must open the Joining Approval bot and tap Start (Approval Master → Joining Approval → Get connect link).</p>:null}
  {status?.issues?.length?<p className="employee-import-error">{status.issues.join(' · ')}</p>:null}
  {rejected?<p className="employee-import-error" role="alert">Rejected by {status?.approvedBy||'approver'}. Correct the details and click Submit Employee again to resend.</p>:
  <div className="ja-otp"><label>OTP<input ref={otpRef} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} defaultValue="" placeholder="6-digit OTP" onInput={e=>{const el=e.currentTarget;el.value=el.value.replace(/\D/g,'').slice(0,6);}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();void verify();}}}/></label>
   <button type="button" className="next" disabled={busy||expired} onClick={()=>void verify()}>Verify OTP</button>
   <button type="button" disabled={busy} onClick={()=>void request(true)}>Resend OTP</button></div>}
  {expired&&!rejected&&<p className="employee-import-error">OTP expired – click Resend OTP.</p>}
  {error&&<p className="employee-import-error" role="alert">{error}</p>}{note&&<p className="employee-import-status">{note}</p>}
  <p className="help-text">Waiting for approval… the employee is submitted automatically when the OTP is verified or the approver taps Approve.</p>
 </div></div>,document.body);
}

export function JoiningApproverMaster({grant}:{grant:string}){
 const[approvers,setApprovers]=useState(''),[enabled,setEnabled]=useState(false),[linked,setLinked]=useState<string[]>([]),[issues,setIssues]=useState<Record<string,string>>({}),[bot,setBot]=useState(''),[configured,setConfigured]=useState(true),[canWrite,setCanWrite]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[error,setError]=useState(''),[links,setLinks]=useState<Record<string,string>>({}),[diag,setDiag]=useState('');
 async function load(){try{const r=await api<{approvers:string;enabled:boolean;linked:string[];issues?:Record<string,string>;botUsername:string;configured:boolean;canWrite:boolean}>(grant,'telegram/joining-approvers');setApprovers(r.approvers);setEnabled(r.enabled);setLinked(r.linked);setIssues(r.issues||{});setBot(r.botUsername);setConfigured(r.configured);setCanWrite(r.canWrite);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 const list=approvers.split(',').map(a=>a.trim().toLowerCase()).filter(Boolean);
 async function connectLink(actor:string){setError('');try{const r=await api<{url:string}>(grant,'telegram/joining-connect','POST',{actor});setLinks(l=>({...l,[actor]:r.url}));}catch(e){setError((e as Error).message);}}
 async function checkBot(){setError('');setDiag('Checking…');try{const d=await api<{tokenSet:boolean;usernameSet:string;secretSet:boolean;me:{ok:boolean;result?:{username:string};description?:string}|null;webhook:{ok:boolean;result?:{url:string;pending_update_count:number;last_error_message?:string}}|null;registered:{ok?:boolean;description?:string}|null;outbox:{actor:string;state:string;attempts:number;last_error:string|null;sent_at:string|null}[]}>(grant,'telegram/joining-status');
  setDiag([`Token set: ${d.tokenSet?'yes':'NO'} · Username set: ${d.usernameSet||'NO'} · Webhook secret set: ${d.secretSet?'yes':'NO'}`,`Bot check (getMe): ${d.me?d.me.ok?'OK – @'+d.me.result?.username:'FAILED – '+d.me.description:'skipped (no token)'}`,`Webhook: ${d.webhook?.ok?(d.webhook.result?.url||'(none)')+' · pending '+d.webhook.result?.pending_update_count+(d.webhook.result?.last_error_message?' · last error: '+d.webhook.result.last_error_message:''):'unknown'}`,`Re-register: ${d.registered?.ok?'OK':d.registered?.description||'—'}`,'Recent joining messages:',...(d.outbox.length?d.outbox.map(o=>`  ${o.actor} – ${o.state}${o.sent_at?' (sent)':''}${o.last_error?' – '+o.last_error:''}`):['  none yet'])].join('\n'));await load();}catch(e){setDiag('');setError((e as Error).message);}}
 return <section className="data-card" aria-label="Joining approval"><h2>Joining approval – OTP on Telegram</h2>
  <p className="help-text">When HR clicks <b>Submit Employee</b> on Document Checklist, the approvers below get a message from the <b>Joining Approval bot</b>{bot?<> (@{bot})</>:null} with the candidate's details, a 6-digit OTP and <b>Approve / Reject</b> buttons. The employee is saved only after the OTP is entered or Approve is tapped.</p>
  {!configured&&<p className="error">The Joining Approval bot is not configured on the server – add TELEGRAM_JOINING_BOT_TOKEN, TELEGRAM_JOINING_BOT_USERNAME and TELEGRAM_JOINING_WEBHOOK_SECRET in Azure → App Service → Environment variables, then restart.</p>}
  {error&&<p className="error" role="alert">{error}</p>}{msg&&<p role="status">{msg}</p>}
  <form onSubmit={e=>{e.preventDefault();setBusy(true);setMsg('');void api(grant,'telegram/joining-approvers','POST',{approvers,enabled}).then(()=>{setMsg('Joining approvers saved.');return load();}).catch(err=>setError((err as Error).message)).finally(()=>setBusy(false));}}>
   <div className="record-form">
    <label>Approvers — comma-separated Pulse usernames (any one can approve)<input required value={approvers} onChange={e=>setApprovers(e.target.value)} placeholder="e.g. roushni, apurvakopulwar"/></label>
    <label>Require approval on Submit Employee<select value={String(enabled)} onChange={e=>setEnabled(e.target.value==='true')}><option value="false">No — employee saves directly</option><option value="true">Yes — OTP / Approve needed</option></select></label>
   </div>
   <button className="primary" disabled={busy||!canWrite}>Save joining approvers</button> <button type="button" disabled={!canWrite} onClick={()=>void checkBot()}>Check bot</button>
  </form>
  {diag&&<pre className="tf-diag">{diag}</pre>}
  {list.length>0&&<table className="tf-drafts-table"><thead><tr><th>Approver</th><th>Telegram</th><th>Connect</th></tr></thead><tbody>{list.map(a=><tr key={a}><td>{a}</td><td>{linked.includes(a)?'Connected ✓':'Not connected'}{issues[a]?<div className="employee-import-error">{issues[a]}</div>:null}</td><td>{links[a]?<a href={links[a]} target="_blank" rel="noreferrer">Open link / send to {a} → tap Start</a>:<button type="button" disabled={!configured} onClick={()=>void connectLink(a)}>Get connect link</button>}</td></tr>)}</tbody></table>}
  <p className="help-text">Each approver must open the Joining Approval bot once and tap <b>Start</b> (use the connect link above, or search @{bot||'the bot'} in Telegram) – otherwise Telegram does not allow the bot to message them. Approvers already connected for leave are still asked to tap Start on this bot once.{!canWrite&&' Editing needs Approval Management permission.'}</p>
 </section>;
}
