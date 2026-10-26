import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyTemplates,validateHierarchy,nextApproval,approvalSteps,createHierarchies} from './joining-hierarchy.mjs';
const configured=()=>({...hierarchyTemplates[0],enabled:true,steps:hierarchyTemplates[0].steps.map((s,i)=>({...s,approvers:i===2?['hr-one','hr-two']:i===3?['cmd','director','vp']:['site-'+i]}))});
test('unassigned hierarchies can be saved only as disabled',()=>{assert.equal(validateHierarchy({...hierarchyTemplates[0],enabled:false}).enabled,false);assert.throws(()=>validateHierarchy({...hierarchyTemplates[0],enabled:true}),/Assign/);assert.equal(validateHierarchy(configured()).steps.length,4);});
test('site approvals stay sequential and either HR and final approver advance once',()=>{const steps=validateHierarchy(configured()).steps;const a={stage:0,requested_by:'requester',approval_steps:steps,approvers:steps.flatMap(s=>s.approvers)};assert.throws(()=>nextApproval(a,'hr-one','APPROVED'),e=>e.status===403);assert.deepEqual(nextApproval(a,'site-0','APPROVED'),{stage:1,state:'PENDING'});a.stage=2;for(const actor of ['hr-one','hr-two'])assert.deepEqual(nextApproval(a,actor,'APPROVED'),{stage:3,state:'PENDING'});a.stage=3;for(const actor of ['cmd','director','vp'])assert.deepEqual(nextApproval(a,actor,'APPROVED'),{stage:4,state:'APPROVED'});assert.throws(()=>nextApproval(a,'hr-two','APPROVED'),e=>e.status===403);assert.equal(nextApproval(a,'cmd','REJECTED').state,'REJECTED');});
test('legacy approvals remain compatible and self-approval is blocked',()=>{const a={approvers:['alice','bob'],stage:0,requested_by:'alice'};assert.equal(approvalSteps(a).length,2);assert.throws(()=>nextApproval(a,'alice','APPROVED'),e=>e.status===403);});
test('rejects duplicate approvers and hierarchy edits by site-restricted users',async()=>{const data=configured();data.steps[1].approvers=['site-0'];assert.throws(()=>validateHierarchy(data),/only one step/);const service=createHierarchies({});await assert.rejects(service.saveHierarchy({permissions:{hrDesktopAccess:['Master Configuration'],site:'NCL-DUDE'}},configured()),e=>e.status===403);});

test('Jayant starts with HR Manager and saved legacy steps retain remaining assignments',async()=>{
 const {currentHierarchy,employeeHierarchy}=await import('./joining-hierarchy.mjs');
 const template=hierarchyTemplates.find(t=>t.code==='NCL-JAYANT');
 assert.equal(template.steps.length,4);assert.equal(template.steps[0].label,'HR Manager');
 const steps=template.steps.map((s,i)=>({...s,approvers:['user-'+i]}));
 const data={...template,steps:[{stage:1,label:'HR Executive',approvers:['executive']},...steps]};
 assert.deepEqual(currentHierarchy(data).steps,steps);
 assert.equal(data.steps.length,5);
 const db={query:async sql=>({rows:sql.startsWith('SELECT code')?[{code:template.code}]:[{data}]})};
 assert.deepEqual((await employeeHierarchy(db,'site-id')).data.steps,steps);
 assert.deepEqual(approvalSteps({approval_steps:data.steps}),data.steps);
});

test('Nagpur requires sequential site approvals then any one final approver',()=>{
 const template=hierarchyTemplates.find(t=>t.code==='CMLL-CO');
 const data=validateHierarchy({...template,enabled:true,steps:template.steps.map((s,i)=>({...s,approvers:i===3?['cmd','vp']:['nagpur-'+i]}))});
 const a={requested_by:'requester',stage:0,approval_steps:data.steps};
 assert.throws(()=>nextApproval(a,'nagpur-1','APPROVED'),e=>e.status===403);
 for(let i=0;i<3;i++){a.stage=i;assert.equal(nextApproval(a,'nagpur-'+i,'APPROVED').state,'PENDING');}
 a.stage=3;for(const actor of ['cmd','vp'])assert.equal(nextApproval(a,actor,'APPROVED').state,'APPROVED');
});
