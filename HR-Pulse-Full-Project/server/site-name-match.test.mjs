// Owner, 23 Nov 2026: Attendance roster › Biometric for Dhoptala OB 2nd said "This site is not assigned to your login …
// has: all sites". The site is found by its name, and the name the browser sends had its spaces tidied (an <option>
// with no value attribute), so a site saved with an extra space was not found. The site is now matched with spaces and
// letter case ignored. The fake database below reads the SQL's own rule, so it fails if that rule is taken out.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBiometricDayStore} from './biometric-day-store.mjs';

const tidy = value => String(value).trim().replace(/\s+/g, ' ').toLowerCase();
const RULE = "lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($1),'[[:space:]]+',' ','g'))";

function pool(saved) {
  return {async query(sql, params = []) {
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) {
      const match = sql.includes(RULE) ? name => tidy(name) === tidy(params[0]) : name => name === params[0];
      const name = saved.find(match);
      return {rows: name ? [{id: 'site-1', name, site_type: 'Site'}] : []};
    }
    if (/FROM hr_biometric_days/.test(sql)) return {rows: []};
    throw new Error('Unexpected SQL ' + sql);
  }};
}

test('a site saved with extra spaces or another letter case is found; an unknown site is still refused', async () => {
  const store = createBiometricDayStore(pool(['Dhoptala  OB 2nd ']), {load: async () => ({}), today: () => '2026-11-23'});
  const read = name => store({login: 'NIKHILBISEN', actor: 'nikhil', permissions: {}}, 'GET', {}, new URLSearchParams({site: name, from: '2026-11-01', to: '2026-11-23'}), null);
  assert.equal((await read('Dhoptala OB 2nd')).site, 'Dhoptala  OB 2nd ', 'the saved name is used from here on');
  assert.equal((await read('dhoptala ob 2ND')).site, 'Dhoptala  OB 2nd ');
  await assert.rejects(read('Majri OB'), e => e.status === 403);
});

test('every exact site lookup by name uses the same whitespace rule', () => {
  for (const file of ['biometric-day-store.mjs', 'trip-card-store.mjs']) {
    const source = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
    assert.ok(!/kind='sites' AND status IN \('ACTIVE','APPROVED'\) AND name=\$1/.test(source), file + ' still matches the name exactly');
    assert.ok(source.includes(RULE), file);
  }
  const attendance = readFileSync(new URL('./attendance.mjs', import.meta.url), 'utf8');
  assert.ok(attendance.includes('attendanceSiteKey(row.name)===attendanceSiteKey(siteName)'), 'attendance imports use the OB/OC-aware site resolver');
  const roster = readFileSync(new URL('../src/AttendanceRoster.tsx', import.meta.url), 'utf8');
  assert.ok(roster.includes('<option key={s} value={s}>{s}</option>'), 'the site option sends the name as saved');
});
