import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRegister, gatePassMinutes, readPolicy, savePolicy, pairByKey} from './attendance-register.mjs';
import {createAttendance} from './attendance.mjs';
import {DEFAULT_POLICY, validatePolicy, workingHoursStatus, standardHours, workingHoursRuleSite, isDriverOrOperator} from './attendance-policy.mjs';

const staff = {id: 'e1', code: 'C001', name: 'Ravi', siteId: 's1', siteCode: 'NGP', site: 'Nagpur', siteType: 'Office', shift: 'General', starts: '08:00', ends: '17:00', designation: 'Accountant', dailyWage: 800};
const punches = (date, ...times) => times.map(time => ({employeeId: 'e1', at: `${date} ${time}`}));
const register = (extra = {}) => buildRegister({from: '2026-11-02', to: '2026-11-02', today: '2026-11-20', employees: [staff], ...extra});
const only = result => result.rows[0].days[0];

test('the server day calculation applies the hours rule with lunch excluded', () => {
  const cases = [['12:59', 'A'], ['13:00', 'HD'], ['15:59', 'HD'], ['16:00', 'P']];
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

test('rotating drivers and operators keep repeated C duties together even without a shift assignment', () => {
  for (const designation of ['Tipper Driver', 'Dumper operator', '']) {
    const employee = {...staff, designation, siteType: 'Site', site: 'Sasti OC', starts: null, ends: null};
    const result = buildRegister({from: '2026-11-02', to: '2026-11-04', today: '2026-11-20', employees: [employee],
      punches: [...punches('2026-11-02', '21:00'), ...punches('2026-11-03', '05:00', '21:00'), ...punches('2026-11-04', '05:00')]});
    assert.deepEqual(result.rows[0].days.map(d => [d.in,d.out,d.status,d.missPunch]), [
      ['21:00','05:00 (+1)','P',false], ['21:00','05:00 (+1)','P',false], ['','','A',false]
    ]);
    assert.equal(result.rows[0].summary.missPunch, 0);
  }
});

test('a rotating operator on an old A assignment works C, including a one-day query across month end', () => {
  const employee = {...staff, designation: 'Dumper operator', siteType: 'Site', starts: '05:00', ends: '13:00'};
  const input = {today:'2026-12-02',employees:[employee],punches:[...punches('2026-11-30','05:00','21:00'),...punches('2026-12-01','05:00','21:00'),...punches('2026-12-02','05:00')]};
  const night = only(buildRegister({...input,from:'2026-11-30',to:'2026-11-30'}));
  assert.deepEqual([night.in,night.out,night.status,night.shift,night.late],['21:00','05:00 (+1)','P','C',false]);
  const next = only(buildRegister({...input,from:'2026-12-01',to:'2026-12-01'}));
  assert.deepEqual([next.in,next.out,next.status],['21:00','05:00 (+1)','P']);
});

test('day shifts are preserved; a night missing its OUT and a morning missing its IN still need review', () => {
  const employees = [{...staff,starts:null,ends:null,designation:'Driver',siteType:'Site'}];
  for (const times of [['05:00','13:00'],['13:00','21:00']]) {
    const d = only(register({employees,punches:punches('2026-11-02',...times)}));
    assert.deepEqual([d.in,d.out,d.status],[...times,'P']);
  }
  for (const time of ['21:00','05:00']) {
    assert.equal(only(register({employees,punches:punches('2026-11-02',time)})).status,'MP');
  }
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
  const siteHr = {actor: 'site', permissions: {application: 'HR', site: 'Nagpur', hrDesktopAccess: ['Attendance Management']}};
  await assert.rejects(service.attendanceApi(siteHr, 'policy', 'POST', {version: 0, policy: DEFAULT_POLICY}, new URLSearchParams()), e => e.status === 403);
  const view = await service.attendanceApi(siteHr, 'policy', 'GET', {}, new URLSearchParams());
  assert.equal(view.policy.graceMinutes, 15);
  assert.equal(view.canEdit, false);
});

test('roster: comp off leave shows as CO, department is carried on the line', async () => {
  const {isCompOff} = await import('./attendance-register.mjs');
  assert.deepEqual(['Comp Off', 'CO Comp off', 'Compensatory off', 'comp-off', 'CL Casual Leave', 'COL Casual'].map(isCompOff), [true, true, true, true, false, false]);
  const result = buildRegister({from: '2026-11-02', to: '2026-11-04', today: '2026-11-20', employees: [{...staff, department: 'Accounts'}],
    leaves: [{employeeId: 'e1', from: '2026-11-02', to: '2026-11-02', compOff: true}, {employeeId: 'e1', from: '2026-11-03', to: '2026-11-03'}]});
  const row = result.rows[0];
  assert.equal(row.department, 'Accounts');
  assert.deepEqual(row.days.map(d => d.status), ['CO', 'L', 'A']);
  assert.deepEqual([row.summary.CO, row.summary.L], [1, 1]);
});

/* ---------- Working-hours rules for Manual Biometric (owner, 28 Nov 2026) ---------- */
const GP = 'Gauri Pauni OB 2nd';
const rulePolicy = validatePolicy({workingHoursSites: [GP]});
const helper = {id: 'w1', code: 'CMLL19971', name: 'AAKASH KUMAR', siteId: 'gp', site: GP, siteType: '', designation: 'ASST MECHANIC PC', workingHours: 12, hoursSource: 'master'};
const keyed = (id, list) => list.map(([at, type]) => ({employeeId: id, at, type}));
const ruled = (extra = {}) => buildRegister({from: '2026-11-01', to: '2026-11-04', today: '2026-11-28', policy: rulePolicy, workingHoursSite: GP, employees: [helper], ...extra});
const byDate = result => Object.fromEntries(result.rows[0].days.map(day => [day.date.slice(8), day]));

test('working-hours rules: In/Out key pairs day duties on their own date (Gauri Pauni DAT, AAKASH KUMAR)', () => {
  const days = byDate(ruled({punches: keyed('w1', [
    ['2026-11-01 07:27', '0'], ['2026-11-01 19:01', '1'], ['2026-11-02 07:00', '0'], ['2026-11-02 19:14', '1'],
    ['2026-11-03 07:45', '0'], ['2026-11-04 07:29', '0'], ['2026-11-04 18:48', '1']])}));
  assert.deepEqual([days['01'].status, days['01'].in, days['01'].out, days['01'].workedMinutes], ['P', '07:27', '19:01', 694], '11 h 34 m ≥ 12 - 1 h: P, no lunch deducted');
  assert.deepEqual([days['02'].status, days['02'].in, days['02'].out], ['P', '07:00', '19:14'], 'evening Out is not paired with the next morning In');
  assert.deepEqual([days['03'].status, days['03'].in, days['03'].out], ['MP', '07:45', ''], 'a lone In is a miss punch, not absent');
  assert.equal(days['04'].status, 'P');
  assert.ok(Object.values(days).every(day => !day.late && !day.early), 'no late come / early going under the rules');
});

test('working-hours rules: a night duty counts on the In date (AMAN HAIBURU, 19:11 → 07:08 next day)', () => {
  const days = byDate(ruled({punches: keyed('w1', [['2026-11-02 19:11', '0'], ['2026-11-03 07:08', '1'], ['2026-11-03 19:03', '0'], ['2026-11-04 07:05', '1']])}));
  assert.deepEqual([days['02'].status, days['02'].in, days['02'].out], ['P', '19:11', '07:08 (+1)']);
  assert.deepEqual([days['03'].status, days['03'].in, days['03'].out], ['P', '19:03', '07:05 (+1)'], 'the 07:08 Out is not the 3rd\'s In');
  assert.equal(days['04'].status, 'A', 'the 4th has no duty of its own');
  assert.equal(days['01'].status, 'A');
});

test('working-hours rules: P from hours - 1 h, HD from half, else SH; blank hours HM', () => {
  assert.deepEqual([660, 659, 360, 359].map(m => workingHoursStatus(m, 12)), ['P', 'HD', 'HD', 'SH']);
  assert.deepEqual([420, 419, 240, 239].map(m => workingHoursStatus(m, 8)), ['P', 'HD', 'HD', 'SH']);
  assert.equal(workingHoursStatus(700, null), 'HM');
  assert.deepEqual([11.6, 10.4, 8.6, 9.4].map(standardHours), [12, 11, 8, 8]);
  const short = byDate(ruled({punches: keyed('w1', [['2026-11-01 07:00', '0'], ['2026-11-01 11:00', '1']])}))['01'];
  assert.deepEqual([short.status, short.workedMinutes], ['SH', 240]);
  assert.match(short.note, /Short hours/);
  const missing = byDate(ruled({employees: [{...helper, workingHours: null, hoursSource: 'missing'}], punches: keyed('w1', [['2026-11-01 07:00', '0'], ['2026-11-01 19:00', '1']])}));
  assert.equal(missing['01'].status, 'HM');
  const assumed = byDate(ruled({employees: [{...helper, hoursSource: 'designation'}], punches: keyed('w1', [['2026-11-01 07:00', '0'], ['2026-11-01 19:00', '1']])}));
  assert.match(assumed['01'].note, /taken from the same designation at the site — HR to confirm/);
});

test('working-hours rules: Out → In is rest, a wrong key pairs only near the usual In hour, double presses merge', () => {
  const rest = pairByKey([{minute: 19 * 60, type: '1'}, {minute: 31 * 60, type: '0'}]);
  assert.ok([...rest.values()].every(duty => !duty.complete), '19:00 Out → 07:00 In is never a duty');
  const guessed = pairByKey([{minute: 7 * 60, type: '0'}, {minute: 19 * 60, type: '0'}], 7);
  assert.deepEqual([guessed.get(0).complete, guessed.get(0).guessed, guessed.get(0).worked], [true, true, 720]);
  assert.ok(![...pairByKey([{minute: 13 * 60, type: '0'}, {minute: 19 * 60, type: '0'}], 7).values()].some(duty => duty.complete), 'far from the usual In: not guessed');
  const pressed = pairByKey([{minute: 420, type: '0'}, {minute: 422, type: '0'}, {minute: 1140, type: '1'}]);
  assert.deepEqual([pressed.get(0).inMinute, pressed.get(0).outMinute, pressed.get(0).complete], [420, 1140, true]);
  // AAKASH, 14 Nov: 07:18 In, 19:08 In, 19:08 Out — the key was corrected at once, so the Out counts.
  const corrected = pairByKey([{minute: 438, type: '0'}, {minute: 1148, type: '0'}, {minute: 1148, type: '1'}]);
  assert.deepEqual([corrected.get(0).complete, corrected.get(0).outMinute], [true, 1148]);
  assert.equal(pairByKey([{minute: 0, type: '0'}, {minute: 17 * 60, type: '1'}]).get(0).complete, false, 'more than 16 h is not one duty');
});

test('working-hours rules: device offline is DO, after the leaving date LF; switched off and drivers keep the old rules', () => {
  const days = byDate(ruled({employees: [{...helper, leavingDate: '2026-11-03'}], offline: ['w1|2026-11-02'], punches: keyed('w1', [['2026-11-01 07:00', '0'], ['2026-11-01 19:00', '1']])}));
  assert.deepEqual(['01', '02', '03', '04'].map(d => days[d].status), ['P', 'DO', 'A', 'LF']);
  const list = keyed('w1', [['2026-11-01 07:27', '0'], ['2026-11-01 19:01', '1']]);
  const off = buildRegister({from: '2026-11-01', to: '2026-11-04', today: '2026-11-28', policy: rulePolicy, employees: [helper], punches: list});
  const before = buildRegister({from: '2026-11-01', to: '2026-11-04', today: '2026-11-28', employees: [helper], punches: list});
  assert.deepEqual(off.rows[0].days, before.rows[0].days, 'no workingHoursSite: exactly the old calculation');
  assert.equal(off.rows[0].rule, undefined);
  const driver = {...helper, designation: 'VOLVO DRIVER'};
  assert.deepEqual(ruled({employees: [driver], punches: list}).rows[0].days,
    buildRegister({from: '2026-11-01', to: '2026-11-04', today: '2026-11-28', employees: [driver], punches: list}).rows[0].days, 'drivers keep their rules');
  assert.ok(['PC OPERATOR', 'EXCAVATOR/OP', 'TIPPER DRIVER'].every(isDriverOrOperator) && !isDriverOrOperator('ASST MECHANIC PC'));
  const excepted = byDate(ruled({employees: [{...helper, exceptions: [{from: '2026-11-02', to: ''}]}], punches: keyed('w1', [['2026-11-03 07:00', '0'], ['2026-11-03 10:00', '1']])}));
  assert.deepEqual([excepted['01'].status, excepted['02'].status, excepted['03'].status], ['A', 'P', 'P'], 'a Biometric Exception Master day stays present under the rules');
});

test('working-hours rule sites are cleaned and matched without case or extra spaces', () => {
  assert.deepEqual(validatePolicy({workingHoursSites: ' Gauri  Pauni OB 2nd , gauri pauni ob 2nd, Sasti OB '}).workingHoursSites, ['Gauri Pauni OB 2nd', 'Sasti OB']);
  assert.equal(workingHoursRuleSite(rulePolicy, 'gauri pauni  OB 2nd'), true);
  // Site Master names the site "Gauri Pauni OC" (live, 28 Nov 2026): OB = OC, "(2nd)" = "2nd".
  assert.equal(workingHoursRuleSite(rulePolicy, 'Gauri Pauni OC'), true);
  assert.equal(workingHoursRuleSite(rulePolicy, 'Gauri Pauni OC (2nd)'), true);
  assert.equal(workingHoursRuleSite(validatePolicy({workingHoursSites: ['Majri OB']}), 'Majri OC'), true);
  assert.equal(workingHoursRuleSite(rulePolicy, 'Sasti OB'), false);
  assert.deepEqual(validatePolicy({}).workingHoursSites, []);
});
