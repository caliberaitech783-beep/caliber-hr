import {siteIds} from './scope.mjs';
import {trimMisReport, weekOf, dayOfWeekReport} from './mis-trim.mjs';
import {siteMatcher} from './site-match.mjs';

const ORIGIN = 'https://pulse-ll.cmll.in';
const FIRST_DATE = '2026-11-01';
const DAY = 86_400_000;
export const MIS_ATTENDANCE_CACHE_MS = 30_000;
export const DAYS_TIMEOUT_MS = 12_000;
// A site's week in one request (28 Nov 2026). Measured on live that day: nine days of every site took Pulse-II about
// 18 seconds; cut to one site it has less to send, but the first read of a week may still pass the 22 seconds a day is
// given, so a week is waited for longer.
export const WEEK_READ_TIMEOUT_MS = 45_000;
// One "Fetch again" reads a week once: its later days use the week that run already read, for at most this long.
export const WEEK_RUN_KEEP_MS = 10 * 60_000;
// After a week read failed, days are read one by one (as before) for this long, then weeks are tried again.
export const WEEK_RETRY_MS = 2 * 60_000;
const stamp = value => value instanceof Date ? value.getTime() : Date.parse(value);
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

function correctionInput(input) {
  const {date, site, siteKey: canonical, shift, employeeId, status, version, start = '', end = ''} = input;
  const safeText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
  if (![site, canonical || site, shift, employeeId].every(safeText) || !validDay(date) || date < FIRST_DATE ||
      !['mis', 'present', 'absent', 'pending'].includes(status) || !Number.isSafeInteger(version) || version < 0) {
    fail('Choose a valid attendance record and status.');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason || reason.length > 500) fail('Enter a correction reason up to 500 characters.');
  if (start !== '' || end !== '') {
    const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (status !== 'present' || typeof start !== 'string' || typeof end !== 'string' ||
        !clock.test(start) || !clock.test(end) || start === end) {
      fail('Enter both duty times in HH:MM with a duration under 24 hours.');
    }
  }
  return {date, site, siteKey: canonical || site, shift, employeeId, status, version, start, end, reason};
}

// A correction that said absent or pending was kept only in HR Pulse; it is shown, never applied (retired).
const RETIRED_STATUSES = ['absent', 'pending'];
function publicCorrection(row) {
  return {id: row.duty_id, status: row.status, retired: RETIRED_STATUSES.includes(row.status), start: row.start_time, end: row.end_time,
    reason: row.reason, version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at};
}

