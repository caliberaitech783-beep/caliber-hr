import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';
import {canRead,canWrite,validate,modules} from './modules.mjs';
import {requestCode} from './request-number.mjs';
import {progressKinds} from './request-progress.mjs';
import {vtcProblem,vtcBody,misMessage,VTC_COURSES} from './vtc.mjs';

/* VTC Form and VTC approvals (owner, 28 Nov 2026): HR keeps the request and its OD-style approval; Pulse-II (caliber-mis PR 592)
   keeps the record and marks the days present. */
const SITE='00000000-0000-4000-8000-0000000000a1',REG='00000000-0000-4000-8000-0000000000b1',CLERK='00000000-0000-4000-8000-0000000000b2';
const hr={actor:'sitehr',name:'Site HR',permissions:{hrDesktopAccess:['Employee Master','Leave / OD / Gatepass','Approval Management']}};
const approver=actor=>({actor,name:actor,permissions:{hrDesktopAccess:['Approval Management','Employee Master']}});
const form={siteId:SITE,employeeId:'reg:'+REG,fromDate:'2026-11-20',toDate:'2026-11-27',course:'HEMM operator (Dumper)',institute:'VTC Majri',trainer:'R. Rao',certificate:'',vtcStatus:'Ongoing',remarks:''};

test('dates, course and status follow the Pulse-II VTC Master rules',()=>{
  const today='2026-11-28',ok={...form};
  assert.equal(vtcProblem(ok,today),'');
  assert.match(vtcProblem({...ok,fromDate:'2026-10-31'},today),/01-11-2026/);
  assert.match(vtcProblem({...ok,toDate:'2026-11-19'},today),/on or after/);
  assert.match(vtcProblem({...ok,fromDate:'2026-11-01',toDate:'2027-02-01'},today),/92 days/);
  assert.equal(vtcProblem({...ok,fromDate:'2026-11-01',toDate:'2027-01-27'},today),'');   // 88 days, within 60 ahead
  assert.match(vtcProblem({...ok,fromDate:'2027-01-20',toDate:'2027-01-28'},today),/60 days ahead/);
  assert.equal(vtcProblem({...ok,fromDate:'2026-12-01',toDate:'2027-01-27'},today),'');   // after today is allowed
  assert.match(vtcProblem({...ok,toDate:'2026-11-29',vtcStatus:'Completed'},today),/Completed/);
  assert.equal(vtcProblem({...ok,toDate:'2026-11-28',vtcStatus:'Completed'},today),'');
  assert.match(vtcProblem({...ok,course:'Other'},today),/course name/);
  assert.equal(vtcProblem({...ok,course:'Other',courseOther:'Crane operator'},today),'');
  assert.deepEqual(modules.vtcRequests.fields.find(f=>f.key==='course').options,VTC_COURSES);
  assert.throws(()=>validate('vtcRequests',{...form,code:'VTC0001/20-11-2026/CMPL8812',name:'A',course:'Bus'}),/Course is invalid/);
  assert.equal(validate('vtcRequests',{...form,code:'x',name:'A',courseOther:'left over'}).courseOther,'');
});

test('VTC sits beside OD: HR logins read and write it, leave-only logins never see it; numbered VTC0001',()=>{
  for(const menus of [['Leave / OD / Gatepass','Employee Master'],['Employee Master']]){const p={permissions:{hrDesktopAccess:menus}};assert.equal(canRead(p,'vtcRequests'),true);assert.equal(canWrite(p,'vtcRequests'),true);}
  const leaveOnly={permissions:{hrDesktopAccess:['Leave / OD / Gatepass']}};
  assert.equal(canRead(leaveOnly,'vtcRequests'),false);assert.equal(canWrite(leaveOnly,'vtcRequests'),false);
  assert.equal(canRead(leaveOnly,'outDutyRequests'),true);
  assert.equal(modules.vtcRequests.autoCode,true);
  assert.ok(progressKinds.includes('vtcRequests'));
  assert.equal(requestCode('vtcRequests',1,'2026-11-20','CMPL8812'),'VTC0001/20-11-2026/CMPL8812');
  assert.equal(misMessage({status:0,result:null}),'Pulse-II did not answer. Try again in a few minutes.');
  assert.match(misMessage({status:404,result:null}),/does not take VTC/);
  assert.equal(misMessage({status:409,result:{error:'Clashes with OD0003'}}),'Clashes with OD0003');
  assert.deepEqual(vtcBody({code:'VTC0001/20-11-2026/CMPL8812',data:{...form,empCode:'CMPL8812'}},'Majri OC'),
    {request:'VTC0001/20-11-2026/CMPL8812',site:'Majri OC',employee:'CMPL8812',fromDate:'2026-11-20',toDate:'2026-11-27',course:'HEMM operator (Dumper)',courseOther:'',institute:'VTC Majri',trainer:'R. Rao',certificate:'',status:'Ongoing',remarks:''});
});

