type DutyIdentity = {
  date: string;
  site: string;
  siteKey?: string;
  shift: string;
  employeeId: string;
  employeeName: string;
};
type EquipmentDuty = DutyIdentity & {
  employeeKey: string;
  caliberCode?: string;
  doors: string;
  equipment: string;
  status: string;
  trips: number | null;
  reason: string;
  remarks: string;
  logBooks?: string[];
};
type SavedDuty = DutyIdentity & {
  employeeKey: string;
  caliberCode?: string;
  doors: string;
  equipment: string;
  category: string;
  logBooks: string[];
  books: string;
  trips: number | null;
};
type MisReport = {
  attendanceEquipment: EquipmentDuty[];
  attendanceShifts: {siteKey: string; date: string; shift: string; state: string; batch: string; start?: string; end?: string}[];
  otDuties: SavedDuty[];
  ot: {site: string; siteKey?: string; employeeId: string; schedule: string}[];
  performance: (DutyIdentity & {start: string; end: string; km: number | null})[];
  details: (DutyIdentity & {batchStatus: string})[];
  exceptions: (DutyIdentity & {reason: string})[];
  corrections?: AttendanceCorrection[];
  hrChanges?: HrChange[];
};
/** A change HR Pulse made in Pulse-II with an OTP (owner, 27 Nov 2026: Pulse-II is the master of trip card attendance).
    absent: the trip card is kept, only its attendance is not counted; present: a Present entry made in Pulse-II. */
export type HrChange = DutyIdentity & {id: string; mark: 'absent' | 'present'; employeeKey?: string; by: string; reason: string; at: string};
export type CorrectionStatus = 'mis' | 'present' | 'absent' | 'pending';
export type AttendanceCorrection = {
  id: string; status: CorrectionStatus; start: string; end: string; reason: string;
  version: number; updatedBy: string; updatedAt: string;
  /** An absent / pending kept only in HR Pulse before 27 Nov 2026: shown, never applied. */
  retired?: boolean;
};
/** Present / absent is decided in Pulse-II; a correction kept only in HR Pulse that said otherwise no longer counts. */
export const retiredCorrection = (c?: AttendanceCorrection) => Boolean(c && (c.retired || c.status === 'absent' || c.status === 'pending'));
type Window = {start: string; end: string; startMs: number; endMs: number};
export type AttendanceRow = DutyIdentity & {
  id: string;
  employeeKey: string;
  caliberCode?: string;
  designation: string;
  sources: string[];
  equipment: string[];
  references: string;
  note: string;
  output: string;
  window?: Window;
  status: 'Present' | 'Present · 0 trips' | 'Absent' | 'Pending';
  correction?: AttendanceCorrection;
  /** What HR Pulse changed for this duty in Pulse-II (with an OTP). */
  hrChange?: HrChange;
  verification: string;
  verified: boolean;
  otHours: number | null;
  otNote: string;
};

const hour = 3_600_000;
const siteKey = (site: string) => site.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const shiftKey = (site: string, date: string, shift: string) => JSON.stringify([siteKey(site), date, shift]);
const dutyKey = ({site, siteKey: canonical, date, shift, employeeId}: DutyIdentity) =>
  JSON.stringify([shiftKey(canonical || site, date, shift), employeeId.trim().toUpperCase()]);
const existingValues = (...values: string[]) => [...new Set(values.filter(Boolean))];
const parseWindow = (start: string, end: string): Window | undefined => {
  const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
  if (!stamp.test(start) || !stamp.test(end)) return;
  const startMs = Date.parse(start.replace(' ', 'T') + ':00+05:30');
  const endMs = Date.parse(end.replace(' ', 'T') + ':00+05:30');
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return {start, end, startMs, endMs};
  }
};
const nextShift: Record<string, string> = {S1: 'S2', S2: 'S3', S3: 'S1'};
const dateAfter = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') + 24 * hour).toISOString().slice(0, 10);
const consecutive = (a: DutyIdentity, b: DutyIdentity) =>
  nextShift[a.shift] === b.shift && b.date === (a.shift === 'S3' ? dateAfter(a.date) : a.date);
const presentStatus = (zero: boolean) => zero ? 'Present · 0 trips' : 'Present';

