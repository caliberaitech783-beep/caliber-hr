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

// Owner, 28 Nov 2026 ("Yes, send to MIS"): HR Pulse keeps no duty times of its own; they are set in Pulse-II with an OTP.
test('HR Pulse saves no correction of its own, and touches nothing when asked', async () => {
  const {api, calls} = setup();
  for (const body of [change, {...change, version: 1}, {...change, site: 'Other Site'}]) {
    await assert.rejects(api({actor: 'test'}, grant, 'mis/correction', 'POST', body), {status: 400});
  }
  assert.equal(calls.length, 0);
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
    async query(sql, args) {
      if (sql.startsWith('SELECT report') || sql.startsWith('INSERT INTO hr_mis_attendance_cache')) return db.query(sql, args);
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
    async query(sql, args) {
      if (sql.startsWith('SELECT report') || sql.startsWith('INSERT INTO hr_mis_attendance_cache')) return db.query(sql, args);
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
    async query(sql, args) {
      if (sql.startsWith('SELECT report') || sql.startsWith('INSERT INTO hr_mis_attendance_cache')) return db.query(sql, args);
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
    async query(sql, args) {
      if (sql.startsWith('SELECT report') || sql.startsWith('INSERT INTO hr_mis_attendance_cache')) return db.query(sql, args);
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

// Owner, 28 Nov 2026: "plz do this and all other such mine names". HR "Dudhichua OB East" was read as both MIS
// "Dudhichua East OC" and "Dudhichua OC" (the looser rule finds no word in "Dudhichua OC" that East lacks), so the East
// roster also took the other site's trip cards. The site names below are the ones live sent on 28 Nov 2026.
test('a site of almost another site\'s name is given only its own trip cards and signed days', async () => {
  const line = (site, siteKey, employeeId) => ({date: '2026-11-16', site, siteKey, shift: 'S1', employeeId, employeeKey: employeeId, employeeName: employeeId});
  // East saved no card of its own on this day; MIS still names it in the shift list of every date.
  const whole = {
    attendanceEquipment: [], ot: [], performance: [], details: [], exceptions: [],
    attendanceShifts: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shift: 'S1', state: 'none', batch: ''}, {siteKey: 'dudhichua ob', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'B'}],
    otDuties: [line('Dudhichua OC', 'dudhichua ob', 'W1'), line('Dudhichua OC', 'dudhichua ob', 'W2')],
    days: [{siteKey: 'dudhichua ob', date: '2026-11-16', lines: 2, signature: 'w'}],
    pendingDays: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shifts: []}]
  };
  let asked = 0;
  const db = {async query() { return {rows: []}; }, release() {}};
  const pool = {connect: async () => db, async query(sql) { return {rows: sql.includes("kind='sites'") ? [{name: 'Dudhichua OB East'}] : []}; }};
  const api = createMisAttendance(pool, {fetchMis: async url => { asked++; return Response.json(url.searchParams.get('only') === 'days' ? {days: whole.days, pendingDays: whole.pendingDays} : whole); }});
  const day = site => api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site, trim: '1'}));
  const east = await day('Dudhichua OB East'), west = await day('Dudhichua OB West');
  assert.deepEqual([east.otDuties.length, east.days.length, east.attendanceShifts.map(s => s.siteKey)], [0, 0, ['dudhichua east ob']]);
  assert.deepEqual(east.misSites, ['Dudhichua OC'], 'the roster can still say where MIS had cards');
  assert.deepEqual(east.knownSites, ['Dudhichua OC', 'dudhichua east ob', 'dudhichua ob']);
  assert.deepEqual([west.otDuties.map(d => d.employeeId), west.days.map(d => d.signature), west.attendanceShifts.map(s => s.siteKey)], [['W1', 'W2'], ['w'], ['dudhichua ob']]);
  // The same two requests to Pulse-II as before the rule changed: the rule asks for nothing more.
  assert.equal(asked, 2);

  // The check of saved days also says which sites Pulse-II lists (signed, or still open), for the same rule in the roster.
  const signed = await api({actor: 'hr', permissions: {}}, grant, 'mis/days', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16'}));
  assert.deepEqual(signed.days.map(d => d.signature), ['w']);
  assert.deepEqual(signed.knownSites, ['dudhichua east ob', 'dudhichua ob']);
});

