/* VTC (Vocational Training Centre course) for drivers and operators (owner, 28 Nov 2026).
   HR Pulse keeps only the request and its approval (the OD route: HOD (concerned) → Regional HR, Approval Master › OD).
   Pulse-II is the one master of trip card attendance: on the final approval HR Pulse sends the course to Pulse-II's
   VTC Master, which makes the days present (purple P) and sends them to the roster in its attendance feed.
   HR Pulse never writes VTC days into its own attendance. Pulse-II routes: caliber-mis PR 592. */

export const VTC_COURSES = ['HEMM operator (Dumper)', 'HEMM operator (Shovel / Excavator)', 'HEMM operator (Dozer / Grader)',
  'Drill operator', 'Heavy vehicle driver', 'Light vehicle driver', 'Refresher', 'Other'];
export const VTC_STATUSES = ['Ongoing', 'Completed', 'Left midway'];
export const VTC_FIRST_DATE = '2026-11-01';
export const VTC_MAX_DAYS = 92;
export const VTC_DAYS_AHEAD = 60;
const DAY = 86_400_000;
const MIS_ORIGIN = 'https://pulse-ll.cmll.in';

/* Drivers and operators only (the employee list shows nobody else). */
export const isVtcTrade = designation => /driver|operator/i.test(String(designation || ''));

/* Today's date in India. */
export const indiaToday = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

/* What is wrong with the dates, course or status of a VTC request ('' when nothing). Same rules as Pulse-II's VTC Master. */
export function vtcProblem(data, today = indiaToday()) {
  const from = String(data.fromDate || ''), to = String(data.toDate || '');
  if (from && from < VTC_FIRST_DATE) return 'From date must be on or after 01-11-2026.';
  if (from && to && to < from) return 'To date must be on or after the From date.';
  if (from && to && days(from, to) > VTC_MAX_DAYS) return `A VTC course can be at most ${VTC_MAX_DAYS} days.`;
  const latest = new Date(Date.parse(today) + VTC_DAYS_AHEAD * DAY).toISOString().slice(0, 10);
  if ((from && from > latest) || (to && to > latest)) return `Dates can be at most ${VTC_DAYS_AHEAD} days ahead of today.`;
  if (data.vtcStatus === 'Completed' && to && to > today) return 'Completed can be chosen only when the To date is today or earlier.';
  if (data.course === 'Other' && !String(data.courseOther || '').trim()) return 'Write the course name (Course is Other).';
  return '';
}

export function validateVtc(data, today) {
  const problem = vtcProblem(data, today);
  if (problem) throw Object.assign(new Error(problem), {status: 400});
  if (data.course !== 'Other') data.courseOther = '';
  return data;
}

/* The body Pulse-II takes on check, PUT and the list: request = HR's request code, site as HR writes it, employee = Caliber ID. */
export function vtcBody(record, siteName) {
  const d = record.data || {};
  return {request: record.code, site: String(siteName || ''), employee: String(d.empCode || ''), fromDate: d.fromDate, toDate: d.toDate,
    course: d.course, courseOther: d.courseOther || '', institute: d.institute, trainer: d.trainer || '', certificate: d.certificate || '',
    status: d.vtcStatus, remarks: d.remarks || ''};
}

/* Pulse-II's own words when it refuses, or why it could not be asked. */
export function misMessage({status, result}, fallback = 'Pulse-II could not take this VTC request.') {
  if (result?.error) return String(result.error).slice(0, 500);
  if (!status) return 'Pulse-II did not answer. Try again in a few minutes.';
  if (status === 404 || status === 405) return 'Pulse-II does not take VTC requests from HR Pulse yet. It will after its next release.';
  if (status === 401) return 'Your Pulse sign-in has ended. Sign in again and retry.';
  return fallback;
}

/* Calls to Pulse-II with the user's own Pulse grant, like the attendance changes (mis-attendance.mjs). Never throws. */
export function createMisVtc(fetchMis = fetch) {
  async function call(grant, path, {method = 'GET', body, query, timeout = 20_000} = {}) {
    if (!grant) return {status: 0, ok: false, result: {error: 'Sign in again to send this to Pulse-II.'}};
    const url = new URL(path, MIS_ORIGIN);
    if (query) url.search = new URLSearchParams(query);
    try {
      const response = await fetchMis(url, {method, headers: {Authorization: 'Bearer ' + grant, Accept: 'application/json', ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), redirect: 'error', signal: AbortSignal.timeout(timeout)});
      const result = await response.json().catch(() => null);
      return {status: response.status, ok: response.ok && result?.ok !== false, result};
    } catch {
      return {status: 0, ok: false, result: null};
    }
  }
  return {
    check: (grant, body) => call(grant, '/api/integrations/hr/vtc/check', {method: 'POST', body}),
    put: (grant, body) => call(grant, '/api/integrations/hr/vtc', {method: 'PUT', body}),
    remove: (grant, body) => call(grant, '/api/integrations/hr/vtc/remove', {method: 'POST', body}),
    list: (grant, month) => call(grant, '/api/integrations/hr/vtc', {query: {month}}),
  };
}
