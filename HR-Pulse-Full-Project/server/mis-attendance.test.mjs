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

// Owner, 28 Nov 2026: "Yes, build it". Pulse-II took about 14 seconds for every single day asked, 28 times for a month.
// Once Pulse-II says it can cut its answer to one site, the server reads the site's whole week in one request and
// hands out the days of that week from it.
function weekSetup({cutWorks = true, weekFails = false, slowWeek = null} = {}) {
  const dates = Array.from({length: 9}, (_, i) => '2026-11-' + String(14 + i).padStart(2, '0'));
  const line = (site, date, employeeId) => ({date, site, siteKey: site.toLowerCase(), shift: 'S1', employeeId, employeeKey: employeeId, employeeName: employeeId});
  const everySite = wanted => ({
    attendanceEquipment: [], attendanceShifts: [], ot: [], performance: [], details: [], exceptions: [],
    otDuties: wanted.flatMap(date => [line('Majri OC', date, 'CMLL1'), line('Sasti OC', date, 'CMLL9')]),
    days: wanted.flatMap(date => [{siteKey: 'majri oc', date, lines: 1, signature: 'm' + date}, {siteKey: 'sasti oc', date, lines: 1, signature: 's' + date}]),
    hrChanges: [], supports: ['site-cut']
  });
  const between = (from, to) => dates.filter(date => date >= from && date <= to);
  const stored = new Map(), asked = [];
  const db = {
    async query(sql, args) {
      const held = stored.get(args?.[0]);
      if (sql.startsWith('SELECT fetched_at')) return {rows: held ? [{fetched_at: held.fetched_at, run: held.report.run ?? null}] : []};
      if (sql.startsWith('SELECT report,fetched_at')) return {rows: held ? [held] : []};
      if (sql.startsWith('SELECT report')) return {rows: held ? [{report: held.report}] : []};
      if (sql.startsWith('INSERT INTO hr_mis_attendance_cache')) {
        // One second old, so a later request never shares its millisecond.
        const row = {report: JSON.parse(JSON.stringify(args[1])), fetched_at: new Date(Date.now() - 1000)};
        stored.set(args[0], row);
        return {rows: [{fetched_at: row.fetched_at}]};
      }
      return {rows: []};
    },
    release() {}
  };
  const pool = {
    connect: async () => db,
    async query(sql, args) { return sql.includes("kind='sites'") ? {rows: [{name: 'Majri OC'}]} : db.query(sql, args); }
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {
    const q = url.searchParams, cut = q.get('cut') === 'site';
    asked.push([q.get('from'), q.get('to'), cut ? 'cut ' + q.get('site') : 'every site'].join(' '));
    if (cut && slowWeek) await slowWeek;
    if (cut && weekFails) throw new Error('timed out');
    // cutWorks false: Pulse-II is taken back to an older release after its first answer (no cut, no "supports").
    const whole = {...everySite(between(q.get('from'), q.get('to'))), ...(cutWorks || asked.length === 1 ? {} : {supports: undefined})};
    if (!cut || !cutWorks) return Response.json(whole);
    // What Pulse-II's cut sends: the site's lines, and where the lines were before the cut.
    return Response.json({...whole, otDuties: whole.otDuties.filter(d => d.site === 'Majri OC'), days: whole.days.filter(d => d.siteKey === 'majri oc'), cut: 'site',
      misSiteDays: Object.fromEntries(between(q.get('from'), q.get('to')).map(date => [date, ['Majri OC', 'Sasti OC']]))});
  }});
  const day = (date, extra = {}) => api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: date, to: date, site: 'Majri OC', trim: '1', ...extra}));
  return {day, asked, stored};
}

