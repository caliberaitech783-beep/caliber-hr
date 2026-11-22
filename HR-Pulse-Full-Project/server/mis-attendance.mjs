import {siteIds} from './scope.mjs';

const ORIGIN = 'https://pulse-ll.cmll.in';
const FIRST_DATE = '2026-11-01';
const DAY = 86_400_000;
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

function publicCorrection(row) {
  return {id: row.duty_id, status: row.status, start: row.start_time, end: row.end_time,
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
    return Object.fromEntries(sections.map(key => [key, reports.flatMap(report => report[key])]));
  }

  async function sharedRead(profile, grant, from, to, selectedSite, refresh) {
    const scope = await siteIds(pool, profile);
    const key = JSON.stringify([scope === null ? null : [...scope].map(String).sort(), siteKey(selectedSite), from, to]);
    const requestedAt = new Date();
    const db = await pool.connect();
    try {
      await db.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      const cached = (await db.query('SELECT report,fetched_at FROM hr_mis_attendance_cache WHERE cache_key=$1', [key])).rows[0];
      // A refresh that waited behind another PC uses the snapshot that PC just refreshed.
      if (cached && (!refresh || new Date(cached.fetched_at) >= requestedAt)) return cached.report;
      const report = await read(grant, from, to, selectedSite, refresh);
      await db.query(`INSERT INTO hr_mis_attendance_cache(cache_key,report,fetched_by,fetched_at) VALUES($1,$2,$3,now())
        ON CONFLICT(cache_key) DO UPDATE SET report=EXCLUDED.report,fetched_by=EXCLUDED.fetched_by,fetched_at=now()`, [key, report, profile.actor]);
      return report;
    } finally {
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => {});
      db.release();
    }
  }

  async function api(profile, grant, route, method, input, params) {
    if (route === 'mis' && method === 'GET') {
      const selectedSite = String(params.get('site') || '').trim();
      const report = selectedSite
        ? await sharedRead(profile, grant, params.get('from'), params.get('to'), selectedSite, params.get('refresh') === '1')
        : await read(grant, params.get('from'), params.get('to'));
      const ids = [...new Set([...report.otDuties, ...report.attendanceEquipment].map(dutyKey))];
      const scope = await siteIds(pool, profile);
      const [{rows}, siteRows] = await Promise.all([
        ids.length ? pool.query('SELECT * FROM hr_mis_attendance_corrections WHERE duty_id=ANY($1::text[])', [ids]) : {rows: []},
        pool.query("SELECT name FROM hr_records WHERE kind='sites' AND status='ACTIVE' AND ($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY name", [scope])
      ]);
      return {...report, corrections: rows.map(publicCorrection), sites: siteRows.rows.map(row => row.name), canEdit: true};
    }
    if (route === 'mis/correction' && method === 'POST') {
      const change = correctionInput(input);
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
