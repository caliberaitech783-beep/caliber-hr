/* The MIS busy limit (owner, 28 Nov 2026: "plz build the MIS busy limit in HR Pulse also").

   What happened that morning: Pulse-II builds its reports in three places (its report lane). HR Pulse gives up on a read
   after 22 seconds, but Pulse-II goes on building the answer nobody waits for, and the roster asks again (three tries a
   day, then a second pass). With a few PCs reading rosters the three places stayed full of abandoned reads: 3 running,
   18 to 23 waiting, and 47 of 47 trip card reads failed in six minutes. It did not recover until Pulse-II restarted.

   The limit, for this server process:
   - at most `limit` reads are open at Pulse-II at the same time (2, so one of Pulse-II's three places stays free for
     Pulse-II's own users);
   - the next reads wait in a short line here, in the order they came, for up to `lineWaitMs` (6 seconds: with the 22
     seconds Pulse-II is given, the browser's own 30 second limit is never passed, so no read is abandoned);
   - when the line holds `lineMax` reads, or a read has waited its time, the answer is "MIS is busy. Try again in a
     minute." at once, and Pulse-II is not asked;
   - a read Pulse-II did not answer in time keeps its place for `coolMs` more (20 seconds), because Pulse-II is still
     building it. This is what stops the storm: a full Pulse-II is sent no more than two new reads every 42 seconds.

   Nothing is stored. The counts start again after a release or a restart; GET attendance/read-times shows them. */
export const MIS_OPEN_READS = 2, MIS_LINE_WAIT_MS = 6_000, MIS_LINE_MAX = 8, MIS_COOL_MS = 20_000;
export const MIS_BUSY_MESSAGE = 'MIS is busy. Try again in a minute.';

export function createMisReadLimit({limit = MIS_OPEN_READS, lineWaitMs = MIS_LINE_WAIT_MS, lineMax = MIS_LINE_MAX, coolMs = MIS_COOL_MS} = {}) {
  let open = 0, cooling = 0;
  const line = [], counts = {asked: 0, waited: 0, busy: 0, timedOut: 0};
  const busy = () => { counts.busy++; return Object.assign(new Error(MIS_BUSY_MESSAGE), {status: 503, misBusy: true}); };
  const serveLine = () => {
    while (line.length && open + cooling < limit) { const next = line.shift(); clearTimeout(next.timer); open++; next.resolve(); }
  };
  function take(waitMs) {
    counts.asked++;
    if (!line.length && open + cooling < limit) { open++; return Promise.resolve(); }
    if (!(waitMs > 0) || line.length >= lineMax) return Promise.reject(busy());
    counts.waited++;
    return new Promise((resolve, reject) => {
      const waiter = {resolve};
      waiter.timer = setTimeout(() => { const at = line.indexOf(waiter); if (at >= 0) line.splice(at, 1); reject(busy()); }, waitMs);
      line.push(waiter);
    });
  }
  function giveBack(timedOut) {
    open--;
    if (timedOut) {
      counts.timedOut++; cooling++;
      // unref: a cooling place never keeps the server (or a test) from ending.
      setTimeout(() => { cooling--; serveLine(); }, coolMs).unref?.();
    }
    serveLine();
  }
  return {
    /** work(slot): the read of Pulse-II. It sets slot.timedOut when Pulse-II did not answer in time.
        waitMs: how long this read may wait in the line (0: not at all). */
    async run(work, waitMs = lineWaitMs) {
      await take(waitMs);
      const slot = {timedOut: false};
      try { return await work(slot); } finally { giveBack(slot.timedOut); }
    },
    state: () => ({limit, open, cooling, waiting: line.length, ...counts}),
  };
}
