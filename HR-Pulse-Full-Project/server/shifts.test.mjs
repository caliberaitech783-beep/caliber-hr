import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './modules.mjs';
const shift={code:'SITE:A',name:'Night',siteId:'site',startTime:'21:00',endTime:'05:00',graceMinutes:30,halfDayHours:4,fullDayHours:8,overtimeAfterHours:8,nightShift:'Yes'};
test('shift thresholds persist as numbers and overnight times are accepted',()=>{const result=validate('shifts',shift);assert.equal(result.graceMinutes,30);assert.equal(result.nightShift,'Yes');assert.equal(result.endTime,'05:00');});
test('invalid shift thresholds and zero-length shifts are rejected',()=>{for(const change of [{endTime:'21:00'},{graceMinutes:300},{graceMinutes:0.5},{halfDayHours:9},{fullDayHours:25},{overtimeAfterHours:-1},{nightShift:'maybe'}])assert.throws(()=>validate('shifts',{...shift,...change}),e=>e.status===400);});
test('existing shifts without added thresholds remain compatible',()=>{const result=validate('shifts',{code:'OLD',name:'Old',siteId:'site',startTime:'06:00',endTime:'14:00'});assert.equal(result.graceMinutes,'');});
