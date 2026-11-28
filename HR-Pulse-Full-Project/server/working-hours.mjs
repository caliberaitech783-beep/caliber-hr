// Owner, 28 Nov 2026: every employee of Employee Master (Corporate / HO and OB / COAL) has a Working Hours field,
// in Job & Posting Details beside Shift. It is one of 8, 9, 10 or 12 hours, saved as "12 hours" under the heading
// "Working Hours *". It is asked for on every new joining; an employee saved before has it blank until HR fills it in.
export const WORKING_HOURS_FIELD = 'Working Hours *';
export const WORKING_HOURS_OPTIONS = Object.freeze(['8 hours','9 hours','10 hours','12 hours']);
const ALLOWED = new Set([8,9,10,12]);

// "12", "12 hrs", "12 Hours", "12h" and 12 (an Excel number) are all "12 hours". Blank stays blank.
// Anything else returns null: the caller refuses it.
export function normalizeWorkingHours(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.toLowerCase().match(/^(\d{1,2})(?:\.0+)?\s*(?:h|hr|hrs|hour|hours)?\.?$/);
  const hours = match ? Number(match[1]) : NaN;
  return ALLOWED.has(hours) ? `${hours} hours` : null;
}

export const workingHoursProblem = value =>
  normalizeWorkingHours(value) === null ? 'Working Hours must be 8, 9, 10 or 12 hours' : '';

// The number of hours (12) for the Pulse-II feed, or null when it is not set.
export function workingHoursNumber(value) {
  const normal = normalizeWorkingHours(value);
  return normal ? Number(normal.split(' ')[0]) : null;
}