// 28 Nov 2026 (roster 162 seconds for 4 of 20 days): waiting on Pulse-II held one of the server's five database
// connections, so the Manual Biometric reads beside it ran out of connections. No connection is held while waiting now,
// two PCs asking the same day at the same moment share one read, and the roster's day read asks Pulse-II for its site only.
test('the day read holds no database connection while it waits, shares one read, and asks Pulse-II for the site only', async () => {
  const stored = new Map();
  let fetches = 0, requestedUrl, release;
  const answered = new Promise(resolve => {release = resolve;});
  const pool = {
    connect: async () => {throw new Error('no connection may be held while Pulse-II is asked');},
    async query(sql, args) {
      if (sql.startsWith('SELECT report')) {const report = stored.get(args[0]); return {rows: report ? [{report, fetched_at: new Date()}] : []};}
      if (sql.startsWith('INSERT INTO hr_mis_attendance_cache')) stored.set(args[0], args[1]);
      if (sql.includes("kind='sites'")) return {rows: [{name: 'Gauri Pauni OB 2nd'}]};
      return {rows: []};
    }
  };
  const line = (site, employeeId) => ({date: '2026-11-07', site, siteKey: site.toLowerCase(), shift: 'S1', employeeId, employeeKey: employeeId, employeeName: employeeId});
  const cutAnswer = {...report, otDuties: [line('Gauri Pauni OC (2nd)', 'CMLL16436')], days: [], hrChanges: [], cut: 'site',
    misSiteDays: {'2026-11-06': ['Majri OC'], '2026-11-07': ['Gauri Pauni OC (2nd)', 'Sasti OC'], '2026-11-08': ['Jayant OC']}};
  const api = createMisAttendance(pool, {fetchMis: async url => {fetches++; requestedUrl = url; await answered; return Response.json(cutAnswer);}});
  const ask = actor => api({actor, permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-07', to: '2026-11-07', site: 'Gauri Pauni OB 2nd', trim: '1'}));
  const first = ask('pc-1'), second = ask('pc-2');
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(fetches, 1);
  assert.equal(requestedUrl.searchParams.get('cut'), 'site');
  assert.equal(requestedUrl.searchParams.get('site'), 'Gauri Pauni OB 2nd');
  assert.deepEqual(a.otDuties.map(d => d.employeeId), ['CMLL16436']);
  assert.deepEqual(b.otDuties, a.otDuties);
  // The other sites of the day come from misSiteDays (only the dates asked), as the roster shows them when none is its own.
  assert.deepEqual(a.misSites, ['Gauri Pauni OC (2nd)', 'Sasti OC']);
  assert.equal(stored.size, 1);
});

test('a screen that wants every site does not ask Pulse-II for the cut', async () => {
  let requestedUrl;
  const pool = {
    async query(sql) {if (sql.includes("kind='sites'")) return {rows: [{name: 'Majri OC'}]}; return {rows: []};}
  };
  const api = createMisAttendance(pool, {fetchMis: async url => {requestedUrl = url; return Response.json(report);}});
  await api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site: 'Majri OC'}));
  assert.equal(requestedUrl.searchParams.get('cut'), null);
});

// The same site when Pulse-II has already cut its answer (cut=site). Pulse-II's cut uses the looser rule, so for
// "Dudhichua OB East" it still sends "Dudhichua OC"; HR Pulse leaves that site out, also on a day East has no card.
test('an answer Pulse-II already cut to a site of almost another site\'s name is still given only its own cards', async () => {
  const line = (site, siteKey, employeeId) => ({date: '2026-11-16', site, siteKey, shift: 'S1', employeeId, employeeKey: employeeId, employeeName: employeeId});
  const cut = {
    attendanceEquipment: [], ot: [], performance: [], details: [], exceptions: [], hrChanges: [], cut: 'site',
    attendanceShifts: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'E'}, {siteKey: 'dudhichua ob', date: '2026-11-16', shift: 'S1', state: 'closed', batch: 'B'}],
    otDuties: [line('Dudhichua East OC', 'dudhichua east ob', 'E1'), line('Dudhichua OC', 'dudhichua ob', 'W1')],
    days: [{siteKey: 'dudhichua east ob', date: '2026-11-16', lines: 1, signature: 'e'}, {siteKey: 'dudhichua ob', date: '2026-11-16', lines: 1, signature: 'w'}],
    misSiteDays: {'2026-11-16': ['Dudhichua East OC', 'Dudhichua OC', 'Jayant OC']}
  };
  const noCard = {...cut, otDuties: [line('Dudhichua OC', 'dudhichua ob', 'W1')], days: [cut.days[1]], misSiteDays: {'2026-11-16': ['Dudhichua OC']},
    attendanceShifts: [{siteKey: 'dudhichua east ob', date: '2026-11-16', shift: 'S1', state: 'none', batch: ''}, cut.attendanceShifts[1]]};
  const pool = {async query(sql) { return {rows: sql.includes("kind='sites'") ? [{name: 'Dudhichua OB East'}] : []}; }};
  const read = async answer => createMisAttendance(pool, {fetchMis: async () => Response.json(answer)})({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {},
    new URLSearchParams({from: '2026-11-16', to: '2026-11-16', site: 'Dudhichua OB East', trim: '1'}));
  const east = await read(cut);
  assert.deepEqual([east.otDuties.map(d => d.employeeId), east.days.map(d => d.signature), east.attendanceShifts.map(s => s.siteKey)], [['E1'], ['e'], ['dudhichua east ob']]);
  assert.deepEqual(east.misSites, ['Dudhichua East OC', 'Dudhichua OC', 'Jayant OC']);
  const empty = await read(noCard);
  assert.deepEqual([empty.otDuties.length, empty.days.length, empty.attendanceShifts.map(s => s.siteKey)], [0, 0, ['dudhichua east ob']]);
});

