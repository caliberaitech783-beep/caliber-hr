import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBiometricDayStore} from './biometric-day-store.mjs';

function fakePool({sites = ['Sasti OC']} = {}) {
  const saved = new Map(), audit = [];
  return {saved, audit, async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) return {rows: sites.includes(params[0]) ? [{id: 'site-1', name: params[0], site_type: 'Site'}] : []};
    if (/INSERT INTO hr_biometric_days/.test(sql)) {
      saved.set(params[0] + '|' + params[1], {day: params[1], register: JSON.parse(params[2]), punches: params[3], people: params[4], saved_by: params[5], saved_at: '2026-11-23T08:00:00Z'});
      return {rows: [{day: params[1], punches: params[3], people: params[4], saved_by: params[5], saved_at: '2026-11-23T08:00:00Z'}]};
    }
    if (/FROM hr_biometric_days/.test(sql)) return {rows: [...saved.entries()].filter(([k]) => k.startsWith(params[0] + '|')).map(([, v]) => v).filter(v => v.day >= params[1] && v.day <= params[2])};
    if (/INSERT INTO hr_audit/.test(sql)) { audit.push(params); return {rows: []}; }
    throw new Error('Unexpected SQL ' + sql);
  }};
}
const hr = {actor: 'vinod', permissions: {}};
const register = day => ({from: day, to: day, policy: {}, rows: [{id: 'e1', name: 'Ram', days: [{date: day, status: 'P'}]}, {id: 'm:77', name: 'RAMU', linked: false, days: []}],
  machines: [{serial: 'JNP1', punches: 5}, {serial: 'JNP2', punches: 3}]});

test('saves a day of biometric logs built by the server and reads saved days back', async () => {
  const pool = fakePool(), loads = [];
  const store = createBiometricDayStore(pool, {load: async (site, from, to) => {loads.push([site.name, from, to]); return register(from);}, today: () => '2026-11-23'});
  const saved = await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', register: {rows: ['forged']}}, null, null);
  assert.deepEqual([saved.day, saved.punches, saved.people, saved.savedBy], ['2026-11-02', 8, 2, 'vinod']);
  assert.deepEqual(loads, [['Sasti OC', '2026-11-02', '2026-11-02']]);
  const read = await store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-11-01', to: '2026-11-23'}), null);
  assert.equal(read.days.length, 1);
  assert.equal(read.days[0].register.rows[0].name, 'Ram', 'the saved copy is the server register, not what the browser sent');
  assert.equal(pool.audit.length, 1);
});

test('refuses today, another site, a bad day and too many days', async () => {
  const store = createBiometricDayStore(fakePool(), {load: async (s, d) => register(d), today: () => '2026-11-23'});
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-23'}, null, null), /Today is still running/);
  await assert.rejects(store(hr, 'POST', {site: 'Gevra', day: '2026-11-02'}, null, null), e => e.status === 403);
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-02-30'}, null, null), /valid day/);
  await assert.rejects(store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-10-01', to: '2026-11-15'}), null), /up to 31 days/);
});
