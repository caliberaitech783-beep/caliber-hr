import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRegister, gatePassMinutes, readPolicy, savePolicy} from './attendance-register.mjs';
import {createAttendance} from './attendance.mjs';
import {DEFAULT_POLICY} from './attendance-policy.mjs';

const staff = {id: 'e1', code: 'C001', name: 'Ravi', siteId: 's1', siteCode: 'NGP', site: 'Nagpur', siteType: 'Office', shift: 'General', starts: '08:00', ends: '17:00', designation: 'Accountant', dailyWage: 800};
const punches = (date, ...times) => times.map(time => ({employeeId: 'e1', at: `${date} ${time}`}));
const register = (extra = {}) => buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [staff], ...extra});
const only = result => result.rows[0].days[0];

test('the server day calculation applies the hours rule with lunch excluded', () => {
  const cases = [['12:59', 'A'], ['13:00', 'HD'], ['15:29', 'HD'], ['15:30', 'P']];
  for (const [out, status] of cases) {
    const day = only(register({punches: punches('2026-11-02', '08:00', out)}));
    assert.equal(day.status, status, `08:00 → ${out}`);
  }
  const day = only(register({punches: punches('2026-11-02', '08:00', '10:30', '16:00')}));
  assert.deepEqual([day.in, day.out, day.workedMinutes], ['08:00', '16:00', 420]);
});

test('late after 15 min grace and early going before shift end', () => {
  assert.equal(only(register({punches: punches('2026-11-02', '08:15', '17:00')})).late, false);
  assert.equal(only(register({punches: punches('2026-11-02', '08:16', '17:00')})).late, true);
  assert.equal(only(register({punches: punches('2026-11-02', '08:00', '16:59')})).early, true);
  assert.equal(only(register({punches: punches('2026-11-02', '08:00', '17:00')})).early, false);
});

test('third and sixth late / early in a month cut half duties; the next month starts again', () => {
  const days = ['02', '03', '04', '05', '06', '07'].map(d => `2026-11-${d}`);
  const lateDays = days.flatMap((date, i) => punches(date, i % 2 ? '08:00' : '08:20', i % 2 ? '16:30' : '17:00'));
  const month = buildRegister({from: '2026-11-02', to: '2026-11-07', today: '2026-11-20', employees: [staff], punches: lateDays});
  assert.deepEqual([month.rows[0].summary.late, month.rows[0].summary.early, month.rows[0].summary.halfDutyCuts], [3, 3, 2]);
  const third = buildRegister({from: '2026-11-02', to: '2026-11-04', today: '2026-11-20', employees: [staff], punches: lateDays});
  assert.equal(third.rows[0].summary.halfDutyCuts, 1);
  const twoMonths = buildRegister({from: '2026-10-30', to: '2026-11-02', today: '2026-11-20', employees: [{...staff, siteType: 'Site'}],
    punches: [...punches('2026-10-30', '08:20', '17:00'), ...punches('2026-10-31', '08:20', '17:00'), ...punches('2026-11-01', '08:20', '17:00'), ...punches('2026-11-02', '08:20', '17:00')]});
  assert.deepEqual([twoMonths.rows[0].months['2026-10'].halfDutyCuts, twoMonths.rows[0].months['2026-11'].halfDutyCuts], [0, 0]);
});

test('miss punch, absent, holiday, leave, OD and weekly off', () => {
  assert.equal(only(register({punches: punches('2026-11-02', '08:00')})).status, 'MP');
  assert.equal(only(register({punches: punches('2026-11-02', '08:00', '08:03')})).status, 'MP');
  assert.equal(only(register({})).status, 'A');
  assert.equal(only(register({holidays: [{date: '2026-11-02', siteId: 'NGP', name: 'Diwali'}]})).status, 'H');
  assert.equal(only(register({holidays: [{date: '2026-11-02', siteId: 'other', name: 'Local'}]})).status, 'A');
  assert.equal(only(register({leaves: [{employeeId: 'e1', from: '2026-11-01', to: '2026-11-03'}]})).status, 'L');
  assert.equal(only(register({ods: [{employeeId: 'e1', from: '2026-11-02'}], punches: punches('2026-11-02', '08:00')})).status, 'OD');
  const sunday = buildRegister({from: '2026-11-01', to: '2026-11-01', today: '2026-11-20', employees: [staff]});
  assert.equal(sunday.rows[0].days[0].status, 'WO');
  const today = buildRegister({from: '2026-11-20', to: '2026-11-21', today: '2026-11-20', employees: [staff], punches: punches('2026-11-20', '08:00')});
  assert.deepEqual(today.rows[0].days.map(d => d.status), ['IN']);
});

test('night shift punches after midnight stay on the shift start date', () => {
  const night = {...staff, starts: '21:00', ends: '05:00', siteType: 'Site'};
  const result = buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [night],
    punches: [{employeeId: 'e1', at: '2026-11-02 20:50'}, {employeeId: 'e1', at: '2026-11-03 04:59'}]});
  const day = result.rows[0].days[0];
  assert.deepEqual([day.status, day.in, day.out, day.late, day.early], ['P', '20:50', '04:59 (+1)', false, true]);
});

