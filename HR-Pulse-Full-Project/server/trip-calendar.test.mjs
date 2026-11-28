// HR calendar of trip card people with no biometric line (owner, 28 Nov 2026): leave, OD, holidays and absent days.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {employeeNumber, loadHrCalendar} from './attendance-register.mjs';

const fakeDb = ({people = [], holidays = [], leaves = [], ods = []}) => {
  const asked = [];
  return {asked, query: async (sql, values) => {
    asked.push(sql);
    if (sql.includes('hr_attendance_policy')) return {rows: []};
    if (sql.includes("kind='employees'") && sql.includes('UNION ALL')) return {rows: people.filter(p => values[0].includes(p.number))};
    if (sql.includes("kind='holidays'")) return {rows: holidays};
    if (sql.includes("kind='leaveRequests'")) return {rows: leaves};
    if (sql.includes("kind='outDutyRequests'")) return {rows: ods};
    throw new Error('unexpected query ' + sql.slice(0, 60));
  }};
};
const driver = {source: 'joined', id: 'emp-1', code: 'CMLL83111', name: 'Anoop Paul', site_id: 'site-majri', site_code: 'MJR', site: 'Majri OC', site_type: 'Site',
  designation: 'Driver', department: 'Operations', number: '83111'};

test('one person whatever the prefix: CMPL, CMLL, leading zeros', () => {
  assert.equal(employeeNumber('CMPL83111'), '83111');
  assert.equal(employeeNumber('cmll 083111'), '83111');
  assert.equal(employeeNumber('83111'), '83111');
  assert.equal(employeeNumber('D-77X'), '');
});

test('a trip card driver gets approved leave, OD, the site holiday and absent days from HR', async () => {
  const db = fakeDb({people: [driver],
    holidays: [{date: '2027-01-26', site_id: 'site-majri', name: 'Republic Day'}, {date: '2027-01-26', site_id: 'site-other', name: 'Other site'}],
    leaves: [{employee_id: 'emp-1', from_date: '2027-01-06', to_date: '2027-01-07', leave_type: 'CL Casual leave'}],
    ods: [{employee_id: 'emp-1', from_date: '2027-01-21', to_date: '2027-01-24'}]});
  const {rows} = await loadHrCalendar(db, ['CMPL83111'], '2027-01-01', '2027-01-31', '2027-02-01');
  assert.equal(rows.length, 1);
  const marks = Object.fromEntries(rows[0].days.map(d => [d.date.slice(8), d.calendar]));
  assert.deepEqual([marks['06'], marks['07'], marks['21'], marks['24'], marks['26'], marks['13']], ['L', 'L', 'OD', 'OD', 'H', '']);
  assert.equal(rows[0].designation, 'Driver');
  assert.ok(!('in' in rows[0].days[0]), 'no punches or pay are sent');
});

test('a number two people hold is left out; nothing is read for no codes', async () => {
  const twin = {...driver, id: 'emp-2', name: 'Someone Else'};
  assert.deepEqual((await loadHrCalendar(fakeDb({people: [driver, twin]}), ['83111'], '2027-01-01', '2027-01-31', '2027-02-01')).rows, []);
  const empty = fakeDb({});
  assert.deepEqual((await loadHrCalendar(empty, ['', 'X1'], '2027-01-01', '2027-01-31', '2027-02-01')).rows, []);
  assert.equal(empty.asked.length, 0);
});

test('a register line without a joined employee still gets the site holiday', async () => {
  const line = {...driver, source: 'register', id: 'reg-1'};
  const {rows} = await loadHrCalendar(fakeDb({people: [line], holidays: [{date: '2027-01-26', site_id: 'site-majri', name: 'Republic Day'}]}),
    ['CMLL83111'], '2027-01-25', '2027-01-27', '2027-02-01');
  assert.deepEqual(rows[0].days.map(d => d.calendar), ['', 'H', '']);
});
