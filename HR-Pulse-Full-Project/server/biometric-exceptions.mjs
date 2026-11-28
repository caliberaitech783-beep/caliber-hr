// Biometric Exception Master (owner, 28 Nov 2026): "allow users to add or remove employees from the biometric
// exception list ... it should fetch from employee master (employee id). Employees added to this list should be
// exempted from mandatory biometric punching, and their attendance should be generated automatically by the system.
// Employees not added to this list should continue following the existing biometric attendance process."
//
// The attendance register already exempts some designations (Attendance Policy › Exempt roles): no punch is asked of
// them and a working day is Present, with no late, early, miss punch or cut. This master gives one employee the same
// treatment, by Employee ID, from a date. On an exempt day the register still shows the public holiday, approved
// leave / comp off, approved OD and an office's weekly off; every other day is P, punched or not.
//
// One entry per employee number while it is active (CMPL123 = CMLL123 = 123). Removing an entry ends the exemption
// with the day before; the entry is kept, so earlier days stay as they were generated.
// A driver is never taken: a driver's attendance comes from the trip card and logbook (the Attendance Policy's rule).
import {randomUUID} from 'node:crypto';
import {grantedMenus} from './modules.mjs';
import {siteIds} from './scope.mjs';
import {employeeNumber} from './employee-number.mjs';
import {registerLines} from './employee-master-register.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const text = value => value === null || value === undefined ? '' : String(value).trim();
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const indiaDay = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
const isDriver = designation => text(designation).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').includes('DRIVER');
export const EXCEPTION_BACK_DAYS = 62, EXCEPTION_AHEAD_DAYS = 31, FIND_LIMIT = 20;

/**
 * Who is exempt in these dates: Map(employee number → [{from,to}]), `to` '' while the entry is active.
 * The attendance register asks this on every read, so it never fails the register: before the table exists
 * (a server not restarted yet) nobody is exempt.
 */
export async function exceptionRanges(db, from, to) {
  const ranges = new Map();
  let rows;
  try {
    rows = (await db.query(`SELECT employee_number AS number,to_char(from_date,'YYYY-MM-DD') AS from_date,coalesce(to_char(to_date,'YYYY-MM-DD'),'') AS to_date
      FROM hr_biometric_exceptions WHERE from_date<=$2::date AND (to_date IS NULL OR to_date>=$1::date)`, [from, to]))?.rows;
  } catch (error) {
    if (error?.code === '42P01') return ranges;
    throw error;
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.number || (row.to_date && row.to_date < row.from_date)) continue;
    (ranges.get(row.number) || ranges.set(row.number, []).get(row.number)).push({from: row.from_date, to: row.to_date});
  }
  return ranges;
}
/** The ranges of one Employee ID ([] when not exempt). */
export const rangesFor = (ranges, code) => ranges?.get?.(employeeNumber(code)) || [];
/** True when `date` is inside one of the ranges ({from,to}; to '' = still on the list). */
export const exemptOn = (ranges, date) => (ranges || []).some(range => range.from <= date && (!range.to || date <= range.to));

async function access(db, profile) {
  if (!grantedMenus(profile).has('Master Configuration')) throw fail('Master Configuration access is required.', 403);
  return siteIds(db, profile);
}

const entryColumns = `x.id,x.employee_number AS number,x.employee_id AS "employeeId",x.name,x.site,x.department,x.designation,
  to_char(x.from_date,'YYYY-MM-DD') AS "fromDate",coalesce(to_char(x.to_date,'YYYY-MM-DD'),'') AS "toDate",x.reason,
  x.added_by AS "addedBy",x.added_at AS "addedAt",coalesce(x.removed_by,'') AS "removedBy",x.removed_at AS "removedAt",coalesce(x.remove_reason,'') AS "removeReason"`;
const person = row => ({employeeId: text(row.data?.employeeId), name: text(row.name || row.data?.name), site: text(row.site_name), siteId: row.site_id || null,
  department: text(row.data?.department), designation: text(row.data?.designation), status: text(row.data?.status).toUpperCase()});

