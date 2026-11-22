import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSiteRegister} from './attendance-register.mjs';

// A stand-in database for the queries loadSiteRegister and loadRegister make.
function fakeDb({machines = [], punches = []} = {}) {
  const links = {'SST01|1021': 'emp-1', 'SST02|1021': 'emp-1'}, names = {'SST01|1021': 'RAMESH', 'SST02|77': 'RAMU'};
  const place = {SST01: 'Main gate', SST02: 'Workshop'};
  const calls = [];
  return {calls, async query(sql, params = []) {
    calls.push(sql);
    if (/FROM hr_attendance_policy/.test(sql)) return {rows: []};
    if (/FROM hr_attendance_devices d LEFT JOIN hr_attendance_bridges/.test(sql)) return {rows: machines};
    if (/GROUP BY 1,2,3,4/.test(sql)) {
      const seen = new Map();
      for (const p of punches) seen.set(p.serial + '|' + p.id, {device_serial: p.serial, biometric_id: p.id, employee_id: links[p.serial + '|' + p.id] || null, machine_name: names[p.serial + '|' + p.id] || ''});
      return {rows: [...seen.values()]};
    }
    if (/FROM hr_attendance_links l\s+JOIN hr_records e/.test(sql)) {
      assert.deepEqual(params[1], ['emp-1']);
      return {rows: [{id: 'emp-1', code: 'CMLL1021', name: 'Ramesh Kumar', site_id: 'other-site', site: 'Gevra', site_type: 'Site', shift: 'A', starts: '06:00', ends: '14:00', designation: 'Dumper operator', department: 'Operations', daily_wage: '800'}]};
    }
    if (/SELECT l.employee_id,to_char/.test(sql)) {
      assert.deepEqual(params[3], ['SST01', 'SST02']);
      return {rows: punches.filter(p => links[p.serial + '|' + p.id]).map(p => ({employee_id: links[p.serial + '|' + p.id], at: p.at, place: place[p.serial]}))};
    }
    if (/l.employee_id IS NULL/.test(sql)) return {rows: punches.filter(p => !links[p.serial + '|' + p.id]).map(p => ({device_serial: p.serial, biometric_id: p.id, at: p.at}))};
    return {rows: []};
  }};
}
const site = {id: 'site-sasti', name: 'Sasti OC', siteType: 'Site'};
const machines = [{serial: 'SST01', name: 'ESSL K90', location: 'Main gate', last_contact: null, online: true, last_punch: '2026-11-02 14:08', punches: 3},
  {serial: 'SST02', name: 'ESSL face', location: 'Workshop', last_contact: null, online: false, last_punch: '2026-11-02 21:55', punches: 1}];

test('site roster: everyone who punched on the site machines, In / Out, each punch with its machine, unlinked IDs too', async () => {
  const db = fakeDb({machines, punches: [
    {serial: 'SST01', id: '1021', at: '2026-11-02 05:52'}, {serial: 'SST02', id: '1021', at: '2026-11-02 10:15'}, {serial: 'SST01', id: '1021', at: '2026-11-02 14:08'},
    {serial: 'SST02', id: '77', at: '2026-11-02 21:55'}
  ]});
  const result = await loadSiteRegister(db, site, '2026-11-02', '2026-11-02', '2026-11-22');
  assert.deepEqual(result.machines.map(m => [m.serial, m.location, m.online, m.punches]), [['SST01', 'Main gate', true, 3], ['SST02', 'Workshop', false, 1]]);
  const [ramesh, ramu] = result.rows;
  assert.deepEqual([ramesh.code, ramesh.linked, ramesh.site], ['CMLL1021', true, 'Gevra']);
  assert.deepEqual(ramesh.machinesUsed.sort(), ['Main gate · 1021', 'Workshop · 1021']);
  assert.deepEqual([ramesh.days[0].status, ramesh.days[0].in, ramesh.days[0].out], ['P', '05:52', '14:08']);
  assert.deepEqual(ramesh.days[0].punches, ['05:52 Main gate', '10:15 Workshop', '14:08 Main gate']);
  assert.deepEqual([ramu.code, ramu.name, ramu.linked, ramu.site], ['', 'RAMU', false, 'Sasti OC']);
  assert.deepEqual(ramu.machinesUsed, ['Workshop · 77']);
  assert.equal(ramu.days[0].in, '21:55');
});

test('site roster with no machine returns the empty list without reading punches', async () => {
  const db = fakeDb();
  const result = await loadSiteRegister(db, site, '2026-11-01', '2026-11-22', '2026-11-22');
  assert.deepEqual([result.machines, result.rows, result.site], [[], [], 'Sasti OC']);
  assert.ok(!db.calls.some(sql => /GROUP BY 1,2,3,4/.test(sql)));
});
