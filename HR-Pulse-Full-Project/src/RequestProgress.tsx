import type {ReactNode} from 'react';
import {Check,X} from 'lucide-react';
import type {Lookup,RecordRow} from './api';
import './requestProgress.css';

export type RequestProgressData={state:string;stage:number;steps:{label:string;at?:string}[]};
type StepState='done'|'current'|'rejected'|'todo';
type ViewStep={label:string;state:StepState;at?:string};

// Approval progress of one leave, OD or gate pass request: Submitted, then every approval step of its workflow.
export function progressView(status:string,progress?:RequestProgressData|null):{steps:ViewStep[];summary:string;tone:string}{
  if(status==='DRAFT'||!progress?.steps?.length){
    const summary=status==='CANCELLED'?'Cancelled':status==='DRAFT'?'Draft · not submitted':status==='APPROVED'||status==='ACTIVE'?'Approved':status==='REJECTED'?'Rejected':'Waiting for approval';
    const state:StepState=status==='DRAFT'?'current':status==='CANCELLED'?'todo':'done';
    return {steps:[{label:'Submitted',state}],summary,tone:status.toLowerCase()};
  }
  const stage=Math.max(0,Math.min(progress.stage,progress.steps.length)),approval=progress.state;
  const steps=progress.steps.map((s,i):ViewStep=>({label:s.label,at:s.at,state:approval==='APPROVED'||i<stage&&!(approval==='REJECTED'&&i===stage-1)?'done':approval==='REJECTED'&&i===stage-1?'rejected':approval==='PENDING'&&i===stage?'current':'todo'}));
  const total=steps.length+1,current=stage+2;
  const summary=approval==='APPROVED'?'Approved':approval==='REJECTED'?`Rejected at ${steps[stage-1]?.label||'approval'}`:approval==='PENDING'?`Pending · step ${current} of ${total}`:status==='CANCELLED'||approval==='CANCELLED'?'Cancelled':approval;
  return {steps:[{label:'Submitted',state:status==='CANCELLED'?'todo':'done'},...steps],summary,tone:(status==='CANCELLED'?'cancelled':approval).toLowerCase()};
}

const time=(at?:string)=>at?new Date(at).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',hour12:false}):'';

export function ProgressSteps({steps}:{steps:ViewStep[]}){
  return <ol className="rp-steps">{steps.map((s,i)=><li key={i} className={'rp-'+s.state} title={s.label}><span className="rp-dot" aria-hidden="true">{s.state==='done'?<Check/>:s.state==='rejected'?<X/>:i+1}</span><span className="rp-label">{s.label}</span>{s.at&&s.state==='done'&&<small className="rp-time">{time(s.at)}</small>}</li>)}</ol>;
}

export default function RequestProgress({status,progress}:{status:string;progress?:RequestProgressData|null}){
  const view=progressView(status,progress);
  return <div className="request-progress" aria-label={`Approval progress: ${view.summary}`}>
    <span className={'request-progress-summary tone-'+view.tone}>{view.summary}</span>
    <ProgressSteps steps={view.steps}/>
  </div>;
}

const day=(v:unknown)=>{const s=String(v||'');return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4):s;};

// One line describing a request: who, when and what.
export function requestSummary(kind:string,row:RecordRow,byId:Map<string,Lookup>){
  const d=row.data,emp=byId.get(String(d.employeeId||'')),who=[emp?.code,String(d.employeeName||d.name||emp?.name||'')].filter(Boolean).join(' · ');
  if(kind==='leaveRequests'){const days=Number(d.days)||0;return {who,details:[`${day(d.fromDate)} → ${day(d.toDate)}`,days?`${days} day${days===1?'':'s'}`:'',byId.get(String(d.leaveTypeId||''))?.name||''].filter(Boolean)};}
  if(kind==='employeeTransfers'){const site=(id:unknown)=>byId.get(String(id||''))?.name||'';return {who:[String(d.empCode||emp?.code||''),String(d.employeeName||emp?.name||'')].filter(Boolean).join(' · '),details:[day(d.transferDate),[site(d.fromSiteId),site(d.toSiteId)].filter(Boolean).join(' → '),String(d.toDesignation||''),row.code].filter(Boolean)};}
  /* VTC: who, dates, course, institute and status; an approved request Pulse-II has not taken yet says so. */
  if(kind==='vtcRequests'){const pulse=(d.pulse as unknown as {state?:string;error?:string}|undefined)||{};return {who:[String(d.empCode||''),String(d.name||'')].filter(Boolean).join(' · '),details:[`${day(d.fromDate)} → ${day(d.toDate)}`,String(d.course==='Other'?d.courseOther||'Other':d.course||''),String(d.institute||''),String(d.vtcStatus||''),row.code,row.status==='APPROVED'&&pulse.state!=='sent'?`Not yet in Pulse-II${pulse.error?': '+pulse.error:''}`:''].filter(Boolean)};}
  if(kind==='outDutyRequests')return {who:[row.code,String(d.name||'')].filter(Boolean).join(' · '),details:[`${day(d.outDutyDate)} → ${day(d.toDate)}`,String(d.visitLocation||'')].filter(Boolean)};
  return {who:[row.code,String(d.name||'')].filter(Boolean).join(' · '),details:[day(d.passDate),`Out ${d.outTime||'—'} → back ${d.returnTime||'—'}`,String(d.passType||'')].filter(Boolean)};
}

