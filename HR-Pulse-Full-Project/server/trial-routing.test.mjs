import test from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyTemplates,validateHierarchy,withDriverTrainer,withOfficeHr} from './joining-hierarchy.mjs';
import {TRIAL_DIRECTORS,TRIAL_REGIONAL_HR,withTrialRouting} from './trial-routing.mjs';
import {TRIAL_DIRECTORS as BROWSER_DIRECTORS,TRIAL_REGIONAL_HR as BROWSER_REGIONAL_HR,regionalHrFor,trialRoute} from '../src/trial-workflow-preview/routing.ts';

const route=code=>{const t=hierarchyTemplates.find(item=>item.code===code);return withTrialRouting(withOfficeHr(withDriverTrainer(structuredClone(t))));};
const approversOf=(data,label)=>data.steps.find(step=>step.label===label).approvers;

test('NCL sites go to Vinod Pinjarkar (3399), WCL sites to Virat Singh (18114), then the three Directors',()=>{
 for(const code of ['NCL-JAYANT','NCL-JAYANT-W','NCL-DUDE','NCL-DUDW'])assert.deepEqual(approversOf(route(code),'HR Manager — either one'),['vinodpinjarkar']);
 for(const code of ['WCL-SASTI','WCL-MAJRI','WCL-DHOPTALA','WCL-GAURI'])assert.deepEqual(approversOf(route(code),'HR Manager — either one'),['viratsingh']);
 for(const code of ['NCL-DUDE','WCL-SASTI'])assert.deepEqual(approversOf(route(code),'Final approval — any one'),['mohitchadda','manishchadda','rahulchadda']);
});

test('the route keeps Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors',()=>{
 assert.deepEqual(route('NCL-DUDE').steps.map(step=>step.label),['HR Manager','Driver Trainer','Project Manager','Office HR — either one','HR Manager — either one','Final approval — any one']);
});

test('saved Regional HR or Director usernames cannot replace the fixed ones',()=>{
 const t=hierarchyTemplates.find(item=>item.code==='WCL-SASTI');
 const steps=t.steps.map((step,i)=>({approvers:[['sitehr'],['trainer1'],['pm1'],['office1'],['someoneelse'],['otherdirector']][i]}));
 const saved=validateHierarchy({code:'WCL-SASTI',steps,enabled:true});
 assert.deepEqual(approversOf(saved,'HR Manager — either one'),['viratsingh']);
 assert.deepEqual(approversOf(saved,'Final approval — any one'),['mohitchadda','manishchadda','rahulchadda']);
 assert.deepEqual(approversOf(saved,'Project Manager'),['pm1']);
});

test('other sites are left to Approval Master',()=>{
 const lalpeth=route('WCL-LALPETH');
 assert.deepEqual(approversOf(lalpeth,'HR Manager — either one'),[]);
});

test('the browser shows the same route as the server enforces',()=>{
 assert.deepEqual(BROWSER_REGIONAL_HR,TRIAL_REGIONAL_HR);
 assert.deepEqual(BROWSER_DIRECTORS,TRIAL_DIRECTORS);
 assert.equal(regionalHrFor('Dudhichua OB East')?.employeeId,'CMPL3399');
 assert.equal(regionalHrFor('Jayant OC')?.employeeId,'CMPL3399');
 assert.equal(regionalHrFor('Dhuptala OC')?.employeeId,'CMPL18114');
 assert.equal(regionalHrFor('Gauri Pauni OB 2nd')?.employeeId,'CMPL18114');
 assert.deepEqual(trialRoute('Majri OB').map(step=>step.label),['Site HR','Driver Trainer','PM','Office HR','Regional HR','Directors','Active']);
});
