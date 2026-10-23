import {balance,checkLeave,employeeLeaveKinds} from './leave.mjs';
import { randomUUID } from 'node:crypto';
import { modules, grantedMenus, canRead, canWrite, validate } from './modules.mjs';
import {assignedSites,siteIds,scopeSql} from './scope.mjs';
export function problem(message,status=400) { return Object.assign(new Error(message),{status}); }
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export function createService(pool) {
  const audit = (db,actor,action,kind,id,detail={}) => db.query('INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,$3,$4,$5)',[actor,action,kind,id,detail]);
  async function transaction(fn) {
    const db=await pool.connect();
    try { await db.query('BEGIN'); const result=await fn(db); await db.query('COMMIT'); return result; }
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
    if(kind==='sites')site=id;
    if(employeeLeaveKinds.includes(kind))site=(await db.query("SELECT data->>'siteId' AS site FROM hr_records WHERE id=$1 AND kind='employees'",[data.employeeId])).rows[0]?.site;
    if(!['employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments'].includes(kind))throw problem('Global master changes require an account without a site restriction',403);
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
    await checkLeave(db,kind,data,linked,id);
    if(kind==='leaveRequests') {
      const overlap=await db.query("SELECT 1 FROM hr_records WHERE kind='leaveRequests' AND status IN ('PENDING','APPROVED') AND data->>'employeeId'=$1 AND data->>'fromDate'<=$2 AND data->>'toDate'>=$3 AND id<>$4",[data.employeeId,data.toDate,data.fromDate,id||randomUUID()]);
      if(overlap.rowCount) throw problem('Employee already has overlapping pending or approved leave',409);
      const days=data.days??((Date.parse(data.toDate)-Date.parse(data.fromDate))/86400000+1);
      const year=data.fromDate.slice(0,4);
      if(!data.periodId&&year!==data.toDate.slice(0,4))throw problem('Split leave requests across calendar years');
      const used=await db.query("SELECT COALESCE(SUM(COALESCE((data->>'days')::numeric, (data->>'toDate')::date-(data->>'fromDate')::date+1)),0) AS days FROM hr_records WHERE kind='leaveRequests' AND status IN ('PENDING','APPROVED') AND data->>'employeeId'=$1 AND data->>'policyId'=$2 AND (CASE WHEN $5='' THEN left(data->>'fromDate',4)=$3 ELSE data->>'periodId'=$5 END) AND id<>$4",[data.employeeId,data.policyId,year,id||randomUUID(),data.periodId||'']);
      if(days+Number(used.rows[0].days)>Number(linked.policyId.data.annualDays))throw problem('Leave exceeds the configured annual entitlement');
    }
  }
  async function save(db,profile,kind,input,id) {
    authorize(profile,kind,true);
    const data=validate(kind,input); let existing;
    if(id){
      if(!uuid(id))throw problem('Invalid record ID');
      existing=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
      if(!existing)throw problem('Record not found',404);
      if(existing.version!==Number(input.version))throw problem('This record changed. Reload it before saving.',409);
      if(['leaveRequests','leaveEncashments'].includes(kind)&&['APPROVED','CANCELLED','INACTIVE'].includes(existing.status))throw problem('Finalized requests cannot be edited',409);
      if(kind==='leaveAllocations'&&['employeeId','leaveTypeId','periodId'].some(key=>existing.data[key]!==data[key]))throw problem('Allocation employee, type and period cannot be changed. Create another allocation instead.',409);
      if(existing.status==='PENDING')throw problem('A record awaiting approval cannot be edited',409);
      await locationAccess(db,profile,kind,existing.data,id);
    }
    await locationAccess(db,profile,kind,data,id);
    await references(db,kind,data,id);
    const status=['employees','leaveRequests','leaveEncashments'].includes(kind)?'DRAFT':'ACTIVE';
    let result;
    if(id) result=await db.query('UPDATE hr_records SET code=$1,name=$2,data=$3,status=$4,version=version+1,updated_by=$5,updated_at=now() WHERE id=$6 RETURNING *',[data.code,data.name,data,status,profile.actor,id]);
    else result=await db.query('INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *',[randomUUID(),kind,data.code,data.name,data,status,profile.actor]);
    const row=result.rows[0];
    await audit(db,profile.actor,id?'UPDATE':'CREATE',kind,row.id,{code:row.code,fields:Object.keys(data)});
    return row;
  }
  return {
    async config(profile) { const scoped=assignedSites(profile)!==null;return {profile,modules:Object.fromEntries(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).map(([kind,config])=>[kind,{...config,canWrite:canWrite(profile,kind)&&(!scoped||['employees','sites','shifts','holidays','leaveBlocks','leaveRequests','leaveAllocations','leaveEncashments'].includes(kind))}]))}; },
    async list(profile,kind,params) {
      authorize(profile,kind);
      const page=Math.max(1,Math.min(10000,Number(params.get('page'))||1));
      const search=(params.get('search')||'').slice(0,150);const status=params.get('status')||'';
      let filter="r.kind=$1 AND ($2='' OR r.code ILIKE '%'||$2||'%' OR r.name ILIKE '%'||$2||'%') AND ($3='' OR r.status=$3) AND "+scopeSql('r','$4');
      const values=[kind,search,status,await siteIds(pool,profile)];
      const filters=[['leaveTypeId',"r.data->>'leaveTypeId'"],['periodId',"r.data->>'periodId'"],['siteId',"r.data->>'siteId'"],['year',"left(r.data->>'date',4)"],['departmentId',"COALESCE(r.data->>'departmentId',(SELECT e.data->>'departmentId' FROM hr_records e WHERE e.id::text=r.data->>'employeeId'))"]];
      for(const [key,expression] of filters){const value=params.get(key);if(value){values.push(value);filter+=' AND '+expression+'=$'+values.length;}}
      if(params.get('fromDate')){values.push(params.get('fromDate'));filter+=" AND COALESCE(r.data->>'toDate',r.data->>'date') >= $"+values.length;}
      if(params.get('toDate')){values.push(params.get('toDate'));filter+=" AND COALESCE(r.data->>'fromDate',r.data->>'date') <= $"+values.length;}
      const count=await pool.query(`SELECT count(*) FROM hr_records r WHERE ${filter}`,values);
      const result=await pool.query(`SELECT r.* FROM hr_records r WHERE ${filter} ORDER BY r.updated_at DESC,r.id LIMIT 50 OFFSET $${values.length+1}`,[...values,(page-1)*50]);
      if(kind==='leaveAllocations')for(const row of result.rows)row.data={...row.data,...await balance(pool,row.data.employeeId,row.data.leaveTypeId,row.data.periodId)};
      return {rows:result.rows,total:Number(count.rows[0].count),page,pageSize:50};
    },
    async lookups(profile) {
      if(!grantedMenus(profile).size)throw problem('No HR permissions assigned',403);
      const kinds=[...new Set(Object.entries(modules).filter(([kind])=>canRead(profile,kind)).flatMap(([,config])=>config.fields.filter(x=>x.type==='reference').map(x=>x.reference)))];
      const result=await pool.query("SELECT r.id,r.kind,r.code,r.name FROM hr_records r WHERE r.kind=ANY($1) AND r.status IN ('ACTIVE','APPROVED') AND "+scopeSql('r','$2')+" ORDER BY r.name LIMIT 10000",[kinds,await siteIds(pool,profile)]);
      return result.rows;
    },
    async save(profile,kind,data,id) {return transaction(db=>save(db,profile,kind,data,id));},
    async cancel(profile,kind,id,version){
      authorize(profile,kind,true);if(!['leaveRequests','leaveEncashments'].includes(kind)||!uuid(id))throw problem('Invalid cancellation');
      return transaction(async db=>{
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
      if(!['holidays','leaveTypes','leavePolicies','leavePeriods','leaveAllocations','leaveRequests','leaveEncashments','leaveBlocks'].includes(kind))throw problem('Unsupported import');
      authorize(profile,kind,true);if(!Array.isArray(records)||!records.length||records.length>500)throw problem('Import 1–500 rows');
      return transaction(async db=>{for(const record of records){const input={...record};for(const f of modules[kind].fields.filter(f=>f.type==='reference'))if(input[f.key]&&!uuid(input[f.key])){const ref=await db.query("SELECT id FROM hr_records WHERE kind=$1 AND code=$2 AND status IN ('ACTIVE','APPROVED')",[f.reference,String(input[f.key])]);if(!ref.rowCount)throw problem('Unknown '+f.label+' code');input[f.key]=ref.rows[0].id;}await save(db,profile,kind,input);}return {imported:records.length};});
    },
    async deactivate(profile,kind,id,version) {
      authorize(profile,kind,true);if(['leaveRequests','leaveEncashments'].includes(kind))throw problem('Use Cancel for requests',409);if(!uuid(id))throw problem('Invalid record ID');
      return transaction(async db=>{
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
    async importEmployees(profile,records) {
      authorize(profile,'employees',true);
      if(!Array.isArray(records)||!records.length||records.length>500)throw problem('Import 1–500 rows at a time');
      return transaction(async db=>{
        let count=0;
        for(const record of records){
          const input={...record};
          for(const field of modules.employees.fields.filter(x=>x.type==='reference')){
            if(input[field.key]&&!uuid(input[field.key])){
              const found=await db.query("SELECT id FROM hr_records WHERE kind=$1 AND code=$2 AND status IN ('ACTIVE','APPROVED')",[field.reference,String(input[field.key]).trim()]);
              if(!found.rowCount)throw problem(`Row ${count+1}: unknown ${field.label} code`);
              input[field.key]=found.rows[0].id;
            }
          }
          try { await save(db,profile,'employees',input); } catch(error){throw problem(`Row ${count+1}: ${error.code==='23505'?'employee number already exists':error.status?error.message:'unable to save this row'}`,error.status||400);}
          count++;
        }
        return {imported:count,status:'DRAFT'};
      });
    },
    async submit(profile,kind,id,version) {
      authorize(profile,kind,true);
      if(!['employees','leaveRequests','leaveEncashments'].includes(kind)||!uuid(id))throw problem('Invalid approval submission');
      return transaction(async db=>{
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0];
        if(!record)throw problem('Record not found',404);
        if(record.version!==Number(version)||!['DRAFT','REJECTED'].includes(record.status))throw problem('Reload the record; only drafts or rejected records can be submitted',409);
        await locationAccess(db,profile,kind,record.data,id);
        await references(db,kind,record.data,id);
        let companyId=record.data.companyId,siteId=record.data.siteId;
        if(['leaveRequests','leaveEncashments'].includes(kind)){const employee=(await db.query('SELECT data FROM hr_records WHERE id=$1',[record.data.employeeId])).rows[0];companyId=employee?.data.companyId;siteId=employee?.data.siteId;}
        const rules=(await db.query("SELECT * FROM hr_records WHERE kind='approvalRules' AND status='ACTIVE' AND data->>'target'=$1 AND (COALESCE(data->>'companyId','')='' OR data->>'companyId'=$2) AND (COALESCE(data->>'siteId','')='' OR data->>'siteId'=$3)",[kind,companyId||'',siteId||''])).rows;
        const weight=r=>(r.data.companyId?1:0)+(r.data.siteId?2:0);rules.sort((a,b)=>weight(b)-weight(a));
        if(!rules.length&&!record.data.approver)throw problem('Configure an active approval-matrix rule for this module before submitting',409);
        if(rules.length>1&&weight(rules[0])===weight(rules[1]))throw problem('Approval rules overlap. Resolve the approval matrix before submitting.',409);
        const workflow=!rules.length&&record.data.approver?{id:null,data:{approvers:record.data.approver}}:(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='workflows' AND status='ACTIVE'",[rules[0].data.workflowId])).rows[0];
        if(!workflow)throw problem('The configured workflow is not active',409);
        const approvers=workflow.data.approvers.split(',');
        if(approvers.includes(profile.actor))throw problem('The requester cannot be an approver in their own workflow. Configure another approver.',409);
        const snapshot={code:record.code,name:record.name,data:{...record.data}};
        for(const field of modules[kind].fields.filter(x=>x.type==='reference'))if(record.data[field.key]){
          const ref=(await db.query('SELECT code,name FROM hr_records WHERE id=$1',[record.data[field.key]])).rows[0];
          if(ref)snapshot.data[field.key]=`${ref.code} · ${ref.name}`;
        }
        await db.query('INSERT INTO hr_approvals(id,record_id,approvers,requested_by,record_snapshot) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,JSON.stringify(approvers),profile.actor,snapshot]);
        await db.query("UPDATE hr_records SET status='PENDING',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2",[profile.actor,id]);
        await audit(db,profile.actor,'SUBMIT',kind,id,{workflowId:workflow.id,stages:approvers.length});
        return {status:'PENDING'};
      });
    },
    async approvals(profile) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      return (await pool.query("SELECT a.*,r.kind,a.record_snapshot->>'code' AS code,a.record_snapshot->>'name' AS name,a.record_snapshot->'data' AS data FROM hr_approvals a JOIN hr_records r ON r.id=a.record_id WHERE (a.approvers ? $1 OR a.requested_by=$1) AND "+scopeSql('r','$2')+" ORDER BY a.created_at DESC LIMIT 200",[profile.actor,await siteIds(pool,profile)])).rows;
    },
    async decide(profile,id,input) {
      if(!grantedMenus(profile).has('Approval Management'))throw problem('Approval Management permission required',403);
      if(!uuid(id)||!['APPROVED','REJECTED'].includes(input.decision))throw problem('Invalid approval decision');
      const comments=String(input.comments||'').trim();if(comments.length>2000||input.decision==='REJECTED'&&!comments)throw problem('A rejection reason is required (maximum 2000 characters)');
      return transaction(async db=>{
        const approval=(await db.query('SELECT * FROM hr_approvals WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if(!approval)throw problem('Approval not found',404);
        if(approval.state!=='PENDING'||approval.version!==Number(input.version))throw problem('This approval has changed. Reload it.',409);
        if(approval.requested_by===profile.actor||approval.approvers[approval.stage]!==profile.actor)throw problem('Only the current assigned approver can decide; self-approval is prohibited',403);
        const record=(await db.query('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE',[approval.record_id])).rows[0];
        await locationAccess(db,profile,record.kind,record.data,record.id);
        const stage=approval.stage+1;
        const state=input.decision==='REJECTED'?'REJECTED':stage===approval.approvers.length?'APPROVED':'PENDING';
        const history=[...approval.history,{actor:profile.actor,stage:approval.stage+1,decision:input.decision,comments,at:new Date().toISOString()}];
        await db.query('UPDATE hr_approvals SET stage=$1,state=$2,history=$3,version=version+1,updated_at=now() WHERE id=$4',[stage,state,JSON.stringify(history),id]);
        if(state!=='PENDING')await db.query('UPDATE hr_records SET status=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[state==='APPROVED'&&record.kind==='employees'?'ACTIVE':state,profile.actor,record.id]);
        await audit(db,profile.actor,input.decision,record.kind,record.id,{stage:approval.stage+1,comments});return {state};
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
