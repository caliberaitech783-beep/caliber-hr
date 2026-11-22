import {api} from './api';
import {mapMisAttendance, type AttendanceRow} from './misAttendanceModel';
import {sameSite} from './rosterModel';
import type {Register} from './AttendanceRegister';

/* Fetching for the attendance roster (owner, 22 Nov 2026): the Trip card tab reads MIS, the Biometric tab reads the
   biometric register, each only for the site and dates the user chose. */
export const FIRST_TRIP_DATE = '2026-11-01';
/** Days read from MIS at the same time. Three at once left Sasti OC with 11 of 22 days failed (MIS busy / slow). */
export const TRIP_PARALLEL = 2;
/** Tries per day in the first pass, then again one day at a time for the days that still failed. */
export const TRIP_ATTEMPTS = 3;
const addDay = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => {const out: string[] = []; for (let d = from; d <= to; d = addDay(d)) out.push(d); return out;};
export const tripDays = (from: string, to: string) => {const start = from < FIRST_TRIP_DATE ? FIRST_TRIP_DATE : from; return start > to ? [] : daysBetween(start, to);};
export type DayState = 'queued' | 'loading' | 'retrying' | 'done' | 'failed';
export type DayUpdate = {day: string; state: DayState; rows?: AttendanceRow[]; sites?: string[]; error?: string; attempt?: number};
export type TripFetch = {rows: AttendanceRow[]; failed: string[]; error: string; misSites: string[]};
const NO_ACCESS = /outside your assigned access|permission|not allowed|sign in|session/i;
let pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Tests replace the wait between tries. */
export const setRetryPause = (fn: typeof pause) => {pause = fn;};

/** One day of MIS trip cards for the site, tried `attempts` times with a growing wait. */
async function readDay(grant: string, day: string, site: string, attempts: number, onRetry: (attempt: number, error: string) => void) {
  for (let attempt = 1; ; attempt++) {
    try {
      const data = await api<unknown>(grant, 'attendance/mis?' + new URLSearchParams({from: day, to: day}));
      // The feed also carries the day before (for night shifts); keep only this day so no duty is counted twice.
      const all = mapMisAttendance(data).filter(r => r.date === day);
      return {rows: all.filter(r => !site || sameSite(site, r.site)), sites: [...new Set(all.map(r => r.site).filter(Boolean))]};
    } catch (e) {
      const message = (e as Error).message || 'MIS did not answer';
      if (attempt >= attempts || NO_ACCESS.test(message)) throw new Error(message);
      onRetry(attempt + 1, message);
      await pause(1500 * attempt);
    }
  }
}

/**
 * MIS trip cards (VLB, ELB, LMV), one day per request, two days at a time, each day tried three times; the days that
 * still failed are tried again one at a time. `onDay` reports every day as it starts, retries, arrives or fails, so the
 * muster fills in day by day. `live()` false stops it (the user changed the site or dates).
 */
export async function streamTripCards(grant: string, days: string[], site: string, onDay: (update: DayUpdate) => void, live: () => boolean = () => true) {
  const failed = new Set<string>();
  let next = 0;
  for (const day of days) onDay({day, state: 'queued'});
  async function run(day: string, attempts: number) {
    if (!live()) return;
    onDay({day, state: 'loading'});
    try {
      const result = await readDay(grant, day, site, attempts, (attempt, error) => {if (live()) onDay({day, state: 'retrying', attempt, error});});
      failed.delete(day);
      if (live()) onDay({day, state: 'done', rows: result.rows, sites: result.sites});
    } catch (e) {
      failed.add(day);
      if (live()) onDay({day, state: 'failed', error: (e as Error).message});
    }
  }
  async function worker() {while (next < days.length && live()) await run(days[next++], TRIP_ATTEMPTS);}
  await Promise.all(Array.from({length: Math.min(TRIP_PARALLEL, days.length)}, worker));
  // Second pass: the failed days again, one at a time, when MIS is less busy.
  for (const day of [...failed].sort()) {
    if (!live()) break;
    await pause(1000);
    await run(day, TRIP_ATTEMPTS);
  }
  return [...failed].sort();
}

