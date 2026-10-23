// Deployment-only integration check. Every fixture and audit entry is rolled back.
// No HTTP route can invoke it, and it requires only the HR runtime database role.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createService} from './service.mjs';
export async function verifyDatabase(pool){
 const client=await pool.connect();const prefix='VERIFY-'+randomUUID();let sequence=0;const stack=[];
 const db={query:async(sql,values)=>{
   if(sql==='BEGIN'){const point='hr_verify_'+(++sequence);stack.push(point);return client.query('SAVEPOINT '+point);}
   if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT '+stack.pop());
   if(sql==='ROLLBACK'){const point=stack.pop();await client.query('ROLLBACK TO SAVEPOINT '+point);return client.query('RELEASE SAVEPOINT '+point);}
   return client.query(sql,values);
 },release:()=>{}};
 const service=createService({connect:async()=>db,query:(sql,values)=>client.query(sql,values)});
 const user=actor=>({actor,permissions:{application:'HR',hrDesktopAccess:['Dashboard','Employee Master','Master Configuration','Approval Management','Holiday & Leave','Audit Logs']}});
 const owner=user('hr-verification-requester'),reviewer=user('hr-verification-reviewer'),second=user('hr-verification-second');
 try{
  await client.query('BEGIN');
  const company=await service.save(owner,'companies',{code:prefix,name:'Verification company'});
  const company2=await service.save(owner,'companies',{code:prefix+'-2',name:'Verification company two'});
  const region=await service.save(owner,'regions',{code:prefix,name:'Verification region',state:'Test state'});
  const site=await service.save(owner,'sites',{code:prefix,name:'Verification site',companyId:company.id,regionId:region.id,state:'Test state',siteType:'Office'});
  const employeeData={code:prefix,name:'Verification employee',joiningDate:'2026-01-01',category:'Permanent',companyId:company.id,siteId:site.id};
  await assert.rejects(service.save(owner,'employees',{...employeeData,companyId:company2.id}),/selected company/);
  let employee=await service.save(owner,'employees',employeeData);assert.equal(employee.status,'DRAFT');
  assert.equal((await service.list(owner,'employees',new URLSearchParams({search:prefix}))).total,1);
  await assert.rejects(service.save(owner,'employees',{...employeeData,version:0},employee.id),e=>e.status===409);
  const flow=await service.save(owner,'workflows',{code:prefix,name:'Verification flow',approvers:'hr-verification-reviewer,hr-verification-second'});
  await service.save(owner,'approvalRules',{code:prefix,name:'Verification employee rule',target:'employees',workflowId:flow.id,companyId:company.id,siteId:site.id});
  await service.submit(owner,'employees',employee.id,employee.version);
  let approval=(await service.approvals(reviewer)).find(x=>x.record_id===employee.id);assert.ok(approval);
  assert.equal(approval.data.siteId,site.code+' · '+site.name);
  await assert.rejects(service.decide(owner,approval.id,{decision:'APPROVED',version:approval.version}),e=>e.status===403);
  await assert.rejects(service.decide(second,approval.id,{decision:'APPROVED',version:approval.version}),e=>e.status===403);
  assert.equal((await service.decide(reviewer,approval.id,{decision:'APPROVED',version:approval.version})).state,'PENDING');
  approval=(await service.approvals(second)).find(x=>x.id===approval.id);
  assert.equal((await service.decide(second,approval.id,{decision:'APPROVED',version:approval.version})).state,'APPROVED');
  employee=(await service.list(owner,'employees',new URLSearchParams({search:prefix}))).rows[0];assert.equal(employee.status,'ACTIVE');
  const policy=await service.save(owner,'leavePolicies',{code:prefix,name:'Verification leave policy',annualDays:2,companyId:company.id});
  await service.save(owner,'approvalRules',{code:prefix+'-leave',name:'Verification leave rule',target:'leaveRequests',workflowId:flow.id,companyId:company.id,siteId:site.id});
  const leaveData={code:prefix,name:'Verification leave',employeeId:employee.id,policyId:policy.id,fromDate:'2026-11-01',toDate:'2026-11-03'};
  await assert.rejects(service.save(owner,'leaveRequests',leaveData),/annual entitlement/);
  const leave=await service.save(owner,'leaveRequests',{...leaveData,toDate:'2026-11-02'});
  await service.submit(owner,'leaveRequests',leave.id,leave.version);
  await assert.rejects(service.save(owner,'leaveRequests',{...leaveData,code:prefix+'-overlap',toDate:'2026-11-01'}),/overlapping/);
  await assert.rejects(service.importEmployees(owner,[{...employeeData,code:prefix+'-import'},{...employeeData}]),/already exists/);
  assert.equal((await service.list(owner,'employees',new URLSearchParams({search:prefix+'-import'}))).total,0);
  assert.equal((await service.importEmployees(owner,[{...employeeData,code:prefix+'-valid-import'}])).imported,1);
  const scoped={...owner,permissions:{...owner.permissions,site:site.code,adminLevel:'Site'}};
  assert.equal((await service.list(scoped,'employees',new URLSearchParams({search:prefix}))).total,2);
  const outside={...owner,permissions:{...owner.permissions,site:'unassigned-verification-site',adminLevel:'Site'}};
  assert.equal((await service.list(outside,'employees',new URLSearchParams({search:prefix}))).total,0);
  await assert.rejects(service.save(outside,'employees',{...employeeData,code:prefix+'-forbidden'}),e=>e.status===403);
  assert.equal((await service.lookups(outside)).some(x=>x.kind==='employees'),false);

  const leaveType=await service.save(owner,'leaveTypes',{code:prefix,name:'Test paid leave',isPaid:'Yes',maxDaysPerPeriod:12,encashable:'Yes',requiresDocumentAfterDays:3});
  const period=await service.save(owner,'leavePeriods',{code:prefix,name:'Test period',fromDate:'2026-01-01',toDate:'2026-12-31'});
  const newPolicy=await service.save(owner,'leavePolicies',{code:prefix+'-new',name:'Test policy',leaveTypeId:leaveType.id,annualDays:12,companyId:company.id,accrual:'Manual'});
  const allocation=await service.save(owner,'leaveAllocations',{name:'Test allocation',employeeId:employee.id,leaveTypeId:leaveType.id,periodId:period.id,allocated:10});
  const details={name:'Test half day',employeeId:employee.id,leaveTypeId:leaveType.id,periodId:period.id,policyId:newPolicy.id,fromDate:'2026-12-01',toDate:'2026-12-01',halfDay:'Yes'};
  const draft=await service.save(owner,'leaveRequests',details);assert.equal(draft.data.days,0.5);
  await service.submit(owner,'leaveRequests',draft.id,draft.version);
  let allocationList=await service.list(owner,'leaveAllocations',new URLSearchParams({periodId:period.id}));assert.equal(allocationList.rows[0].data.balance,9.5);
  await assert.rejects(service.deactivate(owner,'leaveAllocations',allocation.id,allocation.version),/used or pending/);
  await assert.rejects(service.deactivate(owner,'leavePeriods',period.id,period.version),/pending/);
  await service.cancel(owner,'leaveRequests',draft.id,2);
  allocationList=await service.list(owner,'leaveAllocations',new URLSearchParams({periodId:period.id}));assert.equal(allocationList.rows[0].data.balance,10);
  assert.equal((await service.list(outside,'leaveAllocations',new URLSearchParams({periodId:period.id}))).total,0);
  const encash=await service.save(owner,'leaveEncashments',{name:'Test encashment',employeeId:employee.id,leaveTypeId:leaveType.id,periodId:period.id,days:2,approver:reviewer.actor});
  await service.submit(owner,'leaveEncashments',encash.id,encash.version);
  const encashApproval=(await service.approvals(reviewer)).find(x=>x.record_id===encash.id);
  assert.equal((await service.decide(reviewer,encashApproval.id,{decision:'APPROVED',version:encashApproval.version})).state,'APPROVED');
  assert.equal((await service.list(owner,'leaveAllocations',new URLSearchParams({periodId:period.id}))).rows[0].data.balance,8);
  await assert.rejects(service.save(owner,'leaveEncashments',{...encash.data,version:2},encash.id),/Finalized/);
  await service.save(owner,'leaveBlocks',{code:prefix,name:'Test block',fromDate:'2026-12-01',toDate:'2026-12-01',siteId:site.id,reason:'Test'});
  await assert.rejects(service.save(owner,'leaveRequests',details),/blocked/);
  await assert.rejects(service.importMasters(owner,'holidays',[{code:prefix,name:'Valid holiday',date:'2026-12-25',holidayType:'Public'},{code:prefix+'-bad',name:'Bad holiday',date:'2026-02-30'}]),/valid date/);
  assert.equal((await service.list(owner,'holidays',new URLSearchParams({search:prefix}))).total,0);
  const audit=await service.audit(owner);assert.ok(audit.some(x=>x.record_id===employee.id&&x.action==='APPROVED'));
  await client.query('ROLLBACK');
  assert.equal(Number((await client.query('SELECT count(*) FROM hr_records WHERE code LIKE $1',[prefix+'%'])).rows[0].count),0);
  console.log('HR database integration verification passed; all fixtures rolled back');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