// Requests drawn as cards, each with its approval step bar.
export function RequestCards({kind,rows,byId,actions}:{kind:string;rows:RecordRow[];byId:Map<string,Lookup>;actions:(row:RecordRow)=>ReactNode}){
  return <div className="request-cards">{rows.map(row=>{const v=progressView(row.status,row.progress),s=requestSummary(kind,row,byId);return <article key={row.id} className="request-card" aria-label={`${s.who}: ${v.summary}`}>
    <div className="request-card-top"><p><b>{s.who||row.code}</b>{s.details.map((x,i)=><span key={i}> · {x}</span>)}</p><span className={'request-progress-summary tone-'+v.tone}>{v.summary}</span></div>
    {row.data.__importDraft==='true'&&<small className="rfs-error">Needs review: {String(row.data.__importIssue)}</small>}
    <ProgressSteps steps={v.steps}/>
    <div className="request-card-actions row-actions">{actions(row)}</div>
  </article>;})}
  {rows.length>0&&<p className="request-legend">Green = done · purple ring = waiting here · red = rejected · grey = not reached</p>}</div>;
}

type ApprovalStepRow={stage:number;label:string;approvers:string[]};
export type ApprovalRow={id:string;code:string;name:string;kind:string;data:Record<string,unknown>;state:string;stage:number;approvers:string[];requested_by:string;approval_steps?:ApprovalStepRow[];history:{stage:number;decision:string;at:string;actor:string}[]};

const shortLabel=(label:string)=>String(label||'Approval').split(/\s+[—–-]\s+/)[0].trim()||'Approval';
const approvalSteps=(a:ApprovalRow):ApprovalStepRow[]=>a.approval_steps?.length?a.approval_steps:a.approvers.map(x=>({stage:1,label:'Approval',approvers:[x]}));

// The decision button's wording: gate security records the out and return times instead of "approving".
export function approvalActionLabel(a?:{kind:string;stage:number}|null){return a?.kind==='gatePasses'&&a.stage===1?'Record gate out':a?.kind==='gatePasses'&&a.stage===2?'Record back in':'Approve';}

// Approval progress of an approval row, with the time each step was approved.
export function approvalProgress(a:ApprovalRow):RequestProgressData{
  const history=[...(a.history||[])].reverse();
  return {state:a.state,stage:a.stage,steps:approvalSteps(a).map((s,i)=>{const at=history.find(h=>Number(h.stage)===i+1&&h.decision==='APPROVED')?.at;return at?{label:shortLabel(s.label),at}:{label:shortLabel(s.label)};})};
}

// Gate pass approvals drawn as cards with a step bar; the cards waiting for this user come first and stand out.
export function ApprovalCards({rows,actor,onReview}:{rows:ApprovalRow[];actor:string;onReview:(row:ApprovalRow)=>void}){
  const mine=(a:ApprovalRow)=>a.state==='PENDING'&&a.requested_by!==actor&&!!approvalSteps(a)[a.stage]?.approvers.includes(actor);
  const sorted=[...rows].sort((a,b)=>Number(mine(b))-Number(mine(a)));
  return <div className="request-cards">{sorted.map(a=>{
    const v=progressView(a.state==='PENDING'?'PENDING':a.state,approvalProgress(a)),d=a.data||{},waiting=approvalSteps(a)[a.stage],own=mine(a);
    const details=[day(d.passDate),`Out ${d.outTime||'—'} → back ${d.returnTime||'—'}`,String(d.passType||'')].filter(Boolean);
    return <article key={a.id} className={'request-card'+(own?' request-card-mine':'')} aria-label={`${a.code}: ${v.summary}`}>
      <div className="request-card-top"><p><b>{[a.code,a.name].filter(Boolean).join(' · ')}</b>{details.map((x,i)=><span key={i}> · {x}</span>)}</p><span className={'request-progress-summary tone-'+v.tone}>{v.summary}</span></div>
      {d.purpose?<p className="request-card-purpose">{String(d.purpose)}</p>:null}
      <ProgressSteps steps={v.steps}/>
      <div className="request-card-actions row-actions">
        {a.state==='PENDING'&&!own&&waiting&&<span className="request-card-waiting">Waiting for {waiting.approvers.join(' / ')}</span>}
        <button className={own?'primary':''} onClick={()=>onReview(a)}>{own?approvalActionLabel(a):'Review'}</button>
      </div>
    </article>;})}
    <p className="request-legend">Green = done · purple ring = waiting here · red = rejected · grey = not reached</p>
  </div>;
}
