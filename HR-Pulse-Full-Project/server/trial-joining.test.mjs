import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

const profile={actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}};
const id='00000000-0000-4000-8000-000000000001';
const trial={id,formNo:'TF/2026-27/0001',stage:'done',result:'PASS',post:'Driver',aadhaar:'234500000000',
 history:['pm','rhr','director'].map(role=>({role,action:'Approved'}))};
const employee={code:'EMP-1',name:'Sample Candidate',joiningDate:'2026-11-12',category:'Permanent',companyId:id,
 __officeData:{
  'Joining Category *':'NCL','Employee Code':'EMP-1','Full Name as per Aadhar':'Sample Candidate','Full Name *':'Sample Candidate',
  'Father / Spouse Name *':'Sample Parent','Mobile *':'9876543210','Candidate E-mail *':'sample@example.test','Aadhaar No. *':trial.aadhaar,
  'PAN No.':'ABCDE1234F','Present Address':'Sample Address','Reference Type':'Supervisor','Reference Name':'Sample Referrer',
  'Emergency Contact Name':'Sample Contact','Emergency Contact Number':'9876543211','Department *':'Driver','Sub-department *':'Heavy Vehicles',
  'Designation *':'Tipper Driver','Employee Category':'Driver','Reporting To':'Site Manager','Joining Date *':'2026-11-12','Shift *':'General',
  'Employment Type':'Permanent','Salary Type':'HPC','Site / Project':'Jayant OB East','PT State':'Madhya Pradesh','Skill Category':'1341',
  'A-Form No.':'A-1','Driving Licence No.':'DL123','DL Issue Date':'2020-01-01','DL Valid Upto':'2030-01-01','Mess Plan':'NO',
  'Trial Form No.':trial.formNo,'Candidate photo':'photo.jpg','Aadhaar (masked display)':'aadhaar.pdf','Driving licence':'licence.pdf',
 }};

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

test('joining requests fail before an employee record is written when mandatory data is missing',async()=>{
 const db={release(){},async query(sql){
  assert.ok(['BEGIN','ROLLBACK'].includes(sql),'Unexpected write: '+sql);
 }};
 const service=createService({connect:async()=>db});
 const incomplete={...employee,__officeData:{...employee.__officeData,'Mess Plan':' '}};
 await assert.rejects(service.importEmployees(profile,[incomplete],true),/Mess Plan is required/);
 const incompleteTrial={...employee,__officeData:{...employee.__officeData,'Driving licence':''}};
 await assert.rejects(service.saveTrialEmployee(profile,{employee:incompleteTrial,trial}),/Driving licence is required/);
});
