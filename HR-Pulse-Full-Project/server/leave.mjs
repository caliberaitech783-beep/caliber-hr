import {randomUUID} from 'node:crypto';
export function leaveApprovalSteps(workflow){
 const users=String(workflow?.data?.approvers||'').split(',').map(value=>value.trim().toLowerCase());
 if(users.length<2||users.some(value=>!/^[-a-z0-9_.@]{1,100}$/.test(value))||new Set(users).size!==users.length)
  throw Object.assign(new Error('Configure the site hierarchy or a leave workflow with the Region HR Head first and Director usernames next.'),{status:409});
 return [{stage:1,label:'RHR (Region HR Head)',approvers:[users[0]]},{stage:2,label:'Directors — final approval (any one)',approvers:users.slice(1)}];
}
const t=(key,label,required=false)=>({key,label,type:'text',required});
const n=(key,label,required=false)=>({key,label,type:'number',min:0,required});
const d=(key,label,required=false)=>({key,label,type:'date',required});
const r=(key,label,reference,required=false)=>({key,label,type:'reference',reference,required});
const s=(key,label,options,required=false)=>({key,label,type:'select',options,required});
const yn=(key,label,required=false)=>s(key,label,['Yes','No'],required);
const m=(title,fields,extra={})=>({title,menu:'Holiday & Leave',fields,...extra});
const base=[t('code','Code',true),t('name','Name',true)];
export const leaveModules={
 leaveTypes:m('Leave Types',[...base,t('description','Description'),s('isPaid','Paid',['Yes','No','Not configured'],true),n('maxDaysPerPeriod','Maximum days per period',true),n('carryForwardMax','Maximum carry forward'),yn('encashable','Encashable',true),n('requiresDocumentAfterDays','Document required after days')]),
 leavePeriods:m('Leave Periods',[...base,d('fromDate','From',true),d('toDate','To',true)]),
 leaveAllocations:m('Leave Allocation',[t('code','Allocation ID'),t('name','Description',true),r('employeeId','Employee','employees',true),r('leaveTypeId','Leave type','leaveTypes',true),r('periodId','Period','leavePeriods',true),n('allocated','Allocated days',true)],{autoCode:true}),
 leaveEncashments:m('Leave Encashment',[t('code','Request ID'),t('name','Reason',true),r('employeeId','Employee','employees',true),r('leaveTypeId','Leave type','leaveTypes',true),r('periodId','Period','leavePeriods',true),n('days','Days',true),t('approver','Approver Pulse username (optional; otherwise policy workflow)')],{autoCode:true}),
 leaveBlocks:m('Block List',[...base,d('fromDate','From',true),d('toDate','To',true),r('siteId','Location (blank = all)','sites'),r('departmentId','Department (blank = all)','departments'),t('reason','Reason',true)]),
};
export const requestFields=[t('code','Request ID'),d('fromDate','Date (from)',true),d('toDate','Date (to)',true),r('employeeId','Employee ID','employees',true),t('employeeName','Name'),r('companyId','Company','companies'),t('name','Reason (write-up)',true),{key:'reasonAudio',label:'Reason (audio, up to 500 KB)',type:'audio'},n('days','No. of Days'),{key:'attachment',label:'Attachment (optional; PDF, PNG or JPEG, up to 500 KB)',type:'attachment'},r('leaveTypeId','Leave type','leaveTypes'),r('policyId','Leave policy','leavePolicies',true),r('periodId','Period','leavePeriods'),yn('halfDay','Half day')];
export const policyFields=[...base,r('leaveTypeId','Leave type','leaveTypes'),n('annualDays','Annual entitlement (days)',true),r('companyId','Company','companies',true),r('departmentId','Applies to department (blank = all)','departments'),s('category','Applies to employment group',['Permanent','Contract','Trainee','Consultant']),s('accrual','Accrual rule',['Annual allocation','Monthly','Manual']),d('effectiveFrom','Effective from')];
export function prepareLeave(kind,input){
 if(kind==='leaveRequests'&&input.reasonAudio&&!String(input.name||'').trim())input={...input,name:'Audio reason'};
 if(['leaveAllocations','leaveEncashments','leaveRequests'].includes(kind)&&!input.code)input={...input,code:'LR-'+randomUUID().slice(0,18)};
 return input;
}
export function validateLeave(kind,data){
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 if(kind==='leaveTypes'){
  if(data.carryForwardMax!==''&&data.carryForwardMax>data.maxDaysPerPeriod)fail('Carry forward cannot exceed maximum days per period');
  if(data.requiresDocumentAfterDays!==''&&!Number.isInteger(data.requiresDocumentAfterDays))fail('Document threshold must be a whole number');
 }
 if(kind==='leaveEncashments'&&data.approver){if(!/^[-a-z0-9_.@]{1,100}$/i.test(data.approver))fail('Enter a valid Pulse approver username');data.approver=data.approver.toLowerCase();}
 if(kind==='leaveEncashments'&&data.days<=0)fail('Encashment days must be greater than zero');
 if(kind==='leaveRequests'){
  if(data.halfDay==='Yes'&&data.fromDate!==data.toDate)fail('Half-day leave must start and end on the same date');
  data.days=data.halfDay==='Yes'?0.5:(Date.parse(data.toDate)-Date.parse(data.fromDate))/86400000+1;
  if(data.approver&&!/^[-a-z0-9_.@]{1,100}$/i.test(data.approver))fail('Enter a valid Pulse approver username');
  data.approver=data.approver?.toLowerCase()||'';
 }
}
export const employeeLeaveKinds=['leaveRequests','leaveAllocations','leaveEncashments'];
export async function balance(db,employeeId,leaveTypeId,periodId,exclude='00000000-0000-0000-0000-000000000000'){
 const rows=(await db.query("SELECT kind,status,data FROM hr_records WHERE kind IN ('leaveAllocations','leaveRequests','leaveEncashments') AND data->>'employeeId'=$1 AND data->>'leaveTypeId'=$2 AND data->>'periodId'=$3 AND id<>$4",[employeeId,leaveTypeId,periodId,exclude])).rows;
 const allocated=rows.filter(x=>x.kind==='leaveAllocations'&&x.status==='ACTIVE'&&x.data.__importDraft!=='true').reduce((a,x)=>a+Number(x.data.allocated),0);
 const sum=status=>rows.filter(x=>x.kind!=='leaveAllocations'&&x.status===status).reduce((a,x)=>a+Number(x.data.days||0),0);
 const used=sum('APPROVED'),reserved=sum('PENDING');return {allocated,used,reserved,balance:allocated-used-reserved};
}
export async function checkLeave(db,kind,data,linked,id){
 const fail=message=>{throw Object.assign(new Error(message),{status:409});};
 if(employeeLeaveKinds.includes(kind))await db.query("SELECT id FROM hr_records WHERE id=$1 FOR UPDATE",[data.employeeId]);
 if(kind==='leaveAllocations'){
  const same=await db.query("SELECT id FROM hr_records WHERE kind='leaveAllocations' AND status='ACTIVE' AND COALESCE(data->>'__importDraft','')<>'true' AND data->>'employeeId'=$1 AND data->>'leaveTypeId'=$2 AND data->>'periodId'=$3 AND id<>$4",[data.employeeId,data.leaveTypeId,data.periodId,id||randomUUID()]);
  if(same.rowCount)fail('An allocation already exists for this employee, type and period. Edit it instead.');
  if(data.allocated>linked.leaveTypeId.data.maxDaysPerPeriod)fail('Allocation exceeds the leave type maximum');
  const b=await balance(db,data.employeeId,data.leaveTypeId,data.periodId);
  if(data.allocated<b.used+b.reserved)fail('Allocation cannot be below used and pending days');
 }
 if(kind==='leaveRequests'){
  const policy=linked.policyId?.data||{},employee=linked.employeeId?.data||{};
  if(policy.leaveTypeId&&policy.leaveTypeId!==data.leaveTypeId)fail('Select the leave type configured by this policy');
  if(data.leaveTypeId&&!data.periodId)fail('Select a leave period');
  if(data.periodId&&!data.leaveTypeId)fail('Select a leave type');
  if(policy.departmentId&&policy.departmentId!==employee.departmentId||policy.category&&policy.category!==employee.category)fail('This policy does not apply to the employee');
  if(policy.effectiveFrom&&data.fromDate<policy.effectiveFrom)fail('Leave starts before the policy effective date');
  if(linked.periodId&&(data.fromDate<linked.periodId.data.fromDate||data.toDate>linked.periodId.data.toDate))fail('Request dates must fall within the selected period');
  const blocks=(await db.query("SELECT data FROM hr_records WHERE kind='leaveBlocks' AND status='ACTIVE' AND data->>'fromDate'<=$1 AND data->>'toDate'>=$2",[data.toDate,data.fromDate])).rows;
  if(blocks.some(({data:b})=>(!b.siteId||b.siteId===employee.siteId)&&(!b.departmentId||b.departmentId===employee.departmentId)))fail('Requested dates overlap a blocked leave period');
  // Supporting attachments are optional for employee leave requests.
 }
 if(kind==='leaveEncashments'&&linked.leaveTypeId?.data.encashable!=='Yes')fail('This leave type cannot be encashed');
 if(['leaveRequests','leaveEncashments'].includes(kind)&&data.leaveTypeId&&data.periodId){
  const b=await balance(db,data.employeeId,data.leaveTypeId,data.periodId,id);
  if(data.days>b.balance)fail('Insufficient leave balance after pending requests');
 }
}
