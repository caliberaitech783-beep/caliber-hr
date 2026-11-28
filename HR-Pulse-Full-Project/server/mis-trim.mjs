/* The MIS trip card feed, cut down to the one site the roster asked for (28 Nov 2026).

   Measured on live, 28 Nov 2026 (Majri OC, 1 to 28 Nov, one day per request): every answer carried three days of all
   seven sites, 15.9 MB where the roster keeps about 600 lines of one site. 28 days were 380 MB through the HR server,
   its 30 second copy in the database and the browser, and took 196 seconds.

   What is kept is exactly what the roster's reading (src/misAttendanceModel.ts, mapMisAttendance) uses to make the lines
   of this site, so no line of the site changes:
   - every entry of the site, on every date of the answer (the day before and after decide a duty's overtime);
   - a duty of ANOTHER site by the same person in the same date and shift: the roster marks both "Same shift recorded
     at multiple sites" (Pending), so that duty has to stay or the mark would silently disappear;
   - the signatures of the site's days.
   The site is matched with the roster's own rule (site-match.mjs), so a name written differently in MIS is kept exactly
   when the roster would have kept it. misSites lists the sites MIS had cards for in the dates asked: the roster shows
   them when it finds none for the chosen site. */
import {siteMatcher} from './site-match.mjs';

const list = value => Array.isArray(value) ? value : [];
/* Every MIS site name and site key the answer holds (28 Nov 2026, site-match.mjs): its lines, its shift list (which
   names every site on every date, also one with no card) and its signed days. With them "Dudhichua OB East" is known
   to have a site of exactly its own name in MIS, so "Dudhichua OC" is not taken for it. */
function knownSites(report) {
  const names = new Set(list(report.knownSites).filter(name => typeof name === 'string' && name));
  const add = value => { if (typeof value === 'string' && value) names.add(value); };
  for (const key of ['otDuties', 'attendanceEquipment', 'hrChanges', 'attendanceShifts', 'days', 'ot']) for (const entry of list(report[key])) { add(entry?.site); add(entry?.siteKey); }
  return [...names].sort();
}
const siteKey = site => String(site || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The same two keys as the roster's reading: a duty, and a person's shift whatever the site.
const dutyKey = entry => JSON.stringify([siteKey(entry.siteKey || entry.site), entry.date, entry.shift, String(entry.employeeId || '').trim().toUpperCase()]);
const slotKey = (employeeKey, entry) => JSON.stringify([employeeKey, entry.date, entry.shift]);

export function trimMisReport(report, site, from, to) {
  const known = knownSites(report), isSite = siteMatcher(site, known);
  const mine = entry => Boolean(entry) && (isSite(entry.site) || isSite(entry.siteKey));
  const duties = list(report.otDuties), lines = list(report.attendanceEquipment), changes = list(report.hrChanges);
  const inDates = entry => entry.date >= from && entry.date <= to;
  const misSites = [...new Set([...duties, ...lines, ...changes.filter(c => c?.mark === 'absent')].filter(e => e && inDates(e)).map(e => e.site).filter(Boolean))].sort();

  // A person's shifts at this site, by every key the roster may give the line (the card's, a line's, a change's).
  const slots = new Set();
  for (const entry of [...duties, ...lines]) if (mine(entry)) slots.add(slotKey(entry.employeeKey, entry));
  for (const change of changes) if (mine(change)) slots.add(slotKey(change.employeeKey || change.employeeId, change));
  // The duties to keep: the site's own, and another site's in one of those shifts by the same person.
  const kept = new Set();
  for (const entry of [...duties, ...lines]) if (entry && (mine(entry) || slots.has(slotKey(entry.employeeKey, entry)))) kept.add(dutyKey(entry));
  const keepChange = change => Boolean(change) && (mine(change) || slots.has(slotKey(change.employeeKey || change.employeeId, change)) || kept.has(dutyKey(change)));
  // A duty is one line built from its card and all its equipment lines: every part of a kept duty stays.
  const whole = entry => Boolean(entry) && (mine(entry) || kept.has(dutyKey(entry)));

  return {
    ...report,
    attendanceEquipment: lines.filter(whole),
    otDuties: duties.filter(whole),
    performance: list(report.performance).filter(whole),
    details: list(report.details).filter(whole),
    exceptions: list(report.exceptions).filter(whole),
    attendanceShifts: list(report.attendanceShifts).filter(row => row && isSite(row.siteKey)),
    ot: list(report.ot).filter(mine),
    ...(Array.isArray(report.hrChanges) ? {hrChanges: changes.filter(keepChange)} : {}),
    ...(Array.isArray(report.days) ? {days: report.days.filter(day => day && isSite(day.siteKey))} : {}),
    // knownSites goes along, so the browser decides by the same names.
    misSites, knownSites: known
  };
}
