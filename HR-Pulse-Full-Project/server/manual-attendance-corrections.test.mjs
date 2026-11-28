import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCorrections, cleanCorrection, correctedDay} from './manual-attendance-corrections.mjs';
import {createAttendance} from './attendance.mjs';
import {DEFAULT_POLICY} from './attendance-policy.mjs';

const TODAY = '2026-11-25';
const day = (date, extra = {}) => ({date, status: 'A', calendar: '', note: '', in: '', out: '', workedMinutes: null, late: false, early: false,
  missPunch: false, gatePassMinutes: 0, gatePassDeduction: 0, exempt: false, ...extra});
const register = () => ({from: '2026-11-01', to: '2026-11-02', policy: DEFAULT_POLICY, site: 'Dhoptala OB 2nd', machines: [], rows: [
  {id: 'e1', code: 'CMLL20611', name: 'AADIL KHAN', designation: 'TIPPER HELPER', shiftStart: '', shiftEnd: '', linked: true, summary: {full: 0, missPunch: 1, absent: 1},
    days: [day('2026-11-01', {status: 'MP', in: '07:30', missPunch: true, note: 'Only one punch'}), day('2026-11-02')]},
  {id: 'e2', code: 'CMLL17939', name: 'ABDUL MABOOD', designation: 'DRILL MECHANIC', shiftStart: '', shiftEnd: '', linked: true, summary: {},
    days: [day('2026-11-01', {status: 'P', in: '07:01', out: '18:57'})]}
]});

test('a correction needs a past day, the employee, a time or a code, and a reason', () => {
  const ok = cleanCorrection({day: '2026-11-01', employeeCode: ' cmll20611 ', in: '07:30', out: '19:05', reason: 'Out punch missed, machine down'}, TODAY);
  assert.deepEqual(ok, {day: '2026-11-01', employeeCode: 'CMLL20611', status: '', in: '07:30', out: '19:05', reason: 'Out punch missed, machine down'});
  assert.equal(cleanCorrection({day: '2026-11-01', employeeCode: 'X1', status: 'od', reason: 'On site visit'}, TODAY).status, 'OD');
  assert.throws(() => cleanCorrection({day: TODAY, employeeCode: 'X1', status: 'P', reason: 'abc'}, TODAY), /yesterday back/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: '', status: 'P', reason: 'abc'}, TODAY), /employee/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: 'X1', reason: 'abc'}, TODAY), /In \/ Out time or choose a code/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: 'X1', status: 'MP', reason: 'abc'}, TODAY), /Choose a code/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: 'X1', out: '19:00', reason: 'abc'}, TODAY), /In time with the Out/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: 'X1', in: '7:3', reason: 'abc'}, TODAY), /HH:MM/);
  assert.throws(() => cleanCorrection({day: '2026-11-01', employeeCode: 'X1', status: 'P', reason: ' '}, TODAY), /reason/);
});

test('a new In / Out is rated again with the policy; an Out before the In is the next morning', () => {
  const row = register().rows[0];
  const fixed = correctedDay(row.days[0], {in: '07:30', out: '19:05', reason: 'Out punch missed', correctedBy: 'vinod', correctedAt: 'now'}, row);
  assert.equal(fixed.status, 'P');
  assert.equal(fixed.out, '19:05');
  assert.equal(fixed.missPunch, false);
  assert.deepEqual(fixed.corrected.before, {status: 'MP', in: '07:30', out: ''});
  assert.equal(fixed.corrected.by, 'vinod');
  assert.match(fixed.note, /Corrected by vinod: Out punch missed/);
  const night = correctedDay(row.days[1], {in: '19:00', out: '07:10', reason: 'Night duty'}, row);
  assert.equal(night.out, '07:10 (+1)');
  assert.equal(night.status, 'P');
});

test('a chosen code wins over the punches', () => {
  const row = register().rows[0];
  const od = correctedDay(row.days[0], {status: 'OD', reason: 'Went to Nagpur office'}, row);
  assert.equal(od.status, 'OD');
  assert.equal(od.missPunch, false);
  assert.equal(od.workedMinutes, null);
});

