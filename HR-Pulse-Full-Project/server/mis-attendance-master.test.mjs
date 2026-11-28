// Owner, 27 Nov 2026: Pulse-II (MIS) is the master of trip card attendance.
//   "MIS will be the primary master for HR to fetch in the roster. And if MIS gives the data to HR, and if HR makes any
//    changes, it has to be through OTP. If HR makes absent as present or present as absent, then the same has to be
//    re-updated in MIS also."
//   - a present / absent change is sent to Pulse-II (ask, then the RHR's OTP) and never kept in HR Pulse;
//   - an absent or pending that was kept only in HR Pulse is no longer applied;
//   - Pulse-II signs every site-day it sends, and a saved day keeps that signature, so an old copy is never shown.
import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createMisAttendance} from './mis-attendance.mjs';
import {createTripCardStore, daySignature} from './trip-card-store.mjs';

const grant = 'a'.repeat(43), hr = {actor: 'meena'};
const duty = {date: '2026-11-16', site: 'Jayant OB', shift: 'S1', employeeId: 'CMPL101'};
const report = {attendanceEquipment: [], attendanceShifts: [], otDuties: [duty], ot: [], performance: [], details: [], exceptions: []};

function setup(answer) {
  const sent = [], queries = [];
  const rows = sql => /FROM hr_mis_attendance_corrections/.test(sql) ? [{duty_id: 'd1', status: 'absent', start_time: '', end_time: '', reason: 'Old HR mark', version: 1, updated_by: 'x'},
    {duty_id: 'd2', status: 'present', start_time: '05:00', end_time: '13:00', reason: 'Times', version: 1, updated_by: 'x'}] : [];
  const pool = {
    async query(sql, args) { queries.push([sql.trim().split(/\s+/).slice(0, 3).join(' '), args]); return {rows: rows(sql)}; },
    async connect() { return {query: pool.query, release() {}}; }
  };
  const fetchMis = async (url, options) => {
    sent.push({path: url.pathname, query: Object.fromEntries(url.searchParams), method: options.method || 'GET', auth: options.headers.Authorization, body: options.body ? JSON.parse(options.body) : undefined});
    return answer(url, options);
  };
  return {sent, queries, api: createMisAttendance(pool, {fetchMis})};
}

test('the report keeps what Pulse-II signed and what HR changed there, and retires HR-only absent marks', async () => {
  const days = [{siteKey: 'jayant ob', date: '2026-11-16', signature: 'abc', lines: 1}];
  const hrChanges = [{id: 'c1', mark: 'absent', ...duty, siteKey: 'jayant ob', employeeName: 'Driver', by: 'Meena', reason: 'Wrong day', at: ''}];
  const {api} = setup(() => Response.json({...report, days, hrChanges}));
  const result = await api(hr, grant, 'mis', 'GET', null, new URLSearchParams({from: '2026-11-16', to: '2026-11-16'}));
  assert.deepEqual(result.days, days);
  assert.deepEqual(result.hrChanges, hrChanges);
  assert.equal(result.signed, true);
  // Duty times kept only in HR Pulse are retired too since 28 Nov 2026 ("Yes, send to MIS").
  assert.deepEqual(result.corrections.map(c => [c.id, c.status, c.retired]), [['d1', 'absent', true], ['d2', 'present', true]]);
  // A Pulse-II that does not sign yet: no days, signed false, the report still opens.
  const old = await setup(() => Response.json(report)).api(hr, grant, 'mis', 'GET', null, new URLSearchParams({from: '2026-11-16', to: '2026-11-16'}));
  assert.deepEqual([old.days, old.hrChanges, old.signed], [[], [], false]);
});

test('HR Pulse no longer saves an absent or a pending of its own', async () => {
  const {api, queries} = setup(() => Response.json(report));
  for (const status of ['absent', 'pending']) {
    await assert.rejects(api(hr, grant, 'mis/correction', 'POST', {...duty, status, version: 0, reason: 'Roster checked'}),
      error => error.status === 400 && /marked in Pulse-II with an OTP/.test(error.message));
  }
  // Nor duty times (owner, 28 Nov 2026: "Yes, send to MIS"): they are set in Pulse-II with an OTP.
  for (const status of ['present', 'mis']) {
    await assert.rejects(api(hr, grant, 'mis/correction', 'POST', {...duty, status, version: 0, start: '06:00', end: '14:00', reason: 'Roster checked'}),
      error => error.status === 400 && /Duty times are now set in Pulse-II with an OTP/.test(error.message));
  }
  assert.equal(queries.length, 0);
});

