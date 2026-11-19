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
