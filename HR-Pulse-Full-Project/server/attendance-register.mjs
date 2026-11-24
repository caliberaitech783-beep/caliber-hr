/* Attendance register: the server-side day calculation.
   Biometric punches of linked employees are grouped into duty days by their
   shift, then each day is rated with the attendance HR policy
   (attendance-policy.mjs). Holidays, approved leave / OD and completed gate
   passes are added from the HR records. */
import {DEFAULT_POLICY, validatePolicy, clockMinutes, evaluateDay, isExempt, summarizeMonth} from './attendance-policy.mjs';

const DAY_MS = 86_400_000;
// Punches from 2 h before shift start until the same time next day belong to that duty.
const EARLY_WINDOW = 120;
// Punches this close together count as one (a double press).
const DOUBLE_PRESS = 5;

const dayNumber = date => Date.parse(date + 'T00:00:00Z') / DAY_MS;
const dateOf = number => new Date(number * DAY_MS).toISOString().slice(0, 10);
const stampMinutes = stamp => {   // "YYYY-MM-DD HH:MM" → minutes since 1970-01-01 00:00 (clock time)
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(stamp || ''));
  return match ? dayNumber(match[1]) * 1440 + Number(match[2]) * 60 + Number(match[3]) : null;
};
const indiaStamp = iso => {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '';
};
const clock = minutes => minutes == null ? '' :
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${minutes >= 1440 ? ' (+1)' : ''}`;
const between = (date, from, to) => !!from && from <= date && date <= (to || from);
// A leave whose type is named "Comp Off" / "Compensatory Off" or coded CO shows as CO in the register.
export const isCompOff = type => /\bcomp(ensatory)?[\s-]*off\b|^\s*c\.?o\.?(\s|$)/i.test(String(type || ''));
const daysInMonth = date => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();

/** Gate pass minutes from its actual gate out / back in times, else the planned times. */
export function gatePassMinutes(pass) {
  const steps = Array.isArray(pass.history) ? pass.history : [];
  const approvedAt = stage => [...steps].reverse().find(step => Number(step?.stage) === stage && step?.decision === 'APPROVED')?.at;
  const out = stampMinutes(indiaStamp(approvedAt(2))), back = stampMinutes(indiaStamp(approvedAt(3)));
  if (out != null && back != null && back > out) return back - out;
  const planned = clockMinutes(pass.outTime), expected = clockMinutes(pass.returnTime);
  return planned != null && expected != null && expected > planned ? expected - planned : 0;
}

/**
 * Pure register builder. Inputs are plain rows (see loadRegister):
 * employees {id,code,name,siteId,site,siteCode,siteType,department,shift,starts,ends,designation,dailyWage,monthlyPay}
 * punches {employeeId, at:'YYYY-MM-DD HH:MM'} · holidays {date,siteId,name}
 * leaves {employeeId,from,to,compOff} (compOff: a leave of a comp off leave type, shown as CO)
 * ods {employeeId,from,to} · gatePasses {employeeId,date,minutes}
 */
export function buildRegister({from, to, today, policy = DEFAULT_POLICY, employees = [], punches = [], holidays = [], leaves = [], ods = [], gatePasses = []}) {
  const first = dayNumber(from), last = dayNumber(to), now = today ? dayNumber(today) : Infinity;
  const byEmployee = new Map();
  for (const punch of punches) {
    const minute = stampMinutes(punch.at);
    if (minute == null) continue;
    byEmployee.set(punch.employeeId, [...(byEmployee.get(punch.employeeId) || []), {minute, where: punch.where || ''}]);
  }
  const passMinutes = new Map();
  for (const pass of gatePasses) {
    const key = pass.employeeId + '|' + pass.date;
    passMinutes.set(key, (passMinutes.get(key) || 0) + (pass.minutes || 0));
  }
  const rows = employees.map(employee => {
    const starts = clockMinutes(employee.starts), rawEnd = clockMinutes(employee.ends);
    const ends = starts != null && rawEnd != null ? (rawEnd <= starts ? rawEnd + 1440 : rawEnd) : null;
    const anchor = starts == null ? 0 : starts - EARLY_WINDOW;
    const duties = new Map(), places = new Map();
    for (const {minute, where} of (byEmployee.get(employee.id) || []).sort((a, b) => a.minute - b.minute)) {
      const duty = Math.floor((minute - anchor) / 1440);
      if (duty < first || duty > last) continue;
      duties.set(duty, [...(duties.get(duty) || []), minute - duty * 1440]);
      if (where) places.set(duty, [...(places.get(duty) || []), clock(minute - duty * 1440) + ' ' + where]);
    }
    const exempt = isExempt(employee.designation, policy);
    const holidayFor = date => holidays.find(h => h.date === date && (!h.siteId || [employee.siteId, employee.siteCode, employee.site].includes(h.siteId)));
    const days = [];
    for (let number = first; number <= last && number <= now; number++) {
      const date = dateOf(number), times = duties.get(number) || [];
      const inMinute = times.length ? times[0] : null;
      const outMinute = times.length && times[times.length - 1] - times[0] > DOUBLE_PRESS ? times[times.length - 1] : null;
      const gate = passMinutes.get(employee.id + '|' + date) || 0;
      const wage = employee.dailyWage > 0 ? employee.dailyWage : employee.monthlyPay > 0 ? employee.monthlyPay / daysInMonth(date) : 0;
      const result = evaluateDay({inMinute, outMinute, shiftStart: starts, shiftEnd: ends, designation: employee.designation,
        gatePassMinutes: gate, dailyWage: wage}, policy);
      const holiday = holidayFor(date);
      const leave = leaves.find(l => l.employeeId === employee.id && between(date, l.from, l.to));
      const onLeave = !!leave, leaveCode = leave?.compOff ? 'CO' : 'L';
      const onDuty = ods.some(o => o.employeeId === employee.id && between(date, o.from, o.to));
      let status = result.status, note = '';
      const weeklyOff = employee.siteType === 'Office' && new Date(number * DAY_MS).getUTCDay() === 0;
      // The HR calendar for the day (whatever the punches say): the roster's trip card line shows it too.
      const calendar = holiday ? 'H' : onLeave ? leaveCode : onDuty ? 'OD' : weeklyOff ? 'WO' : '';
      if (!times.length) {
        status = holiday ? 'H' : onLeave ? leaveCode : onDuty ? 'OD' : weeklyOff ? 'WO' : exempt ? 'P' : 'A';
        if (holiday) note = holiday.name || 'Holiday';
      } else if (status !== 'P' && (onLeave || onDuty)) {
        status = onDuty ? 'OD' : leaveCode;
      } else if (holiday) note = `Worked on ${holiday.name || 'holiday'}`;
      if (status === 'MP' && number === now) {
        status = 'IN';
        note = 'On duty — no Out punch yet';
      }
      if (status === 'MP') note = 'Only one punch — regularize the missing punch';
      const counts = ['P', 'HD', 'A', 'MP'].includes(status);
      days.push({
        date, status, calendar, note, in: clock(inMinute), out: clock(outMinute), workedMinutes: counts ? result.workedMinutes : null,
        late: counts && result.late, early: counts && result.early, missPunch: status === 'MP',
        gatePassMinutes: gate, gatePassDeduction: result.gatePassDeduction, exempt,
        // Site roster: every punch of the day with the machine it came from ("05:52 Main gate").
        ...(places.has(number) ? {punches: places.get(number)} : {})
      });
    }
    const months = {};
    for (const month of [...new Set(days.map(day => day.date.slice(0, 7)))]) {
      months[month] = summarizeMonth(days.filter(day => day.date.startsWith(month)), policy);
    }
    const total = Object.values(months).reduce((sum, month) => {
      for (const [key, value] of Object.entries(month)) sum[key] = Math.round(((sum[key] || 0) + value) * 100) / 100;
      return sum;
    }, {});
    for (const status of ['H', 'L', 'CO', 'OD', 'WO', 'IN']) total[status] = days.filter(day => day.status === status).length;
    return {
      id: employee.id, code: employee.code, name: employee.name, siteId: employee.siteId || '', site: employee.site || '',
      siteType: employee.siteType || '', department: employee.department || '', shift: employee.shift || '', designation: employee.designation || '', exempt,
      shiftStart: clock(starts), shiftEnd: clock(ends), days, months, summary: total
    };
  });
  return {from, to, policy, rows};
}

/* ---------- database ---------- */

export async function readPolicy(db) {
  const row = (await db.query('SELECT settings,version,updated_by,updated_at FROM hr_attendance_policy WHERE id')).rows[0];
  let policy;
  try { policy = validatePolicy(row?.settings || {}); } catch { policy = validatePolicy({}); }
  return {policy, version: row?.version || 0, updatedBy: row?.updated_by || '', updatedAt: row?.updated_at || null};
}

export async function savePolicy(db, actor, input) {
  const policy = validatePolicy(input.policy || {});
  const version = Number(input.version ?? -1);
  const row = (await db.query(version === 0
    ? 'INSERT INTO hr_attendance_policy(id,settings,updated_by) VALUES(true,$1,$2) ON CONFLICT DO NOTHING RETURNING version,updated_by,updated_at'
    : 'UPDATE hr_attendance_policy SET settings=$1,updated_by=$2,updated_at=now(),version=version+1 WHERE id AND version=$3 RETURNING version,updated_by,updated_at',
  version === 0 ? [policy, actor] : [policy, actor, version])).rows[0];
  if (!row) throw Object.assign(new Error('Another HR user changed the policy. Refresh and try again.'), {status: 409});
  await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'UPDATE_ATTENDANCE_POLICY','attendance',NULL,$2)", [actor, {policy, version: row.version}]);
  return {policy, version: row.version, updatedBy: row.updated_by, updatedAt: row.updated_at};
}

/**
 * sites: the employees' HR sites (null = all). options.devices: read only punches from these machines (the site roster),
 * options.employeeIds: these linked employees instead of the employees of `sites`. With devices, every punch carries the
 * machine it came from (day.punches).
 */
export async function loadRegister(db, sites, from, to, today, options = {}) {
  const {devices = null, employeeIds = null, manual = false} = options;
  const punchTable=manual?'hr_manual_biometric_punches':'hr_attendance_punches';
  const {policy} = await readPolicy(db);
  const employeeQuery=manual?`
   SELECT e.id,e.data->>'employeeId' AS code,e.name,e.site_id,e.site_code,e.site_name AS site,'' AS site_type,
    '' AS shift,NULL AS starts,NULL AS ends,coalesce(e.data->>'designation','') AS designation,
    coalesce(e.data->>'department','') AS department,'0' AS daily_wage
   FROM hr_employee_master_register e
   WHERE e.id=ANY($1::uuid[])
   ORDER BY e.name,e.data->>'employeeId'`:`
   SELECT DISTINCT e.id,e.code,e.name,e.data->>'siteId' AS site_id,site.code AS site_code,site.name AS site,site.data->>'siteType' AS site_type,
    sh.name AS shift,sh.data->>'startTime' AS starts,sh.data->>'endTime' AS ends,
    coalesce(nullif(des.name,''),e.data->>'designation',e.data#>>'{fields,Designation}',e.data#>>'{officeData,Designation}','') AS designation,
    coalesce(nullif(dep.name,''),e.data->>'department',e.data#>>'{fields,Department}',e.data#>>'{officeData,Department}',e.data#>>'{officeData,Department *}','') AS department,
    e.data->>'dailyWage' AS daily_wage
   FROM hr_attendance_links l
   JOIN hr_records e ON e.id=l.employee_id AND e.kind='employees'
   LEFT JOIN hr_records site ON site.id::text=e.data->>'siteId' AND site.kind='sites'
   LEFT JOIN hr_records sh ON sh.id::text=e.data->>'shiftId' AND sh.kind='shifts'
   LEFT JOIN hr_records dep ON dep.id::text=e.data->>'departmentId' AND dep.kind='departments'
   LEFT JOIN hr_records des ON des.id::text=e.data->>'designationId' AND des.kind='designations'
   WHERE CASE WHEN $2::uuid[] IS NULL THEN ($1::text[] IS NULL OR e.data->>'siteId'=ANY($1)) ELSE e.id=ANY($2::uuid[]) END
   ORDER BY e.name,e.code`;
  const employees = (await db.query(employeeQuery, manual?[employeeIds]:[employeeIds ? null : sites, employeeIds])).rows;
  const ids = employees.map(e => e.id);
  if (!ids.length) return buildRegister({from, to, today, policy});
  const [punches, holidays, leaves, ods, passes, pay] = await Promise.all([
    db.query(manual?`SELECT e.id AS employee_id,to_char(p.punched_at,'YYYY-MM-DD HH24:MI') AS at,
      coalesce(nullif(d.location,''),nullif(d.name,''),p.device_serial) AS place FROM ${punchTable} p
     JOIN hr_employee_master_register e ON upper(btrim(e.data->>'employeeId'))=
       upper(CASE WHEN btrim(p.biometric_id)~'^[0-9]+$' THEN 'CMLL'||btrim(p.biometric_id) ELSE btrim(p.biometric_id) END)
     LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
     WHERE e.id=ANY($1::uuid[]) AND p.punched_at>=$2::date-1 AND p.punched_at<$3::date+2
      AND ($4::text[] IS NULL OR p.device_serial=ANY($4::text[]))`:`SELECT l.employee_id,to_char(p.punched_at,'YYYY-MM-DD HH24:MI') AS at,
      coalesce(nullif(d.location,''),nullif(d.name,''),p.device_serial) AS place FROM ${punchTable} p
     JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
     LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
     WHERE l.employee_id=ANY($1::uuid[]) AND p.punched_at>=$2::date-1 AND p.punched_at<$3::date+2
      AND ($4::text[] IS NULL OR p.device_serial=ANY($4::text[]))`, [ids, from, to, devices]),
    db.query(`SELECT name,data->>'date' AS date,coalesce(data->>'siteId','') AS site_id FROM hr_records
     WHERE kind='holidays' AND status IN ('ACTIVE','APPROVED') AND data->>'date' BETWEEN $1 AND $2`, [from, to]),
    db.query(`SELECT r.data->>'employeeId' AS employee_id,r.data->>'fromDate' AS from_date,coalesce(nullif(r.data->>'toDate',''),r.data->>'fromDate') AS to_date,
      concat_ws(' ',t.code,t.name) AS leave_type FROM hr_records r
     LEFT JOIN hr_records t ON t.id::text=r.data->>'leaveTypeId' AND t.kind='leaveTypes'
     WHERE r.kind='leaveRequests' AND r.status='APPROVED' AND r.data->>'employeeId'=ANY($1::text[]) AND r.data->>'fromDate'<=$3 AND coalesce(nullif(r.data->>'toDate',''),r.data->>'fromDate')>=$2`, [ids, from, to]),
    db.query(`SELECT data->>'employeeId' AS employee_id,data->>'outDutyDate' AS from_date,coalesce(nullif(data->>'toDate',''),data->>'outDutyDate') AS to_date FROM hr_records
     WHERE kind='outDutyRequests' AND status='APPROVED' AND data->>'employeeId'=ANY($1::text[]) AND data->>'outDutyDate'<=$3 AND coalesce(nullif(data->>'toDate',''),data->>'outDutyDate')>=$2`, [ids, from, to]),
    db.query(`SELECT r.data->>'employeeId' AS employee_id,r.data->>'passDate' AS date,r.data->>'outTime' AS out_time,r.data->>'returnTime' AS return_time,a.history
     FROM hr_records r LEFT JOIN LATERAL (SELECT history FROM hr_approvals WHERE record_id=r.id ORDER BY created_at DESC LIMIT 1) a ON true
     WHERE r.kind='gatePasses' AND r.status='APPROVED' AND r.data->>'employeeId'=ANY($1::text[]) AND r.data->>'passDate' BETWEEN $2 AND $3`, [ids, from, to]),
    db.query(`SELECT DISTINCT ON (employee_id) employee_id,amounts FROM hr_salary_structure
     WHERE employee_id=ANY($1::uuid[]) AND month<=$2 ORDER BY employee_id,month DESC`, [ids, to.slice(0, 7)])
  ]);
  const monthly = new Map(pay.rows.map(row => [String(row.employee_id),
    ['basic', 'hra', 'fixedAllowance'].reduce((sum, key) => sum + (Number(row.amounts?.[key]) || 0), 0)]));
  return buildRegister({
    from, to, today, policy,
    employees: employees.map(e => ({id: String(e.id), code: e.code, name: e.name, siteId: e.site_id || '', siteCode: e.site_code || '',
      site: e.site || '', siteType: e.site_type || '', department: e.department || '', shift: e.shift || '', starts: e.starts, ends: e.ends, designation: e.designation || '',
      dailyWage: Number(e.daily_wage) || 0, monthlyPay: monthly.get(String(e.id)) || 0})),
    punches: punches.rows.map(p => ({employeeId: String(p.employee_id), at: p.at, where: devices ? p.place : ''})),
    holidays: holidays.rows.map(h => ({date: h.date, siteId: h.site_id, name: h.name})),
    leaves: leaves.rows.map(l => ({employeeId: l.employee_id, from: l.from_date, to: l.to_date, compOff: isCompOff(l.leave_type)})),
    ods: ods.rows.map(o => ({employeeId: o.employee_id, from: o.from_date, to: o.to_date})),
    gatePasses: passes.rows.map(p => ({employeeId: p.employee_id, date: p.date,
      minutes: gatePassMinutes({history: p.history, outTime: p.out_time, returnTime: p.return_time})}))
  });
}

/**
 * Attendance roster › Biometric for one site (owner, 22 Nov 2026): everyone who punched on that site's machines in these
 * dates, whatever site their HR record shows, with In / Out from those machines and every punch with its machine.
 * Machine IDs not linked to an employee are listed too (linked: false), rated on calendar days.
 * site {id,name,siteType}. Returns the register plus the site's machines (status, last punch, punches in these dates).
 */
export async function loadSiteRegister(db, site, from, to, today, options = {}) {
  const manual=options.manual===true,punchTable=manual?'hr_manual_biometric_punches':'hr_attendance_punches';
  const {rows: machines} = await db.query(`SELECT d.serial,d.name,d.location,d.ip_address,d.last_contact,coalesce(d.last_contact>now()-interval '2 minutes',false) AS online,
    coalesce(max(b.name),CASE WHEN d.bridge_id IS NULL AND (d.last_contact IS NOT NULL OR d.last_seen IS NOT NULL) THEN 'Main bridge PC' ELSE '' END) AS bridge_name,
    (SELECT to_char(max(p.punched_at),'YYYY-MM-DD HH24:MI') FROM ${punchTable} p WHERE p.device_serial=d.serial AND p.punched_at<$3::date+2) AS last_punch,
    (SELECT count(*) FROM ${punchTable} p WHERE p.device_serial=d.serial AND p.punched_at>=$2::date AND p.punched_at<$3::date+1)::int AS punches
   FROM hr_attendance_devices d LEFT JOIN hr_attendance_bridges b ON b.id=d.bridge_id AND b.removed_at IS NULL
   WHERE d.site_id=$1 GROUP BY d.serial ORDER BY d.location,d.name,d.serial`, [site.id, from, to]);
  // Owner, 23 Nov 2026 ("signal timed out" on Attendance roster › Biometric): this runs once for every day asked and used
  // to join every punch of the 33 days around it to find each machine's last punch. The last punch and the day's count
  // are now read per machine through the machine + time index (attendance-schema.sql): a day reads only its own punches.
  const machineList = machines.map(m => ({serial: m.serial, name: m.name || '', location: m.location || '', ipAddress: m.ip_address || '', bridgeName: m.bridge_name || '', online: Boolean(m.online),
    lastContact: m.last_contact || null, lastPunch: m.last_punch || '', punches: Number(m.punches) || 0}));
  const {policy} = await readPolicy(db);
  if (!machines.length) return {from, to, policy, site: site.name, machines: machineList, rows: []};
  const serials = machines.map(m => m.serial);
  const place = new Map(machineList.map(m => [m.serial, m.location || m.name || m.serial]));
  const codeEmployee=manual?`LEFT JOIN LATERAL (SELECT e.id FROM hr_employee_master_register e
    WHERE upper(btrim(e.data->>'employeeId'))=upper(CASE WHEN btrim(p.biometric_id)~'^[0-9]+$' THEN 'CMLL'||btrim(p.biometric_id) ELSE btrim(p.biometric_id) END)
    LIMIT 1) code_employee ON true`:'';
  const employeeId=manual?'code_employee.id':'l.employee_id';
  const {rows: ids} = await db.query(`SELECT p.device_serial,p.biometric_id,${employeeId} AS employee_id,coalesce(u.name,'') AS machine_name
   FROM ${punchTable} p
   LEFT JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
   LEFT JOIN hr_attendance_device_users u ON u.device_serial=p.device_serial AND u.biometric_id=p.biometric_id
   ${codeEmployee}
   WHERE p.device_serial=ANY($1::text[]) AND p.punched_at>=$2::date-1 AND p.punched_at<$3::date+2
   GROUP BY 1,2,3,4`, [serials, from, to]);
  const used = new Map();
  for (const r of ids) {
    const key = r.employee_id ? String(r.employee_id) : `u:${r.device_serial}|${r.biometric_id}`;
    used.set(key, [...(used.get(key) || []), manual?r.device_serial:`${place.get(r.device_serial)} · ${r.biometric_id}`]);
  }
  const linkedIds = [...new Set(ids.filter(r => r.employee_id).map(r => String(r.employee_id)))];
  const linked = linkedIds.length ? (await loadRegister(db, null, from, to, today, {devices: serials, employeeIds: linkedIds, manual})).rows : [];
  const unlinked = ids.filter(r => !r.employee_id);
  const unlinkedKeys=new Set(unlinked.map(r=>`${r.device_serial}|${r.biometric_id}`));
  let others = [];
  if (unlinked.length) {
    const [{rows: punches}, {rows: holidays}] = await Promise.all([
      db.query(`SELECT p.device_serial,p.biometric_id,to_char(p.punched_at,'YYYY-MM-DD HH24:MI') AS at FROM ${punchTable} p
       LEFT JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
       WHERE ${manual?'true':'l.employee_id IS NULL'} AND p.device_serial=ANY($1::text[]) AND p.punched_at>=$2::date-1 AND p.punched_at<$3::date+2`, [serials, from, to]),
      db.query(`SELECT name,data->>'date' AS date,coalesce(data->>'siteId','') AS site_id FROM hr_records
       WHERE kind='holidays' AND status IN ('ACTIVE','APPROVED') AND data->>'date' BETWEEN $1 AND $2`, [from, to])
    ]);
    others = buildRegister({from, to, today, policy,
      employees: unlinked.map(r => ({id: `u:${r.device_serial}|${r.biometric_id}`, code: manual?r.biometric_id:'', name: manual?'Employee not found':r.machine_name || `Machine ID ${r.biometric_id}`,
        siteId: String(site.id), site: site.name, siteType: site.siteType || '', designation: ''})),
      punches: punches.filter(p=>!manual||unlinkedKeys.has(`${p.device_serial}|${p.biometric_id}`)).map(p => ({employeeId: `u:${p.device_serial}|${p.biometric_id}`, at: p.at, where: manual?p.device_serial:place.get(p.device_serial)})),
      holidays: holidays.map(h => ({date: h.date, siteId: h.site_id, name: h.name}))}).rows;
  }
  const rows = [...linked.map(r => ({...r, linked: true})), ...others.map(r => ({...r, linked: false}))]
    .map(r => ({...r, machinesUsed: [...new Set(used.get(r.id) || [])]}));
  return {from, to, policy, site: site.name, machines: machineList, rows};
}
