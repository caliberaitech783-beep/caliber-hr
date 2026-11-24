import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceSiteKey} from './attendance.mjs';

test('attendance treats OB and OC site labels and ordinal parentheses as the same location',()=>{
 assert.equal(attendanceSiteKey('Dhoptala OB 2nd'),attendanceSiteKey('Dhoptala OC (2nd)'));
 assert.equal(attendanceSiteKey('  DHOPTALA   OB (2nd) '),attendanceSiteKey('Dhoptala OC 2nd'));
 assert.notEqual(attendanceSiteKey('Dhoptala OB 1st'),attendanceSiteKey('Dhoptala OC 2nd'));
});
