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
export type DayUpdate = {day: string; state: DayState; rows?: AttendanceRow[]; sites?: string[]; error?: string; attempt?: number;
  /** What Pulse-II signed for this site and day ('' while Pulse-II does not sign yet). */
  signature?: string};
/* Pulse-II is the master of trip card attendance (owner, 27 Nov 2026). It signs every site-day it sends; HR Pulse shows a
   saved day only while that signature is still the one Pulse-II gives. */
export type MisDay = {siteKey: string; date: string; signature: string; lines?: number};
/** The signature of the site's day: every MIS site that is this site, in a fixed order. 'none': Pulse-II holds no
    closed day for it. '': Pulse-II did not sign (an older Pulse-II). */
export function misDaySignature(days: MisDay[] | undefined, site: string, day: string) {
  if (!Array.isArray(days)) return '';
  const mine = days.filter(d => d && d.date === day && typeof d.siteKey === 'string' && typeof d.signature === 'string' && (!site || sameSite(site, d.siteKey)));
  return mine.map(d => d.siteKey + ':' + d.signature).sort().join(',').slice(0, 400) || 'none';
}
export type TripFetch = {rows: AttendanceRow[]; failed: string[]; error: string; misSites: string[]};
const NO_ACCESS = /outside your assigned access|permission|not allowed|sign in|session/i;
let pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** Tests replace the wait between tries. */
export const setRetryPause = (fn: typeof pause) => {pause = fn;};

