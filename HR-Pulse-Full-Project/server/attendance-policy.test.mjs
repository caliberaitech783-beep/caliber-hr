import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_POLICY, validatePolicy, clockMinutes, durationMinutes, workedMinutes, dutyStatus, isLate, isEarly,
  halfDutyCuts, gatePassDeduction, isExempt, evaluateDay, summarizeMonth, policyRules} from './attendance-policy.mjs';

const at = clock => clockMinutes(clock);
const span = (hours, minutes) => hours * 60 + minutes;   // worked time after lunch
const day = (inClock, worked) => ({inMinute: at(inClock), outMinute: at(inClock) + worked + 60});

test('defaults are the approved policy numbers', () => {
  assert.deepEqual({...DEFAULT_POLICY, exemptRoles: [...DEFAULT_POLICY.exemptRoles]}, {
    lunchMinutes: 60, absentBelowHours: 4, fullDutyHours: 7, graceMinutes: 15, lateEarlyPerHalfCut: 3,
    gatePassFreeMinutes: 60, exemptRoles: ['CMD', 'Director', 'VP', 'CFO', 'CA']
  });
  assert.deepEqual(validatePolicy({}), validatePolicy(DEFAULT_POLICY));
});

test('working hours exclude the 1 hr lunch', () => {
  assert.equal(workedMinutes(at('08:00'), at('17:00')), span(8, 0));
  assert.equal(workedMinutes(at('08:00'), at('08:30')), 0);
  assert.equal(workedMinutes(at('08:00'), null), 0);
  assert.equal(workedMinutes(at('08:00'), at('17:00'), {...DEFAULT_POLICY, lunchMinutes: 30}), span(8, 30));
});

test('hours boundaries: 3:59 absent, 4:00 half, 6:59 half, 7:00 full', () => {
  assert.equal(dutyStatus(span(3, 59)), 'A');
  assert.equal(dutyStatus(span(4, 0)), 'HD');
  assert.equal(dutyStatus(span(6, 59)), 'HD');
  assert.equal(dutyStatus(span(7, 0)), 'P');
  // through the full day calculation, lunch included: 08:00 → 12:59 is 3:59 worked
  assert.equal(evaluateDay({inMinute: at('08:00'), outMinute: at('12:59')}).status, 'A');
  assert.equal(evaluateDay({inMinute: at('08:00'), outMinute: at('13:00')}).status, 'HD');
  assert.equal(evaluateDay({inMinute: at('08:00'), outMinute: at('15:59')}).status, 'HD');
  assert.equal(evaluateDay({inMinute: at('08:00'), outMinute: at('16:00')}).status, 'P');
});

test('trip card / logbook staff use logbook hours with the first trip as the In punch', () => {
  // logbook 06:10 first trip → 13:10 last trip end, 06:00 shift: 6 h worked → half duty, on time
  const result = evaluateDay({inMinute: at('06:10'), outMinute: at('13:10'), shiftStart: at('06:00'), shiftEnd: at('14:00'), designation: 'Dumper Operator'});
  assert.equal(result.status, 'HD');
  assert.equal(result.workedMinutes, span(6, 0));
  assert.equal(result.late, false);
  assert.equal(evaluateDay({inMinute: at('06:16'), outMinute: at('14:16'), shiftStart: at('06:00'), shiftEnd: at('14:00'), designation: 'Driver'}).late, true);
});

test('late grace: 15 min on time, 16 min late', () => {
  assert.equal(isLate(at('08:15'), at('08:00')), false);
  assert.equal(isLate(at('08:15:59'), at('08:00')), false);
  assert.equal(isLate(at('08:16'), at('08:00')), true);
  assert.equal(isLate(at('07:40'), at('08:00')), false);
  assert.equal(evaluateDay({...day('08:15', span(8, 0)), shiftStart: at('08:00'), shiftEnd: at('17:00')}).late, false);
  assert.equal(evaluateDay({...day('08:16', span(8, 0)), shiftStart: at('08:00'), shiftEnd: at('17:00')}).late, true);
});

test('early going: any Out before shift end, no grace', () => {
  assert.equal(isEarly(at('16:59'), at('17:00')), true);
  assert.equal(isEarly(at('17:00'), at('17:00')), false);
  // night shift 21:00 → 05:00 next day; out at 04:59 next day is early
  assert.equal(isEarly(1440 + at('04:59'), 1440 + at('05:00')), true);
  const result = evaluateDay({inMinute: at('08:00'), outMinute: at('16:59'), shiftStart: at('08:00'), shiftEnd: at('17:00')});
  assert.deepEqual([result.status, result.early], ['P', true]);
});

