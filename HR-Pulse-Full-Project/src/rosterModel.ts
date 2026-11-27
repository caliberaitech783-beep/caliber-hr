/* Attendance roster: trip card line against biometric line (owner, 22 Nov 2026).
   Every employee has two lines in the monthly roster: "Trip Card" (MIS trip cards / log books: a saved card is
   Present, whatever its hours) and "Bio Matric" (biometric punches, the server register). Weekly off, holiday,
   leave, comp off and OD come from the HR records and are shown on both lines. The last column,
   "Diff. of Trip Card and Bio-matric", counts the days the two lines disagree; pressing it lists those days. */
import {DEFAULT_POLICY, type AttendancePolicy} from '../server/attendance-policy.mjs';
import type {AttendanceRow} from './misAttendanceModel';
import type {RegisterDay, RegisterRow} from './AttendanceRegister';

export type TripDuty = {shift: string; site: string; equipment: string; time: string; output: string; status: string; verification: string; code: string; cards: string[]};
/** MIS card sources → the card names HR uses: VLB trip card, ELB job card, LMV vehicle log book. */
export const CARD_TYPES: [string, string][] = [['Trip card', 'VLB'], ['Job card', 'ELB'], ['Vehicle logbook', 'LMV']];
export const cardTypes = (sources: string[]) => CARD_TYPES.filter(([source]) => sources.includes(source)).map(([, card]) => card);
/** HR site names and MIS site names are written differently ("Jayant" / "Jayant OB"): compare letters and digits only. */
const siteWords = (site: string) => String(site || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Words that only say what kind of site it is: "Sasti OC", "Sasti OCP" and "Sasti" are the same site.
const SITE_KIND = new Set(['ob', 'oc', 'ocp', 'ocm', 'opencast', 'coal', 'mine', 'mines', 'project', 'site', 'colliery']);
const placeWords = (site: string) => {const words = siteWords(site).split(' ').filter(Boolean), place = words.filter(w => !SITE_KIND.has(w)); return place.length ? place : words;};
export function sameSite(hrSite: string, misSite: string) {
  const a = siteWords(hrSite), b = siteWords(misSite);
  if (!a || !b) return false;
  if (a === b || (' ' + b + ' ').includes(' ' + a + ' ') || (' ' + a + ' ').includes(' ' + b + ' ')) return true;
  const pa = placeWords(hrSite), pb = placeWords(misSite);
  return pa.every(w => pb.includes(w)) || pb.every(w => pa.includes(w));
}
/** The roster's dates in week-long pieces, so each MIS trip card request stays well inside the time limit. */
export function weekPieces(from: string, to: string) {
  const pieces: {from: string; to: string}[] = [];
  const day = 86_400_000;
  for (let start = Date.parse(from + 'T00:00:00Z'); start <= Date.parse(to + 'T00:00:00Z'); start += 7 * day) {
    const end = Math.min(start + 6 * day, Date.parse(to + 'T00:00:00Z'));
    pieces.push({from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10)});
  }
  return pieces;
}
export type TripDay = {date: string; code: string; duties: TripDuty[]};
export type Mismatch = {date: string; trip: string; bio: string; reason: string; tripDetail: string; bioDetail: string};
export type RosterGroup = {
  key: string; code: string; aFormNo?: string; name: string; site: string; department: string; designation: string; shift: string; exempt: boolean;
  /** Biometric register line; undefined when the employee has no linked biometric ID. */
  bio?: RegisterRow;
  bioCodes: Record<string, string>;
  tripCodes: Record<string, string>;
  tripDays: Record<string, TripDay>;
  hasTripCards: boolean;
  mismatches: Mismatch[];
  pending: number;
  /** Biometric by site: the machines and IDs punched on, and false for a machine ID not linked to an employee. */
  machines: string[];
  linked: boolean;
};

const CALENDAR = new Set(['WO', 'H', 'L', 'CO', 'OD']);
const WORKED = new Set(['P', 'HD', 'IN', 'MP']);
const RANK: Record<string, number> = {P: 3, HD: 2, A: 1};
const normal = (value?: string) => String(value || '').trim().toUpperCase();
const identityNumber = (value?: string) => {
  const digits=normal(value).match(/\d+$/)?.[0]||'';
  return digits.replace(/^0+(?=\d)/,'');
};
const identityName = (value?: string) => normal(value).replace(/[^A-Z0-9]+/g,'');
const hm = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(11, 16);
const hoursText = (minutes: number | null) => minutes == null ? '' : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
const LABEL: Record<string, string> = {P: 'Present', HD: 'Half day', A: 'Absent', WO: 'Weekly off', H: 'Holiday', CO: 'Comp off', L: 'Leave', OD: 'On duty', MP: 'Miss punch', IN: 'In, no Out yet', '?': 'Trip card not verified yet', '': 'No record'};
export const codeLabel = (code: string) => LABEL[code] ?? code;

