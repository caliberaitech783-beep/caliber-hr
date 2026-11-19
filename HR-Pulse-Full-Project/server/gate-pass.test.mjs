import test from 'node:test';
import assert from 'node:assert/strict';
import {gatePassWorkflow,validateGatePass} from './gate-pass.mjs';
import {modules,validate} from './modules.mjs';
import {requestProgress} from './request-progress.mjs';

test('gate pass goes HOD, then gate security records out and back in',()=>{
  const steps=gatePassWorkflow({hods:{Workshop:'hod.user'},regionalHr:'rhr.one',gateSecurity:'Gate.One, gate.two'},'workshop').data.steps;
  assert.deepEqual(steps.map(s=>s.approvers),[['hod.user'],['gate.one','gate.two'],['gate.one','gate.two']]);
  assert.deepEqual(steps.map(s=>s.stage),[1,2,3]);
  assert.match(steps[1].label,/^Gate out/);assert.match(steps[2].label,/^Back in/);
});
test('without gate security, Regional HR records the times; without a flow, the fixed route applies',()=>{
  assert.deepEqual(gatePassWorkflow({hods:{'*':'hod'},regionalHr:'rhr.one'}).data.steps[1].approvers,['rhr.one']);
  assert.deepEqual(gatePassWorkflow(null).data.steps.map(s=>s.approvers),[['apurvakopulwar'],['mayuriumate'],['mayuriumate']]);
});
test('gate pass needs a return time after the out time',()=>{
  assert.throws(()=>validateGatePass({outTime:'15:00',returnTime:'13:00'}),/after the out time/);
  assert.doesNotThrow(()=>validateGatePass({outTime:'13:00',returnTime:'15:00'}));
  assert.ok(modules.gatePasses.autoCode);
  assert.deepEqual(modules.gatePasses.fields.filter(f=>f.required).map(f=>f.key),['code','employeeId','name','passDate','passType','outTime','returnTime','purpose']);
});
test('progress shows when each step was approved, such as the gate out time',()=>{
  const p=requestProgress({state:'PENDING',stage:2,approval_steps:gatePassWorkflow(null).data.steps,history:[{stage:1,decision:'APPROVED',at:'2026-11-20T07:30:00Z'},{stage:2,decision:'APPROVED',at:'2026-11-20T07:34:00Z'}]});
  assert.deepEqual(p.steps,[{label:'HOD',at:'2026-11-20T07:30:00Z'},{label:'Gate out',at:'2026-11-20T07:34:00Z'},{label:'Back in'}]);
});

import {gatePassCode,gatePassSerial,nextGatePassCode} from './gate-pass.mjs';
test('gate pass numbers read GP No.<serial>/<dd-mm-yyyy>/<Emp ID> and count up from 0001',async()=>{
  assert.equal(gatePassCode(1,'2026-11-20','CMLL00012'),'GP No.0001/20-11-2026/CMLL00012');
  assert.equal(gatePassSerial('GP No.0042/20-11-2026/CMLL00012'),42);
  assert.equal(gatePassSerial('GP-3f1c'),0);
  const db=next=>({queries:[],async query(sql){this.queries.push(sql);if(sql.includes("kind='employees'"))return {rows:[{code:'CMLL00012'}]};if(sql.includes('MAX('))return {rows:[{next}]};return {rows:[]};}});
  const first=db(1);
  assert.equal(await nextGatePassCode(first,undefined,'2026-11-20','e1'),'GP No.0001/20-11-2026/CMLL00012');
  assert.ok(first.queries.some(q=>q.includes('pg_advisory_xact_lock')));
  assert.equal(await nextGatePassCode(db(12),'GP-old-uuid','2026-11-21','e1'),'GP No.0012/21-11-2026/CMLL00012');
  const edit=db(99);
  assert.equal(await nextGatePassCode(edit,'GP No.0005/20-11-2026/CMLL00012','2026-11-22','e1'),'GP No.0005/22-11-2026/CMLL00012');
  assert.ok(!edit.queries.some(q=>q.includes('MAX(')));
});
