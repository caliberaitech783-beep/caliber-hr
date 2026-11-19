import test from 'node:test';
import assert from 'node:assert/strict';
import {attachProgress,requestProgress,stepLabel} from './request-progress.mjs';

test('step labels are shortened for the progress bar',()=>{
  assert.equal(stepLabel('Directors — final approval (any one)'),'Directors');
  assert.equal(stepLabel('HOD (concerned) — any one'),'HOD (concerned)');
  assert.equal(stepLabel('Regional HR'),'Regional HR');
  assert.equal(stepLabel(''),'Approval');
});

test('progress carries state, stage and step labels but no approver names',()=>{
  const p=requestProgress({state:'PENDING',stage:1,approval_steps:[{stage:1,label:'HOD',approvers:['a']},{stage:2,label:'Regional HR — final approval, any one',approvers:['b']}],approvers:['a','b']});
  assert.deepEqual(p,{state:'PENDING',stage:1,steps:[{label:'HOD'},{label:'Regional HR'}]});
  assert.equal(requestProgress(undefined),null);
});

test('attachProgress adds the latest approval to leave and OD rows only',async()=>{
  const queries=[];
  const pool={query:async(sql,values)=>{queries.push(values);return {rows:[{record_id:'r1',state:'APPROVED',stage:2,approval_steps:[{label:'HOD'},{label:'Regional HR'}],approvers:[]}]};}};
  const rows=[{id:'r1'},{id:'r2'}];
  await attachProgress(pool,'leaveRequests',rows);
  assert.equal(rows[0].progress.state,'APPROVED');
  assert.equal(rows[1].progress,null);
  const other=[{id:'x'}];
  await attachProgress(pool,'holidays',other);
  assert.equal(other[0].progress,undefined);
  assert.equal(queries.length,1);
});