/* An in-memory HR Pulse database with the statements the VTC flow uses, and a Pulse-II that answers as told. */
function fixture(){
  const records=new Map([[SITE,{id:SITE,kind:'sites',code:'MAJRI',name:'Majri OC',data:{},status:'ACTIVE',version:1}]]);
  const register=new Map([[REG,{id:REG,name:'Ramesh Kumar',code:'CMPL8812',designation:'Dumper Operator',department:'Operations',status:'Active'}],[CLERK,{id:CLERK,name:'Sita Devi',code:'CMPL9000',designation:'Clerk',department:'Admin',status:'Active'}]]);
  const approvals=new Map(),audits=[],calls=[];let answers=[];
  const one=row=>({rows:row?[row]:[],rowCount:row?1:0});
  async function query(sql,args=[]){
    sql=sql.replace(/\s+/g,' ').trim();
    if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
    if(sql.startsWith('INSERT INTO hr_audit')){audits.push({action:args[1],kind:args[2],detail:args[4]??args[3]});return {rows:[]};}
    if(sql.startsWith("SELECT code,name FROM hr_records WHERE kind='sites'")||sql.startsWith("SELECT name FROM hr_records WHERE kind='sites'"))return one(records.get(args[0]));
    if(sql.includes('FROM hr_employee_master_register r WHERE r.id=$4')){const r=register.get(args[3]);return one(r&&args[1]==='majri'?r:null);}
    if(sql.includes('FROM hr_employee_master_register r WHERE'))return {rows:[...register.values()]};
    if(sql.includes("FROM hr_records e WHERE e.kind='employees'"))return {rows:[]};
    if(sql.startsWith("SELECT code FROM hr_records WHERE id::text=$1 AND kind='employees'"))return {rows:[]};
    if(sql.startsWith('SELECT COALESCE(MAX('))return {rows:[{next:[...records.values()].filter(r=>r.kind==='vtcRequests').length+1}]};
    if(sql.startsWith('SELECT * FROM hr_records WHERE id=$1 AND kind=$2 AND status IN'))return one(records.get(args[0])?.kind===args[1]?records.get(args[0]):null);
    if(sql.startsWith('INSERT INTO hr_records')){const row={id:args[0],kind:args[1],code:args[2],name:args[3],data:args[4],status:args[5],created_by:args[6],version:1};records.set(row.id,row);return one(row);}
    if(sql.startsWith('UPDATE hr_records SET code=$1')){const row=records.get(args[5]);Object.assign(row,{code:args[0],name:args[1],data:args[2],status:args[3],version:row.version+1});return one(row);}
    if(/^SELECT \* FROM hr_records WHERE id=\$1 AND kind='vtcRequests'/.test(sql))return one(records.get(args[0])?.kind==='vtcRequests'?structuredClone(records.get(args[0])):null);
    if(/^SELECT \* FROM hr_records WHERE id=\$1 AND kind=\$2/.test(sql))return one(records.get(args[0])?.kind===args[1]?structuredClone(records.get(args[0])):null);
    if(/^SELECT \* FROM hr_records WHERE id=\$1( FOR UPDATE)?$/.test(sql))return one(structuredClone(records.get(args[0])));
    if(sql.startsWith('SELECT h.data,s.code FROM hr_telegram_hierarchies'))return {rows:[]};
    if(sql.startsWith("SELECT * FROM hr_records WHERE kind='approvalRules'"))return {rows:[]};
    if(sql.startsWith('SELECT code,name FROM hr_records WHERE id=$1'))return one(records.get(args[0]));
    if(sql.startsWith('INSERT INTO hr_approvals')){approvals.set(args[0],{id:args[0],record_id:args[1],approvers:JSON.parse(args[2]),requested_by:args[3],record_snapshot:args[4],approval_steps:JSON.parse(args[5]),state:'PENDING',stage:0,version:1,history:[]});return {rows:[]};}
    if(sql.startsWith("UPDATE hr_records SET status='PENDING'")){const row=records.get(args[1]);row.status='PENDING';row.version++;return {rows:[]};}
    if(sql.startsWith('SELECT a.*,r.kind FROM hr_approvals a JOIN')){const a=approvals.get(args[0]);return one(a&&{...structuredClone(a),kind:records.get(a.record_id).kind});}
    if(sql.startsWith('SELECT * FROM hr_approvals WHERE id=$1'))return one(structuredClone(approvals.get(args[0])));
    if(sql.startsWith('UPDATE hr_approvals SET stage=$1,state=$2')){const a=approvals.get(args[3]);Object.assign(a,{stage:args[0],state:args[1],history:JSON.parse(args[2]),version:a.version+1});return {rows:[]};}
    if(sql.startsWith('UPDATE hr_records SET status=$1')){const row=records.get(args[2]);row.status=args[0];row.version++;return {rows:[]};}
    if(sql.startsWith("UPDATE hr_records SET data=jsonb_set(data,'{pulse}'")){const row=records.get(args[0]);if(row.status==='APPROVED')row.data={...row.data,pulse:JSON.parse(args[1])};return {rows:[]};}
    if(sql.includes("r.kind='vtcRequests' AND r.status='APPROVED'"))return {rows:[...records.values()].filter(r=>r.kind==='vtcRequests'&&r.status==='APPROVED'&&r.data.pulse?.state!=='sent').map(r=>structuredClone(r))};
    if(sql.startsWith("SELECT id FROM hr_approvals WHERE record_id=$1 AND state='PENDING'"))return {rows:[]};
    if(sql.startsWith("UPDATE hr_approvals SET state='CANCELLED'"))return {rows:[]};
    if(sql.startsWith("UPDATE hr_records SET status='CANCELLED'")){const row=records.get(args[1]);row.status='CANCELLED';row.version++;if(args[2])row.data={...row.data,pulse:JSON.parse(args[2])};return {rows:[]};}
    if(sql.includes('FROM hr_records WHERE kind=') ||sql.startsWith('SELECT'))return {rows:[]};
    throw new Error('Unexpected statement: '+sql.slice(0,120));
  }
  const fetchMis=async(url,options)=>{
    calls.push({path:url.pathname,method:options.method,auth:options.headers.Authorization,body:options.body?JSON.parse(options.body):null});
    const next=answers.shift()||{status:200,body:{ok:true}};
    if(next.throws)throw new TypeError('fetch failed');
    return {status:next.status,ok:next.status<300,json:async()=>next.body};
  };
  const pool={query,connect:async()=>({query,release(){}})};
  return {service:createService(pool,{telegram:{send:async()=>{}},fetchMis}),records,approvals,audits,calls,answer:(...list)=>{answers=list;}};
}

