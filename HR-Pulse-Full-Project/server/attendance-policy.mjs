/* Attendance HR policy: how one day of biometric punches becomes Absent,
   Half duty or Full duty (a punched trip card / logbook is always Present), plus late come /
   early going, the monthly half-duty cut and the gate pass deduction.
   Pure functions only, shared by the API (day calculation) and the website
   (policy page and trip card hours). All times are minutes. */

export const DEFAULT_POLICY = Object.freeze({
  lunchMinutes: 60,          // working hours exclude this lunch break
  absentBelowHours: 4,       // under this = Absent
  fullDutyHours: 7,          // this or more = Full duty; in between = Half duty
  graceMinutes: 15,          // In punch up to this many minutes after shift start is on time
  lateEarlyPerHalfCut: 3,    // every N late comings / early goings in a month = one half duty cut
  gatePassFreeMinutes: 60,   // gate pass time in a day up to this is free
  exemptRoles: Object.freeze(['CMD', 'Director', 'VP', 'CFO', 'CA'])
});

// Daily wage / 8 = hourly rate for the gate pass deduction (fixed by the policy).
export const GATE_PASS_HOURS_PER_DAY = 8;

const LIMITS = {
  lunchMinutes: [0, 180, true],
  absentBelowHours: [0, 24, false],
  fullDutyHours: [0, 24, false],
  graceMinutes: [0, 120, true],
  lateEarlyPerHalfCut: [1, 31, true],
  gatePassFreeMinutes: [0, 480, true]
};
const LABELS = {
  lunchMinutes: 'Lunch break (minutes)', absentBelowHours: 'Absent below (hours)', fullDutyHours: 'Full duty from (hours)',
  graceMinutes: 'Late grace (minutes)', lateEarlyPerHalfCut: 'Late / early marks per half duty cut',
  gatePassFreeMinutes: 'Free gate pass time per day (minutes)'
};

const fail = message => { throw Object.assign(new Error(message), {status: 400}); };

/** Checks and cleans policy settings; missing values take the defaults. */
export function validatePolicy(input = {}) {
  const out = {};
  for (const [key, [min, max, whole]] of Object.entries(LIMITS)) {
    const raw = input[key] ?? DEFAULT_POLICY[key];
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
        (whole ? !Number.isInteger(value) : !Number.isInteger(value * 4))) {
      fail(`${LABELS[key]} must be ${whole ? 'a whole number' : 'in quarter hours'} from ${min} to ${max}.`);
    }
    out[key] = value;
  }
  if (out.fullDutyHours <= out.absentBelowHours) fail('Full duty hours must be more than the absent limit.');
  const roles = input.exemptRoles ?? DEFAULT_POLICY.exemptRoles;
  const list = (Array.isArray(roles) ? roles : String(roles).split(','))
    .map(role => String(role).replace(/[\u0000-\u001f]/g, '').trim()).filter(Boolean);
  if (list.length > 20 || list.some(role => role.length > 40)) fail('List up to 20 exempt roles of 40 characters or fewer.');
  if (list.some(role => /driver/i.test(role))) fail('Drivers are not exempt: their attendance comes from the trip card and logbook.');
  out.exemptRoles = [...new Set(list)];
  return out;
}

