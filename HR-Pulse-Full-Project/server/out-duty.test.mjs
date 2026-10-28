import test from 'node:test';
import assert from 'node:assert/strict';
import {odApprovalWorkflow} from './out-duty.mjs';
import {nextApproval} from './joining-hierarchy.mjs';
const pending=()=>({approval_steps:odApprovalWorkflow().data.steps,requested_by:'employee',stage:0,state:'PENDING'});
test('OD requires HOD followed by Regional HR',()=>{
 const a=pending();
 assert.deepEqual(a.approval_steps.map(s=>s.approvers),[['apurvakopulwar'],['mayuriumate']]);
 assert.throws(()=>nextApproval(a,'mayuriumate','APPROVED'),e=>e.status===403);
 const first=nextApproval(a,'apurvakopulwar','APPROVED');
 assert.equal(first.state,'PENDING');assert.equal(first.stage,1);
 assert.equal(nextApproval({...a,...first},'mayuriumate','APPROVED').state,'APPROVED');
 assert.throws(()=>nextApproval({...a,...first},'apurvakopulwar','APPROVED'),e=>e.status===403);
});
test('OD rejects unauthorized and self approval; rejection ends the workflow',()=>{
 const a=pending();
 assert.throws(()=>nextApproval(a,'other','APPROVED'),e=>e.status===403);
 assert.throws(()=>nextApproval({...a,requested_by:'apurvakopulwar'},'apurvakopulwar','APPROVED'),e=>e.status===403);
 assert.equal(nextApproval(a,'apurvakopulwar','REJECTED').state,'REJECTED');
 assert.equal(nextApproval({...a,stage:1},'mayuriumate','REJECTED').state,'REJECTED');
});