test('a day of one site is taken out of one read of that site\'s week, once Pulse-II offers the cut', async () => {
  const {day, asked, stored} = weekSetup();
  // Before Pulse-II has said what it can do, a day is read on its own, as before.
  const first = await day('2026-11-16');
  assert.deepEqual(asked, ['2026-11-15 2026-11-17 every site']);
  assert.equal(first.timing.week, undefined);
  // That answer said the feed can cut: the next day asks for the week of 15 to 21 Nov (with a day each side), cut to the site.
  const second = await day('2026-11-17');
  assert.deepEqual(asked.slice(1), ['2026-11-14 2026-11-22 cut Majri OC']);
  assert.equal(second.timing.week, 'read');
  // The day is sent as its own read sends it: the day, the day before and the day after, of the site.
  assert.deepEqual(second.otDuties.map(d => d.site + ' ' + d.date), ['Majri OC 2026-11-16', 'Majri OC 2026-11-17', 'Majri OC 2026-11-18']);
  assert.deepEqual(second.days.map(d => d.signature), ['m2026-11-16', 'm2026-11-17', 'm2026-11-18']);
  assert.deepEqual(second.misSites, ['Majri OC', 'Sasti OC']);
  assert.equal(second.signed, true);
  assert.equal('misSiteDays' in second || 'run' in second, false);
  // The other days of the week ask Pulse-II nothing more.
  for (const date of ['2026-11-15', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) {
    const next = await day(date);
    assert.equal(next.timing.week, 'kept');
    assert.deepEqual([...new Set(next.otDuties.map(d => d.site))], ['Majri OC']);
    assert.equal(next.otDuties.some(d => d.date === date), true);
  }
  assert.equal(asked.length, 2);
  assert.equal(stored.size, 2);
  // A day of another week reads that week.
  await day('2026-11-22');
  assert.equal(asked.at(-1), '2026-11-21 2026-11-29 cut Majri OC');
});

test('Fetch again reads a week once for the whole run, and again for the next run', async () => {
  const {day, asked} = weekSetup();
  await day('2026-11-16');
  await day('2026-11-16');
  assert.equal(asked.length, 2);
  // Every day of a Fetch again asks to be read afresh: the first one reads the week, the others of the same run use it.
  for (const date of ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-21']) await day(date, {refresh: '1', run: 'runAAAAAAAA'});
  assert.equal(asked.length, 3);
  // The next Fetch again reads it afresh, and so does a refresh that names no run.
  await day('2026-11-17', {refresh: '1', run: 'runBBBBBBBB'});
  assert.equal(asked.length, 4);
  await day('2026-11-18', {refresh: '1'});
  await day('2026-11-19', {refresh: '1'});
  assert.equal(asked.length, 6);
  assert.equal(asked.slice(2).every(line => line === '2026-11-14 2026-11-22 cut Majri OC'), true);
});

test('a week that cannot be read falls back to the day on its own, and weeks rest for a while', async () => {
  const {day, asked} = weekSetup({weekFails: true});
  await day('2026-11-16');
  const answer = await day('2026-11-17');
  assert.deepEqual(asked.slice(1), ['2026-11-14 2026-11-22 cut Majri OC', '2026-11-16 2026-11-18 every site']);
  assert.deepEqual(answer.otDuties.map(d => d.site + ' ' + d.date), ['Majri OC 2026-11-16', 'Majri OC 2026-11-17', 'Majri OC 2026-11-18']);
  await day('2026-11-18');
  assert.equal(asked.at(-1), '2026-11-17 2026-11-19 every site');
  assert.equal(asked.length, 4);
});

test('a Pulse-II that stops cutting still gives the right day, and is no longer asked to cut', async () => {
  const {day, asked} = weekSetup({cutWorks: false});
  await day('2026-11-16');
  const answer = await day('2026-11-17');
  assert.equal(asked.at(-1), '2026-11-14 2026-11-22 cut Majri OC');
  assert.deepEqual(answer.otDuties.map(d => d.site + ' ' + d.date), ['Majri OC 2026-11-16', 'Majri OC 2026-11-17', 'Majri OC 2026-11-18']);
  assert.deepEqual(answer.misSites, ['Majri OC', 'Sasti OC']);
  await day('2026-11-18');
  assert.equal(asked.at(-1), '2026-11-17 2026-11-19 every site');
});

// Owner, 28 Nov 2026: "plz fix the attached issue also". HR "Dudhichua OB East" was read as both MIS "Dudhichua East OC"
// and "Dudhichua OC" (the looser rule finds no word in "Dudhichua OC" that East lacks), so the East roster also took the
// other site's trip cards. The site names below are the ones live sent on 28 Nov 2026.
test('a site of almost another site\'s name is given only its own trip cards and signed days', async () => {
  const {siteMatcher} = await import('./site-match.mjs');
  const live = ['Dhoptala OC (2nd)', 'Dudhichua East OC', 'Dudhichua OC', 'Gauri Pauni OC (2nd)', 'Jayant OC', 'Majri OC', 'Sasti OC',
    'dhoptala ob 2nd', 'dudhichua east ob', 'dudhichua ob', 'gauri pauni ob 2nd', 'jayant ob', 'lalpeth ob', 'majri ob', 'sasti ob'];
  const sitesOf = hr => live.filter(siteMatcher(hr, live));
  assert.deepEqual(sitesOf('Dudhichua OB East'), ['Dudhichua East OC', 'dudhichua east ob']);
  assert.deepEqual(sitesOf('Dudhichua OB West'), ['Dudhichua OC', 'dudhichua ob']);
  // Every other site keeps exactly what it had.
  assert.deepEqual(sitesOf('Majri OC'), ['Majri OC', 'majri ob']);
  assert.deepEqual(sitesOf('Dhoptala OC'), ['Dhoptala OC (2nd)', 'dhoptala ob 2nd']);
  assert.deepEqual(sitesOf('Gauri Pauni OB'), ['Gauri Pauni OC (2nd)', 'gauri pauni ob 2nd']);
  assert.deepEqual(sitesOf('Jayant OB'), ['Jayant OC', 'jayant ob']);
  assert.deepEqual(sitesOf('Hindustan Lalpeth OC'), ['lalpeth ob']);
  assert.deepEqual(sitesOf('Nagpur CO'), []);

  const line = (site, siteKey, employeeId) => ({date: '2026-11-16', site, siteKey, shift: 'S1', employeeId, employeeKey: employeeId, employeeName: employeeId});
  // East saved no card of its own on this day; MIS still names it in the shift list of every date.
  const whole = {
    attendanceEquipment: [], ot: [], performance: [], details: [], exceptions: [],
    attendanceShifts: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shift: 'S1', state: 'none', batch: ''}, {siteKey: 'dudhichua ob', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'B'}],
    otDuties: [line('Dudhichua OC', 'dudhichua ob', 'W1'), line('Dudhichua OC', 'dudhichua ob', 'W2')],
    days: [{siteKey: 'dudhichua ob', date: '2026-11-16', lines: 2, signature: 'w'}],
    pendingDays: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shifts: []}]
  };
  const db = {async query() { return {rows: []}; }, release() {}};
  const pool = {connect: async () => db, async query(sql) { return {rows: sql.includes("kind='sites'") ? [{name: 'Dudhichua OB East'}] : []}; }};
  const api = createMisAttendance(pool, {fetchMis: async url => Response.json(url.searchParams.get('only') === 'days' ? {days: whole.days, pendingDays: whole.pendingDays} : whole)});
  const day = site => api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site, trim: '1'}));
  const east = await day('Dudhichua OB East'), west = await day('Dudhichua OB West');
  assert.deepEqual([east.otDuties.length, east.days.length, east.attendanceShifts.map(s => s.siteKey)], [0, 0, ['dudhichua east ob']]);
  assert.deepEqual(east.misSites, ['Dudhichua OC'], 'the roster can still say where MIS had cards');
  assert.deepEqual(east.knownSites, ['Dudhichua OC', 'dudhichua east ob', 'dudhichua ob']);
  assert.deepEqual([west.otDuties.map(d => d.employeeId), west.days.map(d => d.signature), west.attendanceShifts.map(s => s.siteKey)], [['W1', 'W2'], ['w'], ['dudhichua ob']]);

  // The check of saved days gives each site its own signed days.
  const signed = site => api({actor: 'hr', permissions: {}}, grant, 'mis/days', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16', ...(site ? {site} : {})}));
  assert.deepEqual((await signed('Dudhichua OB East')).days, []);
  assert.deepEqual((await signed('Dudhichua OB West')).days.map(d => d.signature), ['w']);
  assert.deepEqual((await signed('')).days.map(d => d.signature), ['w'], 'without a site every day is sent, as before');
});

