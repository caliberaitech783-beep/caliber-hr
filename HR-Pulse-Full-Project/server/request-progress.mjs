import {approvalSteps} from './joining-hierarchy.mjs';

export const progressKinds=['leaveRequests','outDutyRequests'];

// Short step name for the progress bar: "Directors — final approval (any one)" -> "Directors".
export const stepLabel=label=>String(label||'Approval').split(/\s+[—–-]\s+/)[0].trim()||'Approval';

// The approval progress of one request, from its latest hr_approvals row. Approver usernames are not exposed.
export function requestProgress(approval){
  if(!approval)return null;
  const steps=approvalSteps(approval).map(s=>({label:stepLabel(s.label)}));
  return {state:approval.state,stage:Number(approval.stage)||0,steps};
}

// Adds row.progress to each leave / OD request in a listing page.
export async function attachProgress(pool,kind,rows){
  if(!progressKinds.includes(kind)||!rows.length)return rows;
  const result=await pool.query('SELECT DISTINCT ON (record_id) record_id,state,stage,approval_steps,approvers FROM hr_approvals WHERE record_id=ANY($1::uuid[]) ORDER BY record_id,created_at DESC',[rows.map(r=>r.id)]);
  const latest=new Map(result.rows.map(a=>[String(a.record_id),a]));
  for(const row of rows)row.progress=requestProgress(latest.get(String(row.id)));
  return rows;
}