test('every 3 late comings or early goings together = one half duty cut; 6 = two', () => {
  assert.equal(halfDutyCuts(2), 0);
  assert.equal(halfDutyCuts(3), 1);
  assert.equal(halfDutyCuts(5), 1);
  assert.equal(halfDutyCuts(6), 2);
  const full = {status: 'P', late: false, early: false};
  const month = [{...full, late: true}, {...full, early: true}, {...full, late: true}, full, full];
  const summary = summarizeMonth(month);
  assert.deepEqual([summary.late, summary.early, summary.halfDutyCuts, summary.duties], [2, 1, 1, 4.5]);
  const sixth = summarizeMonth([...month, {...full, late: true}, {...full, early: true}, {...full, late: true}]);
  assert.deepEqual([sixth.lateEarly, sixth.halfDutyCuts, sixth.duties], [6, 2, 7]);
  // The count resets monthly: each month is summarized on its own days.
  assert.equal(summarizeMonth(month.slice(0, 2)).halfDutyCuts, 0);
});

test('gate pass: 1:00 free, 1:01 deducts the full time, 2.15 means 2 h 15 m', () => {
  assert.equal(durationMinutes('1.00'), 60);
  assert.equal(durationMinutes('1:01'), 61);
  assert.equal(durationMinutes('2.15'), 135);
  assert.equal(durationMinutes('2:15'), 135);
  assert.equal(durationMinutes('2.5'), null);
  assert.equal(durationMinutes('2.75'), null);
  assert.equal(gatePassDeduction(60, 800), 0);
  assert.equal(gatePassDeduction(61, 800), 101.67);
  assert.equal(gatePassDeduction(durationMinutes('2.15'), 800), 225);
  assert.equal(gatePassDeduction(135, 0), 0);
  assert.equal(evaluateDay({...day('08:00', span(8, 0)), gatePassMinutes: 135, dailyWage: 800}).gatePassDeduction, 225);
  assert.equal(summarizeMonth([{status: 'P', gatePassDeduction: 225}, {status: 'P', gatePassDeduction: 100}]).gatePassDeduction, 325);
});

test('exempt roles: CMD, Directors, VP, CFO, CA — drivers are not exempt', () => {
  for (const role of ['CMD', 'Director', 'Directors', 'Executive Director', 'VP', 'VP Operations', 'Vice President', 'CFO', 'CA', 'Chartered Accountant']) {
    assert.equal(isExempt(role), true, role);
  }
  for (const role of ['Driver', 'Cashier', 'Accountant', 'Assistant Director Driver', 'HR Executive', '']) {
    assert.equal(isExempt(role), false, role);
  }
  const exempt = evaluateDay({designation: 'CFO'});
  assert.deepEqual([exempt.status, exempt.late, exempt.exempt], ['P', false, true]);
  assert.equal(evaluateDay({designation: 'Driver'}).status, 'A');
});

test('miss punch and absent days', () => {
  assert.equal(evaluateDay({inMinute: at('08:00')}).status, 'MP');
  assert.equal(evaluateDay({inMinute: at('08:00'), outMinute: at('08:00')}).status, 'MP');
  assert.equal(evaluateDay({}).status, 'A');
  assert.equal(evaluateDay({}).late, false);
});

test('settings are editable, validated and keep drivers out of the exempt list', () => {
  const custom = validatePolicy({lunchMinutes: '30', absentBelowHours: 3.5, fullDutyHours: 8, graceMinutes: 10, lateEarlyPerHalfCut: 4, gatePassFreeMinutes: 90, exemptRoles: 'CMD, VP'});
  assert.deepEqual(custom, {lunchMinutes: 30, absentBelowHours: 3.5, fullDutyHours: 8, graceMinutes: 10, lateEarlyPerHalfCut: 4, gatePassFreeMinutes: 90, exemptRoles: ['CMD', 'VP']});
  assert.equal(dutyStatus(span(7, 59), custom), 'HD');
  assert.equal(isLate(at('08:11'), at('08:00'), custom), true);
  assert.equal(halfDutyCuts(3, custom), 0);
  assert.equal(gatePassDeduction(90, 800, custom), 0);
  assert.throws(() => validatePolicy({fullDutyHours: 4}), /more than/);
  assert.throws(() => validatePolicy({graceMinutes: -1}), /grace/i);
  assert.throws(() => validatePolicy({lateEarlyPerHalfCut: 0}), /per half duty/);
  assert.throws(() => validatePolicy({absentBelowHours: 4.1}), /quarter/);
  assert.throws(() => validatePolicy({exemptRoles: ['CMD', 'Driver']}), /Drivers are not exempt/);
});

test('policy page wording follows the settings', () => {
  const rules = Object.fromEntries(policyRules());
  assert.match(rules['Late come'], /08:15 is on time and 08:16 is late/);
  assert.match(rules['Day status'], /Under 4 hrs = Absent · 4 hrs to under 7 hrs = Half duty · 7 hrs or more = Full duty/);
  assert.match(Object.fromEntries(policyRules({...DEFAULT_POLICY, graceMinutes: 10}))['Late come'], /08:11 is late/);
});
