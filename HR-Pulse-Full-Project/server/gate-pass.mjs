import {odApprovalWorkflow} from './out-duty.mjs';

/* Gate pass (employee out-pass) route: HOD (concerned) → Gate out → Back in.
   HOD comes from the site's OD flow (Approval Master › OD). Gate out / Back in are recorded by the
   site's gate security usernames from the same flow; until those are set, Regional HR records them. */
const users=v=>String(v||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);

export const gatePassTypes=['Personal','Official duty','Medical'];

export function gatePassWorkflow(flow,department=''){
  const hod=odApprovalWorkflow(flow,department).data.steps[0];
  const security=users(flow?.gateSecurity).length?users(flow.gateSecurity):users(flow?.regionalHr).length?users(flow.regionalHr):['mayuriumate'];
  return {id:null,data:{steps:[{...hod,stage:1},{stage:2,label:'Gate out — security records the out time',approvers:security},{stage:3,label:'Back in — security records the return time',approvers:security}]}};
}

export function validateGatePass(data){
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if(data.outTime&&data.returnTime&&data.returnTime<=data.outTime)fail('Expected return must be after the out time');
}
