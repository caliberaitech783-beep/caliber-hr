// Owner, 23 Nov 2026: Attendance roster › Biometric for Dhoptala OB 2nd said "This site is not assigned to your login …
// has: all sites". HR Pulse shows the site saved as "Dhoptala OB" (code WCL-DHOPTALA) under the name "Dhoptala OB 2nd"
// (server/site-display-names.mjs), and the roster sent that shown name back; the server looked for a saved site of that
// name and found none. A site is now found by its saved name (spaces and case ignored), or by the name or code behind a
// shown name; the saved name wins over an alias. The fake database below follows the SQL's own rule.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBiometricDayStore} from './biometric-day-store.mjs';
import {siteNameKeys, siteNameMatch, siteKey} from './site-display-names.mjs';

const tidy = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();

function pool(saved) {
  return {async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) {
      assert.ok(sql.includes(siteNameMatch('$1', '$3')), 'the lookup uses the site name rule');
      const keys = params[2] || [];
      const exact = saved.filter(s => tidy(s.name) === tidy(params[0]));
      const alias = saved.filter(s => keys.includes(siteKey(s.name)) || keys.includes(siteKey(s.code)));
      const row = exact[0] || alias[0];
      return {rows: row ? [{id: row.id, name: row.name, site_type: 'Site'}] : []};
    }
    if (/FROM hr_biometric_days/.test(sql)) return {rows: []};
    throw new Error('Unexpected SQL ' + sql);
  }};
}
const read = (saved, name) => createBiometricDayStore(pool(saved), {load: async () => ({}), today: () => '2026-11-23'})(
  {login: 'NIKHILBISEN', actor: 'nikhil', permissions: {}}, 'GET', {}, new URLSearchParams({site: name, from: '2026-11-01', to: '2026-11-23'}), null);

test('the shown name Dhoptala OB 2nd finds the site saved as Dhoptala OB (WCL-DHOPTALA)', async () => {
  const saved = [{id: 'd', name: 'Dhoptala OB', code: 'WCL-DHOPTALA'}, {id: 'm', name: 'Majri OB', code: 'WCL-MAJRI'}];
  assert.equal((await read(saved, 'Dhoptala OB 2nd')).site, 'Dhoptala OB');
  assert.equal((await read([{id: 'd', name: 'Old name', code: 'WCL-DHOPTALA'}], 'Dhoptala OB 2nd')).site, 'Old name', 'found by its code');
  assert.equal((await read(saved, 'dhoptala  ob ')).site, 'Dhoptala OB', 'spaces and case ignored');
  await assert.rejects(read(saved, 'Gevra'), e => e.status === 403, 'a site that is not there is still refused');
});

test('the saved name wins over an alias', async () => {
  const saved = [{id: 'alias', name: 'Dhoptala OC', code: ''}, {id: 'own', name: 'Dhoptala OB 2nd', code: ''}];
  assert.equal((await read(saved, 'Dhoptala OB 2nd')).site, 'Dhoptala OB 2nd');
});

test('the keys of a shown name cover its saved names and codes; another name is only itself', () => {
  const keys = siteNameKeys('Dhoptala OB 2nd');
  for (const name of ['Dhoptala OB', 'Dhoptala OC (2nd)', 'WCL-DHOPTALA']) assert.ok(keys.includes(siteKey(name)), name);
  assert.deepEqual(siteNameKeys('Majri OB'), ['majriob']);
});

test('every site lookup by name in the attendance routes uses the rule, and the site option sends its name', () => {
  for (const file of ['attendance.mjs', 'biometric-day-store.mjs', 'trip-card-store.mjs']) {
    const source = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
    assert.ok(!/kind='sites' AND status IN \('ACTIVE','APPROVED'\) AND name=\$1/.test(source), file + ' still matches the name exactly');
    assert.ok(source.includes("siteNameMatch('$1','$3')"), file);
  }
  const roster = readFileSync(new URL('../src/AttendanceRoster.tsx', import.meta.url), 'utf8');
  assert.ok(roster.includes('<option key={s} value={s}>{s}</option>'));
});
