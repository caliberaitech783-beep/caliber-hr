import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createMisAttendance,MIS_ATTENDANCE_CACHE_MS} from './mis-attendance.mjs';

const duty = {date: '2026-11-16', site: 'Jayant OB', shift: 'S1', employeeId: 'DEMO-1'};
const grant = 'a'.repeat(43);
const change = {...duty, status: 'present', version: 0, start: '05:00', end: '13:00', reason: 'Roster confirmed'};
const report = {
  attendanceEquipment: [], attendanceShifts: [], otDuties: [duty],
  ot: [], performance: [], details: [], exceptions: []
};

function setup() {
  const calls = [];
  const correction = {duty_id: '[duty]', status: 'present', start_time: '05:00', end_time: '13:00',
    version: 1, reason: change.reason, updated_by: 'test'};
  const db = {
    async query(sql, args) {
      calls.push([sql.trim().split(/\s+/).slice(0, 2).join(' '), args]);
      return {rows: sql.startsWith('INSERT INTO hr_mis') ? [correction] : []};
    },
    release() {}
  };
  const fetchMis = async (url, options) => {
    assert.equal(url.pathname, '/api/integrations/hr/attendance');
    assert.equal(options.headers.Authorization, 'Bearer ' + grant);
    assert.equal(url.searchParams.get('from'), '2026-11-15');
    assert.equal(url.searchParams.get('to'), '2026-11-17');
    return Response.json(report);
  };
  return {calls, api: createMisAttendance({connect: async () => db}, {fetchMis})};
}

test('only a duty returned for the signed-in HR user can be corrected', async () => {
  const {api, calls} = setup();
  await assert.rejects(api({actor: 'test'}, grant, 'mis/correction', 'POST', {...change, site: 'Other Site'}), {status: 404});
  assert.equal(calls.length, 0);
});

test('a correction is versioned and audited in the same transaction', async () => {
  const {api, calls} = setup();
  const result = await api({actor: 'test'}, grant, 'mis/correction', 'POST', change);
  assert.equal(result.version, 1);
  assert.equal(result.reason, 'Roster confirmed');
  assert.deepEqual(calls.map(call => call[0]), ['BEGIN', 'INSERT INTO', 'INSERT INTO', 'COMMIT']);
  assert.equal(calls[2][1][1], 'CORRECT_MIS_ATTENDANCE');
});

test('a conflicting correction rolls back without writing an audit entry', async () => {
  const {api, calls} = setup();
  await assert.rejects(api({actor: 'test'}, grant, 'mis/correction', 'POST', {...change, version: 1}), {status: 409});
  assert.deepEqual(calls.map(call => call[0]), ['BEGIN', 'UPDATE hr_mis_attendance_corrections', 'ROLLBACK']);
});

test('two PCs receive the same centrally cached site and day report', async () => {
  let cached, fetches = 0, requestedUrl;
  const db = {
    async query(sql, args) {
      if (sql.startsWith('SELECT report')) return {rows: cached ? [cached] : []};
      if (sql.startsWith('INSERT INTO hr_mis_attendance_cache')) {
        cached = {report: args[1], fetched_at: new Date()};
      }
      return {rows: []};
    },
    release() {}
  };
  const pool = {
    connect: async () => db,
    async query(sql) {
      if (sql.includes('hr_mis_attendance_corrections')) return {rows: []};
      if (sql.includes("kind='sites'")) return {rows: [{name: 'Gevra'}]};
      return {rows: []};
    }
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {
    fetches++;
    requestedUrl = url;
    return Response.json(report);
  }});
  const params = () => new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site: 'Gevra'});
  const first = await api({actor: 'first', permissions: {}}, 'a'.repeat(43), 'mis', 'GET', {}, params());
  const second = await api({actor: 'second', permissions: {}}, 'b'.repeat(43), 'mis', 'GET', {}, params());
  assert.equal(fetches, 1);
  assert.equal(requestedUrl.searchParams.get('site'), 'Gevra');
  assert.deepEqual(second.otDuties, first.otDuties);
});

test('a stale historical snapshot refreshes Pulse-II and returns newly saved trip cards', async () => {
  const oldReport = {...report, otDuties: []};
  const refreshedDuty = {...duty, date: '2026-11-17', site: 'Dhoptala OB (2nd)', shift: 'S3', employeeId: 'CMPL21449'};
  const refreshedReport = {...report, otDuties: [refreshedDuty]};
  let cached = {report: oldReport, fetched_at: new Date(Date.now() - MIS_ATTENDANCE_CACHE_MS - 1)};
  let requestedUrl, fetches = 0;
  const db = {
    async query(sql, args) {
      if (sql.startsWith('SELECT report')) return {rows: [cached]};
      if (sql.startsWith('INSERT INTO hr_mis_attendance_cache')) cached = {report: args[1], fetched_at: new Date()};
      return {rows: []};
    },
    release() {}
  };
  const pool = {
    connect: async () => db,
    async query(sql) {
      if (sql.includes('hr_mis_attendance_corrections')) return {rows: []};
      if (sql.includes("kind='sites'")) return {rows: [{name: 'Dhoptala OB 2nd'}]};
      return {rows: []};
    }
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {
    fetches++;
    requestedUrl = url;
    return Response.json(refreshedReport);
  }});
  const result = await api({actor: 'site-hr', permissions: {}}, grant, 'mis', 'GET', {},
    new URLSearchParams({from: '2026-11-17', to: '2026-11-17', site: 'Dhoptala OB 2nd'}));
  assert.equal(fetches, 1);
  assert.equal(requestedUrl.searchParams.get('refresh'), '1');
  assert.deepEqual(result.otDuties, [refreshedDuty]);
});