/** "08:15" or "08:15:59" → minutes after midnight (seconds are ignored). */
export function clockMinutes(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Gate pass / duration text → minutes. "2.15" and "2:15" both mean 2 h 15 m; "2.5" is refused as unclear. */
export function durationMinutes(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const match = /^(\d{1,2})(?:[.:](\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  return minutes < 60 ? Number(match[1]) * 60 + minutes : null;
}

/** Span between In and Out minus the lunch break (never below zero). */
export function workedMinutes(inMinute, outMinute, policy = DEFAULT_POLICY) {
  if (inMinute == null || outMinute == null || outMinute <= inMinute) return 0;
  return Math.max(0, outMinute - inMinute - policy.lunchMinutes);
}

/** Worked minutes → 'A' (Absent), 'HD' (Half duty) or 'P' (Full duty). */
export function dutyStatus(worked, policy = DEFAULT_POLICY) {
  if (worked < policy.absentBelowHours * 60) return 'A';
  if (worked < policy.fullDutyHours * 60) return 'HD';
  return 'P';
}

/** Late when the In punch is more than the grace after shift start. */
export function isLate(inMinute, shiftStart, policy = DEFAULT_POLICY) {
  return inMinute != null && shiftStart != null && inMinute - shiftStart > policy.graceMinutes;
}

/** Early going when the Out punch is before shift end (no grace). */
export function isEarly(outMinute, shiftEnd) {
  return outMinute != null && shiftEnd != null && outMinute < shiftEnd;
}

/** Number of half duty cuts for a month's late comings + early goings together. */
export function halfDutyCuts(lateEarlyCount, policy = DEFAULT_POLICY) {
  return Math.floor(Math.max(0, lateEarlyCount) / policy.lateEarlyPerHalfCut);
}

/** Gate pass deduction for one day: free up to the limit, otherwise the FULL time at wage / 8 per hour. */
export function gatePassDeduction(totalMinutes, dailyWage, policy = DEFAULT_POLICY) {
  if (!(totalMinutes > policy.gatePassFreeMinutes)) return 0;
  if (!(dailyWage > 0)) return 0;
  return Math.round(totalMinutes / 60 * dailyWage / GATE_PASS_HOURS_PER_DAY * 100) / 100;
}

const words = text => String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const ALIASES = {DIRECTOR: ['DIRECTORS'], VP: ['VICE PRESIDENT'], CA: ['CHARTERED ACCOUNTANT'], CMD: ['CHAIRMAN AND MANAGING DIRECTOR', 'CHAIRMAN MANAGING DIRECTOR']};

/** True when the designation is one of the exempt roles (whole-word match; drivers never). */
export function isExempt(designation, policy = DEFAULT_POLICY) {
  const have = words(designation);
  if (!have.length || have.includes('DRIVER')) return false;
  const text = ' ' + have.join(' ') + ' ';
  return policy.exemptRoles.some(role => [words(role).join(' '), ...(ALIASES[words(role).join(' ')] || [])]
    .some(phrase => phrase && text.includes(' ' + phrase + ' ')));
}

/**
 * One duty day. For trip card / logbook staff pass their first trip / logbook
 * start as inMinute and the last end as outMinute. Night shifts: pass shiftEnd
 * (and outMinute) past 1440 when they fall on the next day.
 */
export function evaluateDay({inMinute = null, outMinute = null, shiftStart = null, shiftEnd = null, designation = '',
  gatePassMinutes = 0, dailyWage = 0} = {}, policy = DEFAULT_POLICY) {
  if (isExempt(designation, policy)) {
    return {status: 'P', exempt: true, missPunch: false, workedMinutes: null, late: false, early: false, gatePassMinutes: 0, gatePassDeduction: 0};
  }
  const missPunch = (inMinute == null) !== (outMinute == null) || (inMinute != null && outMinute <= inMinute);
  const worked = missPunch ? 0 : workedMinutes(inMinute, outMinute, policy);
  const status = missPunch ? 'MP' : inMinute == null ? 'A' : dutyStatus(worked, policy);
  const present = status === 'P' || status === 'HD';
  return {
    status, exempt: false, missPunch, workedMinutes: inMinute == null || missPunch ? null : worked,
    late: inMinute != null && isLate(inMinute, shiftStart, policy),
    early: present && isEarly(outMinute, shiftEnd),
    gatePassMinutes, gatePassDeduction: gatePassDeduction(gatePassMinutes, dailyWage, policy)
  };
}

/** Month totals for one employee from evaluateDay results. */
export function summarizeMonth(days, policy = DEFAULT_POLICY) {
  const count = status => days.filter(day => day.status === status).length;
  const late = days.filter(day => day.late).length, early = days.filter(day => day.early).length;
  const cuts = halfDutyCuts(late + early, policy);
  const full = count('P'), half = count('HD');
  const gatePassDeduction = Math.round(days.reduce((sum, day) => sum + (day.gatePassDeduction || 0), 0) * 100) / 100;
  return {
    full, half, absent: count('A'), missPunch: count('MP'), late, early, lateEarly: late + early, halfDutyCuts: cuts,
    duties: Math.max(0, full + half / 2 - cuts / 2), gatePassDeduction
  };
}

/** Plain-English rule lines for the policy page. */
export function policyRules(policy = DEFAULT_POLICY) {
  const hours = h => `${h} hr${h === 1 ? '' : 's'}`;
  const clock = minutes => `${String(8 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return [
    ['Working hours', `Hours between In and Out, less a ${policy.lunchMinutes} min lunch break.`],
    ['Day status', `Under ${hours(policy.absentBelowHours)} = Absent · ${hours(policy.absentBelowHours)} to under ${hours(policy.fullDutyHours)} = Half duty · ${hours(policy.fullDutyHours)} or more = Full duty.`],
    ['Trip card / logbook', 'A driver or operator with a punched trip card or logbook (VLB, ELB, LMV) is Present for the day, whatever the hours. The hours rule above is for biometric punches only.'],
    ['Late come', `In punch up to ${policy.graceMinutes} min after shift start is on time (for an 08:00 shift, ${clock(policy.graceMinutes)} is on time and ${clock(policy.graceMinutes + 1)} is late).`],
    ['Early going', 'Out punch before shift end is early going. There is no grace.'],
    ['Half duty cut', `Every ${policy.lateEarlyPerHalfCut} late comings or early goings in a month, counted together, cut one half duty (${policy.lateEarlyPerHalfCut * 2} = two). The count starts again each month.`],
    ['Gate pass', `Up to ${policy.gatePassFreeMinutes} min of gate pass in a day is free. Above that, the full gate pass time is deducted at daily wage ÷ ${GATE_PASS_HOURS_PER_DAY} per hour (wage 800, 2 h 15 m → 225).`],
    ['Exempt roles', `${policy.exemptRoles.join(', ') || 'None'}: marked present, no late, early or cut. Drivers are not exempt; their attendance comes from the trip card and logbook.`]
  ];
}