/** The whole range at once (the Weekly register's comparison): the same day-by-day reading, collected. */
export async function fetchTripCards(grant: string, from: string, to: string, site: string, onProgress?: (done: number, total: number) => void): Promise<TripFetch> {
  const days = tripDays(from, to), rows: AttendanceRow[] = [], misSites = new Set<string>(), finished = new Set<string>();
  let error = '';
  if (!days.length) return {rows, failed: [], error, misSites: []};
  onProgress?.(0, days.length);
  const failed = await streamTripCards(grant, days, site, update => {
    if (update.state === 'done') {rows.push(...update.rows || []); for (const s of update.sites || []) misSites.add(s);}
    if (update.state === 'failed') error = error || update.error || '';
    if (update.state === 'done' || update.state === 'failed') {finished.add(update.day); onProgress?.(finished.size, days.length);}
  });
  if (failed.length === days.length) throw new Error(error || 'The MIS attendance feed is temporarily unavailable.');
  return {rows, failed, error, misSites: [...misSites].sort()};
}

export type SiteMachine = {serial: string; name: string; location: string; online: boolean; lastContact: string | null; lastPunch: string; punches: number};
export type SiteRegister = Register & {site?: string; machines: SiteMachine[]};
/**
 * Biometric for a site (owner, 22 Nov 2026): every punch on that site's machines (Biometric machines › site), whoever
 * punched, with In / Out and each punch's machine; machine IDs not linked to an employee are included (linked: false).
 */
export async function fetchBiometric(grant: string, from: string, to: string, site: string): Promise<SiteRegister> {
  const register = await api<SiteRegister>(grant, 'attendance/site-register?' + new URLSearchParams({site, from, to}));
  return {...register, rows: Array.isArray(register?.rows) ? register.rows : [], machines: Array.isArray(register?.machines) ? register.machines : []};
}
export type FetchRequest = {id: string; state: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; punchesReceived: number; newPunches: number; error: string};
/** Fetch from these machines: asks the bridge PC to read each machine in turn and waits for it (2 s polls, 2 minutes a machine). */
export async function fetchFromMachines(grant: string, serials: string[], onStep: (serial: string, request: FetchRequest | null, error?: string) => void, wait = (ms: number) => new Promise(r => setTimeout(r, ms))) {
  for (const serial of serials) {
    try {
      let request = await api<FetchRequest>(grant, 'attendance/fetch', 'POST', {deviceSerial: serial});
      onStep(serial, request);
      for (let i = 0; i < 60 && (request.state === 'PENDING' || request.state === 'RUNNING'); i++) {
        await wait(2000);
        request = await api<FetchRequest>(grant, 'attendance/fetch/' + request.id);
        onStep(serial, request);
      }
    } catch (e) { onStep(serial, null, (e as Error).message); }
  }
}

/* Saved trip cards (owner, 22 Nov 2026): "Save trip cards" stores each day of the site's trip cards in HR
   (server/trip-card-store.mjs), and the Trip card tab opens the saved days at once, reading MIS only for the rest. */
export type SavedInfo = {savedBy: string; savedAt: string};
export type SavedDay = SavedInfo & {day: string; rows: AttendanceRow[]; duties: number};
export async function readSavedTripCards(grant: string, site: string, from: string, to: string) {
  const result = await api<{days?: SavedDay[]}>(grant, 'attendance/trip-cards?' + new URLSearchParams({site, from, to}));
  return Array.isArray(result?.days) ? result.days : [];
}
/** Saves the given days, one day per request (each under the 2 MB request limit), three at a time. */
export async function saveTripCards(grant: string, site: string, days: {day: string; rows: AttendanceRow[]}[], onDay: (day: string, info: SavedInfo | null, error?: string) => void) {
  let next = 0;
  const failed: string[] = [];
  async function worker() {
    while (next < days.length) {
      const {day, rows} = days[next++];
      try { onDay(day, await api<SavedInfo & {day: string}>(grant, 'attendance/trip-cards', 'POST', {site, day, rows})); }
      catch (e) { failed.push(day); onDay(day, null, (e as Error).message); }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, days.length)}, worker));
  return failed.sort();
}
