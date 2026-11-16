import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createMisAttendance} from './mis-attendance.mjs';

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
