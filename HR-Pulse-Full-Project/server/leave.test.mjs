import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './modules.mjs';
import {balance,checkLeave} from './leave.mjs';
import {scopeSql} from './scope.mjs';
const type={code:'CL',name:'Casual',isPaid:'Yes',maxDaysPerPeriod:12,encashable:'No'};
test('leave type fields validate caps and document threshold',()=>{assert.equal(validate('leaveTypes',type).maxDaysPerPeriod,12);for(const change of [{carryForwardMax:13},{requiresDocumentAfterDays:1.5},{isPaid:'maybe'},{maxDaysPerPeriod:-1}])assert.throws(()=>validate('leaveTypes',{...type,...change}));});
const req={name:'Personal',employeeId:'employee',policyId:'policy',fromDate:'2026-10-25',toDate:'2026-10-25',halfDay:'Yes'};
test('request IDs are generated and half days calculated on server',()=>{const result=validate('leaveRequests',{...req,days:99});assert.equal(result.days,.5);assert.match(result.code,/^LR-/);assert.throws(()=>validate('leaveRequests',{...req,toDate:'2026-10-26'}));assert.equal(validate('leaveRequests',{...req,halfDay:'No',toDate:'2026-10-26'}).days,2);});
test('attachments reject unsafe types and oversize data',()=>{assert.throws(()=>validate('leaveRequests',{...req,attachment:'data:text/html;base64,SGVsbG8='}));assert.throws(()=>validate('leaveRequests',{...req,attachment:'data:application/pdf;base64,'+'A'.repeat(700000)}));});
test('balances reserve pending requests and approved encashments but exclude cancelled records',async()=>{const rows=[{kind:'leaveAllocations',status:'ACTIVE',data:{allocated:12}},{kind:'leaveRequests',status:'APPROVED',data:{days:2}},{kind:'leaveRequests',status:'PENDING',data:{days:.5}},{kind:'leaveEncashments',status:'APPROVED',data:{days:1}},{kind:'leaveRequests',status:'CANCELLED',data:{days:5}}];assert.deepEqual(await balance({query:async()=>({rows})},'e','t','p'),{allocated:12,used:3,reserved:.5,balance:8.5});});
test('blocked dates and invalid scope reject leave; attachments stay optional',async()=>{const db={query:async(sql)=>({rows:sql.includes("kind='leaveBlocks'")?[{data:{siteId:'site',fromDate:'2026-10-25'}}]:[]})};await assert.rejects(checkLeave(db,'leaveRequests',{...req,days:.5},{employeeId:{data:{siteId:'site'}},policyId:{data:{}}}),/blocked/);await assert.rejects(checkLeave(db,'leaveRequests',{...req,days:.5},{employeeId:{data:{}},policyId:{data:{departmentId:'dept'}}}),/does not apply/);await checkLeave(db,'leaveRequests',{...req,days:2},{employeeId:{data:{}},policyId:{data:{}},leaveTypeId:{data:{requiresDocumentAfterDays:1}}});});
test('employee-linked leave resources use site scope',()=>{const sql=scopeSql('r','$1');assert.match(sql,/leaveAllocations/);assert.match(sql,/leaveEncashments/);assert.match(sql,/leaveBlocks/);});
test('display-active imported allocations do not credit balances',async()=>{const rows=[{kind:'leaveAllocations',status:'ACTIVE',data:{allocated:100,__importDraft:'true'}},{kind:'leaveAllocations',status:'ACTIVE',data:{allocated:5}}];assert.equal((await balance({query:async()=>({rows})},'e','t','p')).allocated,5);});

test('leave reason accepts written text or safe audio and preserves employee fields',()=>{
 const audio='data:audio/mpeg;base64,SGVsbG8=';
 const saved=validate('leaveRequests',{...req,name:'',reasonAudio:audio,employeeName:'Employee name',companyId:'company',approver:'MANAGER'});
 assert.equal(saved.name,'Audio reason');assert.equal(saved.reasonAudio,audio);assert.equal(saved.employeeName,'Employee name');assert.equal(saved.companyId,'company');assert.equal(saved.approver,'');assert.equal(saved.attachment,'');
 assert.throws(()=>validate('leaveRequests',{...req,name:''}),/required/);
 for(const reasonAudio of ['data:text/html;base64,SGVsbG8=','data:audio/mpeg;base64,'+'A'.repeat(700000)])assert.throws(()=>validate('leaveRequests',{...req,reasonAudio}),/audio/);
});
