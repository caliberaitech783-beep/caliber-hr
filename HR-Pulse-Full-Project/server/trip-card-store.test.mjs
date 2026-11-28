import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTripCardStore, tripDuty} from './trip-card-store.mjs';
import {createMisTripCardDays, signedSiteKeys, savedDayOfSite} from './mis-trip-card-days.mjs';

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

// Owner, 28 Nov 2026: "either re-read by itself, or any change made by MIS department, then upon update by them should
// auto update the hr saved days also" and "now build the MIS push and nightly check also". Pulse-II names the site-days
// that changed (mis-trip-card-days.mjs); a named day is no longer handed to the roster until it is saved again.
const KEY = 'k'.repeat(40);
function dayTable(rows) {
  const table = rows.map(r => ({mis_signature: '', mis_changed_at: null, mis_changed_note: null, duties: 3, rows: [{id: 'x'}], saved_by: 'vinod', saved_at: 't', ...r})), audit = [];
  const shape = r => ({site: r.site, day: r.day, signature: r.mis_signature || '', duties: r.duties, saved_at: r.saved_at, mis_changed_at: r.mis_changed_at});
  return {table, audit, async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites' AND \(lower/.test(sql)) return {rows: [{id: 'site-1'}]};
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) return {rowCount: 1, rows: []};
    if (/count\(\*\)::int AS n FROM hr_mis_attendance_corrections/.test(sql)) return {rows: [{n: 4}]};
    if (/^UPDATE hr_trip_card_days/.test(sql.trim())) {
      const done = [];
      params[0].forEach((site, i) => {
        const row = table.find(r => r.site === site && r.day === params[1][i] && !r.mis_changed_at);
        if (row) { row.mis_changed_at = 'now'; row.mis_changed_note = params[2]; done.push({site, day: row.day}); }
      });
      return {rows: done};
    }
    if (/INSERT INTO hr_trip_card_days/.test(sql)) {
      assert.match(sql, /mis_changed_at=NULL,mis_changed_note=NULL/);
      const row = table.find(r => r.site === params[0] && r.day === params[1]);
      Object.assign(row, {rows: JSON.parse(params[2]), duties: params[3], saved_by: params[4], mis_signature: params[5], mis_changed_at: null, mis_changed_note: null});
      return {rows: [{day: row.day, duties: row.duties, saved_by: row.saved_by, saved_at: 't2'}]};
    }
    if (/WHERE day=ANY\(\$1::date\[\]\) AND mis_changed_at IS NULL/.test(sql)) return {rows: table.filter(r => params[0].includes(r.day) && !r.mis_changed_at).map(shape)};
    if (/WHERE day BETWEEN \$1::date AND \$2::date ORDER BY day,site/.test(sql)) return {rows: table.filter(r => r.day >= params[0] && r.day <= params[1]).map(shape)};
    if (/CASE WHEN mis_changed_at IS NULL THEN rows END AS rows/.test(sql)) {
      return {rows: table.filter(r => r.site === params[0] && r.day >= params[1] && r.day <= params[2]).map(r => ({...r, rows: r.mis_changed_at ? null : r.rows}))};
    }
    if (/INSERT INTO hr_audit/.test(sql)) { audit.push({sql, params}); return {rows: []}; }
    throw new Error('Unexpected SQL ' + sql);
  }};
}

test('a saved day is found by the Pulse-II site key in its signature, an unsigned one by the site rule', () => {
  assert.deepEqual(signedSiteKeys('dudhichua east ob:aa11,dudhichua ob:bb22'), ['dudhichua east ob', 'dudhichua ob']);
  assert.deepEqual([signedSiteKeys(''), signedSiteKeys('none'), signedSiteKeys(null)], [[], [], []]);
  assert.equal(savedDayOfSite({site: 'Majri OC', signature: 'majri ob:aa11'}, 'majri ob'), true);
  assert.equal(savedDayOfSite({site: 'Majri OC', signature: 'majri ob:aa11'}, 'sasti ob'), false);
  // A signed day is judged by its keys alone, whatever the site is called here.
  assert.equal(savedDayOfSite({site: 'Sasti OC', signature: 'majri ob:aa11'}, 'sasti ob'), false);
  assert.equal(savedDayOfSite({site: 'Majri OC', signature: ''}, 'majri ob'), true);
  assert.equal(savedDayOfSite({site: 'Majri OC', signature: 'none'}, 'sasti ob'), false);
});