/** A trip card duty: a saved VLB / ELB / LMV card (trip card punched) marks the driver or operator Present, whatever
    its hours (owner, 23 Nov 2026: the 4-hour half day rule no longer applies to trip cards). Absent only when HR marks it. */
export function tripDutyCode(row: AttendanceRow): string {
  if (row.status === 'Absent') return 'A';
  if (!row.verified || row.status === 'Pending') return '?';
  return 'P';
}

/** One code per employee and date from that day's trip card duties (best duty wins; any unverified duty with no verified one is "?"). */
export function tripCardDays(rows: AttendanceRow[]) {
  const byEmployee = new Map<string, {name: string; site: string; designation: string; days: Record<string, TripDay>}>();
  for (const row of rows) {
    const key = normal(row.caliberCode || row.employeeId);
    if (!key) continue;
    const person = byEmployee.get(key) || {name: row.employeeName, site: row.site, designation: row.designation, days: {}};
    const day = person.days[row.date] || {date: row.date, code: '', duties: []};
    const code = tripDutyCode(row);
    day.duties.push({shift: row.shift, site: row.site, equipment: row.equipment.join(', '), output: row.output, status: row.status, verification: row.verification, code, cards: cardTypes(row.sources),
      time: row.window ? `${hm(row.window.startMs)}–${hm(row.window.endMs)}` : ''});
    const verified = day.duties.filter(d => d.code !== '?');
    day.code = verified.length ? verified.map(d => d.code).sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] : '?';
    person.days[row.date] = day;
    byEmployee.set(key, person);
  }
  return byEmployee;
}

/** VLB / ELB / LMV with the number of days each card type was used. */
export const cardSummary = (group: RosterGroup, dates: string[]) => {
  const count = new Map<string, number>();
  for (const date of dates) for (const card of new Set(group.tripDays[date]?.duties.flatMap(d => d.cards) || [])) count.set(card, (count.get(card) || 0) + 1);
  return CARD_TYPES.map(([, card]) => card).filter(card => count.has(card)).map(card => `${card} ${count.get(card)}`).join(' · ');
};
const tripText = (day?: TripDay) => day?.duties.map(d => [d.cards.join('/'), d.shift, d.site, d.equipment, d.time, d.output, d.verification].filter(Boolean).join(' · ')).join(' | ') || 'No trip card';
const bioText = (day?: RegisterDay) => !day ? 'No biometric record' :
  [day.in || day.out ? `${day.in || '?'}–${day.out || '?'}` : 'No punch', hoursText(day.workedMinutes), day.note].filter(Boolean).join(' · ');

function difference(trip: string, bio: string): string {
  if (trip === bio || trip === '?' || (trip === 'P' && bio === 'IN')) return '';
  if (!bio) return 'Trip card on duty, no biometric record';
  if (WORKED.has(trip) && !WORKED.has(bio)) return `Trip card ${codeLabel(trip).toLowerCase()}, biometric ${codeLabel(bio).toLowerCase()}`;
  if (!WORKED.has(trip) && WORKED.has(bio)) return bio === 'MP' ? 'Biometric miss punch, no trip card duty' : `Biometric ${codeLabel(bio).toLowerCase()}, no trip card duty`;
  if (bio === 'MP') return 'Trip card on duty, biometric miss punch';
  return `Trip card ${codeLabel(trip).toLowerCase()}, biometric ${codeLabel(bio).toLowerCase()}`;
}

/**
 * Joins the biometric register and the trip cards on the employee code (Caliber code). Employees with trip cards
 * but no linked biometric ID are added with an empty biometric line. `dates` are the roster's dates; `today`
 * stops the trip card line (and its absences) at today.
 */