export function createMisAttendance(pool, {fetchMis = fetch} = {}) {
  // What Pulse-II's feed can do, learned from its own answers (supports: ['site-cut'], from its release after
  // 28 Nov 2026). Until an answer says so, nothing is asked that an older Pulse-II would answer with every site.
  let canCut = false, weekOffUntil = 0;
  const learn = answer => { if (Array.isArray(answer?.supports) && answer.supports.includes('site-cut')) canCut = true; };
  // The last weeks read, so the seven days of a week are not each read back from the database (a week is about 7 MB).
  const weeks = new Map();
  const remember = (key, fetchedAt, report) => {
    weeks.delete(key);
    weeks.set(key, {fetchedAt, report});
    while (weeks.size > 8) weeks.delete(weeks.keys().next().value);
  };

  // cut: ask Pulse-II for the chosen site only (its shared/hr-site-cut.mjs); it marks such an answer cut: 'site' and
  // says in misSiteDays which sites had lines on each date.
  async function read(grant, from, to, selectedSite = '', refresh = false, {cut = false, timeout = 22_000} = {}) {
    const ranges = reportRanges(from, to);
    const reports = await Promise.all(ranges.map(async ([start, end]) => {
      const url = new URL('/api/integrations/hr/attendance', ORIGIN);
      url.search = new URLSearchParams({from: dayString(start), to: dayString(end), ...(selectedSite ? {site: selectedSite} : {}), ...(cut ? {cut: 'site'} : {}), ...(refresh ? {refresh: '1'} : {})});
      let response;
      try {
        response = await fetchMis(url, {
          headers: {Authorization: 'Bearer ' + grant, Accept: 'application/json'},
          redirect: 'error', signal: AbortSignal.timeout(timeout)
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
    reports.forEach(learn);
    const answer = {...Object.fromEntries(sections.map(key => [key, reports.flatMap(report => report[key])])),
      days: listed('days'), hrChanges: listed('hrChanges'), signed: reports.every(report => Array.isArray(report.days))};
    if (!cut) return answer;
    // A Pulse-II that does not cut (taken back to an older release) answers with every site: the answer is still right,
    // only heavy, so no more cuts are asked until one of its answers offers them again.
    if (!reports.every(report => report.cut === 'site')) { canCut = false; return answer; }
    const misSiteDays = {};
    for (const report of reports) for (const [date, sites] of Object.entries(report.misSiteDays || {})) misSiteDays[date] = [...new Set([...(misSiteDays[date] || []), ...(Array.isArray(sites) ? sites : [])])];
    return {...answer, cut: 'site', misSiteDays};
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
  // site (28 Nov 2026): only that site's days are sent, by the names of every site Pulse-II lists (its signed days and
  // the days still open), so "Dudhichua OB East" is not also given the days of "Dudhichua OC" (site-match.mjs).
  async function days(grant, from, to, site = '') {
    if (!validDay(from) || !validDay(to) || from < FIRST_DATE || from > to || Date.parse(to) - Date.parse(from) > 30 * DAY) fail('Choose up to 31 days from 1 November 2026 onward.');
    // A short wait: the roster shows its saved days unchecked rather than keep the user waiting for this.
    const {status, ok, result} = await mis(grant, '/api/integrations/hr/attendance', {query: {from, to, only: 'days'}, timeout: DAYS_TIMEOUT_MS});
    if (status === 403) fail('MIS attendance is outside your assigned access.', 403);
    if (!ok || !result) fail('The MIS attendance feed is temporarily unavailable.', 503);
    learn(result);
    const supported = Array.isArray(result.days) && !Array.isArray(result.otDuties);
    const all = supported ? result.days : [];
    if (!site || !supported) return {supported, days: all};
    const isSite = siteMatcher(site, [...all, ...(Array.isArray(result.pendingDays) ? result.pendingDays : [])].map(day => day?.siteKey).filter(name => typeof name === 'string'));
    return {supported, days: all.filter(day => day && isSite(day.siteKey))};
  }
  // A change of attendance is made in Pulse-II, never kept here: ask (the OTP goes to RHR), then the OTP.
  async function change(profile, grant, path, input, action) {
    const {status, ok, result} = await mis(grant, '/api/integrations/hr/attendance/' + path, {method: 'POST', body: input, timeout: 30_000});
    if (status === 404 && !result?.error) fail('Pulse-II does not take attendance changes from HR Pulse yet. It will after its next release.', 503);
    if (!ok || !result) fail(result?.error || 'Pulse-II could not make this change.', status >= 500 || ok ? 503 : status);
    await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)", [profile.actor, action,
      {id: result.id, site: result.site, date: result.date, shift: result.shift, employeeId: result.employeeId, mark: result.mark, reason: result.reason, status: result.status, sentTo: result.sentTo}]);
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

  /* One day of one site out of that site's week (28 Nov 2026). Pulse-II took about 14 seconds for every single day
     asked, 28 times for a month; a week costs it little more than a day. The week is read once (cut to the site by
     Pulse-II), kept like every other copy for 30 seconds, and its days are handed out from it; the lines of a day are
     the same either way (checked on live, see mis-trim.mjs).
     run: the roster's name for one "Fetch again". Each of its days asks to be read afresh, and they do not all start
     before the week arrives, so a week read by the same run counts as fresh for that run. */
  async function weekDay(profile, grant, day, selectedSite, refresh, run) {
    const scope = await siteIds(pool, profile), week = weekOf(day, FIRST_DATE);
    const key = JSON.stringify([scope === null ? null : [...scope].map(String).sort(), siteKey(selectedSite), week.from, week.to, 'site week']);
    const requestedAt = Date.now();
    const db = await pool.connect();
    try {
      await db.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      const held = (await db.query("SELECT fetched_at,report->>'run' AS run FROM hr_mis_attendance_cache WHERE cache_key=$1", [key])).rows[0];
      const fetchedAt = held ? stamp(held.fetched_at) : NaN, age = requestedAt - fetchedAt;
      const usable = Number.isFinite(fetchedAt) && (refresh
        ? fetchedAt >= requestedAt || (Boolean(run) && held.run === run && age <= WEEK_RUN_KEEP_MS)
        : age <= MIS_ATTENDANCE_CACHE_MS);
      if (usable) {
        const kept = weeks.get(key);
        const report = kept?.fetchedAt === fetchedAt ? kept.report : (await db.query('SELECT report FROM hr_mis_attendance_cache WHERE cache_key=$1', [key])).rows[0]?.report;
        if (report) {
          remember(key, fetchedAt, report);
          return {...dayOfWeekReport(report, day), timing: {week: 'kept', misMs: 0, storeMs: 0}};
        }
      }
      const asked = performance.now();
      const whole = await read(grant, week.from, week.to, selectedSite, refresh || Boolean(held), {cut: true, timeout: WEEK_READ_TIMEOUT_MS});
      const answered = performance.now();
      const [[first, last]] = reportRanges(week.from, week.to);
      const report = {...trimMisReport(whole, selectedSite, dayString(first), dayString(last)), run: run || ''};
      const stored = (await db.query(`INSERT INTO hr_mis_attendance_cache(cache_key,report,fetched_by,fetched_at) VALUES($1,$2,$3,now())
        ON CONFLICT(cache_key) DO UPDATE SET report=EXCLUDED.report,fetched_by=EXCLUDED.fetched_by,fetched_at=now() RETURNING fetched_at`, [key, report, profile.actor])).rows[0];
      if (stored) remember(key, stamp(stored.fetched_at), report);
      return {...dayOfWeekReport(report, day), timing: {week: 'read', misMs: Math.round(answered - asked), storeMs: Math.round(performance.now() - answered)}};
    } finally {
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      db.release();
    }
  }

  async function api(profile, grant, route, method, input, params) {
    if (route === 'mis' && method === 'GET') {
      const selectedSite = String(params.get('site') || '').trim(), from = params.get('from'), to = params.get('to');
      const refresh = params.get('refresh') === '1', trim = params.get('trim') === '1';
      const run = /^[A-Za-z0-9_-]{8,64}$/.test(params.get('run') || '') ? params.get('run') : '';
      let report;
      // The roster's day read, once Pulse-II cuts its answer to a site: the day comes out of the site's week.
      if (selectedSite && trim && canCut && from === to && validDay(from) && from >= FIRST_DATE && Date.now() >= weekOffUntil) {
        try {
          report = await weekDay(profile, grant, from, selectedSite, refresh, run);
        } catch (error) {
          if (error?.status === 403) throw error;
          // The week could not be read (Pulse-II busy or slow): this day is read on its own, as before.
          weekOffUntil = Date.now() + WEEK_RETRY_MS;
        }
      }
      report ??= selectedSite
        ? await sharedRead(profile, grant, from, to, selectedSite, refresh, trim)
        : await read(grant, from, to);
      const ids = [...new Set([...report.otDuties, ...report.attendanceEquipment].map(dutyKey))];
      const scope = await siteIds(pool, profile);
      const [{rows}, siteRows] = await Promise.all([
        ids.length ? pool.query('SELECT * FROM hr_mis_attendance_corrections WHERE duty_id=ANY($1::text[])', [ids]) : {rows: []},
        pool.query("SELECT name FROM hr_records WHERE kind='sites' AND status='ACTIVE' AND ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY name", [scope])
      ]);
      return {...report, corrections: rows.map(publicCorrection), sites: siteRows.rows.map(row => row.name), canEdit: true};
    }
    if (route === 'mis/days' && method === 'GET') return days(grant, params.get('from'), params.get('to'), String(params.get('site') || '').trim());
    if (route === 'mis/change' && method === 'POST') {
      const {site, date, shift, employeeId, mark, reason} = input || {};
      return change(profile, grant, 'change', {site, date, shift, employeeId, mark, reason}, 'ASK_MIS_ATTENDANCE_CHANGE');
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
      const change = correctionInput(input);
      // Owner, 27 Nov 2026: present / absent is decided in Pulse-II. HR Pulse corrects only a present duty's times here.
      if (RETIRED_STATUSES.includes(change.status)) fail('Absent is now marked in Pulse-II with an OTP (Mark absent). HR Pulse keeps no attendance of its own.');
      const id = dutyKey(change);
      const report = await read(grant, change.date, change.date);
      const source = [...report.otDuties, ...report.attendanceEquipment].find(row => dutyKey(row) === id);
      if (!source) {
        fail('The duty could not be found in your assigned MIS attendance.', 404);
      }
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const values = [id, change.status, change.start, change.end, change.reason, profile.actor];
        const statement = change.version === 0
          ? `INSERT INTO hr_mis_attendance_corrections(duty_id,status,start_time,end_time,reason,updated_by)
             VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`
          : `UPDATE hr_mis_attendance_corrections SET status=$2,start_time=$3,end_time=$4,reason=$5,
             updated_by=$6,updated_at=now(),version=version+1 WHERE duty_id=$1 AND version=$7 RETURNING *`;
        const row = (await db.query(statement, change.version === 0 ? values : [...values, change.version])).rows[0];
        if (!row) fail('Another HR user updated this duty. Refresh and try again.', 409);
        await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)", [
          profile.actor, 'CORRECT_MIS_ATTENDANCE', {...change, site: source.site, dutyId: id, version: row.version}
        ]);
        await db.query('COMMIT');
        return publicCorrection(row);
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    }
    fail('Not found', 404);
  }
  return api;
}