test('corrections apply to the matching person and day only, and the totals follow', () => {
  const base = register();
  const result = applyCorrections(base, [{day: '2026-11-01', employee_code: 'CMLL20611', status: '', in_time: '07:30', out_time: '19:05', reason: 'Out punch missed', corrected_by: 'vinod', corrected_at: '2026-11-25T10:00:00Z'},
    {day: '2026-11-02', employee_code: 'CMLL99999', status: 'P', in_time: '', out_time: '', reason: 'Someone else', corrected_by: 'vinod', corrected_at: ''}]);
  const [aadil, abdul] = result.rows;
  assert.equal(aadil.days[0].status, 'P');
  assert.equal(aadil.days[0].corrected.reason, 'Out punch missed');
  assert.equal(aadil.days[1].status, 'A', 'the other day is untouched');
  assert.equal(aadil.summary.full, 1);
  assert.equal(aadil.summary.missPunch, 0);
  assert.equal(aadil.months['2026-11'].absent, 1);
  assert.equal(abdul, base.rows[1], 'a person without a correction is the same object');
  assert.equal(base.rows[0].days[0].status, 'MP', 'the register read from the punches is not changed');
  assert.equal(applyCorrections(base, []), base);
});

function fakePool(handler) {
  const calls = [];
  const query = async (sql, params) => {calls.push([sql, params]); return handler(sql, params) || {rows: [], rowCount: 0};};
  return {calls, query, connect: async () => ({query, release() {}})};
}
const admin = {actor: 'vinod', permissions: {application: 'HR', hrDesktopAccess: ['Attendance Management', 'Employee Master']}};
const siteHr = {actor: 'stupal', permissions: {application: 'HR', hrDesktopAccess: ['Attendance Management']}};
const sitePool = () => fakePool(sql => sql.includes("kind='sites'") ? {rows: [{id: '11111111-1111-4111-8111-111111111111', name: 'Dhoptala OB 2nd', site_type: 'Site'}]} : undefined);

test('only an HR administrator corrects a day or deletes saved manual logs', async () => {
  const pool = sitePool(), service = createAttendance(pool, {bridgeKey: 'k'.repeat(40)});
  const body = {site: 'Dhoptala OB 2nd', day: '2026-11-01', employeeCode: 'CMLL20611', status: 'P', reason: 'Machine down'};
  await assert.rejects(service.attendanceApi(siteHr, 'manual-biometric/corrections', 'POST', body, new URLSearchParams()), e => e.status === 403 && /HR administrator/.test(e.message));
  await assert.rejects(service.attendanceApi(siteHr, 'manual-biometric/corrections', 'DELETE', body, new URLSearchParams()), e => e.status === 403);
  await assert.rejects(service.attendanceApi(siteHr, 'manual-biometric/corrections/undo', 'POST', body, new URLSearchParams()), e => e.status === 403);
  await assert.rejects(service.attendanceApi(siteHr, 'manual-biometric-days', 'DELETE', {site: 'Dhoptala OB 2nd', days: ['2026-11-01']}, new URLSearchParams()), e => e.status === 403 && /delete saved manual biometric logs/.test(e.message));
  await assert.rejects(service.attendanceApi(siteHr, 'manual-biometric-days/delete', 'POST', {site: 'Dhoptala OB 2nd', days: ['2026-11-01']}, new URLSearchParams()), e => e.status === 403 && /delete saved manual biometric logs/.test(e.message));
  assert.ok(!pool.calls.some(([sql]) => /hr_manual_attendance_corrections|DELETE FROM/.test(sql)), 'nothing was written');
});