test('Pulse-II lists the saved days without their cards, with its own key only', async () => {
  const pool = dayTable([{site: 'Majri OC', day: '2026-11-08', mis_signature: 'majri ob:aa11'}, {site: 'Sasti OC', day: '2026-11-08'}, {site: 'Majri OC', day: '2026-12-20'}]);
  const {misTripCardDays} = createMisTripCardDays(pool, {syncKey: KEY});
  const listed = await misTripCardDays(KEY, 'GET', {from: '2026-11-01', to: '2026-11-30'});
  assert.deepEqual(listed.days, [{site: 'Majri OC', day: '2026-11-08', signature: 'majri ob:aa11', duties: 3, savedAt: 't', changedAt: null},
    {site: 'Sasti OC', day: '2026-11-08', signature: '', duties: 3, savedAt: 't', changedAt: null}]);
  assert.equal(listed.hrOnlyCorrections, 4);
  assert.equal(JSON.stringify(listed).includes('"rows"'), false, 'no cards are sent');
  await assert.rejects(misTripCardDays('wrong'.repeat(8), 'GET', {from: '2026-11-01', to: '2026-11-30'}), {status: 401});
  await assert.rejects(createMisTripCardDays(pool, {syncKey: ''}).misTripCardDays(KEY, 'GET', {from: '2026-11-01', to: '2026-11-30'}), {status: 503});
  await assert.rejects(misTripCardDays(KEY, 'GET', {from: '2026-11-01', to: '2027-02-01'}), /up to 62 days/);
  await assert.rejects(misTripCardDays(KEY, 'GET', {from: '2026-11-31', to: '2026-12-01'}), /YYYY-MM-DD/);
  await assert.rejects(misTripCardDays(KEY, 'PUT', {}), {status: 405});
});

test('a day Pulse-II names as changed is marked once, leaves the roster, and comes back when it is saved again', async () => {
  const pool = dayTable([{site: 'Majri OC', day: '2026-11-08', mis_signature: 'majri ob:aa11'}, {site: 'Majri OC', day: '2026-11-09', mis_signature: 'majri ob:cc33'},
    {site: 'Sasti OC', day: '2026-11-08', mis_signature: 'sasti ob:dd44'}, {site: 'Jayant OB', day: '2026-11-08'}]);
  const {misTripCardDays} = createMisTripCardDays(pool, {syncKey: KEY});
  const store = createTripCardStore(pool);
  const told = await misTripCardDays(KEY, 'POST', null, {reason: 'Changed in Pulse-II',
    days: [{siteKey: 'Majri OB', date: '2026-11-08'}, {siteKey: 'jayant ob', date: '2026-11-08'}, {siteKey: 'dhoptala ob 2nd', date: '2026-11-08'}]});
  assert.deepEqual([told.marked, told.days], [2, [{site: 'Majri OC', day: '2026-11-08'}, {site: 'Jayant OB', day: '2026-11-08'}]]);
  assert.deepEqual(pool.table.filter(r => r.mis_changed_at).map(r => [r.site, r.day, r.mis_changed_note]),
    [['Majri OC', '2026-11-08', 'Changed in Pulse-II'], ['Jayant OB', '2026-11-08', 'Changed in Pulse-II']]);
  assert.equal(pool.audit.length, 1);
  assert.match(pool.audit[0].sql, /'pulse-ii','MIS_TRIP_CARD_DAYS_CHANGED'/);
  // Told again: nothing new is marked and nothing is written.
  assert.deepEqual(await misTripCardDays(KEY, 'POST', null, {days: [{siteKey: 'majri ob', date: '2026-11-08'}]}), {marked: 0, days: []});
  assert.equal(pool.audit.length, 1);
  // The roster no longer gets the marked day (it reads it from Pulse-II); the other day is still a saved day.
  const read = await store(hr, 'GET', {}, new URLSearchParams({site: 'Majri OC', from: '2026-11-01', to: '2026-11-30'}));
  assert.deepEqual([read.days.map(d => d.day), read.changed], [['2026-11-09'], ['2026-11-08']]);
  // Saved again from Pulse-II: the mark is cleared and the day is a saved day again.
  await store(hr, 'POST', {site: 'Majri OC', day: '2026-11-08', rows: [duty('2026-11-08')], signature: 'majri ob:ee55'});
  const again = await store(hr, 'GET', {}, new URLSearchParams({site: 'Majri OC', from: '2026-11-01', to: '2026-11-30'}));
  assert.deepEqual([again.days.map(d => [d.day, d.signature]), again.changed], [[['2026-11-08', 'majri ob:ee55'], ['2026-11-09', 'majri ob:cc33']], []]);
  await assert.rejects(misTripCardDays(KEY, 'POST', null, {days: [{siteKey: '', date: '2026-11-08'}]}), /siteKey and date/);
  await assert.rejects(misTripCardDays(KEY, 'POST', null, {days: 'all'}), /up to 2000 site-days/);
});
