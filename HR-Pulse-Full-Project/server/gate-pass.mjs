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

/* Gate pass number: GP No.<serial>/<dd-mm-yyyy>/<Emp ID>, e.g. GP No.0001/20-11-2026/CMLL00012.
   The serial is one running count from 0001 that never resets; a pass keeps its serial when edited,
   while the date and Emp ID follow the saved values. */
export const gatePassCode=(serial,date,empCode)=>{const d=String(date||'');return `GP No.${String(serial).padStart(4,'0')}/${d.slice(8,10)}-${d.slice(5,7)}-${d.slice(0,4)}/${empCode||''}`;};
export const gatePassSerial=code=>{const m=/^GP No\.(\d+)\//.exec(String(code||''));return m?Number(m[1]):0;};
export async function nextGatePassCode(db,existingCode,passDate,employeeId){
  const empCode=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='employees'",[String(employeeId||'')])).rows[0]?.code||'';
  let serial=gatePassSerial(existingCode);
  if(!serial){
    await db.query("SELECT pg_advisory_xact_lock(hashtext('hr-gate-pass-serial'))");
    serial=Number((await db.query("SELECT COALESCE(MAX((substring(code from '^GP No\.([0-9]+)/'))::int),0)+1 AS next FROM hr_records WHERE kind='gatePasses'")).rows[0]?.next)||1;
  }
  return gatePassCode(serial,passDate,empCode);
}
