import test from 'node:test';
import assert from 'node:assert/strict';
import {leaveApprovalSteps} from './leave.mjs';
import {nextApproval,hierarchyTemplates,employeeHierarchy} from './joining-hierarchy.mjs';

for(const code of ['NCL-DUDE','NCL-DUDW','NCL-JAYANT'])test(`${code}: leave follows all site steps, either regional HR and any final approver`,async()=>{
 const template=hierarchyTemplates.find(row=>row.code===code),last=template.steps.length-1;
 const steps=template.steps.map((step,index)=>({...step,approvers:index===last-1?['regional-hr-one','regional-hr-two']:index===last?['director-one','director-two']:['site-'+index]}));
 const db={query:async sql=>({rows:sql.startsWith('SELECT code')?[{code}]:[{data:{...template,steps}}]})};
 const hierarchy=await employeeHierarchy(db,'site-id');
 const approval={requested_by:'employee',stage:0,approval_steps:hierarchy.data.steps};
 assert.equal(approval.approval_steps.length,5);
 for(let stage=0;stage<=last;stage++){
  approval.stage=stage;
  assert.throws(()=>nextApproval(approval,'employee','APPROVED'),e=>e.status===403);
  if(stage<last)assert.throws(()=>nextApproval(approval,'director-one','APPROVED'),e=>e.status===403);
  for(const actor of steps[stage].approvers){
   assert.deepEqual(nextApproval(approval,actor,'APPROVED'),{stage:stage+1,state:stage===last?'APPROVED':'PENDING'});
   assert.equal(nextApproval(approval,actor,'REJECTED').state,'REJECTED');
  }
 }
});

test('other sites require RHR then a final Director and cannot use a single-approver override',()=>{
 for(const approvers of ['', 'one', 'one,one'])assert.throws(()=>leaveApprovalSteps({data:{approvers}}),e=>e.status===409);
 assert.deepEqual(leaveApprovalSteps({data:{approvers:'rhr,director-one,director-two'}}),[
  {stage:1,label:'RHR (Region HR Head)',approvers:['rhr']},
  {stage:2,label:'Directors — final approval (any one)',approvers:['director-one','director-two']}
 ]);
});
