import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRequestCode,requestCode,requestSerial} from './request-number.mjs';

const db=next=>({calls:[],async query(sql,values){this.calls.push([sql,values]);if(sql.includes("kind='employees'"))return {rows:[{code:'CMLL00012'}]};if(sql.includes('MAX('))return {rows:[{next}]};return {rows:[]};}});

test('OD numbers read OD0001/<dd-mm-yyyy>/<Emp ID> and count up from 0001',async()=>{
  assert.equal(requestCode('outDutyRequests',1,'2026-11-20','CMLL00012'),'OD0001/20-11-2026/CMLL00012');
  assert.equal(requestSerial('outDutyRequests','OD0014/20-11-2026/CMLL00012'),14);
  assert.equal(requestSerial('outDutyRequests','OD-3f1c2a'),0);
  const first=db(1);
  assert.equal(await nextRequestCode(first,'outDutyRequests',undefined,{outDutyDate:'2026-11-20',employeeId:'e'}),'OD0001/20-11-2026/CMLL00012');
  const max=first.calls.find(([sql])=>sql.includes('MAX('));
  assert.deepEqual(max[1],['outDutyRequests','^OD([0-9]+)/']);
  assert.deepEqual(first.calls.find(([sql])=>sql.includes('advisory'))[1],['hr-od-serial']);
  const edit=db(50);
  assert.equal(await nextRequestCode(edit,'outDutyRequests','OD0007/20-11-2026/CMLL00012',{outDutyDate:'2026-11-25',employeeId:'e'}),'OD0007/25-11-2026/CMLL00012');
  assert.ok(!edit.calls.some(([sql])=>sql.includes('MAX(')));
});
test('gate pass numbers keep their own count and pattern',async()=>{
  const g=db(3);
  assert.equal(await nextRequestCode(g,'gatePasses',undefined,{passDate:'2026-11-20',employeeId:'e'}),'GP No.0003/20-11-2026/CMLL00012');
  assert.deepEqual(g.calls.find(([sql])=>sql.includes('MAX('))[1],['gatePasses','^GP No\\.([0-9]+)/']);
});
