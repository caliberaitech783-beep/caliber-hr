import test from 'node:test';
import assert from 'node:assert/strict';
import {canReadTrial} from './trial-access.mjs';

const as=(...roles)=>({roles,overview:false});
const directorRejected={stage:'REJECTED',pendingRole:'',lastDecision:{reviewer:'director'},history:[{role:'pm',action:'Approved'},{role:'ohr',action:'Approved'},{role:'rhr',action:'Approved'},{role:'director',action:'Rejected'}]};

test('a Director rejection reaches every approver on the route, not only Site HR', ()=>{
 for(const role of ['hr','trainer','pm','ohr','rhr','director'])assert.equal(canReadTrial(as(role),directorRejected),true,role);
});

test('a form rejected by the PM is not shown to approvers it never reached', ()=>{
 const pmRejected={stage:'REJECTED',pendingRole:'',lastDecision:{reviewer:'pm'}};
 assert.equal(canReadTrial(as('pm'),pmRejected),true);
 assert.equal(canReadTrial(as('trainer'),pmRejected),true);
 assert.equal(canReadTrial(as('ohr'),pmRejected),false);
 assert.equal(canReadTrial(as('director'),pmRejected),false);
});

test('approvers keep reading a form after their own step, later approvers wait for it', ()=>{
 const atRegionalHr={stage:'APPROVAL',pendingRole:'rhr'};
 assert.equal(canReadTrial(as('pm'),atRegionalHr),true);
 assert.equal(canReadTrial(as('ohr'),atRegionalHr),true);
 assert.equal(canReadTrial(as('rhr'),atRegionalHr),true);
 assert.equal(canReadTrial(as('director'),atRegionalHr),false);
 assert.equal(canReadTrial(as('ohr'),{stage:'APPROVAL',pendingRole:'director'}),true);
 assert.equal(canReadTrial(as('pm'),{stage:'PART1'}),false);
 assert.equal(canReadTrial(as(),{stage:'CLEARED'}),false);
 assert.equal(canReadTrial(as('director'),{stage:'CLEARED'}),true);
});
