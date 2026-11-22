import {api} from './api';
import {mapMisAttendance, type AttendanceRow} from './misAttendanceModel';
import {sameSite, weekPieces} from './rosterModel';
import type {Register} from './AttendanceRegister';

/* Fetching for the attendance roster (owner, 22 Nov 2026): the Trip card tab reads MIS, the Biometric tab reads the
   biometric register, each only for the site and dates the user chose. */
export const FIRST_TRIP_DATE = '2026-11-01';

/** MIS trip cards (VLB, ELB, LMV) one week at a time (a whole month of every site timed out), kept to the chosen site. */
export async function fetchTripCards(grant: string, from: string, to: string, site: string, onProgress?: (done: number, total: number) => void) {
  const start = from < FIRST_TRIP_DATE ? FIRST_TRIP_DATE : from;
  if (start > to) return [];
  const pieces = weekPieces(start, to), rows: AttendanceRow[] = [];
  onProgress?.(0, pieces.length);
  for (const [i, piece] of pieces.entries()) {
    const data = await api<unknown>(grant, 'attendance/mis?' + new URLSearchParams(piece));
    // Each piece also carries the day before it (for night shifts); keep only its own dates so no duty is counted twice.
    rows.push(...mapMisAttendance(data).filter(r => r.date >= piece.from && r.date <= piece.to && (!site || sameSite(site, r.site))));
    onProgress?.(i + 1, pieces.length);
  }
  return rows;
}

/** Biometric register (punches rated with the HR policy), kept to the chosen site. */
export async function fetchBiometric(grant: string, from: string, to: string, site: string) {
  const register = await api<Register>(grant, `attendance/register?from=${from}&to=${to}`);
  const rows = Array.isArray(register?.rows) ? register.rows : [];
  return {...register, rows: site ? rows.filter(r => sameSite(site, r.site)) : rows};
}