test('draft → Pulse-II check → HOD → Regional HR → Pulse-II record; HR keeps no attendance of its own',async()=>{
  const f=fixture(),grant={token:'g'.repeat(43)};
  const draft=await f.service.save(hr,'vtcRequests',{...form,empCode:'TYPED',name:'Typed name'});
  assert.equal(draft.status,'DRAFT');
  assert.equal(draft.code,'VTC0001/20-11-2026/CMPL8812');
  assert.equal(draft.name,'Ramesh Kumar');                       // from Employee Master, not the form
  assert.deepEqual([draft.data.empCode,draft.data.registerId,draft.data.department],['CMPL8812',REG,'Operations']);
  assert.equal(f.calls.length,0);                                // saving a draft never asks Pulse-II

  /* Pulse-II refuses on submit (clash): nothing is submitted. */
  f.answer({status:409,body:{error:'CMPL8812 is on OD on 22-11-2026 (OD0004).'}});
  await assert.rejects(f.service.submit(hr,'vtcRequests',draft.id,draft.version,grant),e=>e.status===409&&/Pulse-II: CMPL8812 is on OD/.test(e.message));
  assert.equal(f.records.get(draft.id).status,'DRAFT');assert.equal(f.approvals.size,0);
  assert.deepEqual(f.calls[0],{path:'/api/integrations/hr/vtc/check',method:'POST',auth:'Bearer '+grant.token,body:vtcBody(draft,'Majri OC')});

  /* Accepted: the OD route (no site set in Approval Master › OD: HOD apurvakopulwar → Regional HR mayuriumate). */
  assert.equal((await f.service.submit(hr,'vtcRequests',draft.id,draft.version,grant)).status,'PENDING');
  const [approval]=[...f.approvals.values()];
  assert.deepEqual(approval.approval_steps.map(s=>[s.label,s.approvers]),[['HOD',['apurvakopulwar']],['Regional HR',['mayuriumate']]]);

  /* HOD approves: not the last step, Pulse-II is not asked. */
  const callsBefore=f.calls.length;
  assert.equal((await f.service.decide(approver('apurvakopulwar'),approval.id,{decision:'APPROVED',version:1},false,grant)).state,'PENDING');
  assert.equal(f.calls.length,callsBefore);

  /* Regional HR, last step: Pulse-II's check refuses → the request keeps waiting for Regional HR. */
  f.answer({status:403,body:{error:'Majri OC is outside your Pulse-II sites.'}});
  await assert.rejects(f.service.decide(approver('mayuriumate'),approval.id,{decision:'APPROVED',version:2},false,grant),e=>e.status===403);
  assert.equal(f.approvals.get(approval.id).state,'PENDING');assert.equal(f.records.get(draft.id).status,'PENDING');

  /* Check passes, then the PUT stores it in Pulse-II. */
  f.answer({status:200,body:{ok:true}},{status:200,body:{ok:true,id:41}});
  const done=await f.service.decide(approver('mayuriumate'),approval.id,{decision:'APPROVED',version:2},false,grant);
  assert.equal(done.state,'APPROVED');assert.equal(done.pulse.state,'sent');
  const put=f.calls.at(-1);
  assert.equal(put.method,'PUT');assert.equal(put.path,'/api/integrations/hr/vtc');assert.equal(put.body.request,draft.code);assert.equal(put.body.employee,'CMPL8812');
  assert.equal(f.records.get(draft.id).status,'APPROVED');
  assert.ok(f.audits.some(a=>a.action==='VTC_TO_PULSE_II'));
  assert.equal([...f.records.values()].some(r=>r.kind!=='vtcRequests'&&r.kind!=='sites'),false); // no attendance of HR's own
});