test('an explicit refresh forwards the exact selected site and bypass flag to Pulse-II', async () => {
  let requestedUrl;
  const db = {async query(sql) {if (sql.startsWith('SELECT report')) return {rows: []};return {rows: []};}, release() {}};
  const pool = {
    connect: async () => db,
    async query(sql) {
      if (sql.includes('hr_mis_attendance_corrections')) return {rows: []};
      if (sql.includes("kind='sites'")) return {rows: [{name: 'Dudhichua OB East'}]};
      return {rows: []};
    }
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {requestedUrl = url;return Response.json(report);}});
  await api({actor: 'site-hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-14', to: '2026-11-14', site: 'Dudhichua OB East', refresh: '1'}));
  assert.equal(requestedUrl.searchParams.get('site'), 'Dudhichua OB East');
  assert.equal(requestedUrl.searchParams.get('refresh'), '1');
  assert.equal(requestedUrl.searchParams.get('from'), '2026-11-13');
  assert.equal(requestedUrl.searchParams.get('to'), '2026-11-15');
});

// Owner, 28 Nov 2026: one day of Majri OC took about 14 seconds. Measured on live: every answer carried three days of
// all seven sites (15.9 MB), and the same 15.9 MB was written to the 30 second copy and sent to the browser.
test('the roster\'s day read keeps the chosen site only, in the answer and in the stored copy', async () => {
  const line = (site, employeeId, shift = 'S1', extra = {}) => ({date: '2026-11-16', site, siteKey: site.toLowerCase(), shift, employeeId, employeeKey: employeeId, employeeName: employeeId, ...extra});
  const whole = {
    attendanceEquipment: [line('Majri OC', 'CMLL1'), line('Sasti OC', 'CMLL9')],
    attendanceShifts: [{siteKey: 'majri oc', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'B1'}, {siteKey: 'sasti oc', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'B2'}],
    // CMLL2 has a card at both sites in the same shift: the roster must still see both to mark them.
    otDuties: [line('Majri OC', 'CMLL1'), line('Majri OC', 'CMLL2', 'S2'), line('Sasti OC', 'CMLL2', 'S2'), line('Sasti OC', 'CMLL9'), line('Jayant OC', 'CMLL7')],
    ot: [{site: 'Sasti OC', siteKey: 'sasti oc', employeeId: 'CMLL9', schedule: ''}],
    performance: [line('Majri OC', 'CMLL1'), line('Jayant OC', 'CMLL7')], details: [line('Sasti OC', 'CMLL9')], exceptions: [line('Jayant OC', 'CMLL7', 'S1', {reason: 'x'})],
    days: [{siteKey: 'majri oc', date: '2026-11-16', lines: 2, signature: 'm'}, {siteKey: 'sasti oc', date: '2026-11-16', lines: 2, signature: 's'}]
  };
  const stored = new Map();
  let fetches = 0, requestedUrl, correctionIds;
  const db = {
    async query(sql, args) {
      if (sql.startsWith('SELECT report')) {const report = stored.get(args[0]); return {rows: report ? [{report, fetched_at: new Date()}] : []};}
      if (sql.startsWith('INSERT INTO hr_mis_attendance_cache')) stored.set(args[0], args[1]);
      return {rows: []};
    },
    release() {}
  };
  const pool = {
    connect: async () => db,
    async query(sql, args) {
      if (sql.includes('hr_mis_attendance_corrections')) {correctionIds = args[0]; return {rows: []};}
      if (sql.includes("kind='sites'")) return {rows: [{name: 'Majri OC'}]};
      return {rows: []};
    }
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {fetches++; requestedUrl = url; return Response.json(whole);}});
  const ask = extra => api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site: 'Majri OC', ...extra}));

  const trimmed = await ask({trim: '1'});
  // Pulse-II is asked exactly as before.
  assert.equal(requestedUrl.searchParams.get('from'), '2026-11-15');
  assert.equal(requestedUrl.searchParams.get('to'), '2026-11-17');
  assert.deepEqual(trimmed.otDuties.map(d => d.site + ' ' + d.employeeId), ['Majri OC CMLL1', 'Majri OC CMLL2', 'Sasti OC CMLL2']);
  assert.deepEqual(trimmed.attendanceEquipment.map(d => d.site), ['Majri OC']);
  assert.deepEqual(trimmed.attendanceShifts.map(d => d.siteKey), ['majri oc']);
  assert.deepEqual([trimmed.performance.length, trimmed.details.length, trimmed.exceptions.length, trimmed.ot.length], [1, 0, 0, 0]);
  assert.deepEqual(trimmed.days, [{siteKey: 'majri oc', date: '2026-11-16', lines: 2, signature: 'm'}]);
  assert.equal(trimmed.signed, true);
  assert.deepEqual(trimmed.misSites, ['Jayant OC', 'Majri OC', 'Sasti OC']);
  assert.equal(correctionIds.length, 3);
  // The stored copy is the small one, and a second PC is served from it without asking Pulse-II again.
  assert.equal(stored.size, 1);
  assert.equal([...stored.values()][0].otDuties.length, 3);
  const again = await ask({trim: '1'});
  assert.deepEqual(again.otDuties, trimmed.otDuties);
  // How long Pulse-II took and how long the copy took to store go with the answer that waited, and are not stored.
  assert.equal(Number.isInteger(trimmed.timing.misMs) && Number.isInteger(trimmed.timing.storeMs), true);
  assert.equal(again.timing, undefined);
  assert.equal([...stored.values()][0].timing, undefined);
  assert.equal(fetches, 1);

  // A screen that does not ask for it (Trip card and logbook) still gets every site, from its own copy.
  const everything = await ask({});
  assert.equal(fetches, 2);
  assert.equal(everything.otDuties.length, 5);
  assert.equal(everything.misSites, undefined);
  assert.equal(stored.size, 2);
});
