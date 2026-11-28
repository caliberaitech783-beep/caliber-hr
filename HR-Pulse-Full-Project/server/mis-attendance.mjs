import {siteIds} from './scope.mjs';
import {trimMisReport} from './mis-trim.mjs';

const ORIGIN = 'https://pulse-ll.cmll.in';
const FIRST_DATE = '2026-11-01';
const DAY = 86_400_000;
export const MIS_ATTENDANCE_CACHE_MS = 30_000;
export const DAYS_TIMEOUT_MS = 12_000;
const sections = ['attendanceEquipment', 'attendanceShifts', 'otDuties', 'ot', 'performance', 'details', 'exceptions'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const dayString = stamp => new Date(stamp).toISOString().slice(0, 10);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && dayString(Date.parse(value)) === value;
const siteKey = site => site.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compactId = value => value.trim().toUpperCase();
const dutyKey = ({site, siteKey: canonical, date, shift, employeeId}) =>
  JSON.stringify([JSON.stringify([siteKey(canonical || site), date, shift]), compactId(employeeId)]);

function reportRanges(from, to) {
  if (!validDay(from) || !validDay(to) || from < FIRST_DATE || from > to || Date.parse(to) - Date.parse(from) > 30 * DAY) {
    fail('Choose up to 31 days from 1 November 2026 onward.');
  }
  const first = Math.max(Date.parse(FIRST_DATE), Date.parse(from) - DAY);
  const last = Date.parse(to) + DAY;
  const split = Math.min(last, first + 30 * DAY);
  return split < last ? [[first, split], [split + DAY, last]] : [[first, last]];
}

// A correction kept only in HR Pulse is shown, never applied (retired): absent / pending since 27 Nov 2026, the
// corrected duty times of a present duty since 28 Nov 2026 (owner: "Yes, send to MIS"; they are set in Pulse-II with an OTP).
function publicCorrection(row) {
  return {id: row.duty_id, status: row.status, retired: row.status !== 'mis', start: row.start_time, end: row.end_time,
    reason: row.reason, version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at};
}

export function createMisAttendance(pool, {fetchMis = fetch} = {}) {
  async function read(grant, from, to, selectedSite = '', refresh = false) {
    const ranges = reportRanges(from, to);
    const reports = await Promise.all(ranges.map(async ([start, end]) => {
      const url = new URL('/api/integrations/hr/attendance', ORIGIN);
      url.search = new URLSearchParams({from: dayString(start), to: dayString(end), ...(selectedSite ? {site: selectedSite} : {}), ...(refresh ? {refresh: '1'} : {})});
      let response;
      try {
        response = await fetchMis(url, {
          headers: {Authorization: 'Bearer ' + grant, Accept: 'application/json'},
          redirect: 'error', signal: AbortSignal.timeout(22_000)
        });
      } catch {
        fail('The MIS attendance feed is temporarily unavailable.', 503);
      }
      if (response.status === 403) fail('MIS attendance is outside your assigned access.', 403);
      if (!response.ok) fail('The MIS attendance feed is temporarily unavailable.', 503);
      const result = await response.json().catch(() => null);
      if (!result || sections.some(key => !Array.isArray(result[key]))) fail('MIS returned an incomplete attendance report.', 502);
      return result;
    }));
    // Pulse-II is the master of trip card attendance (owner, 27 Nov 2026). It signs every site-day it sends (days) and
    // lists what HR Pulse changed there with an OTP (hrChanges). signed: false while Pulse-II does not send them yet.
    const listed = key => reports.flatMap(report => Array.isArray(report[key]) ? report[key] : []);
    return {...Object.fromEntries(sections.map(key => [key, reports.flatMap(report => report[key])])),
      days: listed('days'), hrChanges: listed('hrChanges'), signed: reports.every(report => Array.isArray(report.days))};
  }

  // One call to Pulse-II with the user's own grant. Pulse-II's own words come back when it refuses.
  async function mis(grant, path, {method = 'GET', query, body, timeout = 22_000} = {}) {
    const url = new URL(path, ORIGIN);
    if (query) url.search = new URLSearchParams(query);
    let response;
    try {
      response = await fetchMis(url, {method, headers: {Authorization: 'Bearer ' + grant, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(timeout)});
    } catch {
      fail('Pulse-II did not answer. Try again.', 503);
    }
    const result = await response.json().catch(() => null);
    return {status: response.status, ok: response.ok, result};
  }
  // The signatures of the site-days Pulse-II holds now, without the cards (a small answer).
  // supported: false while Pulse-II still sends the whole report (before its release of 27 Nov 2026).
  async function days(grant, from, to) {
    if (!validDay(from) || !validDay(to) || from < FIRST_DATE || from > to || Date.parse(to) - Date.parse(from) > 30 * DAY) fail('Choose up to 31 days from 1 November 2026 onward.');
    // A short wait: the roster shows its saved days unchecked rather than keep the user waiting for this.
    const {status, ok, result} = await mis(grant, '/api/integrations/hr/attendance', {query: {from, to, only: 'days'}, timeout: DAYS_TIMEOUT_MS});
    if (status === 403) fail('MIS attendance is outside your assigned access.', 403);
    if (!ok || !result) fail('The MIS attendance feed is temporarily unavailable.', 503);
    const supported = Array.isArray(result.days) && !Array.isArray(result.otDuties);
    // knownSites (28 Nov 2026): the site keys Pulse-II lists, signed or still open, so the roster can tell
    // "Dudhichua OB East" from "Dudhichua OC" when it compares a saved day (site-match.mjs).
    const all = supported ? result.days : [];
    const knownSites = [...new Set([...all, ...(Array.isArray(result.pendingDays) ? result.pendingDays : [])].map(day => day?.siteKey).filter(name => typeof name === 'string' && name))].sort();
    return {supported, days: all, knownSites};
  }
  // A change of attendance is made in Pulse-II, never kept here: ask (the OTP goes to RHR), then the OTP.
  async function change(profile, grant, path, input, action) {
    const {status, ok, result} = await mis(grant, '/api/integrations/hr/attendance/' + path, {method: 'POST', body: input, timeout: 30_000});
    if (status === 404 && !result?.error) fail('Pulse-II does not take attendance changes from HR Pulse yet. It will after its next release.', 503);
    // A Pulse-II from before 28 Nov 2026 knows present / absent only.
    if (status === 400 && ['times', 'card-times'].includes(input?.mark) && /^Choose Present, Absent or/.test(String(result?.error || ''))) {
      fail('Pulse-II does not take duty times from HR Pulse yet. It will after its next release.', 503);
    }
    if (!ok || !result) fail(result?.error || 'Pulse-II could not make this change.', status >= 500 || ok ? 503 : status);
    await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)", [profile.actor, action,
      {id: result.id, site: result.site, date: result.date, shift: result.shift, employeeId: result.employeeId, mark: result.mark, reason: result.reason, status: result.status, sentTo: result.sentTo,
        ...(result.mark === 'times' ? {start: result.start, end: result.end} : {})}]);
    return result;
  }

  async function sharedRead(profile, grant, from, to, selectedSite, refresh, trim = false) {
    const scope = await siteIds(pool, profile);
    // trim: the roster's day read keeps only the chosen site (mis-trim.mjs); its copy is kept apart from the whole answer's.
    const key = JSON.stringify([scope === null ? null : [...scope].map(String).sort(), siteKey(selectedSite), from, to, ...(trim ? ['site only'] : [])]);
    const requestedAt = new Date();
    const db = await pool.connect();
    try {
      await db.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      const cached = (await db.query('SELECT report,fetched_at FROM hr_mis_attendance_cache WHERE cache_key=$1', [key])).rows[0];
      const fetchedAt = cached ? Date.parse(cached.fetched_at) : NaN;
      const fresh = Number.isFinite(fetchedAt) && requestedAt.getTime() - fetchedAt <= MIS_ATTENDANCE_CACHE_MS;
      // A refresh that waited behind another PC uses the snapshot that PC just refreshed.
      if (cached && (refresh ? fetchedAt >= requestedAt.getTime() : fresh)) return cached.report;
      // A stale HR snapshot may also be hiding behind Pulse-II's cache. Refresh both layers so newly saved old VLB,
      // ELB and LMV records appear without a special correction for that employee or date.
      const asked = performance.now();
      const whole = await read(grant, from, to, selectedSite, refresh || Boolean(cached));
      const answered = performance.now();
      const report = trim ? trimMisReport(whole, selectedSite, from, to) : whole;
      await db.query(`INSERT INTO hr_mis_attendance_cache(cache_key,report,fetched_by,fetched_at) VALUES($1,$2,$3,now())
        ON CONFLICT(cache_key) DO UPDATE SET report=EXCLUDED.report,fetched_by=EXCLUDED.fetched_by,fetched_at=now()`, [key, report, profile.actor]);
      // Where the time of a day's read went (28 Nov 2026), so it can be read on live: waiting for Pulse-II's answer, and
      // storing the copy. Only on the cut answer; it is not stored, so a copy served to a second PC carries none.
      return trim ? {...report, timing: {misMs: Math.round(answered - asked), storeMs: Math.round(performance.now() - answered)}} : report;
    } finally {
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      db.release();
    }
  }

  async function api(profile, grant, route, method, input, params) {
    if (route === 'mis' && method === 'GET') {
      const selectedSite = String(params.get('site') || '').trim();
      const report = selectedSite
        ? await sharedRead(profile, grant, params.get('from'), params.get('to'), selectedSite, params.get('refresh') === '1', params.get('trim') === '1')
        : await read(grant, params.get('from'), params.get('to'));
      const ids = [...new Set([...report.otDuties, ...report.attendanceEquipment].map(dutyKey))];
      const scope = await siteIds(pool, profile);
      const [{rows}, siteRows] = await Promise.all([
        ids.length ? pool.query('SELECT * FROM hr_mis_attendance_corrections WHERE duty_id=ANY($1::text[])', [ids]) : {rows: []},
        pool.query("SELECT name FROM hr_records WHERE kind='sites' AND status='ACTIVE' AND ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY name", [scope])
      ]);
      return {...report, corrections: rows.map(publicCorrection), sites: siteRows.rows.map(row => row.name), canEdit: true};
    }
    if (route === 'mis/days' && method === 'GET') return days(grant, params.get('from'), params.get('to'));
    if (route === 'mis/change' && method === 'POST') {
      const {site, date, shift, employeeId, mark, reason, start, end} = input || {};
      // mark times {start,end} / card-times: a present duty's times, set in Pulse-II with the same OTP (28 Nov 2026).
      const times = mark === 'times' ? {start: String(start || ''), end: String(end || '')} : {};
      return change(profile, grant, 'change', {site, date, shift, employeeId, mark, reason, ...times}, 'ASK_MIS_ATTENDANCE_CHANGE');
    }
    if (route === 'mis/change/verify' && method === 'POST') {
      const done = await change(profile, grant, 'change/verify', {id: input?.id, otp: input?.otp}, 'MIS_ATTENDANCE_CHANGED');
      // The next read of every site must come from Pulse-II, not from the 30 second copy.
      await pool.query('DELETE FROM hr_mis_attendance_cache').catch(() => {});
      return done;
    }
    if (route === 'mis/changes' && method === 'GET') {
      const {status, ok, result} = await mis(grant, '/api/integrations/hr/attendance/changes', {query: {from: params.get('from') || '', to: params.get('to') || ''}});
      if (status === 404 && !result?.error) return {changes: [], supported: false};
      if (!ok) fail(result?.error || 'Pulse-II could not list the changes.', status >= 500 ? 503 : status);
      return {changes: Array.isArray(result?.changes) ? result.changes : [], supported: true};
    }
    if (route === 'mis/correction' && method === 'POST') {
      // Owner, 27 Nov 2026: present / absent is decided in Pulse-II. 28 Nov 2026 ("Yes, send to MIS"): so are a present
      // duty's times. HR Pulse keeps no correction of its own any more; the old ones are shown, never applied.
      const status = String(input?.status || '');
      if (status === 'absent' || status === 'pending') fail('Absent is now marked in Pulse-II with an OTP (Mark absent). HR Pulse keeps no attendance of its own.');
      fail('Duty times are now set in Pulse-II with an OTP (Duty times). HR Pulse keeps no attendance of its own.');
    }
    fail('Not found', 404);
  }
  return api;
}
