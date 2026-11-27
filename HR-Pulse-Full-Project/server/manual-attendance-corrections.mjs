/* Admin correction of a day in Attendance roster › Manual Biometric (owner, 25 Nov 2026: "edit option only for admin in
   bio-matric punch daily attendance").
   - Only an HR administrator (every site, Employee Master write: the same people who add and delete machines) corrects a
     day. Site HR sees the roster as before, with no edit and no Delete of saved logs.
   - A correction is kept apart from the imported punches (hr_manual_attendance_corrections, one per site, employee and
     day): the punches and the log file stay as imported. It gives a new In / Out (rated again with the attendance policy)
     and / or a code (P, HD, A, WO, H, CO, L, OD), always with a reason. Undo removes it and the punches rule again.
   - The roster, the M.B-Trip card mismatch and a saved copy of that day show the corrected day, marked with who changed
     it, when, why and what it was. Pulse-II gets the imported punches and, since 25 Nov 2026, the corrections beside them
     (mis-biometric-punches.mjs), so its Biometric vs trip card mismatch shows the corrected day.
   GET    attendance/manual-biometric                 → the register with corrections applied (attendance.mjs)
   POST   attendance/manual-biometric/corrections {site,day,employeeCode,status?,in?,out?,reason}
   DELETE attendance/manual-biometric/corrections {site,day,employeeCode} */
import {DEFAULT_POLICY, clockMinutes, evaluateDay, summarizeMonth} from './attendance-policy.mjs';

export const CORRECTION_CODES = ['P', 'HD', 'A', 'WO', 'H', 'CO', 'L', 'OD'];
const DAY = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const validDay = value => typeof value === 'string' && DAY.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
/** The roster's Employee ID: CMLL20611, or the machine ID of someone not in Employee Master. */
export const correctionCode = value => String(value ?? '').trim().toUpperCase();
const clock = minutes => minutes == null ? '' :
  `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${minutes >= 1440 ? ' (+1)' : ''}`;
const minutesOf = text => clockMinutes(String(text || '').replace(/\s*\(\+1\)\s*$/, ''));

/** A correction as sent by the screen, checked. today: India date; a day is corrected from yesterday back. */
export function cleanCorrection(input, today) {
  const day = input?.day, employeeCode = correctionCode(input?.employeeCode);
  if (!validDay(day)) fail('Choose a valid day.');
  if (day >= today) fail('Today is still running; a day is corrected from yesterday back.');
  if (!employeeCode || employeeCode.length > 40) fail('Choose the employee.');
  const status = String(input?.status ?? '').trim().toUpperCase();
  if (status && !CORRECTION_CODES.includes(status)) fail(`Choose a code: ${CORRECTION_CODES.join(', ')}.`);
  const inTime = String(input?.in ?? '').trim(), outTime = String(input?.out ?? '').trim();
  if (inTime && !TIME.test(inTime)) fail('In time must be HH:MM (24 hours).');
  if (outTime && !TIME.test(outTime)) fail('Out time must be HH:MM (24 hours).');
  if (outTime && !inTime) fail('Give the In time with the Out time.');
  if (!status && !inTime) fail('Give the In / Out time or choose a code.');
  const reason = String(input?.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < 3) fail('Write the reason for the correction.');
  if (reason.length > 300) fail('Keep the reason within 300 letters.');
  return {day, employeeCode, status, in: inTime, out: outTime, reason};
}

/** The day as the correction makes it. The Out is the next morning when it is not after the In. */
export function correctedDay(day, correction, row, policy = DEFAULT_POLICY) {
  const before = {status: day.status, in: day.in || '', out: day.out || ''};
  let next = {...day};
  if (correction.in) {
    const inMinute = clockMinutes(correction.in);
    let outMinute = correction.out ? clockMinutes(correction.out) : null;
    if (outMinute != null && outMinute <= inMinute) outMinute += 1440;
    const starts = minutesOf(row?.shiftStart), rawEnd = minutesOf(row?.shiftEnd);
    const ends = starts != null && rawEnd != null ? (rawEnd <= starts ? rawEnd + 1440 : rawEnd) : null;
    const result = evaluateDay({inMinute, outMinute, shiftStart: starts, shiftEnd: ends, designation: row?.designation || '', site: row?.site || '',
      gatePassMinutes: day.gatePassMinutes || 0}, policy);
    const counts = ['P', 'HD', 'A', 'MP'].includes(result.status);
    next = {...next, status: result.status, in: clock(inMinute), out: clock(outMinute), workedMinutes: counts ? result.workedMinutes : null,
      late: counts && result.late, early: counts && result.early, missPunch: result.status === 'MP', gatePassDeduction: result.gatePassDeduction};
  }
  if (correction.status) {
    const counts = ['P', 'HD', 'A'].includes(correction.status);
    next = {...next, status: correction.status, missPunch: false, late: counts && next.late, early: counts && next.early,
      workedMinutes: counts ? next.workedMinutes : null};
  }
  const by = correction.correctedBy || correction.corrected_by || '', at = correction.correctedAt || correction.corrected_at || '';
  return {...next, note: `Corrected by ${by || 'HR administrator'}: ${correction.reason}`,
    corrected: {by, at, reason: correction.reason, before, status: correction.status || '', in: correction.in || '', out: correction.out || ''}};
}

