import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyTemplates,validateHierarchy,employeeHierarchy,nextApproval,officeStepsOf} from './joining-hierarchy.mjs';
import {initiatedSteps,siteStaffRegionalHr,roleTitle,SITE_STAFF_DIRECTORS} from './site-staff-routing.mjs';
import {additionApprovalMessage,additionDecisionMessage,additionMarkup,parseAdditionCallback,queueAdditionStep,ADDITION_BOT} from './employee-addition-bot.mjs';
import {createService} from './service.mjs';

const directors=SITE_STAFF_DIRECTORS.map(d=>d.username);
const saved=code=>{const t=hierarchyTemplates.find(x=>x.code===code);return {...t,steps:t.steps.map((s,i)=>({...s,approvers:s.label==='HR Manager — either one'?['someone-else']:s.label==='Final approval — any one'?['cmd']:['user-'+i]}))};};
const dbFor=data=>({query:async sql=>({rows:sql.startsWith('SELECT code')?[{code:data.code}]:[{data}]})});

test('site staff route: Site HR → PM / HOD → Office HR → Regional HR → Directors',async()=>{
 const office=(await employeeHierarchy(dbFor(saved('NCL-DUDE')),'site',{driverOperator:false})).data.steps;
 assert.deepEqual(office.map(s=>roleTitle(s.label)),['Site HR','PM / HOD','Office HR','Regional HR','Directors (final)']);
 assert.deepEqual(office[3].approvers,['vinodpinjarkar']);
 assert.deepEqual(office[4].approvers,directors);
});

test('Regional HR is fixed region-wise: NCL → Vinod Pinjarkar (3399), WCL → Virat Singh (18114)',async()=>{
 for(const code of ['NCL-JAYANT','NCL-JAYANT-W','NCL-DUDE','NCL-DUDW'])assert.equal(siteStaffRegionalHr(code).employeeId,'3399');
 for(const code of ['WCL-SASTI','WCL-MAJRI','WCL-DHOPTALA','WCL-GAURI'])assert.equal(siteStaffRegionalHr(code).employeeId,'18114');
 const wcl=(await employeeHierarchy(dbFor(saved('WCL-SASTI')),'site',{driverOperator:false})).data.steps;
 assert.deepEqual(wcl.find(s=>s.label==='HR Manager — either one').approvers,['viratsingh']);
 assert.equal(siteStaffRegionalHr('CMLL-CO'),null);
});

test('saved office-staff approvers for Regional HR and Directors are overridden, other steps kept',async()=>{
 const data=saved('NCL-DUDW');data.officeSteps=officeStepsOf(data.steps).map((s,i)=>({...s,approvers:['office-'+i]}));
 const office=(await employeeHierarchy(dbFor(data),'site',{driverOperator:false})).data.steps;
 assert.deepEqual(office.map(s=>s.approvers),[['office-0'],['office-1'],['office-2'],['vinodpinjarkar'],directors]);
 const t=hierarchyTemplates.find(x=>x.code==='WCL-MAJRI');
 const valid=validateHierarchy({...t,enabled:true,steps:t.steps.map((s,i)=>({...s,approvers:['d-'+i]})),officeSteps:officeStepsOf(t.steps).map((s,i)=>({...s,approvers:['o-'+i]}))});
 assert.deepEqual(valid.officeSteps.map(s=>s.approvers),[['o-0'],['o-1'],['o-2'],['viratsingh'],directors]);
});

test('Nagpur office is not changed by the site staff route',async()=>{
 const t=hierarchyTemplates.find(x=>x.code==='CMLL-CO');const data={...t,steps:t.steps.map((s,i)=>({...s,approvers:['n-'+i]}))};
 const office=(await employeeHierarchy(dbFor(data),'site',{driverOperator:false})).data.steps;
 assert.deepEqual(office.map(s=>s.approvers),[['n-0'],['n-1'],['n-2']]);
});

test('Site HR initiating skips their own step; anyone else still needs Site HR first',()=>{
 const steps=[{stage:1,label:'HR Manager',approvers:['sitehr']},{stage:1,label:'Project Manager',approvers:['pm']},{stage:2,label:'Final approval — any one',approvers:directors}];
 assert.deepEqual(initiatedSteps(steps,'SiteHR').map(s=>s.label),['Project Manager','Final approval — any one']);
 assert.equal(initiatedSteps(steps,'executive'),steps);
 const a={requested_by:'sitehr',stage:0,approval_steps:initiatedSteps(steps,'sitehr')};
 assert.equal(nextApproval(a,'pm','APPROVED').state,'PENDING');
 a.stage=1;assert.equal(nextApproval(a,'manishchadda','APPROVED').state,'APPROVED');
});

const steps=[{stage:1,label:'Project Manager',approvers:['pm']},{stage:2,label:'Office HR — either one',approvers:['ohr1','ohr2']},{stage:2,label:'HR Manager — either one',approvers:['vinodpinjarkar']},{stage:2,label:'Final approval — any one',approvers:directors}];
const record={code:'EMP-9',name:'Ravi Kumar',data:{officeData:{'Department *':'Mining','Designation *':'Supervisor'}}};
const id='0f8fad5b-d9cb-469f-a165-70867728950e';

