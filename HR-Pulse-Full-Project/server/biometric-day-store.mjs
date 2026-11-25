/* Saved biometric logs for the attendance roster (owner, 23 Nov 2026: "save button to save the bio-matric logs").
   "Save biometric" on Attendance roster › Biometric stores each day of a site's biometric roster (every punch on the
   site's machines, rated with the attendance policy) in hr_biometric_days, so the Biometric tab opens saved days at
   once next time and reads the machines' punches only for days not saved (and always for today).
   The server builds the saved copy itself from the punches in HR (loadSiteRegister); the browser only names the day,
   so a saved day cannot be edited from the browser.
   GET  attendance/biometric-days?site=&from=&to=  → {days:[{day,register,punches,people,savedBy,savedAt}]}
   POST attendance/biometric-days {site,day}       → {day,punches,people,savedBy,savedAt}  (one day per request) */
import {siteAccessMessage} from './scope.mjs';

export const MAX_BIO_DAYS = 31;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const validDay = value => typeof value === 'string' && DAY.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** load(site,from,to): the site register for those days (loadSiteRegister); sites: the login's site ids (null = all). today: India date. */
export function createBiometricDayStore(pool, {load, today, manual=false, siteKey=value=>String(value||'').trim().toLowerCase()}) {
  const table=manual?'hr_manual_biometric_days':'hr_biometric_days',label=manual?'manual biometric':'biometric';
  const conflict=manual?'DO UPDATE SET site=EXCLUDED.site':`DO UPDATE SET register=EXCLUDED.register,punches=EXCLUDED.punches,people=EXCLUDED.people,
          saved_by=EXCLUDED.saved_by,saved_at=now()`;
  async function findSite(name, sites, profile) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) fail('Choose a site.');
    let site = (await pool.query("SELECT id,name,data->>'siteType' AS site_type FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($1),'[[:space:]]+',' ','g')) AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) LIMIT 1", [name, sites])).rows[0];
    if (!site) {
      const allowed=(await pool.query("SELECT id,name,data->>'siteType' AS site_type FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND ($1::uuid[] IS NULL OR id=ANY($1::uuid[]))",[sites])).rows;
      site=allowed.find(row=>siteKey(row.name)===siteKey(name));
    }
    if (!site) fail(siteAccessMessage(profile), 403);
    return {id: site.id, name: site.name, siteType: site.site_type || ''};
  }
  return async function biometricDays(profile, method, input, params, sites) {
    if (method === 'GET') {
      const from = params.get('from'), to = params.get('to');
      if (!validDay(from) || !validDay(to) || to < from) fail('Choose a valid date range.');
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > MAX_BIO_DAYS) fail(`Choose up to ${MAX_BIO_DAYS} days.`);
      const site = await findSite(params.get('site'), sites, profile);
      const {rows} = await pool.query(`SELECT to_char(day,'YYYY-MM-DD') AS day,register,punches,people,saved_by,saved_at FROM ${table}
        WHERE site=$1 AND day BETWEEN $2::date AND $3::date ORDER BY day`, [site.name, from, to]);
      return {site: site.name, days: rows.map(r => ({day: r.day, register: r.register, punches: r.punches, people: r.people, savedBy: r.saved_by, savedAt: r.saved_at}))};
    }
    if (method === 'POST') {
      const day = input?.day;
      if (!validDay(day)) fail('Choose a valid day.');
      if (day >= today()) fail(`Today is still running; ${label} logs can be saved from yesterday back.`);
      const site = await findSite(input?.site, sites, profile);
      const register = await load(site, day, day);
      const machines = Array.isArray(register?.machines) ? register.machines : [], people = Array.isArray(register?.rows) ? register.rows.length : 0;
      const punches = machines.reduce((n, m) => n + (Number(m.punches) || 0), 0);
      const saved = (await pool.query(`INSERT INTO ${table}(site,day,register,punches,people,saved_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(site,day) ${conflict}
        RETURNING to_char(day,'YYYY-MM-DD') AS day,punches,people,saved_by,saved_at`, [site.name, day, JSON.stringify(register), punches, people, profile.actor])).rows[0];
      await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)", [profile.actor, manual?'SAVE_MANUAL_BIOMETRIC_DAY':'SAVE_BIOMETRIC_DAY', {site: site.name, day, punches, people}]);
      return {day: saved.day, punches: saved.punches, people: saved.people, savedBy: saved.saved_by, savedAt: saved.saved_at};
    }
    if (method === 'DELETE' && manual) {
      const requested = Array.isArray(input?.days) ? input.days : [input?.day];
      const days = [...new Set(requested)];
      if (!days.length || days.length > MAX_BIO_DAYS || days.some(day => !validDay(day))) fail('Choose valid saved log dates.');
      const site = await findSite(input?.site, sites, profile);
      const result = (await pool.query(`WITH removed_days AS (
          DELETE FROM hr_manual_biometric_days WHERE site=$1 AND day=ANY($2::date[]) RETURNING day
        ), removed_punches AS (
          DELETE FROM hr_manual_biometric_punches p USING hr_attendance_devices d
          WHERE p.device_serial=d.serial AND d.site_id=$3 AND p.punched_at::date=ANY($2::date[]) RETURNING p.device_serial
        ) SELECT (SELECT count(*)::int FROM removed_days) AS logs,(SELECT count(*)::int FROM removed_punches) AS punches`, [site.name, days, site.id])).rows[0];
      await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)", [profile.actor, 'DELETE_MANUAL_BIOMETRIC_LOGS', {site: site.name, days, logs: Number(result?.logs)||0, punches: Number(result?.punches)||0}]);
      return {deleted: Number(result?.logs)||0, punches: Number(result?.punches)||0, days};
    }
    fail('Not found', 404);
  };
}
