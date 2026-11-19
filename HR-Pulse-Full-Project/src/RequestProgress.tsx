import {Check,X} from 'lucide-react';
import './requestProgress.css';

export type RequestProgressData={state:string;stage:number;steps:{label:string}[]};
type StepState='done'|'current'|'rejected'|'todo';

// Approval progress of one leave or OD request: Submitted, then every approval step of its workflow.
export function progressView(status:string,progress?:RequestProgressData|null):{steps:{label:string;state:StepState}[];summary:string;tone:string}{
  if(status==='DRAFT'||!progress?.steps?.length){
    const summary=status==='CANCELLED'?'Cancelled':status==='DRAFT'?'Draft · not submitted':status==='APPROVED'||status==='ACTIVE'?'Approved':status==='REJECTED'?'Rejected':'Waiting for approval';
    const state:StepState=status==='DRAFT'?'current':status==='CANCELLED'?'todo':'done';
    return {steps:[{label:'Submitted',state}],summary,tone:status.toLowerCase()};
  }
  const stage=Math.max(0,Math.min(progress.stage,progress.steps.length)),approval=progress.state;
  const steps=progress.steps.map((s,i):{label:string;state:StepState}=>({label:s.label,state:approval==='APPROVED'||i<stage&&!(approval==='REJECTED'&&i===stage-1)?'done':approval==='REJECTED'&&i===stage-1?'rejected':approval==='PENDING'&&i===stage?'current':'todo'}));
  const total=steps.length;
  const summary=approval==='APPROVED'?'Approved':approval==='REJECTED'?`Rejected at ${steps[stage-1]?.label||'approval'}`:approval==='PENDING'?`Waiting: ${steps[stage]?.label||'approval'} · ${stage+1} of ${total}`:status==='CANCELLED'||approval==='CANCELLED'?'Cancelled':approval;
  return {steps:[{label:'Submitted',state:status==='CANCELLED'?'todo':'done'},...steps],summary,tone:(status==='CANCELLED'?'cancelled':approval).toLowerCase()};
}

export default function RequestProgress({status,progress}:{status:string;progress?:RequestProgressData|null}){
  const view=progressView(status,progress);
  return <div className="request-progress" aria-label={`Approval progress: ${view.summary}`}>
    <span className={'request-progress-summary tone-'+view.tone}>{view.summary}</span>
    <ol>{view.steps.map((s,i)=><li key={i} className={'rp-'+s.state} title={s.label}><span className="rp-dot" aria-hidden="true">{s.state==='done'?<Check/>:s.state==='rejected'?<X/>:i+1}</span><span className="rp-label">{s.label}</span></li>)}</ol>
  </div>;
}
