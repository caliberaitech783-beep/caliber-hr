import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegram} from './telegram.mjs';
import {trialRoleLabels} from './trial-access.mjs';
import {directorDecided} from './trial-review.mjs';

/* Owner, 21 Nov 2026: once a Director clears or rejects a candidate, the form is closed for good. */
const hierarchy={code:'NCL-DUDE',data:{group:'NCL',steps:Object.values(trialRoleLabels).map(label=>({label,approvers:['ankit']}))}};
const profile={actor:'ankit',name:'Ankit Tiwari',permissions:{hrDesktopAccess:['Employee Master'],site:'NCL-DUDE'}};
const fields={'Name of candidate':'Vishal','Mobile no.':'1234567894','Aadhaar no.':'123412341234',Result:'PASS'};
const approvals=[{role:'pm',action:'Approved'},{role:'ohr',action:'Approved'},{role:'rhr',action:'Approved'}];
const cleared={site:'Dudhichua OB East',stage:'CLEARED',fields,history:[...approvals,{role:'director',action:'Approved'}]};
const rejected={site:'Dudhichua OB East',stage:'REJECTED',fields,history:[...approvals,{role:'director',action:'Rejected'}],lastDecision:{reviewer:'director'}};
function api(saved,{rejectedCode=''}={}){
 const writes=[];
 const db={release(){},query:async(sql,values=[])=>{
  if(sql.includes("kind='joiningHierarchies'"))return {rows:[hierarchy]};
  if(sql.includes("status='REJECTED' AND (data->'lastDecision'"))return {rows:rejectedCode?[{code:rejectedCode}]:[]};
  if(sql.includes("kind='trialForms' AND code=$1"))return {rows:saved?[{id:'f1',data:saved}]:[]};
  if(sql.includes("code = ANY($1) OR data->>'batchId'=$2"))return {rows:saved?[{code:'TF/2026-27/0001',data:saved}]:[]};
  if(sql.includes("data->>'batchId'=$1 FOR UPDATE"))return {rows:saved?[{id:'f1',code:'TF/2026-27/0001',data:saved}]:[]};
  if(/^(UPDATE|INSERT)/.test(sql.trim()))writes.push(sql);
  return {rows:[]};
 }};
 return {writes,call:(route,input)=>createTelegram({query:db.query,connect:async()=>db}).telegramApi(profile,route,'POST',input)};
}
const input={formNo:'TF/2026-27/0001',site:'Dudhichua OB East',region:'NCL',fields};

test('a Director decision closes the form; earlier decisions do not',()=>{
 assert.equal(directorDecided(cleared),true);
 assert.equal(directorDecided(rejected),true);
 assert.equal(directorDecided({stage:'REJECTED',history:[{role:'pm',action:'Rejected'}],lastDecision:{reviewer:'pm'}}),false);
 assert.equal(directorDecided({stage:'APPROVAL',history:approvals}),false);
});

for(const [label,saved] of [['cleared',cleared],['rejected',rejected]]){
 test(`a trial result cannot be entered again on a form the Directors ${label}`,async()=>{
  const {call,writes}=api(saved);
  await assert.rejects(call('trial-result',input),e=>e.status===409&&/final decision/.test(e.message));
  await assert.rejects(call('trial-forms',input),e=>e.status===409&&/final decision/.test(e.message));
  await assert.rejects(call('trial-batch-result',{batchId:'B1',site:'Dudhichua OB East',results:[{formNo:input.formNo,result:'PASS'}],rows:[{formNo:input.formNo,fields,attachments:[{name:'x.pdf',kind:'trialResult',data:'eA=='}]}]}),e=>e.status===409);
  assert.equal(writes.length,0);
 });
}

test('a candidate the Directors rejected cannot be sent through a fresh Part 1 trial',async()=>{
 const {call,writes}=api(null,{rejectedCode:'TF/2026-27/0001'});
 await assert.rejects(call('trial-part1',{site:'Dudhichua OB East',region:'NCL',candidates:[{formNo:'TF/2026-27/0009',fields}]}),e=>e.status===409&&/Directors rejected/.test(e.message));
 assert.equal(writes.length,0);
});
