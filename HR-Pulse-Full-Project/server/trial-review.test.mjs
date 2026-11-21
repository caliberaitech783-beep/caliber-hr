import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trialHistoryWithSteps,trialReviewStage,trialStepNames} from './trial-review.mjs';

const approvals=[{role:'pm',action:'Approved',by:'CHITRANJAN SINGH',at:'2026-11-21T06:00:00Z'}];
const saved={part1By:'amitsingh',part1Name:'AMIT SINGH',part1At:'2026-11-20T04:00:00Z',trialBy:'driver trainer',resultBy:'santosh',resultAt:'2026-11-20T08:00:00Z',
 fields:{Result:'PASS','Trial conducted by':'SANTOSH KUMAR MOHANTA'},history:approvals};

test('approvals show who submitted Part 1 and who conducted the trial',()=>{
 const history=trialHistoryWithSteps(saved);
 assert.deepEqual(history.slice(0,2),[
  {role:'hr',action:'Submitted Part 1',by:'AMIT SINGH',at:saved.part1At},
  {role:'trainer',action:'Trial result: PASS',by:'SANTOSH KUMAR MOHANTA',at:saved.resultAt}]);
 assert.equal(trialReviewStage(history,saved.resultAt),'ohr');
});

test('older forms fall back to the Site HR login and keep steps already recorded',()=>{
 const {part1Name,...old}=saved;
 assert.equal(trialHistoryWithSteps(old)[0].by,'amitsingh');
 const own={...saved,history:[{role:'hr',action:'Submitted Part 1',by:'Site HR',at:'2026-11-20T04:00:00Z'},...approvals]};
 assert.equal(trialHistoryWithSteps(own).filter(h=>h.role==='hr').length,1);
 assert.equal(trialHistoryWithSteps({part1At:'2026-11-20T04:00:00Z',part1By:'x',fields:{}}).some(h=>h.role==='trainer'),false);
});

test('older forms show the Site HR full name from the employee linked to that login',async()=>{
 const {part1Name,...old}=saved;let args;
 const db={query:async(sql,values)=>{args=values;return {rows:[{actor:'amitsingh',name:'AMIT KUMAR SINGH'}]};}};
 const names=await trialStepNames(db,[old,saved]);
 assert.deepEqual(args[0],['amitsingh','santosh']);
 assert.equal(trialHistoryWithSteps(old,names)[0].by,'AMIT KUMAR SINGH');
 assert.equal((await trialStepNames({query:async()=>{throw new Error('no query');}},[saved].map(({resultBy,...d})=>d))).size,0);
});