// Measured on live on 28 Nov 2026: the first read of a week took Pulse-II 38 seconds. The second day of the week waited
// for it on a database lock, the database ends a statement after 5 seconds, so the wait was cut off, the week was taken
// for failed, and the rest of the week was read day by day. The days now wait for the one read in the server's memory.
test('the days of a week that arrive while it is being read wait for that one read', async () => {
  let release;
  const slowWeek = new Promise(resolve => { release = resolve; });
  const {day, asked} = weekSetup({slowWeek});
  await day('2026-11-16');
  // Three days of the same week are asked while Pulse-II is still answering the first.
  const waiting = [day('2026-11-17'), day('2026-11-18'), day('2026-11-19')];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(asked.slice(1), ['2026-11-14 2026-11-22 cut Majri OC'], 'Pulse-II is asked once');
  release();
  const answers = await Promise.all(waiting);
  assert.deepEqual(answers.map(a => a.timing.week), ['read', 'shared', 'shared']);
  assert.deepEqual(answers.map(a => a.otDuties.map(d => d.date).join(' ')), ['2026-11-16 2026-11-17 2026-11-18', '2026-11-17 2026-11-18 2026-11-19', '2026-11-18 2026-11-19 2026-11-20']);
  assert.equal(asked.length, 2);
  // A day after that is handed out from the week kept in memory.
  assert.equal((await day('2026-11-20')).timing.week, 'kept');
  assert.equal(asked.length, 2);
});
