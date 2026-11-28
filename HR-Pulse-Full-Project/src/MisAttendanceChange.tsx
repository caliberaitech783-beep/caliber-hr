/* A change of trip card attendance is made in Pulse-II, with an OTP (owner, 27 Nov 2026).
   "MIS will be the primary master for HR to fetch in the roster. And if MIS gives the data to HR, and if HR makes any
    changes, it has to be through OTP. If HR makes absent as present or present as absent, then the same has to be
    re-updated in MIS also."
   HR Pulse keeps no present / absent of its own. This form asks Pulse-II (the RHR of the site's region gets the OTP on
   Telegram), then sends the OTP; only then is the change made, in Pulse-II, and both sides show the same.
     present: a Present entry is made in Pulse-II (no trip card);
     absent:  the trip card stays in Pulse-II with its trips, only the attendance of that shift is not counted;
     card:    an earlier change from HR Pulse is taken back ("as the trip card says").
   Duty times (owner, 28 Nov 2026: "Yes, send to MIS"): a present duty's times are set in Pulse-II the same way.
     times:      the duty's start and end (an end before the start is the next day);
     card-times: the corrected times are taken back; the duty is again on the Shift Master times. */
import {useState} from 'react';
import {api} from './api';

export type ChangeMark = 'present' | 'absent' | 'card' | 'times' | 'card-times';
export type ChangeTarget = {site: string; date: string; shift: string; employeeId: string; employeeName?: string; mark: ChangeMark; start?: string; end?: string};
type Asked = {id: string; sentTo?: string[]; employeeId: string; employeeName?: string; site: string; date: string; shift: string; mark: ChangeMark; start?: string; end?: string};
export const CHANGE_SHIFTS = ['S1', 'S2', 'S3', 'D', 'N'];
export const CHANGE_REASON_MIN = 10;
const WORD: Record<ChangeMark, string> = {present: 'present', absent: 'absent', card: 'as the trip card says', times: 'duty times', 'card-times': 'Shift Master times'};
const EFFECT: Record<ChangeMark, string> = {
  present: 'A Present entry will be made in MIS for this shift. No trip card is made.',
  absent: 'The trip card stays in MIS with its trips; only the attendance of this shift will not be counted.',
  card: 'The earlier change from HR Pulse will be taken back; attendance is again what the trip card says.',
  times: 'The duty times are kept in MIS and sent to HR Pulse from there; the trip card and the attendance stay as they are. An end before the start is the next day.',
  'card-times': 'The corrected duty times will be taken back in MIS; the duty is again on the Shift Master times.'
};
const show = (date: string) => date.split('-').reverse().join('-');
const asking = (c: {mark: ChangeMark; start?: string; end?: string}) => c.mark === 'times' ? `duty times ${c.start}–${c.end}` :
  c.mark === 'card-times' ? 'take back the corrected duty times' : `mark ${WORD[c.mark]}`;
const doneText = (c: Asked) => c.mark === 'times' ? `The duty times of ${c.employeeName || c.employeeId} are now ${c.start}–${c.end} in MIS` :
  c.mark === 'card-times' ? `The duty times of ${c.employeeName || c.employeeId} are again the Shift Master times in MIS` :
  `${c.employeeName || c.employeeId} is now ${WORD[c.mark]} in MIS`;
const label = (target: ChangeTarget) => target.mark === 'times' ? `Duty times of ${target.employeeName || target.employeeId}` :
  target.mark === 'card-times' ? `Take back the duty times of ${target.employeeName || target.employeeId}` : `Mark ${target.employeeName || target.employeeId} ${WORD[target.mark]}`;

