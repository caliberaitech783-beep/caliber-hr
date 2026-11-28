// Owner, 28 Nov 2026: every employee of Employee Master (Corporate / HO and OB / COAL) has a Working Hours field,
// in Job & Posting Details beside Shift. It is one of 8, 9, 10, 11 or 12 hours, saved as "12 hours" under the heading
// "Working Hours *". It is asked for on every new joining; an employee saved before has it blank until HR fills it in.
// 11 hours was added the same day: the sites' own hour-wise sheet has people on 11 hours.
export const WORKING_HOURS_FIELD = 'Working Hours *';
export const WORKING_HOURS_OPTIONS = Object.freeze(['8 hours','9 hours','10 hours','11 hours','12 hours']);
const ALLOWED = new Set([8,9,10,11,12]);
const ALLOWED_TEXT = '8, 9, 10, 11 or 12 hours';

// "12", "12 hrs", "12 Hours", "12h", "08 HRS", "12 HRS." and 12 (an Excel number) are all "12 hours". Blank stays
// blank. Anything else returns null: the caller refuses it.
export function normalizeWorkingHours(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.toLowerCase().match(/^0?(\d{1,2})(?:\.0+)?\s*(?:h|hr|hrs|hour|hours)?\.?$/);
  const hours = match ? Number(match[1]) : NaN;
  return ALLOWED.has(hours) ? `${hours} hours` : null;
}

// The sites' hour-wise sheets also write "8 Hrs Day & Night" and "11 Hrs Day": for the Excel update of working hours
// the number in front of "hrs" is the hours, whatever follows. Not used by the forms.
export function sheetWorkingHours(value) {
  const plain = normalizeWorkingHours(value);
  if (plain !== null) return plain;
  const match = String(value ?? '').trim().toLowerCase().match(/^0?(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b/);
  const hours = match ? Number(match[1]) : NaN;
  return ALLOWED.has(hours) ? `${hours} hours` : null;
}

export const workingHoursProblem = value =>
  normalizeWorkingHours(value) === null ? `Working Hours must be ${ALLOWED_TEXT}` : '';

// The number of hours (12) for the Pulse-II feed, or null when it is not set.
export function workingHoursNumber(value) {
  const normal = normalizeWorkingHours(value);
  return normal ? Number(normal.split(' ')[0]) : null;
}
