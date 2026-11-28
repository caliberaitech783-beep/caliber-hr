// Owner, 28 Nov 2026: every employee of Employee Master (Corporate / HO and OB / COAL) has a Working Hours field,
// in Job & Posting Details beside Shift, saved as "12 hours" under the heading "Working Hours *". It is asked for on
// every new joining; an employee saved before has it blank until HR fills it in.
//
// Working Hour Master (owner, 28 Nov 2026: "add working hour master and it should be same for both corporate and
// coal"): the hours that may be chosen are the active lines of Master Configuration › Working Hour Master (records of
// kind `workingHours`, code = the hours). One list for Corporate / HO and OB / COAL alike: the forms, the Excel imports,
// the register edit and the hour-wise Excel update all take it. It starts with 8, 9, 10, 11 and 12 hours (schema.sql);
// while the master holds no line at all those five stay the list.
export const WORKING_HOURS_FIELD = 'Working Hours *';
export const WORKING_HOURS_KIND = 'workingHours';
export const DEFAULT_WORKING_HOURS = Object.freeze([8,9,10,11,12]);
export const hoursLabel = hours => `${hours} hours`;
// Whole hours only, at most a day.
export const validMasterHours = hours => Number.isInteger(hours) && hours >= 1 && hours <= 24;

const tidy = list => Object.freeze([...new Set(list.map(Number).filter(validMasterHours))].sort((a,b)=>a-b));

// The list in use. The browser sets it from the configuration (/api/config, `workingHours`) when the workspace opens; the server reads the
// master (loadWorkingHours) before it checks a value and passes that list on.
let current = DEFAULT_WORKING_HOURS;
export function setWorkingHours(list) { current = Array.isArray(list) ? tidy(list) : DEFAULT_WORKING_HOURS; return current; }
export const currentWorkingHours = () => current;
export const workingHoursOptions = (allowed = current) => allowed.map(hoursLabel);
/** The starting list. Screens read workingHoursOptions() for the master's list. */
export const WORKING_HOURS_OPTIONS = Object.freeze(DEFAULT_WORKING_HOURS.map(hoursLabel));

export function allowedText(allowed = current) {
  if (!allowed.length) return 'one of the hours in Working Hour Master (none is active)';
  if (allowed.length === 1) return hoursLabel(allowed[0]);
  return `${allowed.slice(0,-1).join(', ')} or ${allowed[allowed.length-1]} hours`;
}

// "12", "12 hrs", "12 Hours", "12h", "08 HRS", "12 HRS." and 12 (an Excel number) are all 12. NaN when it is not hours.
function plainHours(value) {
  const match = String(value ?? '').trim().toLowerCase().match(/^0?(\d{1,2})(?:\.0+)?\s*(?:h|hr|hrs|hour|hours)?\.?$/);
  return match ? Number(match[1]) : NaN;
}

// Blank stays blank. A value the master does not hold returns null: the caller refuses it.
export function normalizeWorkingHours(value, allowed = current) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const hours = plainHours(text);
  return allowed.includes(hours) ? hoursLabel(hours) : null;
}

// The sites' hour-wise sheets also write "8 Hrs Day & Night" and "11 Hrs Day": for the Excel update of working hours
// the number in front of "hrs" is the hours, whatever follows. Not used by the forms.
export function sheetWorkingHours(value, allowed = current) {
  const plain = normalizeWorkingHours(value, allowed);
  if (plain !== null) return plain;
  const match = String(value ?? '').trim().toLowerCase().match(/^0?(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b/);
  const hours = match ? Number(match[1]) : NaN;
  return allowed.includes(hours) ? hoursLabel(hours) : null;
}

export const workingHoursProblem = (value, allowed = current) =>
  normalizeWorkingHours(value, allowed) === null ? `Working Hours must be ${allowedText(allowed)}` : '';

// The number of hours (12) for the Pulse-II feed, or null when it is not set. A saved value is sent even when its line
// in the master was switched off later: the employee still works those hours until HR changes them.
export function workingHoursNumber(value) {
  const hours = plainHours(value);
  return validMasterHours(hours) ? hours : null;
}

// The master's active hours. No line of the kind at all (a database the seed has not reached) is the starting list.
export async function loadWorkingHours(db) {
  const rows = ((await db.query("SELECT kind,code,status FROM hr_records WHERE kind=$1", [WORKING_HOURS_KIND]))?.rows || [])
    .filter(row => row?.kind === WORKING_HOURS_KIND);
  if (!rows.length) return DEFAULT_WORKING_HOURS;
  return tidy(rows.filter(row => ['ACTIVE','APPROVED'].includes(row.status)).map(row => Number(row.code)));
}

// A line of the master: the hours are its code, its name is always "N hours".
export function masterLine(data) {
  const hours = plainHours(data?.code);
  if (!validMasterHours(hours)) throw Object.assign(new Error('Working hours must be a whole number from 1 to 24'), {status:400});
  return {...data, code:String(hours), name:hoursLabel(hours)};
}