/** target: the duty to change. Without one (Mark present for a person with no card) the user fills in who, where and when. */
export default function MisAttendanceChange({grant, target, sites = [], latest, onDone, onCancel}: {
  grant: string; target?: ChangeTarget; sites?: string[]; latest: string; onDone: (message: string) => void; onCancel: () => void;
}) {
  const [asked, setAsked] = useState<Asked>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Record<string, unknown>>();
  const mark: ChangeMark = target?.mark || 'present';

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const text = (name: string) => String(fields.get(name) || '').trim();
    const body = {
      site: target?.site || text('site'), date: target?.date || text('date'), shift: target?.shift || text('shift'),
      employeeId: target?.employeeId || text('employeeId'), mark, reason: text('reason'),
      ...(mark === 'times' ? {start: text('start'), end: text('end')} : {})
    };
    if (mark === 'times' && (!/^\d{2}:\d{2}$/.test(body.start || '') || !/^\d{2}:\d{2}$/.test(body.end || '') || body.start === body.end)) {
      setError('Enter both duty times, under 24 hours apart.'); return;
    }
    if (body.reason.length < CHANGE_REASON_MIN) { setError(`Write why this attendance is changed (at least ${CHANGE_REASON_MIN} letters).`); return; }
    setBusy(true); setError('');
    try {
      const result = await api<Asked>(grant, 'attendance/mis/change', 'POST', body);
      setSent(body); setAsked(result);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !asked) return;
    const otp = String(new FormData(event.currentTarget).get('otp') || '').trim();
    if (!/^\d{6}$/.test(otp)) { setError('Enter the six-digit OTP.'); return; }
    setBusy(true); setError('');
    try {
      const done = await api<Asked>(grant, 'attendance/mis/change/verify', 'POST', {id: asked.id, otp});
      onDone(`${doneText(done)} · ${done.site} · ${show(done.date)} · ${done.shift}.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function again() {
    if (busy || !sent) return;
    setBusy(true); setError('');
    try { setAsked(await api<Asked>(grant, 'attendance/mis/change', 'POST', sent)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (asked) return <form className="trip-attendance-editor" onSubmit={confirm} aria-label="Enter the OTP from RHR">
    <p className="trip-attendance-change-note" role="status">
      OTP sent to RHR{asked.sentTo?.length ? ` (${asked.sentTo.join(', ')})` : ''} on Telegram for {asked.employeeName || asked.employeeId} · {asked.site} · {show(asked.date)} · {asked.shift}: {asking(asked)}.
      It is valid for 10 minutes. Nothing changes until the OTP is entered.
    </p>
    <label>OTP from RHR<input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required autoFocus/></label>
    <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Confirm with OTP'}</button>
    <button type="button" disabled={busy} onClick={again}>Send OTP again</button>
    <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    {error && <p role="alert">{error}</p>}
  </form>;

  return <form className="trip-attendance-editor" onSubmit={ask} aria-label={target ? label(target) : 'Mark present in MIS'}>
    {mark === 'times' && <>
      <label>Duty start<input type="time" name="start" required defaultValue={target?.start || ''}/></label>
      <label>Duty end<input type="time" name="end" required defaultValue={target?.end || ''}/></label>
    </>}
    {!target && <>
      <label>Employee ID<input name="employeeId" required maxLength={40} placeholder="CMLL…"/></label>
      <label>Site<select name="site" required defaultValue="">
        <option value="" disabled>Choose the site</option>
        {sites.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label>Date<input type="date" name="date" required min="2026-11-01" max={latest} defaultValue={latest}/></label>
      <label>Shift<select name="shift" required defaultValue="">
        <option value="" disabled>Choose</option>
        {CHANGE_SHIFTS.map(code => <option key={code}>{code}</option>)}
      </select></label>
    </>}
    <label className="trip-attendance-reason">Reason<input name="reason" maxLength={500} required minLength={CHANGE_REASON_MIN} placeholder="Why this attendance is changed"/></label>
    <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send OTP to RHR'}</button>
    <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    <p className="trip-attendance-change-note">{EFFECT[mark]} The change is made in MIS, after the RHR's OTP; HR Pulse keeps no attendance of its own.</p>
    {error && <p role="alert">{error}</p>}
  </form>;
}
