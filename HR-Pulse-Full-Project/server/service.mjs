import {managementModules} from './management-modules.mjs';
import {createTelegram,telegramLeaveFlow,odSiteFlow,telegramSteps,queueTelegram,leaveMessage,employeeActor,queueLeaveStep,leaveBot} from './telegram.mjs';
import {leaveOtpMessage,LEAVE_OTP_MINUTES,LEAVE_OTP_ATTEMPTS} from './leave-request-bot.mjs';
import {odApprovalWorkflow} from './out-duty.mjs';
import {createTransferFlows,transferWorkflow,applyTransfer} from './employee-transfer-flow.mjs';
import {createAssets} from './assets.mjs';
import {payroll} from './payroll.mjs';
import {createAttendance} from './attendance.mjs';
import {officeStaffHierarchy} from './office-staff-routing.mjs';
import {createHierarchies,employeeHierarchy,approvalSteps,nextApproval,isDriverOperator} from './joining-hierarchy.mjs';
import {createHolidayDocuments,holidayAliases} from './holiday-documents.mjs';
import {createEmployeeDocuments} from './employee-documents.mjs';
import {createEmployeeMasterRegister} from './employee-master-register.mjs';
import {createReportingManagers} from './reporting-managers.mjs';
import {validateTrialJoining} from './trial-joining.mjs';
import {requireTrialRole} from './trial-access.mjs';
import {isProjectManager,PM_EMPLOYEE_WRITE_ERROR} from './pm-access.mjs';
import {missingJoiningField, requiredEmployeeDetail, siteProjectMismatch, underageBirthDate} from './joining-required.mjs';
import {importWithDrafts,resolveImportReferences} from './import-drafts.mjs';
import {createDeletion} from './deletion.mjs';
import {balance,checkLeave,employeeLeaveKinds,leaveApprovalSteps} from './leave.mjs';
import {attachProgress,stepLabel} from './request-progress.mjs';
import {gatePassWorkflow} from './gate-pass.mjs';
import {nextRequestCode} from './request-number.mjs';
import { randomUUID,randomInt,createHash } from 'node:crypto';
import { complianceKinds, modules, grantedMenus, canRead, canWrite, validate } from './modules.mjs';
import {assignedSites,siteIds,scopeSql} from './scope.mjs';
import {createTelegramNotifier} from './telegram-notifications.mjs';
import {initiatedSteps} from './site-staff-routing.mjs';
import {ADDITION_BOT,queueAdditionStep,parseAdditionCallback,additionActor} from './employee-addition-bot.mjs';
import {webhookSecretValid,botSecret,botToken,cmllHrEnabled,notSender,telegramUsers,additionBot} from './telegram.mjs';
import {employeeTrackSteps,missingTrackApprovers,otpEnterers,isEmployeeTrack,queueTrackStep,trackOtpMessage,trackMarkup,EMPLOYEE_TRACK_BOT} from './employee-track.mjs';
export function problem(message,status=400) { return Object.assign(new Error(message),{status}); }
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const employeeDetailFields={
  'Full Name *':'name','Mobile *':'mobile','Candidate E-mail *':'email','Date of Birth':'dateOfBirth',
  'Joining Date *':'joiningDate','Employment Type':'category','Department *':'departmentId',
  'Designation *':'designationId',Grade:'gradeId','Shift *':'shiftId',
};
const employeeCategories=new Map([['fixed-term','Contract'],['fixed term','Contract'],['temporary','Contract'],...modules.employees.fields.find(field=>field.key==='category').options.map(value=>[value.toLowerCase(),value])]);
const lockedEmployeeDetails=new Set(['Employee Code','Site *','Status','Employment Status']);
export function createService(pool,{telegram=createTelegramNotifier()}={}) {
  const employeeDocuments=createEmployeeDocuments(pool);
  /* Approval lists. `mine` keeps only requests the user submitted or must approve; every list stays inside the
     user's Pulse sites. `filter` and `limit` are fixed strings and numbers from this file, never user input. */
  const approvalRows=async(profile,{mine,filter='',limit})=>{
    if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
    const sites=await siteIds(pool,profile),params=mine?[profile.actor,sites]:[sites];
    const where=[mine?'(a.approvers ? $1 OR a.requested_by=$1)':'',filter,scopeSql('r',mine?'$2':'$1')].filter(Boolean).join(' AND ');
    return (await pool.query("SELECT a.*,r.kind,a.record_snapshot->>'code' AS code,a.record_snapshot->>'name' AS name,a.record_snapshot->'data' AS data,(a.record_snapshot ? 'telegramFlow') AS telegram_flow,COALESCE(a.record_snapshot->'data'->'officeData'->>'Designation *',a.record_snapshot->'data'->>'designationTitle',(SELECT d.name FROM hr_records d WHERE d.kind='designations' AND d.id::text=a.record_snapshot->'data'->>'designationId')) AS designation FROM hr_approvals a JOIN hr_records r ON r.id=a.record_id WHERE "+where+" ORDER BY a.created_at DESC LIMIT "+Number(limit),params)).rows;
  };
  const audit = (db,actor,action,kind,id,detail={}) => db.query('INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,$3,$4,$5)',[actor,action,kind,id,detail]);
  async function transaction(fn) {
    const afterCommit=[];
    const db=await pool.connect();
    try { await db.query('BEGIN'); const result=await fn(db,effect=>afterCommit.push(effect)); await db.query('COMMIT');for(const effect of afterCommit)try{await effect();}catch(error){console.error('Post-commit notification failed',error instanceof Error?error.message:error);}return result; }
    catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  function authorize(profile,kind,write=false) {
    if (!modules[kind]) throw problem('Module not found',404);
    if (write&&kind==='employees'&&isProjectManager(profile)) throw problem(PM_EMPLOYEE_WRITE_ERROR,403);
    if (!(write?canWrite:canRead)(profile,kind)) throw problem('Your Pulse HR permissions do not allow this operation',403);
  }
  async function locationAccess(db,profile,kind,data,id){
    const ids=await siteIds(db,profile);if(ids===null)return;
    let site=data.siteId;
    if(kind==='holidays'&&site&&!ids.includes(site))site=(await db.query("SELECT id FROM hr_records WHERE kind='sites' AND (code=$1 OR name=$1)",[site])).rows.find(r=>ids.includes(r.id))?.id;
    if(kind==='sites')site=id;
    if(['assetEmployees','assetAllocationLog','assetExitClearances','employeeTransfers','outDutyRequests','gatePasses'].includes(kind)||employeeLeaveKinds.includes(kind))site=(await db.query("SELECT data->>'siteId' AS site FROM hr_records WHERE id=$1 AND kind='employees'",[data.employeeId])).rows[0]?.site;
    if(!Object.hasOwn(managementModules,kind)&&![...complianceKinds,'calendarEvents','assetEmployees','assetAllocationLog','assetExitClearances','assets','employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments','employeeTransfers','outDutyRequests','gatePasses'].includes(kind))throw problem('Global master changes require an account without a site restriction',403);
    if(!ids.includes(site))throw problem('This record is outside your assigned Pulse site',403);
  }
  async function references(db,kind,data,id) {
    const linked={};
    for (const field of modules[kind].fields.filter(x=>x.type==='reference')) {
      if (!data[field.key]) continue;
      if (!uuid(data[field.key])) throw problem(`${field.label}: choose an existing record`);
      if (data[field.key]===id) throw problem('A record cannot refer to itself');
      const found=await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind=$2 AND status IN ('ACTIVE','APPROVED')"+(kind==='leaveRequests'&&field.key==='employeeId'?' FOR UPDATE':field.reference==='leavePeriods'?' FOR SHARE':''),[data[field.key],field.reference]);
      if (!found.rowCount) throw problem(`${field.label} is not active`);
      if(Object.hasOwn(managementModules,kind) && field.reference!=='sites' && found.rows[0].data.siteId!==data.siteId)throw problem(field.label+' must belong to the selected site');
      linked[field.key]=found.rows[0];
    }
    for(const key of ['siteId','departmentId']) if(linked[key]?.data.companyId && data.companyId && linked[key].data.companyId!==data.companyId) throw problem('Site and department must belong to the selected company');
    if (linked.shiftId?.data.siteId && data.siteId && linked.shiftId.data.siteId!==data.siteId) throw problem('Shift must belong to the selected site');
    if (linked.designationId?.data.departmentId && data.departmentId && linked.designationId.data.departmentId!==data.departmentId)throw problem('Designation must belong to the selected department');
    if (linked.designationId?.data.gradeId && data.gradeId && linked.designationId.data.gradeId!==data.gradeId)throw problem('Grade must match the selected designation');
    if (linked.employeeId && linked.policyId && linked.employeeId.data.companyId!==linked.policyId.data.companyId) throw problem('Leave policy must belong to the employee company');
    if(kind==='leaveRequests'&&linked.employeeId){
      const employee=linked.employeeId;
      if(data.companyId&&data.companyId!==employee.data.companyId)throw problem('Company must match the selected employee');
      data.employeeName=employee.name;
      data.companyId=employee.data.companyId||'';
    }
    await checkLeave(db,kind,data,linked,id);
    if(kind==='leaveRequests') {
      const overlap=await db.query("SELECT 1 FROM hr_records WHERE kind='leaveRequests' AND status IN ('PENDING','APPROVED') AND data->>'employeeId'=$1 AND data->>'fromDate'<=$2 AND data->>'toDate'>=$3 AND id<>$4",[data.employeeId,data.toDate,data.fromDate,id||randomUUID()]);
      if(overlap.rowCount) throw problem('Employee already has overlapping pending or approved leave',409);
      const days=data.days??((Date.parse(data.toDate)-Date.parse(data.fromDate))/86400000+1);
      const year=data.fromDate.slice(0,4);
      if(!data.periodId&&year!==data.toDate.slice(0,4))throw problem('Split leave requests across calendar years');
      const used=await db.query("SELECT COALESCE(SUM(COALESCE((data->>'days')::numeric, (data->>'toDate')::date-(data->>'fromDate')::date+1)),0) AS days FROM hr_records WHERE kind='leaveRequests' AND status IN ('PENDING','APPROVED') AND data->>'employeeId'=$1 AND data->>'policyId'=$2 AND (CASE WHEN $5='' THEN left(data->>'fromDate',4)=$3 ELSE data->>'periodId'=$5 END) AND id<>$4",[data.employeeId,data.policyId,year,id||randomUUID(),data.periodId||'']);
      if(linked.policyId&&days+Number(used.rows[0].days)>Number(linked.policyId.data.annualDays))throw problem('Leave exceeds the configured annual entitlement');
    }
  }
  async function save(db,profile,kind,input,id) {
    authorize(profile,kind,true);
    let data; let existing;
    if(id){
      if(!uuid(id))throw problem('Invalid record ID');
      existing=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
      if(!existing)throw problem('Record not found',404);
      if(existing.version!==Number(input.version))throw problem('This record changed. Reload it before saving.',409);
      if(['leaveRequests','leaveEncashments','outDutyRequests','gatePasses'].includes(kind)&&['APPROVED','CANCELLED','INACTIVE'].includes(existing.status))throw problem('Finalized requests cannot be edited',409);
      if(kind==='leaveAllocations'&&existing.data.__importDraft!=='true'&&['employeeId','leaveTypeId','periodId'].some(key=>existing.data[key]!==input[key]))throw problem('Allocation employee, type and period cannot be changed. Create another allocation instead.',409);
      if(existing.status==='PENDING')throw problem('A record awaiting approval cannot be edited',409);
      if(!(existing.data.__importDraft==='true'&&existing.created_by===profile.actor))await locationAccess(db,profile,kind,existing.data,id);
    }
    if(existing?.data.__importDraft==='true')input=await resolveImportReferences(db,kind,input);
    if(kind==='outDutyRequests')input={...input,code:await nextRequestCode(db,kind,existing?.code,input)};
    if(kind==='gatePasses')input={...input,code:await nextRequestCode(db,kind,existing?.code,input)};
    data=validate(kind,input);
    await locationAccess(db,profile,kind,data,id);
    await references(db,kind,data,id);
    const status=['employeeTransfers','outDutyRequests','gatePasses'].includes(kind)?'DRAFT':kind==='holidays'?'PENDING':['employees','leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)?'DRAFT':'ACTIVE';
    let result;
    if(id) result=await db.query('UPDATE hr_records SET code=$1,name=$2,data=$3,status=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$6 RETURNING *',[data.code,data.name,data,status,profile.actor,id]);
    else result=await db.query('INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',[randomUUID(),kind,data.code,data.name,data,status,profile.actor]);
    const row=result.rows[0];
    await audit(db,profile.actor,id?'UPDATE':'CREATE',kind,row.id,{code:row.code,fields:Object.keys(data)});
    if(kind==='holidays'){
      const steps=[{stage:1,label:'HR Manager — holiday approval',approvers:['vinodpinjarkar']}];
      await db.query('INSERT INTO hr_approvals(id,record_id,approvers,requested_by,record_snapshot,approval_steps) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),row.id,JSON.stringify(['vinodpinjarkar']),profile.actor,{code:row.code,name:row.name,data:row.data},JSON.stringify(steps)]);
      await audit(db,profile.actor,'SUBMIT',kind,row.id,{approver:'vinodpinjarkar',stages:1});
    }
    return row;
  }
   /* The new employee route for a site (null when the site is outside every region): Site HR from the saved hierarchy,
      the region's fixed Regional HR (or the office's HR Manager) and the Directors by OTP. */
   async function employeeTrackRoute(db,siteId,officeRoute,hierarchy,requester){
        if(!siteId)return null;
        const code=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='sites'",[String(siteId)])).rows[0]?.code;
        if(!code)return null;
        const saved=officeRoute?(await db.query("SELECT data FROM hr_records WHERE kind='joiningHierarchies' AND code=$1",[code])).rows[0]?.data?.steps:hierarchy?.data?.steps;
        /* OB / COAL (owner, 21 Nov 2026): Site PM and Office HR must be set in Approval Master › Hierarchy. */
        const missing=missingTrackApprovers({code,steps:saved||[]});
        if(missing.length){const name=(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[String(siteId)])).rows[0]?.name||code;
         throw problem(`Set the ${missing.join(' and ')} for ${name} in Approval Master › Hierarchy and enable it, then submit again.`,409);}
        const steps=employeeTrackSteps({code,steps:saved||[],requester});
        return steps?.length?steps:null;
   }
   /* Directors' OTP (leave and new employees): a fresh 6-digit OTP goes to the Directors of the OTP step on that workflow's bot;
      whoever enters it (otpEnterers) hears it from a Director. 15 minutes, single use, five wrong tries. */
   const otpCode=id=>'LO-'+id,otpHash=(id,otp)=>createHash('sha256').update(otpCode(id)+':'+otp).digest('hex');
   async function issueDirectorsOtp(db,{approval,record,steps,stage,requester,siteName}){
        const code=otpCode(approval.id),old=(await db.query("SELECT data FROM hr_records WHERE kind='leaveOtps' AND code=$1 FOR UPDATE",[code])).rows[0]?.data;
        const otp=String(randomInt(100000,1000000)),expires=new Date(Date.now()+LEAVE_OTP_MINUTES*60000).toISOString(),resends=old?(old.resends||0)+1:0;
        const data={status:'PENDING',approvalId:approval.id,stage,otpHash:otpHash(approval.id,otp),expires,attempts:0,requestedBy:requester.actor,requestedAt:new Date().toISOString(),resends};
        await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'leaveOtps',$1,$2,$3,'PENDING',$4,$4) ON CONFLICT(kind,code) DO UPDATE SET data=$3,name=$2,status='PENDING',updated_by=$4,updated_at=now()",[code,"Directors' OTP – "+record.code,data,requester.actor]);
        const to=steps[stage].approvers.filter(notSender(requester.actor));
        if(record.kind==='employees')await queueTelegram(db,`employee-otp:${approval.id}:${resends}`,to,trackOtpMessage({record:approval.record_snapshot||record,siteName,otp,requestedBy:requester.name||requester.actor,minutes:LEAVE_OTP_MINUTES}),additionBot(),trackMarkup(approval.id,stage));
        else await queueTelegram(db,`leave-otp:${approval.id}:${resends}`,to,leaveOtpMessage({record,siteName,otp,requestedBy:requester.name||requester.actor}),leaveBot());
        await audit(db,requester.actor,record.kind==='employees'?'EMPLOYEE_OTP_REQUEST':'LEAVE_OTP_REQUEST',record.kind,record.id,{stage:stage+1,sentTo:to});
        return {status:'OTP_SENT',expires,sentTo:to};
   }
   const siteNameOf=async(db,approval,record)=>approval.record_snapshot?.telegramSiteName||(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[String(record.data?.siteId||'')])).rows[0]?.name||'';
   async function submitRecord(db,profile,kind,id,version,afterCommit){
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
        if(!record)throw problem('Record not found',404);
        if(record.data.__importDraft==='true')throw problem('Resolve the imported draft and save it before submitting',409);
        if(record.version!==Number(version)||!['DRAFT','REJECTED'].includes(record.status))throw problem('Reload the record; only drafts or rejected records can be submitted',409);
        await locationAccess(db,profile,kind,record.data,id);
        await references(db,kind,record.data,id);
        let companyId=record.data.companyId,siteId=record.data.siteId;
        let employeeDepartment='';
        if(['leaveRequests','leaveEncashments','outDutyRequests','gatePasses'].includes(kind)){const employee=(await db.query('SELECT data FROM hr_records WHERE id=$1',[record.data.employeeId])).rows[0];companyId=employee?.data.companyId;siteId=employee?.data.siteId;if(employee?.data.departmentId)employeeDepartment=(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='departments'",[String(employee.data.departmentId)])).rows[0]?.name||'';}
        const telegramFlow=kind==='leaveRequests'?await telegramLeaveFlow(db,siteId):null,odFlow=['outDutyRequests','gatePasses'].includes(kind)?await odSiteFlow(db,siteId):null,siteFlow=telegramFlow||odFlow;
        /* Site flow: only the site HR Manager raises leave / OD requests (on the employee's behalf). */
        if(kind!=='leaveRequests'&&siteFlow?.type==='site'&&siteFlow.hods&&siteFlow.hrManager&&siteFlow.hrManager!==profile.actor){const siteName=(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[siteId||''])).rows[0]?.name||'this site';throw problem(`${kind==='outDutyRequests'?'OD':kind==='gatePasses'?'Gate pass':'Leave'} requests at ${siteName} are raised by the site HR Manager (${siteFlow.hrManager}). Please contact them to submit this request.`,403);}
        /* Office staff (Nagpur office, Chandrapur HO): office HR initiates → that office's HR Manager → Directors (office-staff-routing.mjs). */
        const officeRoute=kind==='employees'?await officeStaffHierarchy(db,siteId,profile.actor):null;
        const hierarchy=officeRoute||(telegramFlow?{id:null,data:{steps:telegramSteps(telegramFlow,employeeDepartment,profile.actor)}}:kind==='outDutyRequests'?odApprovalWorkflow(odFlow,employeeDepartment):kind==='gatePasses'?gatePassWorkflow(odFlow,employeeDepartment):kind==='employeeTransfers'?await transferWorkflow(db,record.data.fromSiteId):['employees','leaveRequests'].includes(kind)?await employeeHierarchy(db,siteId,{optional:kind==='employees',driverOperator:kind!=='employees'||await (async()=>{const d=record.data||{};const names=[];for(const [k,kindName] of [['departmentId','departments'],['designationId','designations']])if(d[k])names.push((await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind=$2",[String(d[k]),kindName])).rows[0]?.name||'');const f=d.fields||d.officeData||{};names.push(f['Department'],f['Designation'],f['Employee Category'],d.department,d.designation,d.category);return isDriverOperator(names.filter(Boolean).join(' '));})()}):null);
        const rules=(await db.query("SELECT * FROM hr_records WHERE kind='approvalRules' AND status='ACTIVE' AND data->>'target'=$1 AND (COALESCE(data->>'companyId','')='' OR data->>'companyId'=$2) AND (COALESCE(data->>'siteId','')='' OR data->>'siteId'=$3)",[kind,companyId||'',siteId||''])).rows;
        const weight=r=>(r.data.companyId?1:0)+(r.data.siteId?2:0);rules.sort((a,b)=>weight(b)-weight(a));
        if(!hierarchy&&kind==='employeeTransfers')throw problem('Enable transfer routing and set the approvers in Approval Master › Employee Transfer before submitting',409);
        const trackSteps=kind==='employees'?await employeeTrackRoute(db,siteId,officeRoute,hierarchy,profile.actor):null;
        if(!hierarchy&&!trackSteps&&!rules.length&&(kind==='leaveRequests'||!record.data.approver))throw problem('Configure an active approval-matrix rule for this module before submitting',409);
        if(!hierarchy&&!trackSteps&&rules.length>1&&weight(rules[0])===weight(rules[1]))throw problem('Approval rules overlap. Resolve the approval matrix before submitting.',409);
        const workflow=hierarchy||(trackSteps?{id:null,data:{}}:null)||(!rules.length&&record.data.approver?{id:null,data:{approvers:record.data.approver}}:(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='workflows' AND status='ACTIVE'",[rules[0].data.workflowId])).rows[0]);
        if(!workflow)throw problem('The configured workflow is not active',409);
        /* New employees (owner, 21 Nov 2026): Site HR initiates → Site PM → Office HR (OB / COAL sites) → Regional HR → Directors (OTP), employee-track.mjs. */
        const steps=trackSteps?trackSteps:kind==='employees'&&hierarchy?initiatedSteps(hierarchy.data.steps,profile.actor):hierarchy?hierarchy.data.steps:kind==='leaveRequests'?leaveApprovalSteps(workflow):workflow.data.approvers.split(',').map(actor=>({stage:1,label:'Approval',approvers:[actor]}));
        const approvers=steps.flatMap(s=>s.approvers);
        if(approvers.includes(profile.actor))throw problem('The requester cannot be an approver in their own workflow. Configure another approver.',409);
        const telegramSiteName=telegramFlow?(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[siteId||''])).rows[0]?.name:null;
        const snapshot={code:record.code,name:record.name,data:{...record.data},...(telegramFlow?{telegramFlow,telegramSiteName}:{})};
        for(const field of modules[kind].fields.filter(x=>x.type==='reference'))if(record.data[field.key]){
          const ref=(await db.query('SELECT code,name FROM hr_records WHERE id=$1',[record.data[field.key]])).rows[0];
          if(ref)snapshot.data[field.key]=`${ref.code} · ${ref.name}`;
        }
        const approvalId=randomUUID();
        await db.query('INSERT INTO hr_approvals(id,record_id,approvers,requested_by,record_snapshot,approval_steps) VALUES($1,$2,$3,$4,$5,$6)',[approvalId,id,JSON.stringify(approvers),profile.actor,snapshot,JSON.stringify(steps)]);
        if(telegramFlow?.hods)await queueLeaveStep(db,{key:approvalId+':submitted',record,steps,stage:0,siteName:telegramSiteName,sender:profile.actor});
        else if(telegramFlow)await queueTelegram(db,approvalId+':submitted',cmllHrEnabled()?steps[0].approvers.flatMap(telegramUsers).filter(notSender(profile.actor)):telegramFlow.hods?[...steps[0].approvers,telegramFlow.hrManager]:[telegramFlow.siteHr,telegramFlow.regionalHr],leaveMessage(record,'SUBMITTED',{siteName:telegramSiteName,firstRole:telegramFlow.hods?steps[0].label.replace(/ — .*/,''):telegramFlow.firstRole}));
        await db.query("UPDATE hr_records SET status='PENDING',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2",[profile.actor,id]);
        await audit(db,profile.actor,'SUBMIT',kind,id,{workflowId:workflow.id,stages:steps.length});
        if(kind==='employees'){const siteName=(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[siteId||''])).rows[0]?.name||'';
          if(isEmployeeTrack(steps))await queueTrackStep(db,queueTelegram,additionBot(),{key:approvalId+':submitted',approvalId,record:snapshot,siteName,steps,stage:0,state:'SUBMITTED',requestedBy:profile.actor,sender:profile.actor});
          else await queueAdditionStep(db,queueTelegram,{approvalId,record:snapshot,siteName,steps,stage:0,state:'SUBMITTED',requestedBy:profile.actor,assignedOnly:cmllHrEnabled()});}
        return {status:'PENDING'};
  }
  const telegramBase=createTelegram(pool);
  return {...telegramBase,...createAssets(pool),...createAttendance(pool),...employeeDocuments,
    payroll:(profile,method,params,input)=>transaction(db=>payroll(db,profile,method,params,input)),
    ...createDeletion(pool),
    ...createHierarchies(pool),
    ...createTransferFlows(pool),
    ...createHolidayDocuments(pool),
    ...createEmployeeMasterRegister(pool),
    ...createReportingManagers(pool),
    async config(profile) { const scoped=assignedSites(profile)!==null;return {profile,modules:Object.fromEntries(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).map(([kind,config])=>[kind,{...config,canWrite:canWrite(profile,kind)&&(!scoped||Object.hasOwn(managementModules,kind)||[...complianceKinds,'employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments','outDutyRequests','gatePasses'].includes(kind))}]))}; },
    async list(profile,kind,params) {
      authorize(profile,kind);
      const page=Math.max(1,Math.min(10000,Number(params.get('page'))||1));
      const search=(params.get('search')||'').slice(0,150);const status=params.get('status')||'';
      let filter="r.kind=$1 AND ($2='' OR r.code ILIKE '%'||$2||'%' OR r.name ILIKE '%'||$2||'%' OR ($1='employees' AND COALESCE(r.data->'officeData'->>'Aadhaar No. *',r.data->'officeData'->>'Aadhaar No.','') ILIKE '%'||$2||'%')) AND ($3='' OR r.status=$3) AND "+scopeSql('r','$4','$5');
      const values=[kind,search,status,await siteIds(pool,profile),profile.actor];
      const filters=[['leaveTypeId',"r.data->>'leaveTypeId'"],['periodId',"r.data->>'periodId'"],['siteId',"r.data->>'siteId'"],['year',"left(r.data->>'date',4)"],['departmentId',"COALESCE(r.data->>'departmentId',(SELECT e.data->>'departmentId' FROM hr_records e WHERE e.id::text=r.data->>'employeeId'))"]];
      for(const [key,expression] of filters){const value=params.get(key);if(value){values.push(value);filter+=' AND '+expression+'=$'+values.length;}}
      if(kind==='holidays'&&(params.get('holidaySite')||params.get('holidayGroup'))){values.push(holidayAliases(params.get('holidaySite'),params.get('holidayGroup')).map(x=>x.toLowerCase()));filter+=" AND (lower(r.data->>'siteId')=ANY($"+values.length+") OR EXISTS(SELECT 1 FROM hr_records hs WHERE hs.kind='sites' AND hs.id::text=r.data->>'siteId' AND lower(hs.code)=ANY($"+values.length+")))";}
      if(params.get('fromDate')){values.push(params.get('fromDate'));filter+=" AND COALESCE(r.data->>'toDate',r.data->>'date') >= $"+values.length;}
      if(params.get('toDate')){values.push(params.get('toDate'));filter+=" AND COALESCE(r.data->>'fromDate',r.data->>'date') <= $"+values.length;}
      const count=await pool.query(`SELECT count(*) FROM hr_records r WHERE ${filter}`,values);
      const result=await pool.query(`SELECT r.* FROM hr_records r WHERE ${filter} ORDER BY r.updated_at DESC,r.id LIMIT 50 OFFSET $${values.length+1}`,[...values,(page-1)*50]);
      await attachProgress(pool,kind,result.rows);
      if(kind==='leaveAllocations')for(const row of result.rows)if(row.data.__importDraft!=='true')row.data={...row.data,...await balance(pool,row.data.employeeId,row.data.leaveTypeId,row.data.periodId)};
      const siteOptions=kind==='holidays'?(await pool.query("SELECT DISTINCT r.data->>'siteId' AS value FROM hr_records r WHERE r.kind='holidays' AND COALESCE(r.data->>'siteId','')<>'' AND "+scopeSql('r','$1','$2')+" ORDER BY value",[await siteIds(pool,profile),profile.actor])).rows.map(r=>r.value):undefined;
      return {rows:result.rows,total:Number(count.rows[0].count),page,pageSize:50,siteOptions};
    },
    /* Read-only: the employee details a leave / OD form fills in, and the approval route it would take. Nothing is saved. */
    async requestPreview(profile,params) {
      const kind=params.get('kind')||'',employeeId=params.get('employeeId')||'';
      if(!['leaveRequests','outDutyRequests','gatePasses'].includes(kind)||!uuid(employeeId))throw problem('Invalid request preview');
      authorize(profile,kind);
      const employee=(await pool.query("SELECT r.id,r.name,r.data FROM hr_records r WHERE r.id=$1 AND r.kind='employees' AND "+scopeSql('r','$2','$3'),[employeeId,await siteIds(pool,profile),profile.actor])).rows[0];
      if(!employee)throw problem('Employee not found',404);
      const name=async(id,kindName)=>id?(await pool.query('SELECT name FROM hr_records WHERE id::text=$1 AND kind=$2',[String(id),kindName])).rows[0]?.name||'':'';
      const d=employee.data||{},f=d.officeData||d.fields||{},siteId=d.siteId||'';
      const department=await name(d.departmentId,'departments')||String(f['Department']||d.department||'');
      const designation=await name(d.designationId,'designations')||String(f['Designation']||d.designation||'');
      let route=null,routeNote='';
      try{
        const flow=kind==='leaveRequests'?await telegramLeaveFlow(pool,siteId):await odSiteFlow(pool,siteId);
        const steps=kind==='gatePasses'?gatePassWorkflow(flow,department).data.steps:flow&&kind==='leaveRequests'?telegramSteps(flow,department):kind==='outDutyRequests'?odApprovalWorkflow(flow,department).data.steps:(await employeeHierarchy(pool,siteId))?.data?.steps;
        if(steps?.length)route=steps.map(s=>stepLabel(s.label));else routeNote='The approval matrix sets the route when you submit.';
      }catch(e){routeNote=e.message||'The approval route is not configured for this employee yet.';}
      return {employee:{name:employee.name,companyId:d.companyId||'',siteId,department,designation},route,routeNote,missing:[d.companyId?'':'Company',siteId?'':'Site'].filter(Boolean)};
    },
    async lookups(profile) {
      if(!grantedMenus(profile).size)throw problem('No HR permissions assigned',403);
      const kinds=[...new Set(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).flatMap(([,config])=>config.fields.filter(x=>x.type==='reference').map(x=>x.reference)))];
      if(grantedMenus(profile).has('Approval Management')&&!kinds.includes('employees'))kinds.push('employees');
      if(canRead(profile,'outDutyRequests')||canRead(profile,'gatePasses'))for(const kind of ['departments','designations','sites'])if(!kinds.includes(kind))kinds.push(kind);
      const result=await pool.query("SELECT r.id,r.kind,r.code,r.name,CASE WHEN r.kind='designations' THEN r.data->>'departmentId' END AS department_id,r.data->>'actor' AS actor FROM hr_records r WHERE r.kind=ANY($1) AND r.status IN ('ACTIVE','APPROVED') AND "+scopeSql('r','$2')+" ORDER BY r.name LIMIT 10000",[kinds,await siteIds(pool,profile)]);
      if(profile.permissions?.leaveOnly){
        const normalized=value=>String(value||'').trim().toLowerCase().replace(/&/g,'and').replace(/\bltd\b/g,'limited').replace(/[^a-z0-9]/g,'');
        const employeeName=normalized(profile.name),employeeLogin=normalized(profile.actor||profile.login||profile.username);
        const caliberCompany=new Set(['caliberminingandlogisticslimited','cmll','cmpl']);
        return result.rows.filter(row=>row.kind==='employees'?normalized(row.name)===employeeName||Boolean(employeeLogin&&normalized(row.actor)===employeeLogin):row.kind==='companies'?caliberCompany.has(normalized(row.name))||caliberCompany.has(normalized(row.code)):true);
      }
      return result.rows;
    },
    async save(profile,kind,data,id) {
      if(profile.permissions?.leaveOnly&&['leaveRequests','outDutyRequests','gatePasses'].includes(kind)&&!id){
        const employee=(await pool.query("SELECT r.id FROM hr_records r WHERE r.kind='employees' AND r.status IN ('ACTIVE','APPROVED') AND (lower(trim(r.name))=lower(trim($1)) OR lower(trim(COALESCE(r.data->>'actor','')))=lower(trim($2))) AND "+scopeSql('r','$3')+" ORDER BY r.updated_at DESC LIMIT 1",[profile.name,profile.actor||profile.login||profile.username||'',await siteIds(pool,profile)])).rows[0];
        const company=(await pool.query("SELECT id FROM hr_records WHERE kind='companies' AND status IN ('ACTIVE','APPROVED') AND (upper(regexp_replace(code,'[^A-Z0-9]','','g')) IN ('CMLL','CMPL') OR lower(regexp_replace(name,'[^a-z0-9]','','g'))='caliberminingandlogisticslimited') ORDER BY updated_at DESC LIMIT 1")).rows[0];
        if(!employee)throw problem('Your Pulse employee name is not linked to an active HR Employee Master record.',409);
        if(!company)throw problem('Caliber Mining and Logistics Limited is not configured in Company Master.',409);
        data={...data,employeeId:employee.id,companyId:company.id};
      }
      return transaction(db=>save(db,profile,kind,data,id));
    },
    async updateEmployeeDetails(profile,id,{version,officeData}) {
      authorize(profile,'employees',true);
      if(!uuid(id))throw problem('Invalid employee ID');
      if(!officeData||typeof officeData!=='object'||Array.isArray(officeData))throw problem('Employee details are required');
      const changes=Object.entries(officeData);
      if(!changes.length||changes.length>250||changes.some(([key,value])=>key.length>150||typeof value!=='string'||value.length>4000))throw problem('Invalid employee details');
      if(officeData['New Account No']?.trim()&&!/^[0-9]{1,18}$/.test(officeData['New Account No'].trim()))throw problem('New Account No must contain up to 18 digits.');
      const missing=changes.find(([key,value])=>requiredEmployeeDetail(key)&&!value.trim());
      if(missing)throw problem(missing[0].replace(/\s*\*$/,'')+' is required');
      if(changes.some(([key])=>lockedEmployeeDetails.has(key)))throw problem('Use Employee Transfer for posting site changes. Employee code and status cannot be edited here.');
      return transaction(async db=>{
        const record=(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='employees' FOR UPDATE",[id])).rows[0];
        if(!record)throw problem('Employee not found',404);
        await locationAccess(db,profile,'employees',record.data,id);
        if(record.status!=='ACTIVE')throw problem('Only active employees can be edited here',409);
        if(record.version!==Number(version))throw problem('This employee changed. Reload the employee list before editing again.',409);

        const savedAccount=String(record.data.officeData?.['Bank Account No']??'').trim();
        if(savedAccount&&Object.hasOwn(officeData,'Bank Account No')&&officeData['Bank Account No'].trim()!==savedAccount)throw problem('Bank account number is locked after it is saved.');
        if(Object.hasOwn(officeData,'Site / Project')){const mismatch=siteProjectMismatch({...record.data.officeData,...officeData});if(mismatch)throw problem(mismatch);}

        const coreChanges={};
        for(const [header,value] of changes){
          if(!Object.hasOwn(employeeDetailFields,header))continue;
          const field=employeeDetailFields[header];
          coreChanges[field]=field==='category'?(employeeCategories.get(value.trim().toLowerCase())??value):value;
        }
        const hasReferenceChanges=Object.keys(coreChanges).some(key=>key.endsWith('Id'));
        const resolved=hasReferenceChanges?await resolveImportReferences(db,'employees',coreChanges):coreChanges;
        const data={...record.data,officeData:{...record.data.officeData,...officeData}};
        if(Object.keys(resolved).length){
          const validated=validate('employees',{...record.data,code:record.code,name:record.name,...resolved});
          for(const key of Object.keys(resolved))data[key]=validated[key];
          if(hasReferenceChanges)await references(db,'employees',data,id);
        }
        const saved=(await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4 RETURNING *',[data.name??record.name,data,profile.actor,id])).rows[0];
        await audit(db,profile.actor,'UPDATE','employees',id,{code:record.code,fields:Object.keys(officeData)});
        return saved;
      });
    },
    async cancel(profile,kind,id,version){
      authorize(profile,kind,true);if(!['leaveRequests','leaveEncashments','outDutyRequests','gatePasses'].includes(kind)||!uuid(id))throw problem('Invalid cancellation');
       return transaction(async(db,afterCommit)=>{
        await db.query("SELECT id FROM hr_approvals WHERE record_id=$1 AND state='PENDING' FOR UPDATE",[id]);
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
        if(!record)throw problem('Record not found',404);
        await locationAccess(db,profile,kind,record.data,id);
        if(record.version!==Number(version)||!['DRAFT','PENDING','REJECTED'].includes(record.status))throw problem('Only draft, pending or rejected requests can be cancelled',409);
        if(record.created_by!==profile.actor)throw problem('Only the requester can cancel this request',403);
        await db.query("UPDATE hr_approvals SET state='CANCELLED',version=version+1,updated_at=now() WHERE record_id=$1 AND state='PENDING'",[id]);
        await db.query("UPDATE hr_records SET status='CANCELLED',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2",[profile.actor,id]);
        await audit(db,profile.actor,'CANCEL',kind,id);return {status:'CANCELLED'};
      });
    },
    async importMasters(profile,kind,records){
      if(!['assets','assetCategories','assetEmployees','assetAllocationLog','assetExitClearances','holidays','leaveTypes','leavePolicies','leavePeriods','leaveAllocations','leaveRequests','leaveEncashments','leaveBlocks'].includes(kind))throw problem('Unsupported import');
      authorize(profile,kind,true);if(!Array.isArray(records)||!records.length||records.length>500)throw problem('Import 1–500 rows');
      return transaction(db=>importWithDrafts(db,profile,kind,records,input=>save(db,profile,kind,input)));
    },
    async deactivate(profile,kind,id,version) {
      authorize(profile,kind,true);if(['leaveRequests','leaveEncashments','outDutyRequests','gatePasses'].includes(kind))throw problem('Use Cancel for requests',409);if(!uuid(id))throw problem('Invalid record ID');
      return transaction(async(db,afterCommit)=>{
        const current=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
        if(!current)throw problem('Record not found',404);
        await locationAccess(db,profile,kind,current.data,id);
        if(kind==='leaveAllocations'){await db.query('SELECT id FROM hr_records WHERE id=$1 FOR UPDATE',[current.data.employeeId]);const b=await balance(db,current.data.employeeId,current.data.leaveTypeId,current.data.periodId);if(b.used+b.reserved>0)throw problem('Allocation has used or pending days',409);}
        if(kind==='leavePeriods'){const pending=await db.query("SELECT id FROM hr_records WHERE kind IN ('leaveRequests','leaveEncashments') AND status='PENDING' AND data->>'periodId'=$1",[id]);if(pending.rowCount)throw problem('Resolve pending requests before closing this period',409);}
        const result=await db.query("UPDATE hr_records SET status='INACTIVE',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2 AND kind=$3 AND version=$4 AND status<>'PENDING' RETURNING *",[profile.actor,id,kind,version]);
        if(!result.rowCount)throw problem('Reload the record; pending records cannot be deactivated',409);
        await audit(db,profile.actor,'DEACTIVATE',kind,id);return result.rows[0];
      });
    },
    async saveTrialEmployee(profile,input) {
      if (!grantedMenus(profile).has('Employee Master')) throw problem('Employee Master permission required',403);
      const {employee,trial}=input||{};
      const clearance=validateTrialJoining(trial,employee||{},employee?.__officeData);
      return this.importEmployees(profile,[employee],false,clearance);
    },
    async importEmployees(profile,records,submitForApproval=false,trialClearance) {
      authorize(profile,'employees',true);
      if(!Array.isArray(records)||!records.length||records.length>500)throw problem('Import 1–500 rows at a time');
      return transaction(async(db,afterCommit)=>{
        let count=0,submitted=0;
        for(const record of records){
          const input={...record};
          const officeData=input.__officeData;delete input.__officeData;
          if(officeData&&(!officeData.constructor||officeData.constructor!==Object))throw problem(`Row ${count+1}: Corporate / HO employee data is invalid`);
          if(officeData){const mismatch=siteProjectMismatch(officeData);if(mismatch)throw problem('Row '+(count+1)+': '+mismatch);}
          if (submitForApproval||trialClearance) {
            const missing=missingJoiningField(officeData);
            if(missing)throw problem('Row '+(count+1)+': '+missing.replace(/\s*\*$/,'')+' is required');
            const underage=underageBirthDate(officeData?.['Date of Birth']||input.dateOfBirth);
            if(underage)throw problem('Row '+(count+1)+': '+underage);
          }
          if(trialClearance)await requireTrialRole(db,profile,'hr',trialClearance);
          if (trialClearance) {
            await locationAccess(db,profile,'employees',input);
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['trial-joining:'+trialClearance.id]);
            const used=(await db.query("SELECT t.data,t.created_by,e.status FROM hr_records t LEFT JOIN hr_records e ON e.id::text=t.data->>'employeeId' AND e.kind='employees' WHERE t.kind='trialJoinings' AND t.code=$1",[trialClearance.id])).rows[0];
            if (used) {
              if (used.status==='ACTIVE' && used.created_by===profile.actor && used.data.employeeCode===input.code && used.data.siteId===(input.siteId||'')) {
                return {imported:1,submitted:0,status:'ACTIVE'};
              }
              throw problem('This trial is already linked to an employee.',409);
            }
          }
          if(!input.companyId){
            const companies=await db.query("SELECT id FROM hr_records WHERE kind='companies' AND status IN ('ACTIVE','APPROVED') ORDER BY (lower(code)='cmll') DESC,created_at LIMIT 2");
            if(companies.rowCount>1){const cmll=await db.query("SELECT id FROM hr_records WHERE kind='companies' AND lower(code)='cmll' AND status IN ('ACTIVE','APPROVED') LIMIT 2");if(cmll.rowCount===1)companies.rows=[cmll.rows[0]];companies.rowCount=cmll.rowCount;}
            if(companies.rowCount!==1)throw problem(`Row ${count+1}: configure exactly one active company before importing the Corporate / HO format`);
            input.companyId=companies.rows[0].id;
          }
          for(const field of modules.employees.fields.filter(x=>x.type==='reference')){
            if(input[field.key]&&!uuid(input[field.key])){
              const found=await db.query("SELECT id FROM hr_records WHERE kind=$1 AND (code=$2 OR ($3 AND lower(name)=lower($2))) AND status IN ('ACTIVE','APPROVED') LIMIT 2",[field.reference,String(input[field.key]).trim(),Boolean(officeData)]);
              if(found.rowCount!==1)throw problem(`Row ${count+1}: unknown or ambiguous ${field.label} code/name`);
              input[field.key]=found.rows[0].id;
            }
          }
          try {
            const saved=await save(db,profile,'employees',input);
            if (trialClearance) {
              await db.query("UPDATE hr_records SET status='ACTIVE',data=data||jsonb_build_object('officeData',$1::jsonb,'trialJoiningId',$2::text) WHERE id=$3",[JSON.stringify(officeData),trialClearance.id,saved.id]);
              const link={...trialClearance,employeeId:saved.id,employeeCode:saved.code,siteId:saved.data.siteId};
              await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'trialJoinings',$2,$3,$4,'ACTIVE',$5,$5)",[randomUUID(),trialClearance.id,trialClearance.formNo,link,profile.actor]);
              await audit(db,profile.actor,'JOIN_FROM_TRIAL','employees',saved.id,{trialFormNo:trialClearance.formNo,post:trialClearance.post});
            } else {
              if(officeData)await db.query("UPDATE hr_records SET data=data||jsonb_build_object('officeData',$1::jsonb) WHERE id=$2",[JSON.stringify(officeData),saved.id]);
              if(submitForApproval){
                /* Owner, 21 Nov 2026: Submit Employee goes into approval whenever the site has a route: the new employee
                   route (region sites and the two offices need no saved hierarchy) or an enabled saved hierarchy. */
                const siteCode=(await db.query("SELECT code FROM hr_records WHERE kind='sites' AND id::text=$1",[saved.data.siteId||''])).rows[0]?.code;
                const routed=!!siteCode&&(!!employeeTrackSteps({code:siteCode,requester:profile.actor})||!!(await db.query("SELECT 1 FROM hr_records WHERE kind='joiningHierarchies' AND status='ACTIVE' AND code=$1",[siteCode])).rowCount);
                if(routed){await submitRecord(db,profile,'employees',saved.id,saved.version,afterCommit);submitted++;}
              }
            }
          } catch(error){throw problem(`Row ${count+1}: ${error.code==='23505'?'employee number already exists':error.status?error.message:'unable to save this row'}`,error.status||400);}
          count++;
        }
        return {imported:count,submitted,status:trialClearance?'ACTIVE':submitted===count?'PENDING':'DRAFT'};
      });
    },
    async submit(profile,kind,id,version){authorize(profile,kind,true);if(!['employees','leaveRequests','leaveEncashments','outDutyRequests','gatePasses'].includes(kind)||!uuid(id))throw problem('Invalid approval submission');return transaction((db,afterCommit)=>submitRecord(db,profile,kind,id,version,afterCommit));},
    async approvals(profile) {
      return approvalRows(profile,{mine:true,limit:200});
    },
    /* Employee Verify: the user's employee forms not yet fully approved, so leave, OD and gate pass requests
       never push them out of the latest-200 list (owner, 21 Nov 2026). */
    async employeeApprovals(profile) {
      return approvalRows(profile,{mine:true,filter:"r.kind='employees' AND a.state<>'APPROVED'",limit:200});
    },
    /* Completed Form: every fully approved employee in the user's Pulse sites, whoever submitted or approved it
       (owner, 21 Nov 2026). */
    async completedEmployees(profile) {
      const rows=await approvalRows(profile,{mine:false,filter:"r.kind='employees' AND a.state='APPROVED'",limit:2000});
      const canPermanentDelete=assignedSites(profile)===null;
      return rows.map(row=>({...row,can_permanent_delete:canPermanentDelete}));
    },
    async permanentDeleteCompletedEmployee(profile,id) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      if(assignedSites(profile)!==null)throw problem('Permanent employee deletion requires access to all sites',403);
      if(!uuid(id))throw problem('Invalid employee',400);
      return transaction(async db=>{
        const row=(await db.query("SELECT r.*,a.state AS approval_state FROM hr_records r JOIN hr_approvals a ON a.record_id=r.id WHERE r.id=$1 AND r.kind='employees' FOR UPDATE",[id])).rows[0];
        if(!row||row.approval_state!=='APPROVED')throw problem('Completed employee not found',404);
        await audit(db,profile.actor,'PERMANENT_DELETE','employees',row.id,{code:row.code,name:row.name});
        await db.query('DELETE FROM hr_salary_structure WHERE employee_id=$1',[row.id]);
        await db.query('DELETE FROM hr_payroll_period WHERE employee_id=$1',[row.id]);
        await db.query('DELETE FROM hr_approvals WHERE record_id=$1',[row.id]);
        await db.query("DELETE FROM hr_records WHERE id=$1 AND kind='employees'",[row.id]);
        return {deleted:1,id:row.id};
      });
    },
    /* Leave at the Directors' step: Regional HR requests the OTP (sent to the Directors on the Leave Request bot),
       a Director tells it to Regional HR, who enters it here. 15 minutes, single use, five wrong tries. */
    async leaveOtp(profile,id,input,verify=false) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      if(!uuid(id))throw problem('Invalid approval');
      const code=otpCode(id);
      const result=await transaction(async db=>{
        const approval=(await db.query('SELECT * FROM hr_approvals WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!approval)throw problem('Approval not found',404);
        const steps=approvalSteps(approval),step=steps[approval.stage];
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE',[approval.record_id])).rows[0];
        const what=record?.kind==='employees'?'new employee':'leave';
        if(approval.state!=='PENDING'||!step?.otp)throw problem(`This ${what} is not waiting for the Directors' OTP. Reload it.`,409);
        if(!otpEnterers(steps,approval.stage).includes(profile.actor))throw problem(`Only Regional HR for this ${what} can request or enter the Directors' OTP.`,403);
        await locationAccess(db,profile,record.kind,record.data,record.id);
        const old=(await db.query("SELECT data FROM hr_records WHERE kind='leaveOtps' AND code=$1 FOR UPDATE",[code])).rows[0]?.data;
        const siteName=await siteNameOf(db,approval,record);
        if(!verify)return issueDirectorsOtp(db,{approval,record,steps,stage:approval.stage,requester:profile,siteName});
        const otp=String(input.otp||'').replace(/\D/g,'');
        if(!old||old.stage!==approval.stage)throw problem('Request the OTP from the Directors first.',404);
        if(new Date(old.expires)<new Date())throw problem('OTP expired – press Resend OTP.',410);
        if((old.attempts||0)>=LEAVE_OTP_ATTEMPTS)throw problem('Too many wrong attempts – press Resend OTP.',429);
        if(otp.length!==6||otpHash(id,otp)!==old.otpHash){
          const attempts=(old.attempts||0)+1;
          await db.query("UPDATE hr_records SET data=$2,updated_at=now() WHERE kind='leaveOtps' AND code=$1",[code,{...old,attempts}]);
          return {wrong:LEAVE_OTP_ATTEMPTS-attempts};
        }
        const at=new Date().toISOString();
        await db.query("UPDATE hr_records SET data=$2,status='APPROVED',updated_at=now() WHERE kind='leaveOtps' AND code=$1",[code,{...old,status:'APPROVED',otpHash:null,approvedAt:at,enteredBy:profile.actor}]);
        const history=[...approval.history,{actor:'directors-otp',stage:approval.stage+1,decision:'APPROVED',comments:`Directors' OTP entered by ${profile.name||profile.actor} (Regional HR)`,at}];
        /* New employee: the Directors' OTP is the last step, so it makes the employee Active. */
        const final=approval.stage+1>=steps.length;
        if(final)await db.query('UPDATE hr_approvals SET stage=$1,state=$2,history=$3,version=version+1,updated_at=now() WHERE id=$4',[approval.stage+1,'APPROVED',JSON.stringify(history),id]);
        else await db.query('UPDATE hr_approvals SET stage=$1,history=$2,version=version+1,updated_at=now() WHERE id=$3',[approval.stage+1,JSON.stringify(history),id]);
        if(final)await db.query("UPDATE hr_records SET status=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3",[record.kind==='employees'?'ACTIVE':'APPROVED',profile.actor,record.id]);
        await audit(db,profile.actor,'APPROVED',record.kind,record.id,{stage:approval.stage+1,via:'directors-otp'});
        if(final&&record.kind==='employees')await queueTrackStep(db,queueTelegram,additionBot(),{key:id+':otp:'+approval.version,approvalId:id,record:approval.record_snapshot,siteName,steps,stage:approval.stage+1,state:'APPROVED',requestedBy:approval.requested_by,sender:profile.actor,actor:profile.name||profile.actor,decidedAt:new Date(at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})});
        return {status:'APPROVED',final,next:steps[approval.stage+1]?.label||''};
      });
      if(result.wrong!==undefined)throw problem(`Wrong OTP (${result.wrong} attempt${result.wrong===1?'':'s'} left).`,400);
      return result;
    },
    async decide(profile,id,input,trusted=false) {
      if(!trusted&&!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      if(!uuid(id)||!['APPROVED','REJECTED'].includes(input.decision))throw problem('Invalid approval decision');
      const comments=String(input.comments||'').trim();if(comments.length>2000||input.decision==='REJECTED'&&!comments)throw problem('A rejection reason is required (maximum 2000 characters)');
      return transaction(async(db,afterCommit)=>{
        const approval=(await db.query('SELECT * FROM hr_approvals WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!approval)throw problem('Approval not found',404);
        if(approval.state!=='PENDING'||approval.version!==Number(input.version))throw problem('This approval has changed. Reload it.',409);
        const next=nextApproval(approval,profile.actor,input.decision);
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE',[approval.record_id])).rows[0];
        if(!trusted)await locationAccess(db,profile,record.kind,record.data,record.id);
        if(trusted&&(record.kind!=='employees'||Number(input.stage)!==approval.stage))throw problem('This request has already moved on.',409);
        const flow=approval.record_snapshot?.telegramFlow;
        /* Owner, 21 Nov 2026: at the Directors' step a Director may approve directly; the OTP through Regional HR is the backup. */
        let handoverActor='';
        if(flow&&input.decision==='APPROVED'&&next.state==='APPROVED'){
          if(!uuid(input.chargeEmployeeId)||input.chargeEmployeeId===record.data.employeeId)throw problem('Select another active employee to take charge',422);
          const handover=(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='employees' AND status IN ('ACTIVE','APPROVED') FOR SHARE",[input.chargeEmployeeId])).rows[0];
          if(!handover||/exited|terminated|inactive/i.test(String(handover.data.employmentStatus||handover.data.officeData?.Status||'')))throw problem('Choose an active employee to take charge',422);
          await locationAccess(db,profile,'employees',handover.data,handover.id);
          handoverActor=await employeeActor(db,handover.id);
          if(!handoverActor)throw problem('Link the selected employee to their Pulse username in Telegram Hierarchy first',422);
          record.data={...record.data,chargeEmployeeId:handover.id,chargeHandedOverTo:handover.name};
          await db.query('UPDATE hr_records SET data=$1 WHERE id=$2',[record.data,record.id]);
          await db.query("UPDATE hr_approvals SET record_snapshot=jsonb_set(record_snapshot,'{data,chargeHandedOverTo}',to_jsonb($1::text)) WHERE id=$2",[handover.name,id]);
        }
        const stage=next.stage;
        const state=next.state;
        const history=[...approval.history,{actor:profile.actor,stage:approval.stage+1,decision:input.decision,comments,at:new Date().toISOString()}];
        await db.query('UPDATE hr_approvals SET stage=$1,state=$2,history=$3,version=version+1,updated_at=now() WHERE id=$4',[stage,state,JSON.stringify(history),id]);
        if(state!=='PENDING')await db.query('UPDATE hr_records SET status=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[state==='APPROVED'&&['employees','holidays'].includes(record.kind)?'ACTIVE':state,profile.actor,record.id]);
        if(state==='APPROVED'&&record.kind==='employeeTransfers')await applyTransfer(db,record,profile.actor);
        if(flow?.hods){   /* leave route: HOD → Directors (OTP) → Regional HR; only the next step hears of it, then the employee hears the result */
          const siteName=approval.record_snapshot.telegramSiteName||'';
          const account=(await db.query('SELECT telegram_user_id FROM hr_telegram_accounts WHERE actor=$1',[profile.actor])).rows[0];
          const decision={actor:profile.actor,name:profile.name,telegramId:account?.telegram_user_id,at:history.at(-1).at,comments};
          if(state==='PENDING')await queueLeaveStep(db,{key:id+':decision:'+approval.version,record,steps:approvalSteps(approval),stage,siteName,sender:profile.actor,decision});
          else{const employee=await employeeActor(db,record.data.employeeId,approval.requested_by);
           await queueTelegram(db,id+':decision:'+approval.version,[employee,approval.requested_by,handoverActor].filter(Boolean).filter(notSender(profile.actor)),leaveMessage(record,state,{siteName,firstRole:'HOD',...decision}),leaveBot());}
        }else if(flow){
          const employee=await employeeActor(db,record.data.employeeId,approval.requested_by);
          const flowSteps=approvalSteps(approval),stageRole=flowSteps[approval.stage]?.label.replace(/ — .*/,''),nextRole=flowSteps[stage]?.label.replace(/ — .*/,'');
          const recipients=cmllHrEnabled()?(state==='PENDING'?(flowSteps[stage]?.approvers||[]).flatMap(telegramUsers).filter(notSender(profile.actor)):[]):flow.hods?(state==='APPROVED'?[employee,flow.hrManager,...flowSteps.flatMap(x=>x.approvers),handoverActor]:state==='REJECTED'?[employee,flow.hrManager,flow.regionalHr]:[employee,flow.hrManager,...(flowSteps[stage]?.approvers||[])])
           :(state==='APPROVED'?[employee,flow.siteHr,...flow.directors,handoverActor]:state==='REJECTED'?[employee,flow.siteHr,flow.regionalHr]:[employee,flow.regionalHr]);
          const siteName=approval.record_snapshot.telegramSiteName||(await db.query("SELECT s.name FROM hr_records e JOIN hr_records s ON s.id::text=e.data->>'siteId' AND s.kind='sites' WHERE e.id::text=$1 AND e.kind='employees'",[record.data.employeeId||''])).rows[0]?.name;
          const account=(await db.query('SELECT telegram_user_id FROM hr_telegram_accounts WHERE actor=$1',[profile.actor])).rows[0];
          await queueTelegram(db,id+':decision:'+approval.version,recipients,leaveMessage(record,state,{siteName,firstRole:flow.firstRole,stageRole,nextRole,actor:profile.actor,name:profile.name,telegramId:account?.telegram_user_id,at:history.at(-1).at,comments}));
        }
        await audit(db,profile.actor,input.decision,record.kind,record.id,{stage:approval.stage+1,comments,...(handoverActor?{chargeEmployeeId:record.data.chargeEmployeeId}:{})});
        if(record.kind==='employees'&&isEmployeeTrack(approvalSteps(approval))){
          /* Site HR → Regional HR → Directors: Regional HR's approval sends the Directors Approve / Reject buttons with the backup OTP. */
          const steps=approvalSteps(approval),siteName=await siteNameOf(db,approval,record),decidedAt=new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'});
          if(state==='PENDING'&&steps[stage]?.otp){
            const after={...approval,stage,history};
            const sent=await issueDirectorsOtp(db,{approval:after,record,steps,stage,requester:profile,siteName});
            return {state,otpSentTo:sent.sentTo};
          }
          await queueTrackStep(db,queueTelegram,additionBot(),{key:id+':decision:'+approval.version,approvalId:id,record:approval.record_snapshot,siteName,steps,stage,state,requestedBy:approval.requested_by,sender:profile.actor,actor:profile.name||profile.actor,comments,decidedAt});
        }else if(record.kind==='employees'){
          const siteName=(await db.query("SELECT name FROM hr_records WHERE id::text=$1 AND kind='sites'",[record.data.siteId||''])).rows[0]?.name||'';
          await queueAdditionStep(db,queueTelegram,{approvalId:id,record:approval.record_snapshot,siteName,steps:approvalSteps(approval),stage,state,requestedBy:approval.requested_by,actor:profile.name||profile.actor,sender:profile.actor,assignedOnly:cmllHrEnabled(),comments,decidedAt:new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})});
        }
        return {state};
      });
    },
    /* Next employee code for a company (CMLL001, CMLL002 …). The same Aadhaar always gets the same code; numbers come from
       existing employees + reservations, so two HR users scanning at the same time never get the same code. */
    async nextEmployeeCode(profile,input){
      const aadhaar=String(input?.aadhaar||'').replace(/\D/g,'').slice(-12);
      const companyKey=String(input?.company||'').trim().toLowerCase();
      const companies=(await pool.query("SELECT code,name FROM hr_records WHERE kind='companies' AND status='ACTIVE'")).rows;
      const company=companies.find(c=>c.code.toLowerCase()===companyKey||c.name.toLowerCase()===companyKey)||companies.find(c=>c.code.toLowerCase()==='cmll')||companies[0];
      const prefix=(String(input?.prefix||company?.code||'CMLL').replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,6))||'CMLL';
      return transaction(async db=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['employee-code:'+prefix]);
        if(aadhaar.length===12){const held=(await db.query("SELECT code FROM hr_records WHERE kind='employeeCodes' AND data->>'aadhaar'=$1 AND code LIKE $2",[aadhaar,prefix+'%'])).rows[0];if(held)return {code:held.code,prefix,reused:true};}
        await db.query("DELETE FROM hr_records r WHERE r.kind='employeeCodes' AND r.created_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM hr_records e WHERE e.kind='employees' AND e.code=r.code)");
        const used=(await db.query("SELECT code FROM hr_records WHERE kind IN ('employees','employeeCodes') AND code ~ $1",['^'+prefix+'[0-9]+$'])).rows.map(r=>Number(r.code.slice(prefix.length))).filter(n=>Number.isFinite(n));
        const next=(used.length?Math.max(...used):0)+1,code=prefix+String(next).padStart(3,'0');
        await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'employeeCodes',$1,$2,$3,'ACTIVE',$4,$4) ON CONFLICT(kind,code) DO NOTHING",[code,'Reserved employee code',{aadhaar,company:company?.code||'',reservedBy:profile.actor,reservedAt:new Date().toISOString()},profile.actor]);
        return {code,prefix,reused:false};
      });
    },
    async summary(profile) {
      if(!['Dashboard','Reports & MIS'].some(x=>grantedMenus(profile).has(x)))throw problem('Dashboard or Reports permission required',403);
      const ids=await siteIds(pool,profile);
      const counts=(await pool.query('SELECT r.kind,r.status,count(*)::int AS count FROM hr_records r WHERE '+scopeSql('r','$1')+' GROUP BY r.kind,r.status',[ids])).rows;
      const sites=(await pool.query("SELECT COALESCE(s.name,'Unassigned') AS site,count(*)::int AS count FROM hr_records e LEFT JOIN hr_records s ON s.id::text=e.data->>'siteId' WHERE e.kind='employees' AND e.status='ACTIVE' AND "+scopeSql('e','$1')+" GROUP BY s.name ORDER BY count(*) DESC",[ids])).rows;
      return {counts,sites};
    },
    async audit(profile) {
      if(!grantedMenus(profile).has('Audit Logs'))throw problem('Audit Logs permission required',403);
      return (await pool.query('SELECT a.* FROM hr_audit a JOIN hr_records r ON r.id=a.record_id WHERE '+scopeSql('r','$1')+' ORDER BY a.id DESC LIMIT 200',[await siteIds(pool,profile)])).rows;
    },
    /* @NagpurEmployeeAdditionBot: an Approve / Reject tap decides the employee approval through decide(), like the HR app. */
    async telegramWebhook(secret,update,bot='leave'){
      const cmllAddition=bot==='mt'&&cmllHrEnabled()&&Boolean(parseAdditionCallback(update?.callback_query?.data));
      const track=bot===EMPLOYEE_TRACK_BOT;
      if((bot!==ADDITION_BOT&&!cmllAddition&&!track)||!update?.callback_query)return telegramBase.telegramWebhook(secret,update,bot);
      if(!webhookSecretValid(secret,botSecret(bot)))throw problem('Unauthorized webhook',403);
      if(!Number.isSafeInteger(update.update_id))throw problem('Invalid update');
      const updates=cmllAddition?'hr_telegram_mt_updates':track?'hr_telegram_employee_track_updates':'hr_telegram_updates';
      if(!(await pool.query(`INSERT INTO ${updates}(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id`,[update.update_id])).rowCount)return {ok:true};
      const cb=update.callback_query,tap=parseAdditionCallback(cb.data);
      const reply=async text=>{const token=botToken(bot);if(!token)return;const call=(method,body)=>fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)}).catch(()=>{});
        await call('answerCallbackQuery',{callback_query_id:cb.id,text,show_alert:false});
        if(cb.message?.chat?.id&&cb.message.message_id)await call('editMessageReplyMarkup',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,reply_markup:{inline_keyboard:[]}});};
      if(!tap){await reply('Unknown action');return {ok:true};}
      const linkedColumn=cmllAddition?'cmll_hr_connected':track?'employee_track_connected':'';
      const actor=linkedColumn?(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 AND ${linkedColumn}`,[String(cb.from?.id||'')])).rows[0]?.actor:await additionActor(pool,cb.from?.id);
      if(!actor){await reply(track?'Join with your personal Employee Track link first (ask HR: Approval Master › Employee Track bot).':'Connect your Pulse login to this bot first (Caliber HR › Connect Telegram).');return {ok:true};}
      const approval=(await pool.query('SELECT * FROM hr_approvals WHERE id=$1',[tap.id])).rows[0];
      if(!approval){await reply('This request was not found');return {ok:true};}
      if(approval.state!=='PENDING'||approval.stage!==tap.stage){await reply(`Already handled (${String(approval.state).toLowerCase()})`);return {ok:true};}
      if(!approvalSteps(approval)[approval.stage]?.approvers.includes(actor)||approval.requested_by===actor){await reply('You are not the approver for this step');return {ok:true};}
      try{
        const result=await this.decide({actor,name:actor},tap.id,{decision:tap.approve?'APPROVED':'REJECTED',version:approval.version,stage:tap.stage,comments:tap.approve?'':`Rejected on Telegram by ${actor}`},true);
        await reply(tap.approve?(result.state==='APPROVED'?'Approved ✅ – employee is now Active':result.otpSentTo?"Approved ✅ – the Directors got the OTP. Ask one of them and enter it in HRMS › Approvals.":'Approved ✅ – sent to the next step'):'Rejected ❌ – sent back to Site HR');
      }catch(error){await reply(error instanceof Error?error.message.slice(0,180):'Could not save the decision');}
      return {ok:true};
    },
  };
}