test('duty times go to Pulse-II with the OTP, and an older Pulse-II is named', async () => {
  const asked = {id: '22222222-2222-4222-8222-222222222222', status: 'sent', sentTo: ['rhr.ncl'], ...duty, mark: 'times', start: '06:00', end: '14:30', reason: 'Driver came one hour late'};
  const {api, sent, queries} = setup(() => Response.json(asked, {status: 201}));
  await api(hr, grant, 'mis/change', 'POST', {...duty, mark: 'times', start: '06:00', end: '14:30', reason: 'Driver came one hour late', status: 'x'}, new URLSearchParams());
  assert.deepEqual(sent[0].body, {site: duty.site, date: duty.date, shift: 'S1', employeeId: 'CMPL101', mark: 'times', reason: 'Driver came one hour late', start: '06:00', end: '14:30'});
  assert.deepEqual([queries[0][1][2].mark, queries[0][1][2].start, queries[0][1][2].end], ['times', '06:00', '14:30'], 'the audit line names the times');
  await api(hr, grant, 'mis/change', 'POST', {...duty, mark: 'card-times', start: '06:00', end: '14:30', reason: 'Times were right after all'}, new URLSearchParams());
  assert.deepEqual(sent[1].body, {site: duty.site, date: duty.date, shift: 'S1', employeeId: 'CMPL101', mark: 'card-times', reason: 'Times were right after all'}, 'taking back sends no times');
  const old = setup(() => Response.json({error: 'Choose Present, Absent or "as the trip card says".'}, {status: 400}));
  await assert.rejects(old.api(hr, grant, 'mis/change', 'POST', {...duty, mark: 'times', start: '06:00', end: '14:30', reason: 'Driver came one hour late'}, new URLSearchParams()),
    error => error.status === 503 && /does not take duty times from HR Pulse yet/.test(error.message));
});

test('the signatures of the days are asked without the cards, and an older Pulse-II is recognised', async () => {
  const days = [{siteKey: 'jayant ob', date: '2026-11-16', signature: 'abc', lines: 4}];
  const signed = setup(() => Response.json({days, pendingDays: [], generatedAt: 'now'}));
  assert.deepEqual(await signed.api(hr, grant, 'mis/days', 'GET', null, new URLSearchParams({from: '2026-11-01', to: '2026-11-20'})), {supported: true, days});
  assert.deepEqual(signed.sent[0], {path: '/api/integrations/hr/attendance', query: {from: '2026-11-01', to: '2026-11-20', only: 'days'}, method: 'GET', auth: 'Bearer ' + grant, body: undefined});
  // Before its release Pulse-II ignores only=days and sends the whole report: the saved days are then shown as before.
  const old = setup(() => Response.json({...report, days: undefined}));
  assert.deepEqual(await old.api(hr, grant, 'mis/days', 'GET', null, new URLSearchParams({from: '2026-11-01', to: '2026-11-20'})), {supported: false, days: []});
  await assert.rejects(signed.api(hr, grant, 'mis/days', 'GET', null, new URLSearchParams({from: '2026-10-01', to: '2026-11-20'})), {status: 400});
});

