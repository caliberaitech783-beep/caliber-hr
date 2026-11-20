import {useEffect,useState} from 'react';
import {api} from './api';
import './addition-popup.css';

/* Owner, 20 Nov 2026: whoever's turn it is on an employee addition (Site HR → PM / HOD → Office HR → Regional HR →
   Directors) gets this pop-up when they open Caliber HR, can Approve / Reject here, and is offered the
   @NagpurEmployeeAdditionBot link so the same request reaches them on Telegram with buttons. */
type Step={stage:number;label:string;approvers:string[]};
export type AdditionApproval={id:string;code:string;name:string;kind:string;state:string;stage:number;version:number;approvers:string[];requested_by:string;approval_steps?:Step[];designation?:string;data:Record<string,unknown>};
type BotState={connected:boolean;configured:boolean;botUsername:string;issue?:string};
const POLL_MS=120_000;
export const roleTitle=(label='')=>label==='HR Manager'?'Site HR':label==='Project Manager'?'PM / HOD':/^Office HR/.test(label)?'Office HR':label==='HR Manager — either one'?'Regional HR':label==='Final approval — any one'?'Directors (final)':label.replace(/ — .*/,'');
const stepsOf=(row:AdditionApproval):Step[]=>row.approval_steps?.length?row.approval_steps:row.approvers.map(actor=>({stage:1,label:'Approval',approvers:[actor]}));
export const myTurn=(row:AdditionApproval,actor:string)=>row.kind==='employees'&&row.state==='PENDING'&&row.requested_by!==actor&&!!stepsOf(row)[row.stage]?.approvers.includes(actor);
const site=(row:AdditionApproval)=>String(row.data?.siteId||'').replace(/^[^·]*·\s*/,'')||'—';
const seenKey='hr-addition-popup-seen';
const readSeen=():string[]=>{try{return JSON.parse(sessionStorage.getItem(seenKey)||'[]');}catch{return [];}};
const writeSeen=(ids:string[])=>{try{sessionStorage.setItem(seenKey,JSON.stringify(ids));}catch{/* private window */}};

export default function AdditionApprovalPopup({grant,actor,onOpenApprovals}:{grant:string;actor:string;onOpenApprovals?:()=>void}){
 const[rows,setRows]=useState<AdditionApproval[]>([]),[open,setOpen]=useState(false),[bot,setBot]=useState<BotState|null>(null);
 const[reason,setReason]=useState<Record<string,string>>({}),[rejecting,setRejecting]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[done,setDone]=useState('');
 async function load(){
  if(!actor)return;
  try{
   const all=await api<AdditionApproval[]>(grant,'approvals');
   const mine=all.filter(row=>myTurn(row,actor));setRows(mine);
   const seen=readSeen();if(mine.some(row=>!seen.includes(`${row.id}:${row.stage}`)))setOpen(true);
  }catch{/* no Approval Management access: nothing to show */}
 }
 useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),POLL_MS);return()=>window.clearInterval(timer);},[grant,actor]);
 useEffect(()=>{if(open&&!bot)void api<BotState>(grant,'telegram/addition-bot').then(setBot).catch(()=>{});},[open]);
 function later(){writeSeen([...new Set([...readSeen(),...rows.map(row=>`${row.id}:${row.stage}`)])]);setOpen(false);}
 async function decide(row:AdditionApproval,decision:'APPROVED'|'REJECTED'){
  const comments=(reason[row.id]||'').trim();
  if(decision==='REJECTED'&&!comments){setRejecting(row.id);setError('Write the reason for rejecting, then press Reject again.');return;}
  setBusy(row.id);setError('');
  try{
   await api(grant,`approvals/${row.id}/decision`,'POST',{version:row.version,decision,comments});
   const steps=stepsOf(row),next=steps[row.stage+1];
   setDone(decision==='REJECTED'?`${row.name}: rejected, sent back to Site HR.`:next?`${row.name}: approved, sent to ${roleTitle(next.label)}.`:`${row.name}: final approval given, employee is now Active.`);
   setRejecting('');await load();
  }catch(e){setError((e as Error).message);}finally{setBusy('');}
 }
 async function connect(){try{const r=await api<{url:string}>(grant,'telegram/addition-connect','POST',{});window.open(r.url,'_blank','noopener');}catch(e){setError((e as Error).message);}}
 if(!rows.length&&!done)return null;
 if(!open)return rows.length?<button className="addition-popup-chip" onClick={()=>setOpen(true)}>👤 {rows.length} employee addition{rows.length===1?'':'s'} waiting for you</button>:null;
 return <div className="modal-backdrop"><section className="modal addition-popup" role="dialog" aria-modal="true" aria-labelledby="addition-popup-title">
  <div className="modal-heading"><h2 id="addition-popup-title">Employee addition — your approval{rows.length>1?` (${rows.length})`:''}</h2><button aria-label="Close" onClick={later}>×</button></div>
  {done&&<p className="addition-popup-done" role="status">{done}</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {!rows.length&&<p>Nothing else is waiting for you.</p>}
  {rows.map(row=>{const steps=stepsOf(row);return <article className="addition-popup-item" key={row.id}>
   <header><strong>{row.name}</strong><span>{row.code}</span></header>
   <p>{site(row)}{row.designation?` · ${row.designation}`:''} · initiated by {row.requested_by}</p>
   <ol className="addition-route" aria-label="Approval route">{steps.map((step,index)=><li key={index} className={index<row.stage?'done':index===row.stage?'current':''}>{roleTitle(step.label)}</li>)}</ol>
   <p className="addition-popup-step">Step {row.stage+1} of {steps.length}: <b>{roleTitle(steps[row.stage]?.label)}</b> (you){row.stage+1===steps.length?' — final approval makes the employee Active':''}</p>
   {rejecting===row.id&&<label>Reason for rejecting<textarea value={reason[row.id]||''} maxLength={2000} onChange={e=>setReason(r=>({...r,[row.id]:e.target.value}))}/></label>}
   <div className="addition-popup-actions"><button className="primary" disabled={!!busy} onClick={()=>void decide(row,'APPROVED')}>{busy===row.id?'Saving…':'✅ Approve'}</button><button disabled={!!busy} onClick={()=>rejecting===row.id?void decide(row,'REJECTED'):(setRejecting(row.id),setError(''))}>❌ Reject</button></div>
  </article>;})}
  <footer className="addition-popup-footer">
   {bot?.configured&&!bot.connected&&<button onClick={()=>void connect()}>Get these on Telegram (@{bot.botUsername})</button>}
   {bot?.connected&&bot.issue&&<small>Telegram: {bot.issue}</small>}
   {onOpenApprovals&&<button onClick={()=>{later();onOpenApprovals();}}>Open full form</button>}
   <button onClick={later}>Later</button>
  </footer>
 </section></div>;
}