test('an HR administrator saves a correction with its audit line', async () => {
  const pool = fakePool(sql => {
    if (sql.includes("kind='sites'")) return {rows: [{id: '11111111-1111-4111-8111-111111111111', name: 'Dhoptala OB 2nd', site_type: 'Site'}]};
    if (sql.startsWith('INSERT INTO hr_manual_attendance_corrections')) return {rows: [{day: '2026-11-01', employee_code: 'CMLL20611', status: 'P', in_time: '', out_time: '', reason: 'Machine down', corrected_by: 'vinod'}]};
    return undefined;
  });
  const service = createAttendance(pool, {bridgeKey: 'k'.repeat(40)});
  const result = await service.attendanceApi(admin, 'manual-biometric/corrections', 'POST', {site: 'Dhoptala OB 2nd', day: '2026-11-01', employeeCode: 'cmll20611', status: 'P', reason: 'Machine down'}, new URLSearchParams());
  assert.equal(result.employee_code, 'CMLL20611');
  assert.equal(result.savedCopyUpdated, false);
  const insert = pool.calls.find(([sql]) => sql.startsWith('INSERT INTO hr_manual_attendance_corrections'));
  assert.deepEqual(insert[1], ['Dhoptala OB 2nd', '2026-11-01', 'CMLL20611', 'P', '', '', 'Machine down', 'vinod']);
  assert.ok(pool.calls.some(([sql, params]) => sql.includes('INSERT INTO hr_audit') && params[1] === 'CORRECT_MANUAL_ATTENDANCE_DAY'));
});

test('an HR administrator undoes a correction with a POST to …/undo', async () => {
  const pool = fakePool(sql => {
    if (sql.includes("kind='sites'")) return {rows: [{id: '11111111-1111-4111-8111-111111111111', name: 'Dhoptala OB 2nd', site_type: 'Site'}]};
    if (sql.startsWith('DELETE FROM hr_manual_attendance_corrections')) return {rows: [{status: 'P', in_time: '', out_time: '', reason: 'Machine down', corrected_by: 'vinod'}]};
    return undefined;
  });
  const service = createAttendance(pool, {bridgeKey: 'k'.repeat(40)});
  const result = await service.attendanceApi(admin, 'manual-biometric/corrections/undo', 'POST', {site: 'Dhoptala OB 2nd', day: '2026-11-01', employeeCode: 'CMLL20611'}, new URLSearchParams());
  assert.deepEqual([result.day, result.employeeCode, result.removed], ['2026-11-01', 'CMLL20611', true]);
  assert.ok(!pool.calls.some(([sql]) => sql.startsWith('INSERT INTO hr_manual_attendance_corrections')), 'an undo saves nothing');
  assert.ok(pool.calls.some(([sql, params]) => sql.includes('INSERT INTO hr_audit') && params[1] === 'UNDO_MANUAL_ATTENDANCE_CORRECTION'));
});

test('only an HR administrator sees the attendance read times', async () => {
  const {clearReads, recordRead} = await import('./read-times.mjs');
  clearReads();
  recordRead({at: '2026-11-28T04:00:00.000Z', route: 'manual-biometric', method: 'GET', status: 200, ms: 1200, bytes: 340000, sent: 9000, site: 'Majri OC', from: '2026-11-01', to: '2026-11-01', days: 1, by: 'stupal'});
  recordRead({at: '2026-11-28T04:00:02.000Z', route: 'manual-biometric', method: 'GET', status: 200, ms: 400, bytes: 300000, sent: 8000, site: 'Majri OC', from: '2026-11-02', to: '2026-11-02', days: 1, by: 'stupal'});
  const service = createAttendance(sitePool(), {bridgeKey: 'k'.repeat(40)});
  await assert.rejects(service.attendanceApi(siteHr, 'read-times', 'GET', {}, new URLSearchParams()), e => e.status === 403 && /HR administrator/.test(e.message));
  const times = await service.attendanceApi(admin, 'read-times', 'GET', {}, new URLSearchParams());
  assert.equal(times.kept, 2);
  assert.deepEqual(times.routes, [{route: 'manual-biometric', requests: 2, failed: 0, usualMs: 400, worstMs: 1200, usualKb: 293, worstKb: 332, usualSentKb: 8}]);
  assert.equal(times.slowest[0].ms, 1200);
  assert.equal(times.latest[0].from, '2026-11-02', 'newest first');
  clearReads();
});
