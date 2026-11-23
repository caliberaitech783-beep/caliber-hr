// Owner, 23 Nov 2026: an employee is created, edited and deleted only in HR Pulse. A line that should not be in
// Employee Master can be removed (the whole line is kept in the audit); a person who has left gets Status LEFT and a
// leaving date instead. The people below are made up.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEmployeeMasterRegister,REMOVE_REASONS} from './employee-master-register.mjs';
import {createApi} from './app.mjs';

const menus=['Master Configuration','Employee Master'];
const headOffice={actor:'office.hr',permissions:{hrDesktopAccess:menus}};
const siteHr={actor:'sasti.hr',permissions:{hrDesktopAccess:menus,site:'WCL-SASTI'}};
const siteId='20000000-0000-4000-8000-000000000008',lineId='20000000-0000-4000-8000-000000000009';
const LINE={version:3,name:'SAMPLE TWICE',site_code:'WCL-SASTI',site_name:'Sasti OB',data:{employeeId:'CMLL7001',name:'SAMPLE TWICE',designation:'TIPPER DRIVER',status:'ACTIVE'}};

function store({line=LINE,transfer=false}={}){
 const state={deleted:[],audit:[],statements:[]};
 const query=async(sql,params=[])=>{
  state.statements.push(sql.trim().split(/\s+/)[0]);
  if(sql.includes("kind='sites'"))return {rows:[{id:siteId}]};
  if(sql.includes('FOR UPDATE'))return {rows:line?[line]:[]};
  if(sql.includes("kind='employeeTransfers'"))return {rowCount:transfer?1:0,rows:transfer?[{}]:[]};
  if(sql.startsWith('DELETE FROM hr_employee_master_register')){state.deleted.push(params[0]);return {rowCount:1};}
  if(sql.startsWith('INSERT INTO hr_audit'))return state.audit.push({actor:params[0],kind:params[1],id:params[2],detail:params[3]}),{rowCount:1};
  return {rowCount:0,rows:[]};
 };
 return {state,service:createEmployeeMasterRegister({query,connect:async()=>({query,release(){}})})};
}

test('a line is removed only by a login with every HR site, with a reason, and the whole line goes into the audit',async()=>{
 assert.deepEqual([...REMOVE_REASONS],['Duplicate line','Wrong entry','Not our employee']);
 const {state,service}=store();
 await assert.rejects(service.removeEmployeeMasterRegister(siteHr,lineId,{version:3,reason:'Duplicate line'}),{status:403,message:'Removing a line requires access to all HR sites.'});
 await assert.rejects(service.removeEmployeeMasterRegister(headOffice,lineId,{version:3,reason:''}),{status:400,message:'Choose why this line is removed.'});
 await assert.rejects(service.removeEmployeeMasterRegister(headOffice,lineId,{version:3,reason:'Because'}),{status:400});
 await assert.rejects(service.removeEmployeeMasterRegister(headOffice,lineId,{reason:'Duplicate line'}),{status:400});
 await assert.rejects(service.removeEmployeeMasterRegister(headOffice,lineId,{version:2,reason:'Duplicate line'}),{status:409});
 assert.deepEqual([state.deleted,state.audit],[[],[]]);
 assert.deepEqual(await service.removeEmployeeMasterRegister(headOffice,lineId,{version:3,reason:'Duplicate line'}),{removed:true});
 assert.deepEqual(state.deleted,[lineId]);
 assert.deepEqual(state.audit,[{actor:'office.hr',kind:'employeeMasterRegister',id:lineId,detail:{reason:'Duplicate line',name:'SAMPLE TWICE',site:'Sasti OB',siteCode:'WCL-SASTI',line:LINE.data}}]);
 assert.equal(state.statements.at(-1),'COMMIT');
});

test('a line that is gone, or has a transfer in progress, is not removed',async()=>{
 const gone=store({line:null});
 await assert.rejects(gone.service.removeEmployeeMasterRegister(headOffice,lineId,{version:3,reason:'Wrong entry'}),{status:404});
 const moving=store({transfer:true});
 await assert.rejects(moving.service.removeEmployeeMasterRegister(headOffice,lineId,{version:3,reason:'Wrong entry'}),{status:409,message:'A transfer of this employee is in progress. Finish or cancel it first.'});
 assert.deepEqual([gone.state.deleted,moving.state.deleted,moving.state.statements.at(-1)],[[],[],'ROLLBACK']);
});

test('the leaving date is saved with an edit, and only a date is taken',async()=>{
 const writes=[];
 const db={release(){},query:async(sql,params)=>{
  if(sql.includes('FOR UPDATE'))return {rows:[{version:3,site_id:siteId,site_code:'WCL-SASTI',site_name:'Sasti OB',name:'SAMPLE LEFT',employee_id:'CMLL7002'}]};
  if(sql.includes('UPDATE hr_employee_master_register'))writes.push(JSON.parse(params[1]));
  return {rowCount:0};
 }};
 const service=createEmployeeMasterRegister({connect:async()=>db,query:async()=>({rows:[{id:siteId}]})});
 assert.deepEqual(await service.updateEmployeeMasterRegister(siteHr,lineId,{version:3,changes:{status:'LEFT',leavingDate:'2026-11-20'}}),{saved:true});
 assert.deepEqual(writes,[{status:'LEFT',leavingDate:'2026-11-20'}]);
 await assert.rejects(service.updateEmployeeMasterRegister(siteHr,lineId,{version:3,changes:{leavingDate:'20/11/2026'}}),{status:400,message:'Leaving date must be a date.'});
 assert.deepEqual(await service.updateEmployeeMasterRegister(siteHr,lineId,{version:3,changes:{leavingDate:''}}),{saved:true},'a wrong date can be cleared');
});

test('the edit form is told whether this login may remove the line',async()=>{
 const entry={name:'SAMPLE',version:3,siteCode:'WCL-SASTI',fields:{employeeId:'CMLL7001',leavingDate:'2026-11-20'}};
 const service=sites=>createEmployeeMasterRegister({query:async sql=>sql.includes("kind='sites'")?{rows:sites}:{rowCount:1,rows:[entry]}});
 assert.equal((await service([{id:siteId,code:'WCL-SASTI'}]).employeeMasterRegisterDetails(headOffice,lineId,true)).canRemove,true);
 const scoped=await service([{id:siteId,code:'WCL-SASTI'}]).employeeMasterRegisterDetails(siteHr,lineId,true);
 assert.deepEqual([scoped.canRemove,scoped.fields.leavingDate],[false,'2026-11-20']);
});

test('the remove route is a POST for a signed-in HR login',async()=>{
 let got;
 const server=createApi({query:async()=>({}),allowedOrigin:'https://hr.test',authenticate:async()=>({actor:'office.hr',permissions:{application:'HR',hrDesktopAccess:menus}}),
  service:{removeEmployeeMasterRegister:async(profile,id,input)=>{got=[profile.actor,id,input];return {removed:true};}}}).listen(0);
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/employee-master-register/${lineId}/remove`;
  const ok=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+'a'.repeat(43)},body:JSON.stringify({version:3,reason:'Duplicate line'})});
  assert.equal(ok.status,200);assert.deepEqual(got,['office.hr',lineId,{version:3,reason:'Duplicate line'}]);
  assert.notEqual((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,200,'not without a sign-in');
 }finally{server.close();}
});
