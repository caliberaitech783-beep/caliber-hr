import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTripCardStore, tripDuty} from './trip-card-store.mjs';

function fakePool({sites = ['Sasti OC']} = {}) {
  const saved = new Map(), audit = [];
  return {saved, audit, async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites' AND \(lower/.test(sql)) return {rows: [{id: 'site-1'}]};
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) return {rowCount: sites.includes(params[0]) ? 1 : 0, rows: []};
    if (/INSERT INTO hr_trip_card_days/.test(sql)) {
      saved.set(params[0] + '|' + params[1], {day: params[1], rows: JSON.parse(params[2]), duties: params[3], saved_by: params[4], saved_at: '2026-11-22T11:00:00Z'});
      return {rows: [{day: params[1], duties: params[3], saved_by: params[4], saved_at: '2026-11-22T11:00:00Z'}]};
    }
    if (/FROM hr_trip_card_days/.test(sql)) return {rows: [...saved.entries()].filter(([k]) => k.startsWith(params[0] + '|')).map(([, v]) => v).filter(v => v.day >= params[1] && v.day <= params[2])};
    if (/INSERT INTO hr_audit/.test(sql)) { audit.push(params); return {rows: []}; }
    throw new Error('Unexpected SQL ' + sql);
  }};
}
const hr = {actor: 'vinod', permissions: {}};
const duty = (date, extra = {}) => ({id: 'x', date, site: 'SASTI OCP', shift: 'S1', employeeId: 'D1', employeeKey: 'k', employeeName: 'Ram', caliberCode: 'CMLL1',
  designation: 'Driver', sources: ['Trip card'], equipment: ['DT-1'], output: '12 trips', window: {start: date + ' 06:00', end: date + ' 14:00', startMs: 1, endMs: 2},
  status: 'Present', verification: 'MIS batch closed', verified: true, otHours: 0, otNote: '', secret: 'dropped', ...extra});

test('saves a day of trip cards for the site and reads saved days back', async () => {
  const pool = fakePool(), store = createTripCardStore(pool);
  const saved = await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', rows: [duty('2026-11-02'), duty('2026-11-02', {employeeId: 'D2'})]});
  assert.deepEqual([saved.day, saved.duties, saved.savedBy], ['2026-11-02', 2, 'vinod']);
  await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', rows: [duty('2026-11-02')]});
  const read = await store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-11-01', to: '2026-11-30'}));
  assert.equal(read.days.length, 1);
  assert.equal(read.days[0].duties, 1);
  assert.equal(read.days[0].rows[0].secret, undefined);
  assert.equal(read.days[0].rows[0].window.endMs, 2);
  assert.equal(pool.audit.length, 2);
});

test('refuses another site, a duty of another day, too many days and a bad day', async () => {
  const store = createTripCardStore(fakePool());
  await assert.rejects(store(hr, 'POST', {site: 'Gevra', day: '2026-11-02', rows: []}), e => e.status === 403);
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', rows: [duty('2026-11-03')]}), /belong to the day/);
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-02-30', rows: []}), /valid day/);
  await assert.rejects(store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-11-01', to: '2026-12-15'})), /up to 31 days/);
  assert.equal(tripDuty(duty('2026-11-02', {status: 'Hacked'}), '2026-11-02').status, 'Pending');
});
