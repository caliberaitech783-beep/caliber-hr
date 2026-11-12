import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

const profile={actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}};
const id='00000000-0000-4000-8000-000000000001';
const trial={id,formNo:'TF/2026-27/0001',stage:'done',result:'PASS',post:'Driver',aadhaar:'234500000000',
 history:['pm','rhr','director'].map(role=>({role,action:'Approved'}))};
const employee={code:'EMP-1',name:'Sample Candidate',joiningDate:'2026-11-12',category:'Permanent',companyId:id,
 __officeData:{'Employee Category':'Driver','Department *':'Driver','Trial Form No.':trial.formNo,'Aadhaar No. *':trial.aadhaar}};

test('only a completed trial in the matching post can use direct employee save',async()=>{
 const service=createService({connect:()=>assert.fail('invalid clearances must fail before saving')});
 await assert.rejects(service.saveTrialEmployee(profile,{employee,trial:{...trial,result:'FAIL'}}),{status:400});
 await assert.rejects(service.saveTrialEmployee(profile,{employee,trial:{...trial,history:trial.history.slice(0,2)}}),{status:400});
 await assert.rejects(service.saveTrialEmployee(profile,{employee:{...employee,__officeData:{...employee.__officeData,'Employee Category':'Staff'}},trial}),{status:400});
 await assert.rejects(service.saveTrialEmployee(profile,{employee:{...employee,__officeData:{...employee.__officeData,'Aadhaar No. *':'234500000001'}},trial}),{status:400});
 await assert.rejects(service.saveTrialEmployee({actor:'other',permissions:{hrDesktopAccess:['Employee Directory']}},{employee,trial}),{status:403});
});

test('a passed trial creates an active employee once without creating an approval',async()=>{
 let linked, active=false, employees=0;
 const db={release(){},async query(sql,params){
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock')||sql.includes('INSERT INTO hr_audit')) return {rows:[]};
  if (sql.includes("WHERE t.kind='trialJoinings'")) return {rows:linked?[linked]:[]};
  if (sql.startsWith('SELECT * FROM hr_records')) return {rows:[{id,kind:'companies',data:{}}],rowCount:1};
  if (sql.startsWith('INSERT INTO hr_records')&&params[1]==='employees') {
   employees++;
   return {rows:[{id:params[0],code:params[2],data:params[4]}]};
  }
  if (sql.includes("SET status='ACTIVE'")&&sql.includes('trialJoiningId')) {active=true;return {rows:[]};}
  if (sql.includes("'trialJoinings'")) {
   assert.equal(active,true);
   linked={data:{...params[3],siteId:params[3].siteId||''},created_by:params[4],status:'ACTIVE'};
   return {rows:[]};
  }
  assert.fail('Unexpected query: '+sql);
 }};
 const service=createService({connect:async()=>db});
 assert.deepEqual(await service.saveTrialEmployee(profile,{employee,trial}),{imported:1,submitted:0,status:'ACTIVE'});
 assert.equal(linked.data.employeeCode,'EMP-1');
 assert.deepEqual(await service.saveTrialEmployee(profile,{employee,trial}),{imported:1,submitted:0,status:'ACTIVE'});
 await assert.rejects(service.saveTrialEmployee(profile,{employee:{...employee,code:'EMP-2'},trial}),{status:409});
 assert.equal(employees,1);
});