/** One day of MIS trip cards for the site, tried `attempts` times with a growing wait. */
async function readDay(grant: string, day: string, site: string, attempts: number, onRetry: (attempt: number, error: string) => void, refresh = false) {
  for (let attempt = 1; ; attempt++) {
    try {
      const data = await api<unknown>(grant, 'attendance/mis?' + new URLSearchParams({from: day, to: day, ...(site ? {site, trim: '1'} : {}), ...(refresh ? {refresh: '1'} : {})}));
      // The feed also carries the day before (for night shifts); keep only this day so no duty is counted twice.
      const all = mapMisAttendance(data).filter(r => r.date === day);
      // trim: for one site the server sends that site only (server/mis-trim.mjs; one day of every site was 15.9 MB) and
      // names in misSites the sites MIS had cards for. A server from before 28 Nov 2026 sends every site, as before.
      const signed = data as {days?: MisDay[]; signed?: boolean; misSites?: unknown};
      const misSites = Array.isArray(signed?.misSites) ? signed.misSites.filter((s): s is string => typeof s === 'string') : [...new Set(all.map(r => r.site).filter(Boolean))];
      return {rows: all.filter(r => !site || sameSite(site, r.site)), sites: misSites,
        signature: signed?.signed === false ? '' : misDaySignature(signed?.days, site, day)};
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
export async function streamTripCards(grant: string, days: string[], site: string, onDay: (update: DayUpdate) => void, live: () => boolean = () => true, refresh = false) {
  const failed = new Set<string>();
  let next = 0;
  for (const day of days) onDay({day, state: 'queued'});
  async function run(day: string, attempts: number) {
    if (!live()) return;
    onDay({day, state: 'loading'});
    try {
      const result = await readDay(grant, day, site, attempts, (attempt, error) => {if (live()) onDay({day, state: 'retrying', attempt, error});}, refresh);
      failed.delete(day);
      if (live()) onDay({day, state: 'done', rows: result.rows, sites: result.sites, signature: result.signature});
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

export type SiteMachine = {serial: string; name: string; location: string; ipAddress?: string; bridgeName?: string; online: boolean; lastContact: string | null; lastPunch: string; punches: number};
export type SiteRegister = Register & {site?: string; machines: SiteMachine[]; canCorrect?: boolean; failedDays?: string[]; dayErrors?: Record<string,string>};
/**
 * Biometric for a site (owner, 22 Nov 2026): every punch on that site's machines (Biometric machines › site), whoever
 * punched, with In / Out and each punch's machine; machine IDs not linked to an employee are included (linked: false).
 */
export const BIO_DAY_TIMEOUT_MS = 60_000;
export async function fetchBiometric(grant: string, from: string, to: string, site: string): Promise<SiteRegister> {
  // A site's day reads every punch on its machines and the HR records of everyone who punched: wait up to a minute.
  const register = await api<SiteRegister>(grant, 'attendance/site-register?' + new URLSearchParams({site, from, to}), 'GET', undefined, BIO_DAY_TIMEOUT_MS);
  return {...register, rows: Array.isArray(register?.rows) ? register.rows : [], machines: Array.isArray(register?.machines) ? register.machines : []};
}
/* Manual Biometric fills in day by day (owner, 28 Nov 2026), as the Biometric tab does: until then a month showed nothing
   until its last day had arrived. `days`: each day's reading state; `counts`: the punches of a day that was read;
   `partial`: the days read so far, joined (sent only when another day has arrived). In `partial` the days still to come
   are listed in failedDays, so the roster leaves them blank instead of calling them absent. */
export type ManualProgress={days:Record<string,DayState>;counts:Record<string,number>;errors:Record<string,string>;partial?:SiteRegister};
export async function fetchManualBiometric(grant:string,from:string,to:string,site:string,onProgress?:(progress:ManualProgress)=>void,source:'manual1'|'manual2'='manual1'):Promise<SiteRegister>{
 const days=daysBetween(from,to),results:SiteRegister[]=[],dayErrors:Record<string,string>={};let next=0;
 const states:Record<string,DayState>=Object.fromEntries(days.map(day=>[day,'queued' as DayState])),counts:Record<string,number>={};
 const tell=(arrived=false)=>{
  if(!onProgress)return;
  const joined=arrived?joinBiometricDays(results):null;
  onProgress({days:{...states},counts:{...counts},errors:{...dayErrors},...(joined?{partial:{...joined,from,to,failedDays:days.filter(day=>states[day]!=='done'),dayErrors:{...dayErrors}}}:{})});
 };
 tell();
 async function worker(){while(next<days.length){const day=days[next++];states[day]='loading';tell();for(let attempt=1;attempt<=TRIP_ATTEMPTS;attempt++)try{
   const endpoint=source==='manual2'?'attendance/manual-biometric-ii':'attendance/manual-biometric';
   const register=await api<SiteRegister>(grant,endpoint+'?'+new URLSearchParams({site,from:day,to:day}),'GET',undefined,BIO_DAY_TIMEOUT_MS);
   const machines=Array.isArray(register?.machines)?register.machines:[];
   results.push({...register,rows:Array.isArray(register?.rows)?register.rows:[],machines});delete dayErrors[day];
   states[day]='done';counts[day]=machines.reduce((sum,machine)=>sum+(Number(machine.punches)||0),0);tell(true);break;
  }catch(error){
   dayErrors[day]=(error as Error).message||'HR did not answer';
   if(attempt>=TRIP_ATTEMPTS||NO_ACCESS.test(dayErrors[day])){states[day]='failed';tell();break;}
   states[day]='retrying';tell();await pause(1500*attempt);
  }}
 }
 await Promise.all(Array.from({length:Math.min(2,days.length)},worker));
 const joined=joinBiometricDays(results);
 if(!joined)throw new Error(Object.values(dayErrors)[0]||'Manual biometric attendance could not be read.');
 return {...joined,from,to,failedDays:Object.keys(dayErrors).sort(),dayErrors};
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
export type SavedDay = SavedInfo & {day: string; rows: AttendanceRow[]; duties: number; signature?: string};
export async function readSavedTripCards(grant: string, site: string, from: string, to: string) {
  const result = await api<{days?: SavedDay[]}>(grant, 'attendance/trip-cards?' + new URLSearchParams({site, from, to}));
  return Array.isArray(result?.days) ? result.days : [];
}
/** How long the roster waits for Pulse-II's signatures before it shows the saved days unchecked. Asked once, never retried. */
export const SAVED_CHECK_TIMEOUT_MS = 15_000;
/**
 * Which saved days are still what Pulse-II holds. One small question to Pulse-II (signatures only, no cards) about the
 * days that carry a signature: a day whose signature differs is stale and is read from MIS again.
 * unsigned: days saved before Pulse-II signed days (27 Nov 2026). They cannot be compared and are shown as saved; they
 *   are checked once somebody reads them from MIS (Fetch again) and saves them. They are not all read again by
 *   themselves: on the first evening that put twenty MIS reads beside the Manual Biometric read and it timed out.
 * checked false: Pulse-II could not be asked in time (or does not sign yet); the signed days are then shown as saved.
 */
export async function checkSavedTripCards(grant: string, site: string, saved: SavedDay[]): Promise<{fresh: SavedDay[]; stale: string[]; unsigned: string[]; checked: boolean}> {
  const signed = saved.filter(d => Boolean(d.signature)), unsigned = saved.filter(d => !d.signature).map(d => d.day).sort();
  if (!signed.length) return {fresh: saved, stale: [], unsigned, checked: true};
  const days = signed.map(d => d.day).sort();
  try {
    const answer = await api<{supported?: boolean; days?: MisDay[]}>(grant, 'attendance/mis/days?' + new URLSearchParams({from: days[0], to: days[days.length - 1]}), 'GET', undefined, SAVED_CHECK_TIMEOUT_MS);
    if (!answer?.supported || !Array.isArray(answer.days)) return {fresh: saved, stale: [], unsigned, checked: false};
    const stale = signed.filter(d => d.signature !== misDaySignature(answer.days, site, d.day)).map(d => d.day).sort();
    return {fresh: saved.filter(d => !stale.includes(d.day)), stale, unsigned, checked: true};
  } catch {
    return {fresh: saved, stale: [], unsigned, checked: false};
  }
}
/** Saves the given days, one day per request (each under the 2 MB request limit), three at a time. */
export async function saveTripCards(grant: string, site: string, days: {day: string; rows: AttendanceRow[]; signature?: string}[], onDay: (day: string, info: SavedInfo | null, error?: string) => void) {
  let next = 0;
  const failed: string[] = [];
  async function worker() {
    while (next < days.length) {
      const {day, rows, signature} = days[next++];
      try { onDay(day, await api<SavedInfo & {day: string}>(grant, 'attendance/trip-cards', 'POST', {site, day, rows, ...(signature ? {signature} : {})})); }
      catch (e) { failed.push(day); onDay(day, null, (e as Error).message); }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, days.length)}, worker));
  return failed.sort();
}

/* Saved biometric logs (owner, 23 Nov 2026): "Save biometric" asks HR to store each day of the site's biometric roster
   (server/biometric-day-store.mjs builds it from the punches itself), and the Biometric tab opens the saved days at once,
   reading the punches only for the rest. Today is never saved: its punches are still coming in. */
export type SavedBioDay = SavedInfo & {day: string; register: SiteRegister; punches: number; people: number};
/* A saved day carries the whole day's sheet, so the range is asked for a few days at a time (28 Nov 2026): one answer
   with twenty sheets could not arrive within the time limit (the same fault as "Biometric punches unavailable: signal
   timed out" on Manual Biometric). A piece that still fails is left out: those days are read from the punches instead. */
export const SAVED_BIO_DAYS_PER_READ = 3;
export async function readSavedBiometric(grant: string, site: string, from: string, to: string) {
  const days = daysBetween(from, to), pieces: [string, string][] = [];
  for (let i = 0; i < days.length; i += SAVED_BIO_DAYS_PER_READ) pieces.push([days[i], days[Math.min(i + SAVED_BIO_DAYS_PER_READ, days.length) - 1]]);
  const saved: SavedBioDay[] = [];let next = 0;
  async function worker() {
    while (next < pieces.length) {
      const [pieceFrom, pieceTo] = pieces[next++];
      try {
        const result = await api<{days?: SavedBioDay[]}>(grant, 'attendance/biometric-days?' + new URLSearchParams({site, from: pieceFrom, to: pieceTo}), 'GET', undefined, BIO_DAY_TIMEOUT_MS);
        saved.push(...(Array.isArray(result?.days) ? result.days : []).filter(d => d?.register && typeof d.register === 'object' && d.day >= pieceFrom && d.day <= pieceTo));
      } catch (error) {
        if (NO_ACCESS.test((error as Error).message)) throw error;
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(2, pieces.length)}, worker));
  return saved.sort((a, b) => a.day.localeCompare(b.day))
    .map(d => ({...d, register: {...d.register, rows: Array.isArray(d.register.rows) ? d.register.rows : [], machines: Array.isArray(d.register.machines) ? d.register.machines : []}}));
}
/** Saves the given days, one day per request, two at a time (the server reads each day's punches again to save it). */
export async function saveBiometricDays(grant: string, site: string, days: string[], onDay: (day: string, info: (SavedInfo & {punches: number}) | null, error?: string) => void) {
  let next = 0;
  const failed: string[] = [];
  async function worker() {
    while (next < days.length) {
      const day = days[next++];
      try { onDay(day, await api<SavedInfo & {day: string; punches: number}>(grant, 'attendance/biometric-days', 'POST', {site, day})); }
      catch (e) { failed.push(day); onDay(day, null, (e as Error).message); }
    }
  }
  await Promise.all(Array.from({length: Math.min(2, days.length)}, worker));
  return failed.sort();
}

/** Manual biometric snapshots are immutable after Save; imports for those site/days are also rejected by the API.
 *  The screen shows the imported punches and only needs to know which days are saved, by whom and when, so the saved
 *  sheets stay on the server (brief=1, 27 Nov 2026): a 20-day answer with every sheet took more than 30 seconds to
 *  arrive and the page showed "Biometric punches unavailable: signal timed out". */
export type SavedManualDay = SavedInfo & {day: string; punches: number; people: number};
export async function readSavedManualBiometric(grant: string, site: string, from: string, to: string): Promise<SavedManualDay[]> {
  const result = await api<{days?: SavedManualDay[]}>(grant, 'attendance/manual-biometric-days?' + new URLSearchParams({site, from, to, brief: '1'}));
  return (Array.isArray(result?.days) ? result.days : []).filter(d => typeof d?.day === 'string')
    .map(d => ({day: d.day, punches: Number(d.punches) || 0, people: Number(d.people) || 0, savedBy: d.savedBy, savedAt: d.savedAt}));
}
export async function saveManualBiometricDays(grant: string, site: string, days: string[], onDay: (day: string, info: (SavedInfo & {punches: number; people: number}) | null, error?: string) => void) {
  let next = 0;
  const failed: string[] = [];
  async function worker() {
    while (next < days.length) {
      const day = days[next++];
      try { onDay(day, await api<SavedInfo & {day: string; punches: number; people: number}>(grant, 'attendance/manual-biometric-days', 'POST', {site, day})); }
      catch (e) { failed.push(day); onDay(day, null, (e as Error).message); }
    }
  }
  await Promise.all(Array.from({length: Math.min(2, days.length)}, worker));
  return failed.sort();
}
export async function deleteManualBiometricDays(grant: string, site: string, days: string[]) {
  return api<{deleted:number;punches:number;days:string[]}>(grant, 'attendance/manual-biometric-days/delete', 'POST', {site, days});
}

/* Biometric tab, day by day (owner, 22 Nov 2026: "the same way as the trip card"): the site's machines are read one day
   per request, three days at a time, each day tried three times, so the muster fills in as each day arrives. */
export type BioDayUpdate = {day: string; state: DayState; result?: SiteRegister; error?: string; attempt?: number};
export async function streamBiometric(grant: string, days: string[], site: string, onDay: (update: BioDayUpdate) => void, live: () => boolean = () => true) {
  const failed = new Set<string>();
  let next = 0;
  for (const day of days) onDay({day, state: 'queued'});
  async function run(day: string) {
    if (!live()) return;
    onDay({day, state: 'loading'});
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await fetchBiometric(grant, day, day, site);
        failed.delete(day);
        if (live()) onDay({day, state: 'done', result});
        return;
      } catch (e) {
        const error = (e as Error).message || 'HR did not answer';
        if (attempt >= TRIP_ATTEMPTS || NO_ACCESS.test(error)) {failed.add(day); if (live()) onDay({day, state: 'failed', error}); return;}
        if (live()) onDay({day, state: 'retrying', attempt: attempt + 1, error});
        await pause(1500 * attempt);
      }
    }
  }
  async function worker() {while (next < days.length && live()) await run(days[next++]);}
  await Promise.all(Array.from({length: Math.min(3, days.length)}, worker));
  return [...failed].sort();
}

/** The days read so far joined into one register: each person's days in date order, machines and punch counts added up. */
export function joinBiometricDays(results: SiteRegister[], lateEarlyPerHalfCut = 3): SiteRegister | null {
  if (!results.length) return null;
  const people = new Map<string, Register['rows'][number]>();
  const machines = new Map<string, SiteMachine>();
  for (const result of results) {
    for (const m of result.machines) {
      const before = machines.get(m.serial);
      machines.set(m.serial, before ? {...m, punches: before.punches + m.punches, lastPunch: [before.lastPunch, m.lastPunch].sort().at(-1) || ''} : {...m});
    }
    for (const row of result.rows) {
      const before = people.get(row.id);
      if (!before) {people.set(row.id, {...row, days: [...row.days], machinesUsed: [...(row.machinesUsed || [])], summary: {...row.summary}}); continue;}
      before.days.push(...row.days.filter(d => !before.days.some(x => x.date === d.date)));
      before.machinesUsed = [...new Set([...(before.machinesUsed || []), ...(row.machinesUsed || [])])];
      before.summary = {...before.summary, gatePassDeduction: Math.round(((before.summary.gatePassDeduction || 0) + (row.summary.gatePassDeduction || 0)) * 100) / 100};
    }
  }
  // Half duty cuts count late comes and early goings over each month, so they are counted again over the joined days.
  for (const person of people.values()) {
    person.days.sort((a, b) => a.date.localeCompare(b.date));
    const months = new Map<string, number>();
    for (const d of person.days) if (d.late || d.early) months.set(d.date.slice(0, 7), (months.get(d.date.slice(0, 7)) || 0) + (d.late ? 1 : 0) + (d.early ? 1 : 0));
    person.summary = {...person.summary, halfDutyCuts: [...months.values()].reduce((s, n) => s + Math.floor(n / Math.max(1, lateEarlyPerHalfCut)), 0)};
  }
  const first = results[0];
  return {...first, rows: [...people.values()].sort((a, b) => Number(a.linked === false) - Number(b.linked === false) || a.name.localeCompare(b.name)), machines: [...machines.values()]};
}