test('a change is asked for in Pulse-II and made there with the OTP; HR Pulse only writes its audit', async () => {
  const asked = {id: '11111111-1111-4111-8111-111111111111', status: 'sent', sentTo: ['rhr.ncl'], ...duty, employeeName: 'Driver One', mark: 'absent', reason: 'Card filled for the wrong day'};
  const {api, sent, queries} = setup(url => Response.json(url.pathname.endsWith('/verify') ? {...asked, status: 'used'} : asked, {status: url.pathname.endsWith('/verify') ? 200 : 201}));
  const input = {...duty, mark: 'absent', reason: 'Card filled for the wrong day', version: 9, status: 'x'};
  assert.deepEqual(await api(hr, grant, 'mis/change', 'POST', input, new URLSearchParams()), asked);
  assert.deepEqual(sent[0], {path: '/api/integrations/hr/attendance/change', query: {}, method: 'POST', auth: 'Bearer ' + grant,
    body: {site: duty.site, date: duty.date, shift: 'S1', employeeId: 'CMPL101', mark: 'absent', reason: 'Card filled for the wrong day'}});
  assert.deepEqual(queries.map(q => [q[0], q[1][1]]), [['INSERT INTO hr_audit(actor,action,kind,record_id,detail)', 'ASK_MIS_ATTENDANCE_CHANGE']]);
  const done = await api(hr, grant, 'mis/change/verify', 'POST', {id: asked.id, otp: '123456', extra: 1}, new URLSearchParams());
  assert.equal(done.status, 'used');
  assert.deepEqual(sent[1].body, {id: asked.id, otp: '123456'});
  // Nothing of the change is stored in HR Pulse: one audit line, and the 30 second copy of the MIS report is dropped.
  assert.deepEqual(queries.slice(1).map(q => q[0]), ['INSERT INTO hr_audit(actor,action,kind,record_id,detail)', 'DELETE FROM hr_mis_attendance_cache']);
  assert.equal(queries[1][1][1], 'MIS_ATTENDANCE_CHANGED');
  assert.equal(queries.some(q => /hr_mis_attendance_corrections/.test(q[0])), false);
});

test('what Pulse-II refuses is said in its own words, and an older Pulse-II is named', async () => {
  const refused = setup(() => Response.json({error: 'Wrong OTP. 4 attempts left.'}, {status: 400}));
  await assert.rejects(refused.api(hr, grant, 'mis/change/verify', 'POST', {id: 'x', otp: '000000'}, new URLSearchParams()), error => error.status === 400 && error.message === 'Wrong OTP. 4 attempts left.');
  assert.equal(refused.queries.length, 0);
  const locked = setup(() => Response.json({error: 'Attendance of Jayant OC on 16-11-2026 is locked after the Directors approved it.'}, {status: 423}));
  await assert.rejects(locked.api(hr, grant, 'mis/change', 'POST', {...duty, mark: 'absent', reason: 'Card filled for the wrong day'}, new URLSearchParams()), error => error.status === 423 && /locked after the Directors/.test(error.message));
  const old = setup(() => new Response('<html>Not found</html>', {status: 404}));
  await assert.rejects(old.api(hr, grant, 'mis/change', 'POST', {...duty, mark: 'absent', reason: 'Card filled for the wrong day'}, new URLSearchParams()), error => error.status === 503 && /after its next release/.test(error.message));
  assert.deepEqual(await old.api(hr, grant, 'mis/changes', 'GET', null, new URLSearchParams({from: '2026-11-16', to: '2026-11-16'})), {changes: [], supported: false});
});

test('a saved day keeps the signature Pulse-II gave for it', async () => {
  const saved = new Map();
  const pool = {async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites' AND \(lower/.test(sql)) return {rows: [{id: 'site-1'}]};
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) return {rowCount: 1, rows: []};
    if (/INSERT INTO hr_trip_card_days/.test(sql)) { assert.match(sql, /mis_signature=EXCLUDED\.mis_signature/); saved.set(params[1], params[5]); return {rows: [{day: params[1], duties: params[3], saved_by: params[4], saved_at: 'now'}]}; }
    if (/FROM hr_trip_card_days/.test(sql)) { assert.match(sql, /mis_signature/); return {rows: [...saved].map(([day, mis_signature]) => ({day, rows: [], duties: 0, saved_by: 'meena', saved_at: 'now', mis_signature}))}; }
    return {rows: []};
  }};
  const store = createTripCardStore(pool);
  await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', rows: [], signature: 'sasti ob:0123abcd'});
  await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-03', rows: [], signature: '<script>'});
  await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-04', rows: []});
  const read = await store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-11-01', to: '2026-11-30'}));
  assert.deepEqual(read.days.map(d => [d.day, d.signature]), [['2026-11-02', 'sasti ob:0123abcd'], ['2026-11-03', ''], ['2026-11-04', '']]);
  assert.equal(daySignature('gauri pauni ob 2nd:ab12,none'), 'gauri pauni ob 2nd:ab12,none');
  assert.equal(daySignature('x'.repeat(401)), '');
});
