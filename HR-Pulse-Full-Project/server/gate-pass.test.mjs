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
