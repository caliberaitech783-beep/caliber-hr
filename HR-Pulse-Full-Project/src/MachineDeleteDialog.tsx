import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Send,ShieldCheck,Trash2} from 'lucide-react';
import {api} from './api';
import type {Machine} from './BiometricMachines';

/* Delete a biometric machine (owner, 23 Nov 2026): nothing is deleted until an approver taps
   "Approve delete" on Telegram, or the requester enters the OTP sent with it (server/machine-delete.mjs). */
export type DeleteRequest={code:string;serial:string;status:'PENDING'|'APPROVED'|'REJECTED'|'CANCELLED'|'EXPIRED'|'GONE';expires:string;approvers:string[];
 attemptsLeft:number;decidedBy:string;decidedAt:string|null;via:string};
/** How often the window asks whether the approver has answered on Telegram. */
export const DELETE_POLL_MS=3000;
export const timeLeft=(expires:string,now=Date.now())=>{const s=Math.max(0,Math.round((Date.parse(expires)-now)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

type Props={grant:string;machine:Machine;onClose:()=>void;onDeleted:(message:string)=>void};

export default function MachineDeleteDialog({grant,machine,onClose,onDeleted}:Props){
 const [request,setRequest]=useState<DeleteRequest|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[otp,setOtp]=useState(''),[now,setNow]=useState(Date.now());
 const done=useRef(false);
 const pending=request?.status==='PENDING'&&Date.parse(request.expires)>now;

 function settle(next:DeleteRequest){
  setRequest(next);
  if(next.status==='APPROVED'&&!done.current){done.current=true;
   onDeleted(`Machine ${machine.serial} deleted — ${next.via==='otp'?'approved by OTP':`approved by ${next.decidedBy} on Telegram`}.`);}
 }
 /* While waiting: ask the server every few seconds whether the approver tapped Approve / Reject. */
 useEffect(()=>{
  if(!request||request.status!=='PENDING')return;
  const tick=setInterval(()=>setNow(Date.now()),1000);
  const poll=setInterval(()=>{void api<DeleteRequest>(grant,`attendance/devices/delete/${request.code}`).then(settle).catch(()=>{/* next poll */});},DELETE_POLL_MS);
  return ()=>{clearInterval(tick);clearInterval(poll);};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[request?.code,request?.status]);

 async function send(){
  if(busy)return;setBusy(true);setError('');setOtp('');
  try{const next=await api<DeleteRequest>(grant,'attendance/devices/delete','POST',{serial:machine.serial});setNow(Date.now());settle(next);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function confirm(event:FormEvent){
  event.preventDefault();if(busy||!request)return;setBusy(true);setError('');
  try{settle(await api<DeleteRequest>(grant,`attendance/devices/delete/${request.code}`,'POST',{otp}));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function close(){
  if(pending&&request)try{await api(grant,`attendance/devices/delete/${request.code}`,'POST',{cancel:true});}catch{/* it lapses by itself */}
  onClose();
 }

 const who=request?.approvers.join(' / ')||'the approver';
 const rows:[string,string][]=[['Site',machine.siteName||'Not assigned'],['Machine location',machine.location||'—'],['Machine name',machine.name||'—'],
  ['Serial no.',machine.serial],['IP address',machine.ipAddress||'—'],['Bridge PC',machine.bridgeName||'Not connected yet']];
 return <div className="modal-backdrop"><section className="modal machine-delete-modal" role="dialog" aria-modal="true" aria-labelledby="machine-delete-title">
  <div className="modal-heading"><h2 id="machine-delete-title"><Trash2/>Delete machine {machine.serial}?</h2><button aria-label="Close" disabled={busy} onClick={()=>void close()}>×</button></div>
  <dl className="machine-delete-details">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd className={k==='Serial no.'||k==='IP address'?'machine-serial':''}>{v}</dd></div>)}</dl>
  {!request&&<>
   <p className="help-text">The machine is deleted only after approval on Telegram. Its punches already saved are kept.</p>
   <div className="machine-delete-actions"><button type="button" onClick={()=>void close()} disabled={busy}>Cancel</button>
    <button type="button" className="danger" onClick={()=>void send()} disabled={busy}><Send/>{busy?'Sending…':'Send for approval on Telegram'}</button></div>
  </>}
  {request&&pending&&<>
   <p className="machine-delete-wait" role="status"><span className="machine-delete-dot"/>Waiting for <strong>{who}</strong> to approve on Telegram · expires in <strong>{timeLeft(request.expires,now)}</strong></p>
   <form className="machine-delete-otp" aria-label="Delete with OTP" onSubmit={e=>void confirm(e)}>
    <label>Or enter the OTP {who} tells you<input value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit OTP" maxLength={6} disabled={busy}/></label>
    <button className="danger" disabled={busy||otp.length!==6}><ShieldCheck/>{busy?'Checking…':'Delete with OTP'}</button>
   </form>
   <div className="machine-delete-actions"><button type="button" onClick={()=>void close()} disabled={busy}>Cancel request</button></div>
  </>}
  {request&&!pending&&<>
   <p className={'machine-delete-result '+(request.status==='APPROVED'?'ok':'stop')} role="status">{
    request.status==='APPROVED'?`Deleted — ${request.via==='otp'?'approved by OTP':`approved by ${request.decidedBy} on Telegram`}.`
    :request.status==='REJECTED'?`Rejected by ${request.decidedBy} on Telegram. The machine stays.`
    :request.status==='GONE'?'This machine was already removed.'
    :request.status==='CANCELLED'?'This request was cancelled. Nothing was deleted.'
    :'The request expired. Nothing was deleted.'}</p>
   <div className="machine-delete-actions">
    {['REJECTED','EXPIRED','CANCELLED'].includes(request.status)||request.status==='PENDING'?<button type="button" onClick={()=>void send()} disabled={busy}><Send/>Send again</button>:null}
    <button type="button" className="primary" onClick={onClose}>Close</button></div>
  </>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section></div>;
}