export function buildRoster(register: RegisterRow[], trips: AttendanceRow[] | null, dates: string[], today: string, policy: AttendancePolicy = DEFAULT_POLICY,
  /** While MIS is still being read: only these days have trip cards; the others stay blank and are not compared. */
  tripRead?: Set<string>,
  /** While the Biometric tab is still being read: only these days have punches; the others stay blank and are not compared. */
  bioRead?: Set<string>): RosterGroup[] {
  const tripPeople = trips ? tripCardDays(trips) : new Map();
  const groups: RosterGroup[] = register.map(row => ({
    key: row.id, code: row.code, aFormNo: row.aFormNo || '', name: row.name, site: row.site, department: row.department || '', designation: row.designation, shift: row.shift, exempt: row.exempt,
    bio: row, bioCodes: {}, tripCodes: {}, tripDays: {}, hasTripCards: false, mismatches: [], pending: 0,
    machines: row.machinesUsed || [], linked: row.linked !== false
  }));
  const byCode = new Map(groups.filter(g => g.code).map(g => [normal(g.code), g]));
  for (const [code, person] of tripPeople) {
    let group = byCode.get(code);
    // Pulse-II may retain an older Caliber prefix (for example CMPL8812) while Employee Master uses
    // CMLL8812. Resolve that alias only when number, employee name and site identify one unique person;
    // ambiguous values remain separate instead of attaching somebody else's trip card.
    if (!group) {
      const number=identityNumber(code),name=identityName(person.name);
      const aliases=number&&name?groups.filter(candidate=>identityNumber(candidate.code)===number&&identityName(candidate.name)===name&&sameSite(candidate.site,person.site)):[];
      if(aliases.length===1)group=aliases[0];
    }
    if (!group) {
      group = {key: 'mis:' + code, code, aFormNo: '', name: person.name, site: person.site, department: '', designation: person.designation, shift: '', exempt: false,
        bioCodes: {}, tripCodes: {}, tripDays: {}, hasTripCards: false, mismatches: [], pending: 0, machines: [], linked: true};
      groups.push(group);
      byCode.set(code, group);
    }
    group.tripDays = person.days;
    group.hasTripCards = Object.keys(person.days).some(date => dates.includes(date));
  }
  for (const group of groups) {
    const days = new Map((group.bio?.days || []).map(d => [d.date, d]));
    for (const date of dates) {
      if (date > today) continue;
      const day = days.get(date);
      const bioUnread = Boolean(bioRead && !bioRead.has(date));
      const bio = bioUnread ? '' : day?.status || '';
      if (!bioUnread) group.bioCodes[date] = bio;
      if (!trips || !group.hasTripCards || (tripRead && !tripRead.has(date))) continue;
      if (bioUnread) {const read = group.tripDays[date]?.code || ''; if (read) group.tripCodes[date] = read; continue;}
      const calendar = day?.calendar || (CALENDAR.has(bio) ? bio : '');
      const tripDay = group.tripDays[date];
      // Without a biometric line there is no HR calendar to tell a weekly off from an absence: leave such days blank.
      const trip = tripDay?.code || calendar || (group.bio && date < today ? 'A' : '');
      group.tripCodes[date] = trip;
      if (trip === '?') group.pending++;
      if (!trip && !bio) continue;
      const reason = difference(trip, bio);
      if (reason) group.mismatches.push({date, trip, bio, reason, tripDetail: tripText(tripDay), bioDetail: bioText(day)});
    }
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

export type LineTotals = {totalDays: number; present: number; half: number; absent: number; weeklyOff: number; holiday: number; compOff: number; leave: number; onDuty: number; missPunch: number; lateEarly: number; cuts: number; paidDays: number};
/** Totals of one roster line. Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty. */
export function lineTotals(codes: Record<string, string>, dates: string[], extra: {lateEarly?: number; cuts?: number} = {}): LineTotals {
  const list = dates.map(d => codes[d] || '');
  const count = (...wanted: string[]) => list.filter(c => wanted.includes(c)).length;
  const t = {totalDays: dates.length, present: count('P', 'IN'), half: count('HD'), absent: count('A'), weeklyOff: count('WO'), holiday: count('H'), compOff: count('CO'),
    leave: count('L'), onDuty: count('OD'), missPunch: count('MP'), lateEarly: extra.lateEarly || 0, cuts: extra.cuts || 0, paidDays: 0};
  t.paidDays = Math.max(0, Math.round((t.present + t.half / 2 - t.cuts / 2 + t.weeklyOff + t.holiday + t.compOff + t.leave + t.onDuty) * 100) / 100);
  return t;
}