test('Telegram buttons carry the approval and step and fit Telegram limits',()=>{
 const button=additionMarkup(id,2).inline_keyboard[0];
 assert.ok(button.every(b=>Buffer.byteLength(b.callback_data)<=64));
 assert.deepEqual(parseAdditionCallback(button[0].callback_data),{id,stage:2,approve:true});
 assert.deepEqual(parseAdditionCallback(button[1].callback_data),{id,stage:2,approve:false});
 assert.equal(parseAdditionCallback('ea:not-a-uuid:1:a'),null);
 const message=additionApprovalMessage({record,siteName:'Dudhichua OB East',steps,stage:2,requestedBy:'sitehr',previousApprover:'ohr1',previousRole:'Office HR'});
 assert.match(message,/Step 3 of 4: Regional HR/);assert.match(message,/Route: PM \/ HOD → Office HR → Regional HR → Directors \(final\)/);assert.match(message,/After you: Directors/);
 assert.match(additionApprovalMessage({record,siteName:'x',steps,stage:3,requestedBy:'sitehr'}),/final: the employee becomes Active/);
 assert.match(additionDecisionMessage({record,siteName:'x',state:'REJECTED',actor:'pm',comments:'Wrong photo',decidedAt:'now'}),/Reason: Wrong photo/);
});

test('each step queues buttons for the next approvers and a note for Site HR; the end reaches everyone',async()=>{
 const sent=[];const queue=async(_db,key,actors,message,bot,markup)=>sent.push({key,actors,bot,buttons:!!markup,message});
 await queueAdditionStep({},queue,{approvalId:id,record,siteName:'S',steps,stage:0,state:'SUBMITTED',requestedBy:'sitehr'});
 assert.deepEqual(sent.map(s=>[s.actors,s.buttons,s.bot]),[[['pm'],true,ADDITION_BOT],[['sitehr'],false,ADDITION_BOT]]);
 sent.length=0;await queueAdditionStep({},queue,{approvalId:id,record,siteName:'S',steps,stage:1,state:'PENDING',requestedBy:'sitehr',actor:'pm'});
 assert.deepEqual(sent[0].actors,['ohr1','ohr2']);assert.ok(sent[0].buttons);assert.match(sent[1].message,/PM \/ HOD approved/);
 sent.length=0;await queueAdditionStep({},queue,{approvalId:id,record,siteName:'S',steps,stage:4,state:'APPROVED',requestedBy:'sitehr',actor:'mohitchadda',decidedAt:'now'});
 assert.equal(sent.length,1);assert.ok(!sent[0].buttons);assert.deepEqual(new Set(sent[0].actors),new Set(['sitehr','pm','ohr1','ohr2','vinodpinjarkar',...directors]));assert.match(sent[0].message,/now Active/);
});

test('an Approve tap by the current approver moves the request up through decide()',async()=>{
 process.env.TELEGRAM_WEBHOOK_SECRET='s3cret';delete process.env.TELEGRAM_NAGPUR_BOT_TOKEN;
 const approval={id,state:'PENDING',stage:1,version:4,requested_by:'sitehr',approval_steps:steps,approvers:[]};
 const pool={query:async sql=>sql.includes('hr_telegram_updates')?{rowCount:1,rows:[{id:1}]}:sql.includes('hr_telegram_accounts')?{rows:[{actor:'ohr2'}]}:sql.includes('hr_approvals')?{rows:[approval]}:{rows:[]}};
 const service=createService(pool,{telegram:{}});const calls=[];
 const ctx={decide:async(...args)=>{calls.push(args);return {state:'PENDING'};}};
 const tap=(data,update_id=1)=>service.telegramWebhook.call(ctx,'s3cret',{update_id,callback_query:{id:'cb',data,from:{id:777}}},'nagpur');
 await tap(`ea:${id}:1:a`);
 assert.equal(calls.length,1);const [profile,approvalId,input,trusted]=calls[0];
 assert.equal(profile.actor,'ohr2');assert.equal(approvalId,id);assert.deepEqual({decision:input.decision,version:input.version,stage:input.stage},{decision:'APPROVED',version:4,stage:1});assert.equal(trusted,true);
 await tap(`ea:${id}:0:a`,2);assert.equal(calls.length,1,'a stale step button does nothing');
 approval.stage=2;await tap(`ea:${id}:2:r`,3);assert.equal(calls.length,1,'only the current step approvers can tap');
 approval.stage=1;await tap(`ea:${id}:1:r`,4);assert.equal(calls[1][2].decision,'REJECTED');assert.match(calls[1][2].comments,/Rejected on Telegram by ohr2/);
 await assert.rejects(service.telegramWebhook.call(ctx,'wrong',{update_id:5,callback_query:{id:'cb',data:`ea:${id}:1:a`,from:{id:777}}},'nagpur'),e=>e.status===403);
});