test('trip card / logbook staff are not exempt and exempt roles are present without late marks', () => {
  const cfo = buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [{...staff, designation: 'CFO'}], punches: punches('2026-11-02', '09:30', '11:00')});
  assert.deepEqual([cfo.rows[0].exempt, cfo.rows[0].days[0].status, cfo.rows[0].days[0].late], [true, 'P', false]);
  const absentCfo = buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [{...staff, designation: 'CFO'}]});
  assert.equal(absentCfo.rows[0].days[0].status, 'P');
  const driver = buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [{...staff, designation: 'Driver'}]});
  assert.deepEqual([driver.rows[0].exempt, driver.rows[0].days[0].status], [false, 'A']);
});

test('gate pass: 1:00 free, 1:01 and 2:15 deducted in full at daily wage / 8', () => {
  const day = minutes => only(register({punches: punches('2026-11-02', '08:00', '17:00'), gatePasses: [{employeeId: 'e1', date: '2026-11-02', minutes}]}));
  assert.equal(day(60).gatePassDeduction, 0);
  assert.equal(day(61).gatePassDeduction, 101.67);
  assert.equal(day(135).gatePassDeduction, 225);
  const two = only(register({punches: punches('2026-11-02', '08:00', '17:00'), gatePasses: [{employeeId: 'e1', date: '2026-11-02', minutes: 40}, {employeeId: 'e1', date: '2026-11-02', minutes: 40}]}));
  assert.deepEqual([two.gatePassMinutes, two.gatePassDeduction], [80, 133.33]);
  // Without a daily wage the monthly pay is spread over the days of the month (30 in November).
  const monthly = buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [{...staff, dailyWage: 0, monthlyPay: 24000}],
    gatePasses: [{employeeId: 'e1', date: '2026-11-02', minutes: 135}], punches: punches('2026-11-02', '08:00', '17:00')});
  assert.equal(monthly.rows[0].days[0].gatePassDeduction, 225);
  assert.equal(monthly.rows[0].summary.gatePassDeduction, 225);
});

test('gate pass time comes from security gate out / back in, else the planned times', () => {
  const history = [{stage: 1, decision: 'APPROVED', at: '2026-11-02T04:00:00Z'}, {stage: 2, decision: 'APPROVED', at: '2026-11-02T06:30:00Z'}, {stage: 3, decision: 'APPROVED', at: '2026-11-02T08:45:00Z'}];
  assert.equal(gatePassMinutes({history, outTime: '12:00', returnTime: '12:30'}), 135);
  assert.equal(gatePassMinutes({history: [], outTime: '12:00', returnTime: '13:01'}), 61);
  assert.equal(gatePassMinutes({outTime: '12:00', returnTime: '11:00'}), 0);
});

test('policy settings: defaults, validation and version check', async () => {
  const stored = [];
  const db = {async query(sql, values) {
    stored.push([sql, values]);
    if (/SELECT settings/.test(sql)) return {rows: []};
    if (/INSERT INTO hr_attendance_policy/.test(sql)) return {rows: [{version: 1, updated_by: 'hr', updated_at: 'now'}]};
    if (/UPDATE hr_attendance_policy/.test(sql)) return {rows: []};
    return {rows: []};
  }};
  assert.deepEqual((await readPolicy(db)).policy, {...DEFAULT_POLICY, exemptRoles: [...DEFAULT_POLICY.exemptRoles]});
  const saved = await savePolicy(db, 'hr', {version: 0, policy: {...DEFAULT_POLICY, graceMinutes: 10}});
  assert.equal(saved.policy.graceMinutes, 10);
  assert.ok(stored.some(([sql]) => /UPDATE_ATTENDANCE_POLICY/.test(sql)));
  await assert.rejects(savePolicy(db, 'hr', {version: 3, policy: DEFAULT_POLICY}), e => e.status === 409);
  await assert.rejects(savePolicy(db, 'hr', {version: 0, policy: {fullDutyHours: 2}}), e => e.status === 400);
});

test('only an unrestricted HR administrator can change the policy', async () => {
  const pool = {async query() { return {rows: []}; }, connect() { throw new Error('must not write'); }};
  const service = createAttendance(pool, {bridgeKey: 'k'.repeat(40)});
  const siteHr = {actor: 'site', permissions: {application: 'HR', site: 'Nagpur', hrDesktopAccess: ['Employee Master']}};
  await assert.rejects(service.attendanceApi(siteHr, 'policy', 'POST', {version: 0, policy: DEFAULT_POLICY}, new URLSearchParams()), e => e.status === 403);
  const view = await service.attendanceApi(siteHr, 'policy', 'GET', {}, new URLSearchParams());
  assert.equal(view.policy.graceMinutes, 15);
  assert.equal(view.canEdit, false);
});
