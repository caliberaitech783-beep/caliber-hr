/* Saved trip cards for the attendance roster (owner, 22 Nov 2026).
   "Save trip cards" on Attendance roster › Trip card stores the MIS trip cards (VLB, ELB, LMV) of a site, one row per
   day (hr_trip_card_days), so the roster opens them at once next time and reads MIS only for days not saved.
   GET  attendance/trip-cards?site=&from=&to=  → {days:[{day,rows,duties,savedBy,savedAt}]}
   POST attendance/trip-cards {site,day,rows}  → {day,duties,savedBy,savedAt}  (one day per request, under 2 MB) */
import {siteNameMatch, exactNameFirst, siteNameKeys} from './site-display-names.mjs';
import {siteAccessMessage,siteIds} from './scope.mjs';

export const MAX_TRIP_ROWS = 5000, MAX_TRIP_DAYS = 31;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const validDay = value => typeof value === 'string' && DAY.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const text = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';
const texts = (value, max = 20) => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, max).map(v => v.slice(0, 120)) : [];
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const STATUS = new Set(['Present', 'Present · 0 trips', 'Absent', 'Pending']);

/** One duty as the roster uses it (misAttendanceModel AttendanceRow); anything else in the input is dropped. */
export function tripDuty(row, day) {
  if (!row || typeof row !== 'object' || row.date !== day) fail('Each saved trip card must belong to the day being saved.');
  const window = row.window && typeof row.window === 'object' && number(row.window.startMs) !== null && number(row.window.endMs) !== null
    ? {start: text(row.window.start, 20), end: text(row.window.end, 20), startMs: row.window.startMs, endMs: row.window.endMs} : undefined;
  return {
    id: text(row.id, 300), date: day, site: text(row.site), siteKey: text(row.siteKey), shift: text(row.shift, 20),
    employeeId: text(row.employeeId, 60), employeeKey: text(row.employeeKey, 120), employeeName: text(row.employeeName), caliberCode: text(row.caliberCode, 60),
    designation: text(row.designation), sources: texts(row.sources), equipment: texts(row.equipment, 40), references: text(row.references, 300),
    note: text(row.note, 500), output: text(row.output, 60), ...(window ? {window} : {}),
    status: STATUS.has(row.status) ? row.status : 'Pending', verification: text(row.verification), verified: row.verified === true,
    otHours: number(row.otHours), otNote: text(row.otNote)
  };
}

async function checkSite(db, profile, site) {
  if (typeof site !== 'string' || !site.trim() || site.length > 200) fail('Choose a site.');
  const scope = await siteIds(db, profile);
  const found = (await db.query("SELECT 1 FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND "+siteNameMatch('$1','$3')+" AND ($2::uuid[] IS NULL OR id=ANY($2)) " + exactNameFirst('$1') + " LIMIT 1", [site, scope, siteNameKeys(site)])).rowCount;
  if (!found) fail(siteAccessMessage(profile), 403);
}

export function createTripCardStore(pool) {
  return async function tripCards(profile, method, input, params) {
    if (method === 'GET') {
      const site = params.get('site'), from = params.get('from'), to = params.get('to');
      if (!validDay(from) || !validDay(to) || to < from) fail('Choose a valid date range.');
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_TRIP_DAYS) fail(`Choose up to ${MAX_TRIP_DAYS} days.`);
      await checkSite(pool, profile, site);
      const {rows} = await pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day,rows,duties,saved_by,saved_at FROM hr_trip_card_days
        WHERE site=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day`, [site, from, to]);
      return {site, days: rows.map(r => ({day: r.day, rows: r.rows, duties: r.duties, savedBy: r.saved_by, savedAt: r.saved_at}))};
    }
    if (method === 'POST') {
      const {site, day} = input || {};
      if (!validDay(day)) fail('Choose a valid day.');
      if (!Array.isArray(input.rows) || input.rows.length > MAX_TRIP_ROWS) fail(`Send up to ${MAX_TRIP_ROWS} trip cards for a day.`);
      await checkSite(pool, profile, site);
      const rows = input.rows.map(row => tripDuty(row, day));
      const saved = (await pool.query(`INSERT INTO hr_trip_card_days(site,day,rows,duties,saved_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(site,day) DO UPDATE SET rows=EXCLUDED.rows,duties=EXCLUDED.duties,saved_by=EXCLUDED.saved_by,saved_at=now()
        RETURNING to_char(day,'YYYY-MM-DD') AS day,duties,saved_by,saved_at`, [site, day, JSON.stringify(rows), rows.length, profile.actor])).rows[0];
      await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIP_CARDS','attendance',NULL,$2)", [profile.actor, {site, day, duties: rows.length}]);
      return {day: saved.day, duties: saved.duties, savedBy: saved.saved_by, savedAt: saved.saved_at};
    }
    fail('Not found', 404);
  };
}
