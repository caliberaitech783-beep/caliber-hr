import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

/* Owner, 21 Nov 2026: Completed Form lists every fully approved employee in the user's Pulse sites, whoever
   submitted or approved it; Employee Verify keeps only the user's own employee forms, so leave, OD and gate
   pass requests never push them out of the latest-200 list. */
const siteId='40000000-0000-4000-8000-000000000001';
function fixture(){
 const calls=[];
 const db={async query(sql,args=[]){calls.push({sql,args});
  if(sql.startsWith("SELECT id FROM hr_records WHERE kind='sites'"))return {rows:[{id:siteId}],rowCount:1};
  if(sql.startsWith('SELECT a.*'))return {rows:[{id:'a1',kind:'employees',state:'APPROVED'}],rowCount:1};
  throw Error('Unexpected SQL: '+sql);
 }};
 return {service:createService(db),calls};
}
const profile={actor:'sitehr',permissions:{application:'HR',site:'Sasti',hrDesktopAccess:['Approval Management','Employee Master']}};
const listQuery=calls=>calls.find(call=>call.sql.startsWith('SELECT a.*'));

test('Completed Form lists every approved employee in the user sites, not only their own',async()=>{
 const {service,calls}=fixture();
 assert.deepEqual(await service.completedEmployees(profile),[{id:'a1',kind:'employees',state:'APPROVED',can_permanent_delete:false}]);
 const {sql,args}=listQuery(calls);
 assert.match(sql,/r\.kind='employees' AND a\.state='APPROVED'/);
 assert.doesNotMatch(sql,/a\.approvers \?|requested_by=/);
 assert.match(sql,/LIMIT 2000$/);
 assert.deepEqual(args,[[siteId]]);
});

test('Employee Verify lists only the user own employee forms that are not yet approved',async()=>{
 const {service,calls}=fixture();
 await service.employeeApprovals(profile);
 const {sql,args}=listQuery(calls);
 assert.match(sql,/\(a\.approvers \? \$1 OR a\.requested_by=\$1\) AND r\.kind='employees' AND a\.state<>'APPROVED'/);
 assert.match(sql,/LIMIT 200$/);
 assert.deepEqual(args,['sitehr',[siteId]]);
});

test('the general approval inbox is unchanged',async()=>{
 const {service,calls}=fixture();
 await service.approvals(profile);
 const {sql,args}=listQuery(calls);
 assert.match(sql,/WHERE \(a\.approvers \? \$1 OR a\.requested_by=\$1\) AND \(\$2::text\[\] IS NULL/);
 assert.doesNotMatch(sql,/r\.kind='employees'/);
 assert.deepEqual(args,['sitehr',[siteId]]);
});

test('every employee approval list still needs Approval Management',async()=>{
 const {service}=fixture();
 const noApprovals={...profile,permissions:{...profile.permissions,hrDesktopAccess:['Employee Master']}};
 for(const list of ['approvals','employeeApprovals','completedEmployees'])await assert.rejects(service[list](noApprovals),{status:403});
});

test('all-sites admin permanently deletes only the selected completed employee',async()=>{
 const id='11111111-1111-4111-8111-111111111111',queries=[];
 const db={async query(sql,args=[]){queries.push({sql,args});if(sql.startsWith('SELECT r.*,a.state'))return {rows:[{id,code:'CMLL001',name:'Selected Employee',approval_state:'APPROVED'}],rowCount:1};return {rows:[],rowCount:1};},release(){}};
 const service=createService({connect:async()=>db});
 const admin={actor:'admin',permissions:{application:'HR',site:'All Sites',hrDesktopAccess:['Approval Management','Employee Master']}};
 assert.deepEqual(await service.permanentDeleteCompletedEmployee(admin,id),{deleted:1,id});
 assert.deepEqual(queries.find(call=>call.sql.startsWith("DELETE FROM hr_records WHERE id="))?.args,[id]);
 assert.ok(queries.some(call=>call.sql.startsWith('DELETE FROM hr_approvals WHERE record_id=')));
 assert.equal(queries.at(-1).sql,'COMMIT');
});

test('site-restricted users cannot permanently delete completed employees',async()=>{
 const service=createService({connect:async()=>{throw Error('must not connect');}});
 await assert.rejects(service.permanentDeleteCompletedEmployee(profile,'11111111-1111-4111-8111-111111111111'),{status:403});
});
