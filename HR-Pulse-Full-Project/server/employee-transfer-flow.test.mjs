import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTransferCommon,validateTransferSite,transferSteps,transferWorkflow} from './employee-transfer-flow.mjs';
import {nextApproval} from './joining-hierarchy.mjs';
test('transfer route: Site HR → PM → Office HR → Regional HR Head → Director (any one)',()=>{
 const common=validateTransferCommon({officeHr:'Office.One, office.two',regionalHrHead:'rhr.head',directors:'mohit,manish',enabled:true});
 const site=validateTransferSite({siteHr:'site.hr',pm:'pm.sir'});
 const steps=transferSteps(common,site);
 assert.deepEqual(steps.map(s=>s.approvers),[['site.hr'],['pm.sir'],['office.one','office.two'],['rhr.head'],['mohit','manish']]);
 let a={requested_by:'hr.user',stage:0,approval_steps:steps};
 assert.throws(()=>nextApproval(a,'pm.sir','APPROVED'),e=>e.status===403);
 for(const u of ['site.hr','pm.sir','office.two','rhr.head'])a={...a,...nextApproval(a,u,'APPROVED')};
 assert.equal(a.state,'PENDING');assert.equal(nextApproval(a,'manish','APPROVED').state,'APPROVED');
});
test('transfer flow is inactive until enabled and needs the from-site approvers',async()=>{
 assert.equal(transferSteps({enabled:false},{siteHr:'a',pm:'b'}),null);
 assert.throws(()=>transferSteps({enabled:true,officeHr:'o',regionalHrHead:'r',directors:'d'},null),e=>e.status===409);
 const db={query:async(sql,params)=>({rows:sql.includes("code='COMMON'")?[{data:{enabled:true,officeHr:'o',regionalHrHead:'r',directors:'d'}}]:sql.startsWith('SELECT code')?[{code:'NCL-JAYANT'}]:params?.[0]==='NCL-JAYANT'?[{data:{siteHr:'s',pm:'p'}}]:[]})};
 assert.equal((await transferWorkflow(db,'site-id')).data.steps.length,5);
 assert.throws(()=>validateTransferCommon({officeHr:'',regionalHrHead:'r',directors:'d'}),/Office HR/);
});
