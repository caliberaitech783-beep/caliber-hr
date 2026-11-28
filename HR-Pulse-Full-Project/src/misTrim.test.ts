/* Owner, 28 Nov 2026: "find why one MIS trip-card day takes 14 seconds and fix it". One day of one site came back as
   three days of all seven sites (15.9 MB). The server now leaves the other sites out (server/mis-trim.mjs).
   The promise tested here: the roster's lines for the chosen site are exactly the same from the cut answer as from the
   whole one. Many made-up answers are tried, with the cases that could go wrong written in on purpose: the same person
   in the same shift at two sites, a site written two ways in MIS, a card and its equipment lines under different
   keys, overtime across midnight, changes made by HR. */
import {describe, expect, it} from 'vitest';
import {trimMisReport} from '../server/mis-trim.mjs';
import {mapMisAttendance} from './misAttendanceModel';
import {sameSite} from './rosterModel';

// A small repeatable random source, so a failure can be run again.
function random(seed: number) {
  let s = seed >>> 0;
  return () => {s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296;};
}
const DATES = ['2026-11-04', '2026-11-05', '2026-11-06'];
const SHIFTS = ['S1', 'S2', 'S3'];
const HOURS: Record<string, [string, string, number]> = {S1: ['06:00', '14:00', 0], S2: ['14:00', '22:00', 0], S3: ['22:00', '06:00', 1]};
// MIS writes Majri two ways here; both are the HR site "Majri OC". Sasti and Jayant are other sites.
const MIS_SITES: [string, string][] = [['Majri OC', 'majri oc'], ['Majri OCP', 'majri ocp'], ['Sasti OC', 'sasti oc'], ['Jayant OB', 'jayant ob'], ['Dudhichua East OC', 'dudhichua east oc']];
const dayAfter = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);

function madeUpReport(seed: number) {
  const next = random(seed), pick = <T,>(list: T[]) => list[Math.floor(next() * list.length)], chance = (p: number) => next() < p;
  const people = Array.from({length: 9}, (_, i) => ({employeeId: 'CMLL' + (100 + i), employeeKey: 'key-' + i, employeeName: 'Person ' + i}));
  const report = {attendanceEquipment: [] as Record<string, unknown>[], attendanceShifts: [] as Record<string, unknown>[], otDuties: [] as Record<string, unknown>[],
    ot: [] as Record<string, unknown>[], performance: [] as Record<string, unknown>[], details: [] as Record<string, unknown>[], exceptions: [] as Record<string, unknown>[],
    hrChanges: [] as Record<string, unknown>[], days: [] as Record<string, unknown>[], signed: true, corrections: [] as Record<string, unknown>[]};
  for (const [, siteKey] of MIS_SITES) for (const date of DATES) {
    report.days.push({siteKey, date, lines: 1, signature: 'sig-' + siteKey + date});
    for (const shift of SHIFTS) if (chance(0.8)) {
      const [start, end, plus] = HOURS[shift];
      report.attendanceShifts.push({siteKey, date, shift, state: pick(['closed', 'closed', 'open', 'not_due', 'none']), batch: 'B-' + shift,
        start: `${date} ${start}`, end: `${plus ? dayAfter(date) : date} ${end}`});
    }
  }
  for (let n = 0; n < 70; n++) {
    const person = pick(people), [site, siteKey] = pick(MIS_SITES), date = pick(DATES), shift = pick(SHIFTS), [start, end, plus] = HOURS[shift];
    const identity = {date, site, siteKey, shift, employeeId: person.employeeId, employeeName: person.employeeName};
    // A card and its equipment line do not always carry the same key: the roster takes the card's.
    const lineKey = chance(0.15) ? person.employeeKey + '-line' : person.employeeKey;
    if (chance(0.8)) report.otDuties.push({...identity, employeeKey: person.employeeKey, caliberCode: person.employeeId, doors: 'D' + n, equipment: 'E' + n, category: 'DRIVER', logBooks: ['VLB'], books: 'BK' + n, trips: chance(0.2) ? 0 : 3});
    if (chance(0.7)) report.attendanceEquipment.push({...identity, employeeKey: lineKey, caliberCode: person.employeeId, doors: 'D' + n, equipment: 'E' + n, status: chance(0.2) ? 'Present — 0 trips' : 'Present — with trips', trips: 2, reason: '', remarks: chance(0.3) ? 'remark ' + n : '', logBooks: ['ELB']});
    if (chance(0.7)) report.performance.push({...identity, start: `${date} ${start}`, end: `${plus ? dayAfter(date) : date} ${end}`, km: 12});
    if (chance(0.4)) report.details.push({...identity, batchStatus: chance(0.5) ? 'Saved scan' : 'Manual'});
    if (chance(0.15)) report.exceptions.push({...identity, reason: 'Effective site shift schedule is missing or ambiguous; timing requires review.'});
    if (chance(0.1)) report.ot.push({site, siteKey, employeeId: person.employeeId, schedule: `${date} ${shift}: ${date} ${start} → ${plus ? dayAfter(date) : date} ${end}`});
    if (chance(0.1)) report.hrChanges.push({...identity, id: 'chg-' + n, mark: chance(0.5) ? 'absent' : 'present', employeeKey: person.employeeKey, by: 'hr', reason: 'checked', at: date + 'T10:00:00Z'});
  }
  return report;
}

const forSite = (report: unknown, site: string) => mapMisAttendance(report).filter(row => sameSite(site, row.site));

describe('one site of the MIS trip card feed', () => {
  it('gives the roster exactly the same lines for the site as the whole answer does', () => {
    let lines = 0, multipleSites = 0, cut = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const whole = madeUpReport(seed);
      for (const site of ['Majri OC', 'Sasti', 'Jayant OB']) {
        const trimmed = trimMisReport(whole, site, DATES[1], DATES[1]);
        const expected = forSite(whole, site), got = forSite(trimmed, site);
        expect(got, `seed ${seed}, ${site}`).toEqual(expected);
        lines += expected.length;
        multipleSites += expected.filter(row => row.verification === 'Same shift recorded at multiple sites').length;
        cut += whole.otDuties.length - trimmed.otDuties.length;
      }
    }
    // The made-up answers do hold the hard cases, and the cut does leave duties out.
    expect(lines).toBeGreaterThan(5000);
    expect(multipleSites).toBeGreaterThan(200);
    expect(cut).toBeGreaterThan(10000);
    // 300 made-up answers: a slower machine (GitHub's, at release) needs more than the usual 5 seconds.
  }, 60_000);

  it('keeps the signatures of the site\'s days and names the sites MIS had cards for', () => {
    const whole = madeUpReport(7), trimmed = trimMisReport(whole, 'Majri OC', DATES[1], DATES[1]);
    expect(trimmed.days.map(day => day.siteKey).sort()).toEqual([...new Set(whole.days.filter(day => /majri/.test(String(day.siteKey))).map(day => day.siteKey))].flatMap(key => DATES.map(() => key)).sort());
    expect(trimmed.signed).toBe(true);
    const expected = [...new Set(mapMisAttendance(whole).filter(row => row.date === DATES[1]).map(row => row.site))].sort();
    expect(trimmed.misSites).toEqual(expected);
  });
});
