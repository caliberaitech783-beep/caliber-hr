import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTelegramNotifier,nagpurApprovalMessage} from './telegram-notifications.mjs';

const input={siteCode:'CMLL-CO',record:{code:'EMP-01',name:'Employee One',data:{officeData:{'Department *':'Human Resources','Designation *':'HR Executive'}}},step:{label:'HR Executive',approvers:['apurvakopulwar']},stage:1,total:3,requestedBy:'sitehr'};

test('formats the Nagpur approval message without private identity fields',()=>{
 const message=nagpurApprovalMessage(input);
 assert.match(message,/Nagpur Employee Addition/);assert.match(message,/Stage 1 of 3/);assert.match(message,/Employee One \(EMP-01\)/);assert.match(message,/Human Resources/);assert.match(message,/HR Executive/);assert.doesNotMatch(message,/Aadhaar|PAN|Mobile|Address/);
});
test('sends only Nagpur messages to configured current approvers',async()=>{
 const calls=[],notifier=createTelegramNotifier({token:'secret',recipients:{apurvakopulwar:'12345'},fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200};}});
 assert.deepEqual(await notifier.approvalRequested(input),{sent:1,skipped:false});
 assert.equal(calls.length,1);assert.equal(calls[0].body.chat_id,'12345');assert.doesNotMatch(calls[0].url,/12345/);
 assert.deepEqual(await notifier.approvalRequested({...input,siteCode:'CMLL-HO'}),{sent:0,skipped:true});assert.equal(calls.length,1);
});

test('queues the next-stage employee notification before returning the approval result',async()=>{
 const source=await readFile(new URL('./service.mjs',import.meta.url),'utf8');
 const notification=source.lastIndexOf("if(record.kind==='employees'&&state==='PENDING')");
 const result=source.indexOf('return {state};',notification);
 assert.ok(notification>=0&&result>notification,'next-stage notification must be reachable before decide returns');
});