export function mapMisAttendance(value: unknown): AttendanceRow[] {
  if (!value || typeof value !== 'object') throw new Error('MIS returned an invalid attendance report.');
  const report = value as MisReport;
  if (![report.attendanceEquipment, report.attendanceShifts, report.otDuties, report.ot,
    report.performance, report.details, report.exceptions].every(Array.isArray)) {
    throw new Error('MIS returned an incomplete attendance report.');
  }

  const equipment = new Map<string, EquipmentDuty[]>();
  for (const entry of report.attendanceEquipment) {
    const id = dutyKey(entry);
    equipment.set(id, [...(equipment.get(id) || []), entry]);
  }
  const saved = new Map(report.otDuties.map(row => [dutyKey(row), row]));
  const batches = new Map(report.attendanceShifts.map(row => [shiftKey(row.siteKey, row.date, row.shift), row]));
  const performance = new Map(report.performance.map(row => [dutyKey(row), row]));
  const corrections = new Map((report.corrections || []).map(row => [row.id, row]));
  const scheduleByShift = new Map<string, Window>();
  const conflictingSchedules = new Set<string>();
  for (const row of report.performance) {
    const key = shiftKey(row.siteKey || row.site, row.date, row.shift);
    const window = parseWindow(row.start, row.end);
    if (!window) continue;
    const prior = scheduleByShift.get(key);
    if (prior && (prior.start !== window.start || prior.end !== window.end)) conflictingSchedules.add(key);
    scheduleByShift.set(key, window);
  }
  const scanned = new Set(report.details.filter(row => row.batchStatus === 'Saved scan').map(dutyKey));
  const exceptions = new Map(report.exceptions
    .filter(row => /conflict|ambiguous|schedule is missing|shift start differs/i.test(row.reason) && row.employeeId)
    .map(row => [dutyKey(row), row.reason]));
  const eventWindows = new Map<string, Window>();
  const conflictingWindows = new Set<string>();
  for (const event of report.ot) {
    for (const item of event.schedule.split('; ')) {
      const match = item.match(/^(\d{4}-\d{2}-\d{2}) (\w+): (.+) → (.+)$/);
      if (!match) continue;
      const [, date, shift, start, end] = match;
      const window = parseWindow(start, end);
      if (!window) continue;
      const id = dutyKey({...event, date, shift, employeeName: ''});
      const prior = eventWindows.get(id);
      if (prior && (prior.start !== start || prior.end !== end)) conflictingWindows.add(id);
      eventWindows.set(id, window);
    }
  }

  const rows = [...new Set([...equipment.keys(), ...saved.keys()])].map((id): AttendanceRow => {
    const lines = equipment.get(id) || [];
    const card = saved.get(id);
    const primary = card || lines[0];
    const shift = shiftKey(primary.siteKey || primary.site, primary.date, primary.shift);
    const batch = batches.get(shift);
    const detail = performance.get(id);
    const ownWindow = detail && parseWindow(detail.start, detail.end);
    const batchWindow = batch?.start && batch.end ? parseWindow(batch.start, batch.end) : undefined;
    const window = ownWindow || eventWindows.get(id) || batchWindow || scheduleByShift.get(shift);
    const zero = lines.some(row => row.status === 'Present — 0 trips') || card?.trips === 0;
    const books = existingValues(...(card?.logBooks || []), ...lines.flatMap(row => row.logBooks || []));
    const sources = books.map(book => ({VLB: 'Trip card', ELB: 'Job card', LMV: 'Vehicle logbook'}[book] || book));
    if (zero) sources.push('Zero trip');
    if (scanned.has(id)) sources.push('Card scan');
    const usableTrips = lines.flatMap(row => row.trips === null ? [] : [row.trips]);
    const trips = card?.trips ?? (usableTrips.length ? usableTrips.reduce((sum, n) => sum + n, 0) : null);
    const verificationIssue = exceptions.get(id) ||
      (conflictingWindows.has(id) || conflictingSchedules.has(shift) ? 'Conflicting shift times' : '');
    const verified = batch?.state === 'closed' && !verificationIssue;
    const verification = verificationIssue || (verified ? 'MIS batch closed' :
      batch?.state === 'not_due' ? 'Shift in progress' : batch?.state === 'none' || !batch ? 'Awaiting MIS batch' : 'MIS batch open');

    return {
      id, date: primary.date, site: primary.site, siteKey: primary.siteKey, shift: primary.shift, employeeId: primary.employeeId,
      employeeKey: primary.employeeKey, employeeName: primary.employeeName, caliberCode: primary.caliberCode,
      designation: card?.category || '', sources: sources.length ? sources : ['MIS attendance'],
      equipment: existingValues(...[card?.doors || '', ...lines.map(row => row.doors)].flatMap(doors => doors.split('; '))),
      references: existingValues(card?.books || '', batch?.batch || '').join(' · '),
      note: existingValues(...lines.flatMap(row => [row.reason, row.remarks])).join(' · '),
      output: trips !== null ? `${trips} ${trips === 1 ? 'trip' : 'trips'}` : detail?.km != null ? `${detail.km} km` : '',
      window, status: verified ? presentStatus(zero) : 'Pending', verification,
      verified: Boolean(verified), otHours: null, otNote: ''
    };
  });

  // What HR Pulse changed in Pulse-II: a duty marked absent is no longer sent as a duty, so it is listed here as an
  // Absent line (the card is kept in Pulse-II); a Present entry HR made is one of the lines above and carries the change.
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const change of Array.isArray(report.hrChanges) ? report.hrChanges : []) {
    if (!change || typeof change.employeeId !== 'string' || typeof change.date !== 'string') continue;
    const id = dutyKey(change), held = byId.get(id);
    if (held) { held.hrChange = change; continue; }
    if (change.mark !== 'absent') continue;
    const row: AttendanceRow = {
      id, date: change.date, site: change.site, siteKey: change.siteKey, shift: change.shift, employeeId: change.employeeId,
      employeeKey: change.employeeKey || change.employeeId, employeeName: change.employeeName, caliberCode: change.employeeKey || '',
      designation: '', sources: ['HR change'], equipment: [], references: '', note: existingValues(change.reason, change.by).join(' · '), output: '',
      status: 'Absent', verification: 'Marked absent in HR Pulse (OTP) · trip card kept in MIS', verified: true, otHours: null, otNote: '', hrChange: change
    };
    rows.push(row);
    byId.set(id, row);
  }

  const slots = new Map<string, AttendanceRow[]>();
  const timelines = new Map<string, AttendanceRow[]>();
  for (const row of rows) {
    const slot = JSON.stringify([row.employeeKey, row.date, row.shift]);
    slots.set(slot, [...(slots.get(slot) || []), row]);
    const timeline = JSON.stringify([row.employeeKey, siteKey(row.siteKey || row.site)]);
    timelines.set(timeline, [...(timelines.get(timeline) || []), row]);
  }
  for (const row of rows) {
    const correction = corrections.get(row.id);
    if (!correction) continue;
    row.correction = correction;
    if (correction.status === 'mis' || retiredCorrection(correction)) continue;
    row.verified = correction.status !== 'pending';
    row.status = correction.status === 'present' ? presentStatus(row.sources.includes('Zero trip')) :
      correction.status === 'absent' ? 'Absent' : 'Pending';
    row.verification = 'Corrected by HR';
    if (correction.start && correction.end) {
      const endDate = correction.end < correction.start ? dateAfter(row.date) : row.date;
      row.window = parseWindow(`${row.date} ${correction.start}`, `${endDate} ${correction.end}`);
    }
  }
  for (const sameSlot of slots.values()) {
    const held = sameSlot.filter(row => row.status !== 'Absent');
    if (held.length < 2) continue;
    for (const row of held) {
      row.verified = false;
      row.status = 'Pending';
      row.verification = 'Same shift recorded at multiple sites';
    }
  }

  for (const duties of timelines.values()) {
    const scheduled = duties.filter(row => row.window && row.status !== 'Absent').sort((a, b) => a.window!.startMs - b.window!.startMs);
    const pairs = new Map<AttendanceRow, AttendanceRow[]>();
    for (let i = 1; i < scheduled.length; i++) {
      const a = scheduled[i - 1], b = scheduled[i];
      if (!consecutive(a, b) || a.window!.endMs !== b.window!.startMs) continue;
      pairs.set(a, [...(pairs.get(a) || []), b]);
      pairs.set(b, [...(pairs.get(b) || []), a]);
    }
    for (const row of duties) {
      if (row.status === 'Absent') {
        row.otHours = 0;
        continue;
      }
      if (!row.verified || !row.window) {
        row.otNote = row.window ? 'Awaiting verification' : 'Shift timing unavailable';
        continue;
      }
      const related = pairs.get(row) || [];
      if (related.some(other => pairs.get(other)!.length > 1) || related.length > 1) {
        row.otNote = 'Review consecutive duties';
      } else if (related.length) {
        const other = related[0];
        if (!other.verified) row.otNote = 'Awaiting second duty verification';
        else if ([row, other].every(d => d.window!.endMs - d.window!.startMs === 8 * hour)) {
          row.otHours = row.window.startMs > other.window!.startMs ? 8 : 0;
        } else row.otNote = 'Review shift duration';
      } else if (duties.some(other => other.status !== 'Absent' && !other.window && (consecutive(row, other) || consecutive(other, row)))) {
        row.otNote = 'Review shift timing';
      } else row.otHours = 0;
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.site.localeCompare(b.site) ||
    a.employeeName.localeCompare(b.employeeName) || a.shift.localeCompare(b.shift));
}