// The MIS busy limit (owner, 28 Nov 2026: "plz build the MIS busy limit in HR Pulse also"). That morning HR Pulse gave
// up on a read after 22 seconds while Pulse-II went on building it, and the roster asked again: Pulse-II's three report
// places stayed full of reads nobody waited for, and 47 of 47 trip card reads failed in six minutes. HR Pulse now keeps
// at most two reads open at Pulse-II; the next few wait in a short line here; beyond that the answer is "MIS is busy"
// at once, without asking Pulse-II.
const busyPool = () => ({async query(sql) { return {rows: sql.includes("kind='sites'") ? [{name: 'Majri OC'}] : []}; }});
const askDay = (api, day) => api({actor: 'hr', permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: day, to: day, site: 'Majri OC', trim: '1'}));
const gate = () => {let open; const wait = new Promise(resolve => {open = resolve;}); return {wait, open};};
const until = async check => {for (let i = 0; i < 400 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(check(), 'waited for: ' + check);};
const isBusy = error => error.status === 503 && error.message === 'MIS is busy. Try again in a minute.';
// Pulse-II holding every read until the test lets it answer.
function heldMis() {
  const gates = [], asked = [];
  return {gates, asked, fetchMis: async url => {const g = gate(); gates.push(g); asked.push(url.searchParams.get('only') || url.searchParams.get('from')); await g.wait; return Response.json(report);}};
}

test('no more than two reads are open at Pulse-II; the next waits in line and is read when one ends', async () => {
  const pulse = heldMis();
  const api = createMisAttendance(busyPool(), {fetchMis: pulse.fetchMis, readLimit: {lineWaitMs: 5000}});
  const reads = ['2026-11-10', '2026-11-11', '2026-11-12'].map(day => askDay(api, day));
  await until(() => api.readLimit().waiting === 1);
  assert.equal(pulse.asked.length, 2, 'the third read has not been sent to Pulse-II');
  assert.deepEqual(api.readLimit(), {limit: 2, open: 2, cooling: 0, waiting: 1, asked: 3, waited: 1, busy: 0, timedOut: 0});
  pulse.gates[0].open();
  await until(() => pulse.asked.length === 3);
  assert.equal(api.readLimit().open, 2);
  pulse.gates[1].open(); pulse.gates[2].open();
  assert.equal((await Promise.all(reads)).length, 3);
  assert.deepEqual([api.readLimit().open, api.readLimit().waiting], [0, 0]);
});

test('when the line is full, or the wait in it is over, the answer is "MIS is busy" and Pulse-II is not asked', async () => {
  const pulse = heldMis();
  const api = createMisAttendance(busyPool(), {fetchMis: pulse.fetchMis, readLimit: {lineWaitMs: 60, lineMax: 1}});
  const open = [askDay(api, '2026-11-10'), askDay(api, '2026-11-11')];
  await until(() => pulse.asked.length === 2);
  const inLine = askDay(api, '2026-11-12');
  await until(() => api.readLimit().waiting === 1);
  // The line holds one: the next is told at once.
  await assert.rejects(askDay(api, '2026-11-13'), isBusy);
  assert.equal(api.readLimit().waiting, 1, 'the read in the line is still waiting');
  // The read in the line is told after its wait.
  await assert.rejects(inLine, isBusy);
  assert.equal(pulse.asked.length, 2, 'neither refused read reached Pulse-II');
  assert.equal(api.readLimit().busy, 2);
  for (const g of pulse.gates) g.open();
  await Promise.all(open);
});

test('a read Pulse-II did not answer in time keeps its place for a while, because Pulse-II is still building it', async () => {
  let asked = 0;
  const fetchMis = async () => {asked++; if (asked <= 2) throw new DOMException('The operation timed out', 'TimeoutError'); return Response.json(report);};
  const api = createMisAttendance(busyPool(), {fetchMis, readLimit: {lineWaitMs: 0, coolMs: 80}});
  const unavailable = error => error.status === 503 && error.message === 'The MIS attendance feed is temporarily unavailable.';
  await assert.rejects(askDay(api, '2026-11-10'), unavailable);
  await assert.rejects(askDay(api, '2026-11-11'), unavailable);
  assert.deepEqual([api.readLimit().open, api.readLimit().cooling, api.readLimit().timedOut], [0, 2, 2]);
  // Both places are still taken: the roster's next try is not passed on to Pulse-II.
  await assert.rejects(askDay(api, '2026-11-12'), isBusy);
  assert.equal(asked, 2);
  await until(() => api.readLimit().cooling === 0);
  await askDay(api, '2026-11-12');
  assert.equal(asked, 3);
});

test('a read Pulse-II refused or answered badly gives its place back at once', async () => {
  let asked = 0;
  const api = createMisAttendance(busyPool(), {fetchMis: async () => {asked++; return asked <= 2 ? Response.json({error: 'no'}, {status: 500}) : Response.json(report);}, readLimit: {lineWaitMs: 0}});
  await assert.rejects(askDay(api, '2026-11-10'), /temporarily unavailable/);
  await assert.rejects(askDay(api, '2026-11-11'), /temporarily unavailable/);
  assert.deepEqual([api.readLimit().open, api.readLimit().cooling], [0, 0]);
  await askDay(api, '2026-11-12');
  assert.equal(asked, 3);
});

test('the check of saved days never waits in the line, and an attendance change with an OTP is never held back', async () => {
  const pulse = heldMis();
  const changes = [];
  const fetchMis = async (url, options) => {
    if (url.pathname.endsWith('/change')) {changes.push(JSON.parse(options.body).mark); return Response.json({id: 'c1', site: 'Majri OC', date: duty.date, shift: 'S1', employeeId: 'DEMO-1', mark: 'absent', reason: 'r', status: 'asked', sentTo: 'RHR'});}
    return pulse.fetchMis(url);
  };
  const api = createMisAttendance(busyPool(), {fetchMis, readLimit: {lineWaitMs: 5000}});
  const open = [askDay(api, '2026-11-10'), askDay(api, '2026-11-11')];
  await until(() => pulse.asked.length === 2);
  // The roster shows its saved days unchecked rather than wait: told at once.
  await assert.rejects(api({actor: 'hr', permissions: {}}, grant, 'mis/days', 'GET', null, new URLSearchParams({from: '2026-11-01', to: '2026-11-20'})), isBusy);
  assert.equal(pulse.asked.length, 2);
  const asked = await api({actor: 'hr', permissions: {}}, grant, 'mis/change', 'POST', {...duty, mark: 'absent', reason: 'Roster checked'}, new URLSearchParams());
  assert.equal(asked.id, 'c1');
  assert.deepEqual(changes, ['absent']);
  for (const g of pulse.gates) g.open();
  await Promise.all(open);
  // With a place free the check goes to Pulse-II as before.
  const check = api({actor: 'hr', permissions: {}}, grant, 'mis/days', 'GET', null, new URLSearchParams({from: '2026-11-01', to: '2026-11-20'}));
  await until(() => pulse.asked.length === 3);
  assert.equal(pulse.asked[2], 'days');
  pulse.gates[2].open();
  await check.catch(() => {});
});

// 28 Nov 2026, "MIS is busy" on Shift roster: the all-sites read is shared between PCs, kept 30 seconds in memory, and
// its last good answer is given (marked stale) while Pulse-II is busy, instead of an empty page.
test('the all-sites read is shared, kept for 30 seconds, and the last answer stands in while MIS is busy', async () => {
  let fetches = 0, answer = 'ok', release;
  const pool = {async query(sql) { if (sql.includes("kind='sites'")) return {rows: [{name: 'Gevra'}]}; return {rows: []}; }};
  const api = createMisAttendance(pool, {fetchMis: async url => {
    fetches++;
    assert.equal(url.searchParams.get('site'), null);
    if (answer === 'wait') await new Promise(resolve => { release = resolve; });
    if (answer === 'down') return new Response('{}', {status: 503});
    return Response.json(report);
  }});
  const ask = actor => api({actor, permissions: {}}, grant, 'mis', 'GET', {}, new URLSearchParams({from: '2026-11-16', to: '2026-11-16'}));
  answer = 'wait';
  const both = Promise.all([ask('first'), ask('second')]);
  await new Promise(resolve => setImmediate(resolve));
  release();
  const [first, second] = await both;
  assert.equal(fetches, 1, 'two PCs asking together share one read');
  assert.deepEqual(second.otDuties, first.otDuties);
  answer = 'ok';
  await ask('third');
  assert.equal(fetches, 1, 'a read within 30 seconds uses the copy');
  const realNow = Date.now;
  Date.now = () => realNow() + MIS_ATTENDANCE_CACHE_MS + 1;
  try {
    answer = 'down';
    const stale = await ask('fourth');
    assert.equal(fetches, 2);
    assert.deepEqual(stale.otDuties, report.otDuties);
    assert.match(stale.stale.reason, /temporarily unavailable/);
  } finally { Date.now = realNow; }
});
