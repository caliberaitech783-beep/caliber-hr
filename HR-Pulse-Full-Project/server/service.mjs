import {createTelegram,telegramLeaveFlow,telegramSteps,queueTelegram,leaveMessage,employeeActor} from './telegram.mjs';
import {odApprovalWorkflow} from './out-duty.mjs';
import {createAssets} from './assets.mjs';
import {createHierarchies,employeeHierarchy,approvalSteps,nextApproval} from './joining-hierarchy.mjs';
import {createHolidayDocuments,holidayAliases} from './holiday-documents.mjs';
import {createEmployeeDocuments} from './employee-documents.mjs';
import {importWithDrafts,resolveImportReferences} from './import-drafts.mjs';
import {createDeletion} from './deletion.mjs';
import {balance,checkLeave,employeeLeaveKinds,leaveApprovalSteps} from './leave.mjs';
import { randomUUID } from 'node:crypto';
import { modules, grantedMenus, canRead, canWrite, validate } from './modules.mjs';
import {assignedSites,siteIds,scopeSql} from './scope.mjs';
import {createTelegramNotifier} from './telegram-notifications.mjs';
export function problem(message,status=400) { return Object.assign(new Error(message),{status}); }
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export function createService(pool,{telegram=createTelegramNotifier()}={}) {
  const employeeDocuments=createEmployeeDocuments(pool);
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
    if (!(write?canWrite:canRead)(profile,kind)) throw problem('Your Pulse HR permissions do not allow this operation',403);
  }
  async function locationAccess(db,profile,kind,data,id){
    const ids=await siteIds(db,profile);if(ids===null)return;
    let site=data.siteId;
    if(kind==='holidays'&&site&&!ids.includes(site))site=(await db.query("SELECT id FROM hr_records WHERE kind='sites' AND (code=$1 OR name=$1)",[site])).rows.find(r=>ids.includes(r.id))?.id;
    if(kind==='sites')site=id;
    if(['assetEmployees','assetAllocationLog','assetExitClearances','employeeTransfers','outDutyRequests'].includes(kind)||employeeLeaveKinds.includes(kind))site=(await db.query("SELECT data->>'siteId' AS site FROM hr_records WHERE id=$1 AND kind='employees'",[data.employeeId])).rows[0]?.site;
    if(!['calendarEvents','assetEmployees','assetAllocationLog','assetExitClearances','assets','employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments','employeeTransfers','outDutyRequests'].includes(kind))throw problem('Global master changes require an account without a site restriction',403);
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
      if(['leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)&&['APPROVED','CANCELLED','INACTIVE'].includes(existing.status))throw problem('Finalized requests cannot be edited',409);
      if(kind==='leaveAllocations'&&existing.data.__importDraft!=='true'&&['employeeId','leaveTypeId','periodId'].some(key=>existing.data[key]!==input[key]))throw problem('Allocation employee, type and period cannot be changed. Create another allocation instead.',409);
      if(existing.status==='PENDING')throw problem('A record awaiting approval cannot be edited',409);
      if(!(existing.data.__importDraft==='true'&&existing.created_by===profile.actor))await locationAccess(db,profile,kind,existing.data,id);
    }
    if(existing?.data.__importDraft==='true')input=await resolveImportReferences(db,kind,input);
    if(kind==='outDutyRequests')input={...input,code:existing?.code||'OD-'+randomUUID()};
    data=validate(kind,input);
    await locationAccess(db,profile,kind,data,id);
    await references(db,kind,data,id);
    const status=['employeeTransfers','outDutyRequests'].includes(kind)?'DRAFT':kind==='holidays'?'PENDING':['employees','leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)?'DRAFT':'ACTIVE';
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
   async function submitRecord(db,profile,kind,id,version,afterCommit){
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
        if(!record)throw problem('Record not found',404);
        if(record.data.__importDraft==='true')throw problem('Resolve the imported draft and save it before submitting',409);
        if(record.version!==Number(version)||!['DRAFT','REJECTED'].includes(record.status))throw problem('Reload the record; only drafts or rejected records can be submitted',409);
        await locationAccess(db,profile,kind,record.data,id);
        await references(db,kind,record.data,id);
        let companyId=record.data.companyId,siteId=record.data.siteId;
        if(['leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)){const employee=(await db.query('SELECT data FROM hr_records WHERE id=$1',[record.data.employeeId])).rows[0];companyId=employee?.data.companyId;siteId=employee?.data.siteId;}
        const telegramFlow=kind==='leaveRequests'?await telegramLeaveFlow(db,siteId):null;
        const hierarchy=telegramFlow?{id:null,data:{steps:telegramSteps(telegramFlow)}}:kind==='outDutyRequests'?odApprovalWorkflow():['employees','leaveRequests'].includes(kind)?await employeeHierarchy(db,siteId):null;
        const rules=(await db.query("SELECT * FROM hr_records WHERE kind='approvalRules' AND status='ACTIVE' AND data->>'target'=$1 AND (COALESCE(data->>'companyId','')='' OR data->>'companyId'=$2) AND (COALESCE(data->>'siteId','')='' OR data->>'siteId'=$3)",[kind,companyId||'',siteId||''])).rows;
        const weight=r=>(r.data.companyId?1:0)+(r.data.siteId?2:0);rules.sort((a,b)=>weight(b)-weight(a));
        if(!hierarchy&&!rules.length&&(kind==='leaveRequests'||!record.data.approver))throw problem('Configure an active approval-matrix rule for this module before submitting',409);
        if(!hierarchy&&rules.length>1&&weight(rules[0])===weight(rules[1]))throw problem('Approval rules overlap. Resolve the approval matrix before submitting.',409);
        const workflow=hierarchy||(!rules.length&&record.data.approver?{id:null,data:{approvers:record.data.approver}}:(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='workflows' AND status='ACTIVE'",[rules[0].data.workflowId])).rows[0]);
        if(!workflow)throw problem('The configured workflow is not active',409);
        const steps=hierarchy?hierarchy.data.steps:kind==='leaveRequests'?leaveApprovalSteps(workflow):workflow.data.approvers.split(',').map(actor=>({stage:1,label:'Approval',approvers:[actor]}));
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
        if(telegramFlow)await queueTelegram(db,approvalId+':submitted',[telegramFlow.siteHr,telegramFlow.regionalHr],leaveMessage(record,'SUBMITTED',{siteName:telegramSiteName}));
        await db.query("UPDATE hr_records SET status='PENDING',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2",[profile.actor,id]);
        await audit(db,profile.actor,'SUBMIT',kind,id,{workflowId:workflow.id,stages:steps.length});
         if(kind==='employees'&&hierarchy?.code==='CMLL-CO')afterCommit?.(()=>telegram.approvalRequested({siteCode:hierarchy.code,record:snapshot,step:steps[0],stage:1,total:steps.length,requestedBy:profile.actor}));
        return {status:'PENDING'};
  }
  return {...createTelegram(pool),...createAssets(pool),...employeeDocuments,
    ...createDeletion(pool),
    ...createHierarchies(pool),
    ...createHolidayDocuments(pool),
    async config(profile) { const scoped=assignedSites(profile)!==null;return {profile,modules:Object.fromEntries(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).map(([kind,config])=>[kind,{...config,canWrite:canWrite(profile,kind)&&(!scoped||['employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments','outDutyRequests'].includes(kind))}]))}; },
    async list(profile,kind,params) {
      authorize(profile,kind);
      const page=Math.max(1,Math.min(10000,Number(params.get('page'))||1));
      const search=(params.get('search')||'').slice(0,150);const status=params.get('status')||'';
      let filter="r.kind=$1 AND ($2='' OR r.code ILIKE '%'||$2||'%' OR r.name ILIKE '%'||$2||'%') AND ($3='' OR r.status=$3) AND "+scopeSql('r','$4','$5');
      const values=[kind,search,status,await siteIds(pool,profile),profile.actor];
      const filters=[['leaveTypeId',"r.data->>'leaveTypeId'"],['periodId',"r.data->>'periodId'"],['siteId',"r.data->>'siteId'"],['year',"left(r.data->>'date',4)"],['departmentId',"COALESCE(r.data->>'departmentId',(SELECT e.data->>'departmentId' FROM hr_records e WHERE e.id::text=r.data->>'employeeId'))"]];
      for(const [key,expression] of filters){const value=params.get(key);if(value){values.push(value);filter+=' AND '+expression+'=$'+values.length;}}
      if(kind==='holidays'&&(params.get('holidaySite')||params.get('holidayGroup'))){values.push(holidayAliases(params.get('holidaySite'),params.get('holidayGroup')).map(x=>x.toLowerCase()));filter+=" AND (lower(r.data->>'siteId')=ANY($"+values.length+") OR EXISTS(SELECT 1 FROM hr_records hs WHERE hs.kind='sites' AND hs.id::text=r.data->>'siteId' AND lower(hs.code)=ANY($"+values.length+")))";}
      if(params.get('fromDate')){values.push(params.get('fromDate'));filter+=" AND COALESCE(r.data->>'toDate',r.data->>'date') >= $"+values.length;}
      if(params.get('toDate')){values.push(params.get('toDate'));filter+=" AND COALESCE(r.data->>'fromDate',r.data->>'date') <= $"+values.length;}
      const count=await pool.query(`SELECT count(*) FROM hr_records r WHERE ${filter}`,values);
      const result=await pool.query(`SELECT r.* FROM hr_records r WHERE ${filter} ORDER BY r.updated_at DESC,r.id LIMIT 50 OFFSET $${values.length+1}`,[...values,(page-1)*50]);
      if(kind==='leaveAllocations')for(const row of result.rows)if(row.data.__importDraft!=='true')row.data={...row.data,...await balance(pool,row.data.employeeId,row.data.leaveTypeId,row.data.periodId)};
      const siteOptions=kind==='holidays'?(await pool.query("SELECT DISTINCT r.data->>'siteId' AS value FROM hr_records r WHERE r.kind='holidays' AND COALESCE(r.data->>'siteId','')<>'' AND "+scopeSql('r','$1','$2')+" ORDER BY value",[await siteIds(pool,profile),profile.actor])).rows.map(r=>r.value):undefined;
      return {rows:result.rows,total:Number(count.rows[0].count),page,pageSize:50,siteOptions};
    },
    async lookups(profile) {
      if(!grantedMenus(profile).size)throw problem('No HR permissions assigned',403);
      const kinds=[...new Set(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).flatMap(([,config])=>config.fields.filter(x=>x.type==='reference').map(x=>x.reference)))];
      if(grantedMenus(profile).has('Approval Management')&&!kinds.includes('employees'))kinds.push('employees');
      if(canRead(profile,'outDutyRequests'))for(const kind of ['departments','designations','sites'])if(!kinds.includes(kind))kinds.push(kind);
      const result=await pool.query("SELECT r.id,r.kind,r.code,r.name,CASE WHEN r.kind='designations' THEN r.data->>'departmentId' END AS department_id FROM hr_records r WHERE r.kind=ANY($1) AND r.status IN ('ACTIVE','APPROVED') AND "+scopeSql('r','$2')+" ORDER BY r.name LIMIT 10000",[kinds,await siteIds(pool,profile)]);
      return result.rows;
    },
    async save(profile,kind,data,id) {return transaction(db=>save(db,profile,kind,data,id));},
    async cancel(profile,kind,id,version){
      authorize(profile,kind,true);if(!['leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)||!uuid(id))throw problem('Invalid cancellation');
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
      authorize(profile,kind,true);if(['leaveRequests','leaveEncashments','outDutyRequests'].includes(kind))throw problem('Use Cancel for requests',409);if(!uuid(id))throw problem('Invalid record ID');
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
    async importEmployees(profile,records,submitForApproval=false) {
      authorize(profile,'employees',true);
      if(!Array.isArray(records)||!records.length||records.length>500)throw problem('Import 1–500 rows at a time');
      return transaction(async(db,afterCommit)=>{
        let count=0,submitted=0;
        for(const record of records){
          const input={...record};
          const officeData=input.__officeData;delete input.__officeData;
          if(officeData&&(!officeData.constructor||officeData.constructor!==Object))throw problem(`Row ${count+1}: Corporate / HO employee data is invalid`);
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
           try { const saved=await save(db,profile,'employees',input);if(officeData)await db.query("UPDATE hr_records SET data=data||jsonb_build_object('officeData',$1::jsonb) WHERE id=$2",[JSON.stringify(officeData),saved.id]);if(submitForApproval){const configured=await db.query("SELECT 1 FROM hr_records h JOIN hr_records s ON s.code=h.code WHERE h.kind='joiningHierarchies' AND h.status='ACTIVE' AND s.kind='sites' AND s.id::text=$1",[saved.data.siteId||'']);if(configured.rowCount){await submitRecord(db,profile,'employees',saved.id,saved.version,afterCommit);submitted++;}} } catch(error){throw problem(`Row ${count+1}: ${error.code==='23505'?'employee number already exists':error.status?error.message:'unable to save this row'}`,error.status||400);}
          count++;
        }
        return {imported:count,submitted,status:submitted===count?'PENDING':'DRAFT'};
      });
    },
    async submit(profile,kind,id,version){authorize(profile,kind,true);if(!['employees','leaveRequests','leaveEncashments','outDutyRequests'].includes(kind)||!uuid(id))throw problem('Invalid approval submission');return transaction((db,afterCommit)=>submitRecord(db,profile,kind,id,version,afterCommit));},
    async approvals(profile) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      return (await pool.query("SELECT a.*,r.kind,a.record_snapshot->>'code' AS code,a.record_snapshot->>'name' AS name,a.record_snapshot->'data' AS data,(a.record_snapshot ? 'telegramFlow') AS telegram_flow FROM hr_approvals a JOIN hr_records r ON r.id=a.record_id WHERE (a.approvers ? $1 OR a.requested_by=$1) AND "+scopeSql('r','$2')+" ORDER BY a.created_at DESC LIMIT 200",[profile.actor,await siteIds(pool,profile)])).rows;
    },
    async decide(profile,id,input) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      if(!uuid(id)||!['APPROVED','REJECTED'].includes(input.decision))throw problem('Invalid approval decision');
      const comments=String(input.comments||'').trim();if(comments.length>2000||input.decision==='REJECTED'&&!comments)throw problem('A rejection reason is required (maximum 2000 characters)');
      return transaction(async(db,afterCommit)=>{
        const approval=(await db.query('SELECT * FROM hr_approvals WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!approval)throw problem('Approval not found',404);
        if(approval.state!=='PENDING'||approval.version!==Number(input.version))throw problem('This approval has changed. Reload it.',409);
        const next=nextApproval(approval,profile.actor,input.decision);
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE',[approval.record_id])).rows[0];
        await locationAccess(db,profile,record.kind,record.data,record.id);
        const flow=approval.record_snapshot?.telegramFlow;
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
        if(flow){
          const employee=await employeeActor(db,record.data.employeeId,approval.requested_by);
          const recipients=state==='APPROVED'?[employee,flow.siteHr,...flow.directors,handoverActor]:state==='REJECTED'?[employee,flow.siteHr,flow.regionalHr]:[employee,flow.regionalHr];
          const siteName=approval.record_snapshot.telegramSiteName||(await db.query("SELECT s.name FROM hr_records e JOIN hr_records s ON s.id::text=e.data->>'siteId' AND s.kind='sites' WHERE e.id::text=$1 AND e.kind='employees'",[record.data.employeeId||''])).rows[0]?.name;
          const account=(await db.query('SELECT telegram_user_id FROM hr_telegram_accounts WHERE actor=$1',[profile.actor])).rows[0];
          await queueTelegram(db,id+':decision:'+approval.version,recipients,leaveMessage(record,state,{siteName,actor:profile.actor,name:profile.name,telegramId:account?.telegram_user_id,at:history.at(-1).at,comments}));
        }
        await audit(db,profile.actor,input.decision,record.kind,record.id,{stage:approval.stage+1,comments,...(handoverActor?{chargeEmployeeId:record.data.chargeEmployeeId}:{})});
        if(record.kind==='employees'){
          const site=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='sites'",[record.data.siteId||''])).rows[0],steps=approvalSteps(approval);
          if(site?.code==='CMLL-CO'){
            if(state==='PENDING'){const step=steps[stage];afterCommit?.(()=>telegram.approvalRequested({siteCode:site.code,record:approval.record_snapshot,step,stage:stage+1,total:steps.length,requestedBy:approval.requested_by,previousApprover:profile.actor}));}
            else afterCommit?.(()=>telegram.finalDecision({siteCode:site.code,record:approval.record_snapshot,state,approver:profile.actor,comments,decidedAt:new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),recipients:steps.flatMap(step=>step.approvers)}));
          }
        }
        return {state};
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
  };
}
