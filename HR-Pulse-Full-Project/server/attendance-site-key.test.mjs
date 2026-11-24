import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceSiteKey} from './attendance.mjs';

test('attendance treats OB and OC site labels and ordinal parentheses as the same location',()=>{
 assert.equal(attendanceSiteKey('Dhoptala OB 2nd'),attendanceSiteKey('Dhoptala OC (2nd)'));
 assert.equal(attendanceSiteKey('Dhoptala OB 2nd'),attendanceSiteKey('Dhoptala OB'));
 assert.equal(attendanceSiteKey('Dhoptala OC (2nd)'),attendanceSiteKey('Dhoptala OC'));
 assert.equal(attendanceSiteKey('  DHOPTALA   OB (2nd) '),attendanceSiteKey('Dhoptala OC 2nd'));
 assert.equal(attendanceSiteKey('Dhoptala OB 2nd'),'wcl-dhoptala');
 assert.notEqual(attendanceSiteKey('Dhoptala OB 1st'),attendanceSiteKey('Dhoptala OC 2nd'));
});

test('attendance maps Gauri Pauni OC and OC (2nd) to one site',()=>{
 assert.equal(attendanceSiteKey('Gauri Pauni OC'),attendanceSiteKey('Gauri Pauni OC (2nd)'));
 assert.equal(attendanceSiteKey('Gauri Pauni OB 2nd'),'wcl-gauri-pauni');
 assert.equal(attendanceSiteKey('  GAURI   PAUNI OC (2nd) '),'wcl-gauri-pauni');
});
