import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officeStaffSteps,officeStaffHierarchy,OFFICE_DIRECTORS} from './office-staff-routing.mjs';
import {nextApproval} from './joining-hierarchy.mjs';
const saved=(hrExecutive,hrManager,final=[])=>({steps:[{stage:1,label:'HR Executive',approvers:hrExecutive},{stage:1,label:'HR Manager',approvers:hrManager},{stage:2,label:'Final approval — any one',approvers:final}]});

test('Nagpur office: Nagpur HR initiates → Nagpur HR Manager → Directors (final)',()=>{
 const steps=officeStaffSteps('CMLL-CO',saved(['mayuriumate'],['vinodpinjarkar']),'mayuriumate');
 assert.deepEqual(steps.map(s=>s.label),['HR Manager — Nagpur Office','Final approval — any one']);
 assert.deepEqual(steps[0].approvers,['vinodpinjarkar']);
 assert.deepEqual(steps[1].approvers,OFFICE_DIRECTORS);
 const a={requested_by:'mayuriumate',stage:0,approval_steps:steps};
 assert.throws(()=>nextApproval(a,'mohitchadda','APPROVED'),e=>e.status===403);
 assert.equal(nextApproval(a,'vinodpinjarkar','APPROVED').state,'PENDING');
 a.stage=1;for(const director of OFFICE_DIRECTORS)assert.equal(nextApproval(a,director,'APPROVED').state,'APPROVED');
});

test('Chandrapur HO uses its own HR Manager and must have one assigned',()=>{
 const steps=officeStaffSteps('CMLL-HO',saved(['chphr'],['chpmanager']),'chphr');
 assert.deepEqual(steps.map(s=>[s.label,s.approvers]),[['HR Manager — Chandrapur HO',['chpmanager']],['Final approval — any one',OFFICE_DIRECTORS]]);
 assert.throws(()=>officeStaffSteps('CMLL-HO',null,'chphr'),e=>e.status===409&&/Chandrapur HO HR Manager/.test(e.message));
});

test('Nagpur falls back to Vinod Pinjarkar when no HR Manager is saved',()=>{
 assert.deepEqual(officeStaffSteps('CMLL-CO',null,'anyhr')[0].approvers,['vinodpinjarkar']);
});

test('only the office HR (or its HR Manager) may initiate when office HR is assigned',()=>{
 assert.throws(()=>officeStaffSteps('CMLL-CO',saved(['mayuriumate'],['vinodpinjarkar']),'chphr'),e=>e.status===403&&/Nagpur Office HR/.test(e.message));
 assert.ok(officeStaffSteps('CMLL-CO',saved([],['vinodpinjarkar']),'someone'));
});

test('HR Manager initiating sends the form straight to the Directors',()=>{
 const steps=officeStaffSteps('CMLL-CO',saved(['mayuriumate'],['vinodpinjarkar']),'vinodpinjarkar');
 assert.deepEqual(steps.map(s=>s.label),['Final approval — any one']);
});

test('saved extra final approvers are added to the fixed Directors, never duplicated',()=>{
 const steps=officeStaffSteps('CMLL-CO',saved([],['vinodpinjarkar'],['MohitChadda','honeysir']),'hr');
 assert.deepEqual(steps[1].approvers,[...OFFICE_DIRECTORS,'honeysir']);
});

test('officeStaffHierarchy applies only to the two offices',async()=>{
 const db=code=>({query:async(sql)=>({rows:sql.startsWith('SELECT code')?[{code}]:[{id:'h1',data:saved(['nhr'],['nmgr'])}]})});
 assert.equal(await officeStaffHierarchy(db('NCL-JAYANT'),'site'),null);
 assert.equal(await officeStaffHierarchy(db('CMLL-CO'),''),null);
 const route=await officeStaffHierarchy(db('CMLL-CO'),'site','nhr');
 assert.equal(route.code,'CMLL-CO');
 assert.deepEqual(route.data.steps.map(s=>s.approvers[0]),['nmgr','mohitchadda']);
});

test('a rejected office form goes back to that office HR; site forms still go back to Site HR',async()=>{
 const {additionDecisionMessage}=await import('./employee-addition-bot.mjs');
 const record={code:'EMP-1',name:'New Joiner',data:{}};
 const reject=steps=>additionDecisionMessage({record,siteName:'x',state:'REJECTED',actor:'vinodpinjarkar',comments:'Wrong photo',decidedAt:'now',steps});
 assert.match(reject(officeStaffSteps('CMLL-CO',null,'nagpurhr')),/goes back to Nagpur Office HR for correction/);
 assert.match(reject(officeStaffSteps('CMLL-HO',saved([],['chpmanager']),'chphr')),/goes back to Chandrapur HO HR for correction/);
 assert.match(reject([{stage:1,label:'Project Manager',approvers:['pm']}]),/goes back to Site HR for correction/);
 assert.match(reject(undefined),/goes back to Site HR/);
});