export function createBiometricExceptions(pool, {today = indiaDay} = {}) {
  // The employee of an Employee ID, from Employee Master (imported lines and joined employees), inside the login's sites.
  const lookup = async (db, scope, number) => (await db.query(`${registerLines(true)} SELECT id,site_id,site_name,name,data FROM lines
    WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND hr_employee_number(data->>'employeeId')=$2`, [scope, number])).rows;
  return {
    /**
     * ?find=text: up to 20 employees of Employee Master for the Add box (Employee ID or name).
     * Otherwise the list: the active entries, and with ?removed=1 the removed ones too.
     */
    async biometricExceptions(profile, params) {
      const scope = await access(pool, profile);
      const find = text(params?.get?.('find')).slice(0, 100);
      if (find) {
        if (find.length < 2) return {employees: []};
        const number = employeeNumber(find);
        const {rows} = await pool.query(`${registerLines(true)} SELECT id,site_id,site_name,name,data FROM lines
          WHERE ($1::uuid[] IS NULL OR site_id=ANY($1))
            AND (($2<>'' AND hr_employee_number(data->>'employeeId')=$2) OR strpos(lower(concat_ws(' ',name,data->>'employeeId')),lower($3))>0)
          ORDER BY (hr_employee_number(data->>'employeeId')=$2) DESC,lower(name),id LIMIT ${FIND_LIMIT}`, [scope, number, find]);
        const numbers = rows.map(row => employeeNumber(row.data?.employeeId)).filter(Boolean);
        const listed = new Set(numbers.length ? (await pool.query('SELECT employee_number FROM hr_biometric_exceptions WHERE removed_at IS NULL AND employee_number=ANY($1::text[])', [numbers])).rows.map(row => row.employee_number) : []);
        return {employees: rows.map(row => ({...person(row), siteId: undefined, onList: listed.has(employeeNumber(row.data?.employeeId)), driver: isDriver(row.data?.designation)}))};
      }
      const removed = params?.get?.('removed') === '1';
      const {rows} = await pool.query(`SELECT ${entryColumns} FROM hr_biometric_exceptions x
        WHERE ($1::uuid[] IS NULL OR x.site_id=ANY($1)) AND ($2 OR x.removed_at IS NULL)
        ORDER BY (x.removed_at IS NOT NULL),lower(x.name),x.added_at`, [scope, removed]);
      return {entries: rows, today: today(), canEdit: true};
    },
    async addBiometricException(profile, input) {
      const scope = await access(pool, profile);
      const number = employeeNumber(input?.employeeId), day = today();
      if (!number) throw fail('Enter a valid Employee ID.');
      const fromDate = text(input?.fromDate) || day, reason = text(input?.reason);
      if (!isDate(fromDate)) throw fail('Choose the date the exemption starts.');
      if (fromDate < addDays(day, -EXCEPTION_BACK_DAYS)) throw fail(`The exemption can start at most ${EXCEPTION_BACK_DAYS} days back.`);
      if (fromDate > addDays(day, EXCEPTION_AHEAD_DAYS)) throw fail(`The exemption can start at most ${EXCEPTION_AHEAD_DAYS} days ahead.`);
      if (reason.length < 5 || reason.length > 500 || reason.includes('\0')) throw fail('Write why this employee is exempt (5 to 500 letters).');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['biometric-exception:' + number]);
        const found = await lookup(db, scope, number);
        if (!found.length) throw fail(`Employee ID ${text(input.employeeId)} is not in Employee Master, or is outside your sites.`, 404);
        if (found.length > 1) throw fail(`Employee ID ${text(input.employeeId)} is on more than one line of Employee Master. Correct that first.`, 409);
        const employee = person(found[0]);
        if (employee.status === 'LEFT') throw fail(`${employee.name} has left. A person who has left is not put on the exception list.`, 409);
        if (isDriver(employee.designation)) throw fail(`${employee.name} is a driver (${employee.designation}). A driver's attendance comes from the trip card and logbook, so a driver is not exempted here.`, 409);
        if ((await db.query('SELECT 1 FROM hr_biometric_exceptions WHERE employee_number=$1 AND removed_at IS NULL', [number])).rowCount) {
          throw fail(`${employee.name} (${employee.employeeId}) is already on the exception list.`, 409);
        }
        const id = randomUUID();
        await db.query(`INSERT INTO hr_biometric_exceptions(id,employee_number,employee_id,name,site_id,site,department,designation,from_date,reason,added_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)`, [id, number, employee.employeeId, employee.name, employee.siteId, employee.site, employee.department, employee.designation, fromDate, reason, profile.actor]);
        await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'ADD','biometricExceptions',$2,$3)",
          [profile.actor, id, {employeeId: employee.employeeId, name: employee.name, site: employee.site, fromDate, reason}]);
        await db.query('COMMIT');
        return {added: true, id, employeeId: employee.employeeId, name: employee.name, fromDate};
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { db.release(); }
    },
    // The exemption ends with yesterday: from today the employee follows the biometric process again.
    async removeBiometricException(profile, id, input) {
      const scope = await access(pool, profile);
      const reason = text(input?.reason);
      if (reason.length < 5 || reason.length > 500 || reason.includes('\0')) throw fail('Write why this employee is taken off the list (5 to 500 letters).');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const entry = (await db.query(`SELECT id,employee_id,name,site,to_char(from_date,'YYYY-MM-DD') AS from_date FROM hr_biometric_exceptions
          WHERE id=$1 AND removed_at IS NULL AND ($2::uuid[] IS NULL OR site_id=ANY($2)) FOR UPDATE`, [id, scope])).rows[0];
        if (!entry) throw fail('This entry is not on the exception list any more.', 404);
        const lastDay = addDays(today(), -1);
        await db.query('UPDATE hr_biometric_exceptions SET to_date=$2::date,removed_by=$3,removed_at=now(),remove_reason=$4 WHERE id=$1', [id, lastDay, profile.actor, reason]);
        await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'REMOVE','biometricExceptions',$2,$3)",
          [profile.actor, id, {employeeId: entry.employee_id, name: entry.name, site: entry.site, fromDate: entry.from_date, lastDay, reason}]);
        await db.query('COMMIT');
        return {removed: true, lastDay};
      } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { db.release(); }
    },
  };
}
