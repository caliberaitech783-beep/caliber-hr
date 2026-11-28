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
import {sameSite} from './site-match.mjs';

const list = value => Array.isArray(value) ? value : [];
const siteKey = site => String(site || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The same two keys as the roster's reading: a duty, and a person's shift whatever the site.
const dutyKey = entry => JSON.stringify([siteKey(entry.siteKey || entry.site), entry.date, entry.shift, String(entry.employeeId || '').trim().toUpperCase()]);
const slotKey = (employeeKey, entry) => JSON.stringify([employeeKey, entry.date, entry.shift]);

export function trimMisReport(report, site, from, to) {
  const mine = entry => Boolean(entry) && (sameSite(site, entry.site) || sameSite(site, entry.siteKey));
  const duties = list(report.otDuties), lines = list(report.attendanceEquipment), changes = list(report.hrChanges);
  // The sites MIS had lines for, date by date. An answer Pulse-II already cut to the site (cut: 'site') no longer holds
  // the other sites' lines, so it says itself where they were (misSiteDays); otherwise they are counted here.
  const siteDays = new Map();
  const given = report.cut === 'site' && report.misSiteDays && typeof report.misSiteDays === 'object' ? report.misSiteDays : null;
  if (given) for (const [date, sites] of Object.entries(given)) siteDays.set(date, new Set(list(sites).filter(name => typeof name === 'string' && name)));
  else for (const entry of [...duties, ...lines, ...changes.filter(c => c?.mark === 'absent')]) if (entry?.site && entry.date) siteDays.set(entry.date, (siteDays.get(entry.date) || new Set()).add(entry.site));
  const misSiteDays = Object.fromEntries([...siteDays].sort(([a], [b]) => a.localeCompare(b)).map(([date, sites]) => [date, [...sites].sort()]));
  const misSites = [...new Set(Object.entries(misSiteDays).filter(([date]) => date >= from && date <= to).flatMap(([, sites]) => sites))].sort();

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
    attendanceShifts: list(report.attendanceShifts).filter(row => row && sameSite(site, row.siteKey)),
    ot: list(report.ot).filter(mine),
    ...(Array.isArray(report.hrChanges) ? {hrChanges: changes.filter(keepChange)} : {}),
    ...(Array.isArray(report.days) ? {days: report.days.filter(day => day && sameSite(site, day.siteKey))} : {}),
    misSites, misSiteDays
  };
}

/* One request for a site's whole week (28 Nov 2026, after Pulse-II learned to cut its answer to one site).
   Measured on live that day: Pulse-II took about 14 seconds for every single day asked, because each day made it build
   a fresh three-day report of every site; a month was 28 such requests and 191 seconds. Checked on live the same day:
   the lines of a day are exactly the same from one read of a week as from that day's own read (four days compared,
   including the days at the edge of Pulse-II's own weeks). So the server reads the week of the day once and hands out
   its days from it. */
const DAY = 86_400_000;
const dayString = stamp => new Date(stamp).toISOString().slice(0, 10);
/** The seven days that hold `day`, counted from the first operating day, so every user and site asks the same weeks. */
export function weekOf(day, first) {
  const start = Date.parse(first) + Math.floor((Date.parse(day) - Date.parse(first)) / (7 * DAY)) * 7 * DAY;
  return {from: dayString(start), to: dayString(start + 6 * DAY)};
}
// The dates a duty case names: "2026-11-09 S1: 2026-11-09 04:00 → 2026-11-09 12:00; 2026-11-09 S2: …".
const caseDates = schedule => String(schedule || '').split('; ').map(item => item.match(/^(\d{4}-\d{2}-\d{2}) \w+:/)?.[1]).filter(Boolean);
/** What a day's own read sends, taken out of the week: the day, the day before and the day after (they decide overtime). */
export function dayOfWeekReport(week, day) {
  const near = new Set([dayString(Date.parse(day) - DAY), day, dayString(Date.parse(day) + DAY)]);
  const dated = key => list(week[key]).filter(entry => entry && near.has(entry.date));
  const {misSiteDays, run, ...rest} = week;
  return {
    ...rest,
    attendanceEquipment: dated('attendanceEquipment'), otDuties: dated('otDuties'), performance: dated('performance'), details: dated('details'),
    exceptions: dated('exceptions'), attendanceShifts: dated('attendanceShifts'),
    ot: list(week.ot).filter(event => event && caseDates(event.schedule).some(date => near.has(date))),
    ...(Array.isArray(week.hrChanges) ? {hrChanges: dated('hrChanges')} : {}),
    ...(Array.isArray(week.days) ? {days: dated('days')} : {}),
    misSites: list(misSiteDays?.[day])
  };
}
