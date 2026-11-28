/* How long each attendance read took and how large its answer was (owner, 28 Nov 2026, after "Biometric punches
   unavailable: signal timed out" on a 20-day roster): the next slow report is traced from numbers, not guessed.
   The last 500 attendance requests of this server process are kept in memory; nothing is written to the database, so the
   list starts again after a release or a restart. A request of 3 seconds or more is also written to the server log.
   GET attendance/read-times (HR administrator only) shows the list. */
export const READ_TIMES_KEPT = 500, SLOW_READ_MS = 3000;
const reads = [];

/** entry: {at, route, method, status, ms, bytes, sent, site, from, to, days, by} — bytes is the answer as JSON, sent after compression. */
export function recordRead(entry) {
  reads.push(entry);
  if (reads.length > READ_TIMES_KEPT) reads.splice(0, reads.length - READ_TIMES_KEPT);
  if (entry.ms >= SLOW_READ_MS) console.log('slow attendance read ' + JSON.stringify(entry));
}
export function clearReads() { reads.length = 0; }

const middle = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0; };
/** The kept requests: a line per route (how many, the usual and the worst time and size), the 20 slowest, and the newest 200. */
export function recentReads() {
  const routes = new Map();
  for (const read of reads) routes.set(read.route, [...(routes.get(read.route) || []), read]);
  return {
    kept: reads.length, limit: READ_TIMES_KEPT, since: reads[0]?.at || null, slowFromMs: SLOW_READ_MS,
    routes: [...routes].map(([route, list]) => ({route, requests: list.length, failed: list.filter(r => r.status >= 400).length,
      usualMs: middle(list.map(r => r.ms)), worstMs: Math.max(...list.map(r => r.ms)),
      usualKb: Math.round(middle(list.map(r => r.bytes)) / 1024), worstKb: Math.round(Math.max(...list.map(r => r.bytes)) / 1024),
      usualSentKb: Math.round(middle(list.map(r => r.sent)) / 1024)})).sort((a, b) => b.worstMs - a.worstMs),
    slowest: [...reads].sort((a, b) => b.ms - a.ms).slice(0, 20),
    latest: reads.slice(-200).reverse(),
  };
}
