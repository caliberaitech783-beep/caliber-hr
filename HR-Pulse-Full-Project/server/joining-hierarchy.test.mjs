import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyTemplates,validateHierarchy,nextApproval,approvalSteps,createHierarchies,withDriverTrainer,employeeHierarchy} from './joining-hierarchy.mjs';
const configured=()=>({...hierarchyTemplates[0],enabled:true,steps:hierarchyTemplates[0].steps.map((s,i)=>({...s,approvers:i===3?['hr-one','hr-two']:i===4?['cmd','director','vp']:['site-'+i]}))});
test('unassigned hierarchies can be saved only as disabled',()=>{assert.equal(validateHierarchy({...hierarchyTemplates[0],enabled:false}).enabled,false);assert.throws(()=>validateHierarchy({...hierarchyTemplates[0],enabled:true}),/Assign/);assert.equal(validateHierarchy(configured()).steps.length,5);});
test('site approvals stay sequential and either HR and final approver advance once',()=>{const steps=validateHierarchy(configured()).steps;const a={stage:0,requested_by:'requester',approval_steps:steps,approvers:steps.flatMap(s=>s.approvers)};assert.throws(()=>nextApproval(a,'hr-one','APPROVED'),e=>e.status===403);assert.deepEqual(nextApproval(a,'site-0','APPROVED'),{stage:1,state:'PENDING'});a.stage=2;assert.deepEqual(nextApproval(a,'site-2','APPROVED'),{stage:3,state:'PENDING'});a.stage=3;for(const actor of ['hr-one','hr-two'])assert.deepEqual(nextApproval(a,actor,'APPROVED'),{stage:4,state:'PENDING'});a.stage=4;for(const actor of ['cmd','director','vp'])assert.deepEqual(nextApproval(a,actor,'APPROVED'),{stage:5,state:'APPROVED'});assert.throws(()=>nextApproval(a,'hr-two','APPROVED'),e=>e.status===403);assert.equal(nextApproval(a,'cmd','REJECTED').state,'REJECTED');});
test('legacy approvals remain compatible and self-approval is blocked',()=>{const a={approvers:['alice','bob'],stage:0,requested_by:'alice'};assert.equal(approvalSteps(a).length,2);assert.throws(()=>nextApproval(a,'alice','APPROVED'),e=>e.status===403);});
test('rejects duplicate approvers and hierarchy edits by site-restricted users',async()=>{const data=configured();data.steps[1].approvers=['site-0'];assert.throws(()=>validateHierarchy(data),/only one step/);const service=createHierarchies({});await assert.rejects(service.saveHierarchy({permissions:{hrDesktopAccess:['Master Configuration'],site:'NCL-DUDE'}},configured()),e=>e.status===403);});

test('Jayant starts with HR Manager and saved legacy steps retain remaining assignments',async()=>{
 const {currentHierarchy,employeeHierarchy}=await import('./joining-hierarchy.mjs');
 const template=hierarchyTemplates.find(t=>t.code==='NCL-JAYANT');
 assert.equal(template.steps.length,5);assert.equal(template.steps[0].label,'HR Manager');
 const steps=template.steps.map((s,i)=>({...s,approvers:['user-'+i]}));
 const data={...template,steps:[{stage:1,label:'HR Executive',approvers:['executive']},...steps]};
 assert.deepEqual(currentHierarchy(data).steps,steps);
 assert.equal(data.steps.length,6);
 const db={query:async sql=>({rows:sql.startsWith('SELECT code')?[{code:template.code}]:[{data}]})};
 assert.deepEqual((await employeeHierarchy(db,'site-id')).data.steps,steps);
 assert.deepEqual(approvalSteps({approval_steps:data.steps}),data.steps);
});

test('Nagpur requires sequential site approvals then any one final approver',()=>{
 const template=hierarchyTemplates.find(t=>t.code==='CMLL-CO');
 const data=validateHierarchy({...template,enabled:true,steps:template.steps.map((s,i)=>({...s,approvers:i===2?['cmd','vp']:['nagpur-'+i]}))});
 const a={requested_by:'requester',stage:0,approval_steps:data.steps};
 assert.throws(()=>nextApproval(a,'nagpur-1','APPROVED'),e=>e.status===403);
 for(let i=0;i<2;i++){a.stage=i;assert.equal(nextApproval(a,'nagpur-'+i,'APPROVED').state,'PENDING');}
 a.stage=2;for(const actor of ['cmd','vp'])assert.equal(nextApproval(a,actor,'APPROVED').state,'APPROVED');
});

test('saved Nagpur hierarchy removes HOD while preserving assigned usernames',async()=>{
 const {currentHierarchy}=await import('./joining-hierarchy.mjs');
 const template=hierarchyTemplates.find(t=>t.code==='CMLL-CO');
 assert.deepEqual(template.steps.map(s=>s.label),['HR Executive','HR Manager','Final approval — any one']);
 const steps=template.steps.map((s,i)=>({...s,approvers:['assigned-'+i]}));
 const saved={...template,steps:[steps[0],{stage:1,label:'HOD',approvers:[]},...steps.slice(1)]};
 assert.deepEqual(currentHierarchy(saved).steps,steps);
 assert.equal(saved.steps.length,4);
});

test('NCL and WCL add Driver Trainer after Project Manager; Nagpur does not',()=>{
 for(const t of hierarchyTemplates)assert.deepEqual(t.steps.slice(1,3).map(s=>s.label),["NCL","WCL"].includes(t.group)?['Project Manager','Driver Trainer']:t.steps.slice(1,3).map(s=>s.label));
 assert.deepEqual(hierarchyTemplates.filter(t=>t.group==='WCL').map(t=>t.name),['Sasti OB','Dhoptala OB','Gauri Pauni OB','Majri OB']);
 assert.ok(!hierarchyTemplates.find(t=>t.code==='CMLL-CO').steps.some(s=>s.label==='Driver Trainer'));
});
test('saved NCL hierarchies show an empty Driver Trainer step after Project Manager',()=>{
 const saved={code:'NCL-JAYANT',group:'NCL',steps:[{stage:1,label:'HR Manager',approvers:['a']},{stage:1,label:'Project Manager',approvers:['b']},{stage:2,label:'HR Manager — either one',approvers:['c']},{stage:2,label:'Final approval — any one',approvers:['d']}]};
 const shown=withDriverTrainer(saved);
 assert.deepEqual(shown.steps.map(s=>s.label),['HR Manager','Project Manager','Driver Trainer','HR Manager — either one','Final approval — any one']);
 assert.deepEqual(shown.steps[2].approvers,[]);assert.equal(withDriverTrainer(shown),shown);assert.equal(saved.steps.length,4);
});
test('WCL sites keep the previous flow until their hierarchy is enabled',async()=>{
 const db={query:async sql=>({rows:sql.startsWith('SELECT code')?[{code:'WCL-SASTI'}]:[]})};
 assert.equal(await employeeHierarchy(db,'site-id'),null);
 const ncl={query:async sql=>({rows:sql.startsWith('SELECT code')?[{code:'NCL-JAYANT'}]:[]})};
 await assert.rejects(employeeHierarchy(ncl,'site-id'),e=>e.status===409);
});