/** Month and range totals again, as buildRegister makes them. */
function totals(days, policy) {
  const months = {};
  for (const month of [...new Set(days.map(day => day.date.slice(0, 7)))]) months[month] = summarizeMonth(days.filter(day => day.date.startsWith(month)), policy);
  const summary = Object.values(months).reduce((sum, month) => {
    for (const [key, value] of Object.entries(month)) sum[key] = Math.round(((sum[key] || 0) + value) * 100) / 100;
    return sum;
  }, {});
  for (const status of ['H', 'L', 'CO', 'OD', 'WO', 'IN']) summary[status] = days.filter(day => day.status === status).length;
  return {months, summary};
}

/** The register with the site's corrections laid over it. corrections: rows of hr_manual_attendance_corrections. */
export function applyCorrections(register, corrections = []) {
  if (!register || !Array.isArray(register.rows) || !corrections.length) return register;
  const policy = register.policy || DEFAULT_POLICY;
  const byKey = new Map(corrections.map(c => [correctionCode(c.employee_code ?? c.employeeCode) + '|' + String(c.day), c]));
  const rows = register.rows.map(row => {
    const code = correctionCode(row.code);
    if (!code || !row.days?.some(day => byKey.has(code + '|' + day.date))) return row;
    const days = row.days.map(day => {
      const c = byKey.get(code + '|' + day.date);
      return c ? correctedDay(day, {status: c.status || '', in: c.in_time ?? c.in ?? '', out: c.out_time ?? c.out ?? '', reason: c.reason,
        correctedBy: c.corrected_by ?? c.correctedBy, correctedAt: c.corrected_at ?? c.correctedAt}, row, policy) : day;
    });
    const {months, summary} = totals(days, policy);
    return {...row, days, months, summary: {...row.summary, ...summary}};
  });
  return {...register, rows};
}

/** Database side: read, save and remove corrections. tx(fn) runs fn(db) in a transaction. */
export function createCorrections({pool, tx, audit}) {
  async function read(db, siteName, from, to) {
    return (await db.query(`SELECT to_char(day,'YYYY-MM-DD') AS day,employee_code,status,in_time,out_time,reason,corrected_by,corrected_at
      FROM hr_manual_attendance_corrections WHERE site=$1 AND day BETWEEN $2::date AND $3::date`, [siteName, from, to])).rows;
  }
  return {
    read: (siteName, from, to) => read(pool, siteName, from, to),
    async save(profile, siteName, correction) {
      return tx(async db => {
        const before = (await db.query(`SELECT status,in_time,out_time,reason,corrected_by FROM hr_manual_attendance_corrections
          WHERE site=$1 AND day=$2::date AND employee_code=$3`, [siteName, correction.day, correction.employeeCode])).rows[0] || null;
        const row = (await db.query(`INSERT INTO hr_manual_attendance_corrections(site,day,employee_code,status,in_time,out_time,reason,corrected_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(site,day,employee_code) DO UPDATE SET status=EXCLUDED.status,in_time=EXCLUDED.in_time,out_time=EXCLUDED.out_time,
           reason=EXCLUDED.reason,corrected_by=EXCLUDED.corrected_by,corrected_at=now()
          RETURNING to_char(day,'YYYY-MM-DD') AS day,employee_code,status,in_time,out_time,reason,corrected_by,corrected_at`,
        [siteName, correction.day, correction.employeeCode, correction.status, correction.in, correction.out, correction.reason, profile.actor])).rows[0];
        await audit(db, profile.actor, 'CORRECT_MANUAL_ATTENDANCE_DAY', {site: siteName, ...correction, before});
        return row;
      });
    },
    async remove(profile, siteName, day, employeeCode) {
      return tx(async db => {
        const removed = (await db.query(`DELETE FROM hr_manual_attendance_corrections WHERE site=$1 AND day=$2::date AND employee_code=$3
          RETURNING status,in_time,out_time,reason,corrected_by`, [siteName, day, employeeCode])).rows[0];
        if (!removed) fail('This day has no correction to undo.', 404);
        await audit(db, profile.actor, 'UNDO_MANUAL_ATTENDANCE_CORRECTION', {site: siteName, day, employeeCode, removed});
        return {day, employeeCode, removed: true};
      });
    }
  };
}
