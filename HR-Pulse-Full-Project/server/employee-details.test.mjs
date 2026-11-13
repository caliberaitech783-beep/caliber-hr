import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

const employeeId='20000000-0000-4000-8000-000000000001',companyId='30000000-0000-4000-8000-000000000001',siteId='40000000-0000-4000-8000-000000000001';
const profile={actor:'hr',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};
function fixture(){
 const record={id:employeeId,kind:'employees',code:'E1',name:'Original',status:'ACTIVE',version:4,data:{code:'E1',name:'Original',companyId,siteId,joiningDate:'2026-10-01',category:'Permanent',officeData:{'Employee Code':'E1','Full Name *':'Original','Site *':'Jayant OB'}}};
 const calls=[];
 const db={release(){},async query(sql,args=[]){calls.push({sql,args});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[],rowCount:0};
  if(sql.startsWith("SELECT * FROM hr_records WHERE id=$1 AND kind='employees'"))return {rows:[record],rowCount:1};
  if(sql.startsWith('UPDATE hr_records'))return {rows:[{...record,name:args[0],data:args[1],version:5}],rowCount:1};
  if(sql.startsWith('INSERT INTO hr_audit'))return {rows:[],rowCount:1};
  if(sql.startsWith("SELECT id FROM hr_records WHERE kind='sites'"))return {rows:[],rowCount:0};
  throw Error('Unexpected SQL: '+sql);
 }};
 return {service:createService({connect:async()=>db}),record,calls};
}
test('individual employee edits preserve active status and untouched joining data',async()=>{
 const {service,record,calls}=fixture();
 record.data.officeData['Sr. No.']=1;
 const officeData={'Full Name *':'Corrected','Mobile *':'9999999999','Employment Type':'Fixed-term',Qualification:'B.Tech'};
 const saved=await service.updateEmployeeDetails(profile,employeeId,{version:4,officeData});
 assert.equal(saved.name,'Corrected');
 assert.equal(saved.status,'ACTIVE');
 assert.equal(saved.version,5);
 assert.equal(saved.data.mobile,'9999999999');
 assert.equal(saved.data.category,'Contract');
 assert.deepEqual(saved.data.officeData,{...record.data.officeData,...officeData});
 assert.ok(!calls.find(call=>call.sql.startsWith('UPDATE hr_records')).sql.includes('status='));
 assert.ok(calls.some(call=>call.sql.startsWith('INSERT INTO hr_audit')&&call.args[1]==='UPDATE'));
});

test('individual employee edits reject stale, inactive, out-of-scope and read-only requests',async()=>{
 const {service,record,calls}=fixture();
 const input={version:4,officeData:{'Mobile *':'9999999999'}};
 await assert.rejects(service.updateEmployeeDetails(profile,employeeId,{...input,version:3}),error=>error.status===409);
 await assert.rejects(service.updateEmployeeDetails({...profile,permissions:{...profile.permissions,site:'other-site'}},employeeId,input),error=>error.status===403);
 await assert.rejects(service.updateEmployeeDetails({...profile,permissions:{hrDesktopAccess:['Employee Directory']}},employeeId,input),error=>error.status===403);
 await assert.rejects(service.updateEmployeeDetails(profile,employeeId,{...input,officeData:{'Site *':'Other site'}}),error=>error.status===400);
 await assert.rejects(service.updateEmployeeDetails(profile,employeeId,{...input,officeData:{'Candidate E-mail *':'  '}}),/Candidate E-mail is required/);
 record.status='PENDING';
 await assert.rejects(service.updateEmployeeDetails(profile,employeeId,input),error=>error.status===409);
 assert.ok(!calls.some(call=>call.sql.startsWith('UPDATE')));
});