test('Pulse-II down at the final approval: approved, marked not yet in Pulse-II, Retry sends it; cancel removes it from Pulse-II',async()=>{
  const f=fixture(),grant={token:'g'.repeat(43)};
  const draft=await f.service.save(hr,'vtcRequests',form);
  await f.service.submit(hr,'vtcRequests',draft.id,draft.version,grant);
  const [approval]=[...f.approvals.values()];
  await f.service.decide(approver('apurvakopulwar'),approval.id,{decision:'APPROVED',version:1},false,grant);
  f.answer({status:200,body:{ok:true}},{throws:true});
  const done=await f.service.decide(approver('mayuriumate'),approval.id,{decision:'APPROVED',version:2},false,grant);
  assert.equal(done.state,'APPROVED');assert.equal(done.pulse.state,'failed');assert.match(done.pulse.error,/did not answer/);
  assert.equal(f.records.get(draft.id).status,'APPROVED');        // never lost

  const pending=await f.service.vtcApi(hr,'pending','GET',{},new URLSearchParams(),grant.token);
  assert.deepEqual(pending.rows.map(r=>[r.code,r.tries]),[[draft.code,1]]);
  f.answer({status:503,body:{error:'Pulse-II is restarting.'}});
  assert.deepEqual((await f.service.vtcApi(hr,'retry','POST',{},new URLSearchParams(),grant.token)).failed,1);
  assert.equal(f.records.get(draft.id).data.pulse.error,'Pulse-II is restarting.');assert.equal(f.records.get(draft.id).data.pulse.tries,2);
  f.answer({status:200,body:{ok:true}});
  assert.equal((await f.service.vtcApi(hr,'retry','POST',{id:draft.id},new URLSearchParams(),grant.token)).sent,1);
  assert.equal((await f.service.vtcApi(hr,'pending','GET',{},new URLSearchParams(),grant.token)).rows.length,0);
  await assert.rejects(f.service.vtcApi(hr,'retry','POST',{id:draft.id},new URLSearchParams(),grant.token),e=>e.status===409);

  /* Cancel of the approved request: Pulse-II refuses → it stays approved; Pulse-II removes it → cancelled. */
  const version=f.records.get(draft.id).version;
  f.answer({throws:true});
  await assert.rejects(f.service.cancel(hr,'vtcRequests',draft.id,version,{token:grant.token,input:{}}),e=>e.status===503&&/stays approved/.test(e.message));
  assert.equal(f.records.get(draft.id).status,'APPROVED');
  f.answer({status:200,body:{ok:true}});
  assert.equal((await f.service.cancel(hr,'vtcRequests',draft.id,version,{token:grant.token,input:{reason:'Course postponed'}})).status,'CANCELLED');
  assert.deepEqual(f.calls.at(-1),{path:'/api/integrations/hr/vtc/remove',method:'POST',auth:'Bearer '+grant.token,body:{request:draft.code,reason:'Course postponed'}});
  assert.equal(f.records.get(draft.id).data.pulse.state,'removed');
});

test('only working drivers and operators of the chosen site can be picked',async()=>{
  const f=fixture();
  await assert.rejects(f.service.save(hr,'vtcRequests',{...form,employeeId:'reg:'+CLERK}),e=>e.status===409&&/drivers and operators/.test(e.message));
  await assert.rejects(f.service.save(hr,'vtcRequests',{...form,employeeId:'CMPL8812'}),e=>e.status===400);
  const options=await f.service.vtcApi(hr,'options','GET',{},new URLSearchParams({siteId:SITE}),'');
  assert.deepEqual(options.employees.map(e=>e.label),['CMPL8812 · Ramesh Kumar – Dumper Operator']);
  assert.equal(options.employees[0].value,'reg:'+REG);
  await assert.rejects(f.service.vtcApi({permissions:{hrDesktopAccess:['Leave / OD / Gatepass']}},'options','GET',{},new URLSearchParams({siteId:SITE}),''),e=>e.status===403);
});
