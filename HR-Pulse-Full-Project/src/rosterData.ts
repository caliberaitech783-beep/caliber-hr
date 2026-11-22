import {api} from './api';
import {mapMisAttendance, type AttendanceRow} from './misAttendanceModel';
import {sameSite} from './rosterModel';
import type {Register} from './AttendanceRegister';

/* Fetching for the attendance roster (owner, 22 Nov 2026): the Trip card tab reads MIS, the Biometric tab reads the
   biometric register, each only for the site and dates the user chose. */
export const FIRST_TRIP_DATE = '2026-11-01';
/** Days read from MIS at the same time; more would crowd Pulse-II's database pool. */
export const TRIP_PARALLEL = 3;
const addDay = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => {const out: string[] = []; for (let d = from; d <= to; d = addDay(d)) out.push(d); return out;};
/** rows: the chosen site's duties; misSites: every site name MIS returned (to show when none matched the chosen site). */
export type TripFetch = {rows: AttendanceRow[]; failed: string[]; error: string; misSites: string[]};

/**
 * MIS trip cards (VLB, ELB, LMV), one day per request, three at a time, each day tried twice, kept to the chosen site.
 * A whole month, and even a week, of every site took longer than the 30 second request limit ("signal timed out");
 * one day is what the Trip card and logbook page reads. Days that still fail are returned in `failed`, the rest is shown.
 */
export async function fetchTripCards(grant: string, from: string, to: string, site: string, onProgress?: (done: number, total: number) => void): Promise<TripFetch> {
  const start = from < FIRST_TRIP_DATE ? FIRST_TRIP_DATE : from;
  if (start > to) return {rows: [], failed: [], error: '', misSites: []};
  const days = daysBetween(start, to), rows: AttendanceRow[] = [], failed: string[] = [], misSites = new Set<string>();
  let next = 0, done = 0, error = '';
  onProgress?.(0, days.length);
  async function readDay(day: string) {
    for (let attempt = 1; ; attempt++) {
      try {
        const data = await api<unknown>(grant, 'attendance/mis?' + new URLSearchParams({from: day, to: day}));
        // The feed also carries the day before (for night shifts); keep only this day so no duty is counted twice.
        const all = mapMisAttendance(data).filter(r => r.date === day);
        for (const r of all) if (r.site) misSites.add(r.site);
        return all.filter(r => !site || sameSite(site, r.site));
      } catch (e) {
        const message = (e as Error).message;
        // No access is final; anything else (timeout, MIS busy) is tried once more.
        if (attempt >= 2 || /outside your assigned access|permission|not allowed/i.test(message)) throw e;
      }
    }
  }
  async function worker() {
    while (next < days.length) {
      const day = days[next++];
      try { rows.push(...await readDay(day)); }
      catch (e) { failed.push(day); error = error || (e as Error).message; }
      onProgress?.(++done, days.length);
    }
  }
  await Promise.all(Array.from({length: Math.min(TRIP_PARALLEL, days.length)}, worker));
  if (failed.length === days.length) throw new Error(error || 'The MIS attendance feed is temporarily unavailable.');
  return {rows, failed: failed.sort(), error, misSites: [...misSites].sort()};
}

/** Biometric register (punches rated with the HR policy), kept to the chosen site. */
export async function fetchBiometric(grant: string, from: string, to: string, site: string) {
  const register = await api<Register>(grant, `attendance/register?from=${from}&to=${to}`);
  const rows = Array.isArray(register?.rows) ? register.rows : [];
  return {...register, rows: site ? rows.filter(r => sameSite(site, r.site)) : rows};
}
