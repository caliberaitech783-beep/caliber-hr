// Public holiday (PH) rule, owner 28 Nov 2026 (Pulse II HR deck, slide 10): worked PH is paid twice, a PH with
// presence the day before or after is paid, a PH with absence on both sides is not.
import {expect, it} from 'vitest';
import type {RegisterRow} from './AttendanceRegister';
import {applyHolidayRule, buildRoster, lineTotals} from './rosterModel';
import type {AttendanceRow} from './misAttendanceModel';
import {DEFAULT_POLICY} from '../server/attendance-policy.mjs';

const PH = '2027-01-26';
const three = ['2027-01-25', PH, '2027-01-27'];
const rule = (before: string, on: string, after: string) => {
  const codes: Record<string, string> = {'2027-01-25': before, [PH]: on, '2027-01-27': after};
  const lost = applyHolidayRule(codes, three, new Set([PH]));
  return {codes, lost, totals: lineTotals(codes, three, {holidays: [PH]})};
};

it('rule 1: present on the PH is paid twice, whatever the days around it', () => {
  const {codes, totals} = rule('A', 'P', 'A');
  expect(codes[PH]).toBe('P');
  expect(totals.holidayWorked).toBe(1);
  expect(totals.paidDays, 'P on the PH earns 2').toBe(2);
});

it('rule 2: absent on the PH, present the day before or the day after: PH paid', () => {
  expect(rule('P', 'H', 'A').totals).toMatchObject({holiday: 1, paidDays: 2});
  expect(rule('A', 'H', 'P').totals, 'present on Day 3 only').toMatchObject({holiday: 1, paidDays: 2});
  expect(rule('L', 'H', 'A').codes[PH], 'leave beside the PH is not an absence').toBe('H');
  expect(rule('OD', 'H', 'A').codes[PH]).toBe('H');
});

it('rule 3: absent the day before and the day after: no PH, shown A', () => {
  const {codes, lost, totals} = rule('A', 'H', 'A');
  expect(codes[PH]).toBe('A');
  expect(lost).toEqual([PH]);
  expect(totals).toMatchObject({holiday: 0, absent: 3, paidDays: 0});
});

it('skips weekly offs and other holidays to find the day before / after; an unknown side never takes the PH away', () => {
  const dates = ['2027-01-24', '2027-01-25', PH, '2027-01-27'];
  const codes: Record<string, string> = {'2027-01-24': 'A', '2027-01-25': 'WO', [PH]: 'H', '2027-01-27': 'A'};
  expect(applyHolidayRule({...codes}, dates, new Set([PH]))).toEqual([PH]);
  expect(applyHolidayRule({...codes, '2027-01-24': 'P'}, dates, new Set([PH]))).toEqual([]);
  // Last day of the roster, or the day after not read yet: only one side is known, so the PH stays.
  expect(applyHolidayRule({'2027-01-25': 'A', [PH]: 'H'}, ['2027-01-25', PH], new Set([PH]))).toEqual([]);
  expect(applyHolidayRule({'2027-01-25': 'A', [PH]: 'H', '2027-01-27': '?'}, three, new Set([PH]))).toEqual([]);
});

// Anoop Paul (83111), driver, January 2027: leave 6–7, OD 21–24, Republic Day 26, trip cards on the other days.
const days = Array.from({length: 31}, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);
const calendarOf = (date: string) => ['2027-01-06', '2027-01-07'].includes(date) ? 'L' : date >= '2027-01-21' && date <= '2027-01-24' ? 'OD' : date === PH ? 'H' : '';
const register = (worked: (date: string) => boolean): RegisterRow => ({id: 'e83111', code: 'CMLL83111', name: 'Anoop Paul', siteId: 's1', site: 'Majri OC', siteType: 'Site', department: 'Operations', shift: '',
  designation: 'Driver', exempt: false, shiftStart: '', shiftEnd: '',
  days: days.map(date => {const calendar = calendarOf(date), status = worked(date) ? 'P' : calendar || 'A';
    return {date, status, calendar, note: '', in: '', out: '', workedMinutes: null, late: false, early: false, missPunch: false, gatePassMinutes: 0, gatePassDeduction: 0, exempt: false};}),
  summary: {full: 0, half: 0, absent: 0, missPunch: 0, late: 0, early: 0, lateEarly: 0, halfDutyCuts: 0, duties: 0, gatePassDeduction: 0, H: 0, L: 0, OD: 0, WO: 0, IN: 0}});
const card = (date: string): AttendanceRow => ({id: date, date, site: 'Majri OC', shift: 'A', employeeId: 'CMLL83111', employeeKey: 'k', employeeName: 'Anoop Paul', caliberCode: 'CMLL83111', designation: 'Driver',
  sources: ['Trip card'], equipment: ['DT-12'], references: '', note: '', output: '12 trips', status: 'Present', verification: 'MIS batch closed', verified: true, otHours: 0, otNote: ''});

it('January roster: leave, OD and Republic Day reach the trip card line and the paid days', () => {
  const worked = (date: string) => !calendarOf(date) && date !== '2027-01-13';
  const [group] = buildRoster([register(() => false)], days.filter(worked).map(card), days, '2027-02-01', DEFAULT_POLICY);
  expect(['2027-01-06', '2027-01-07', '2027-01-21', '2027-01-24', PH, '2027-01-13'].map(d => group.tripCodes[d])).toEqual(['L', 'L', 'OD', 'OD', 'H', 'A']);
  expect(lineTotals(group.tripCodes, days, {holidays: group.holidays})).toMatchObject({present: 23, leave: 2, onDuty: 4, holiday: 1, holidayWorked: 0, absent: 1, paidDays: 30});
});

it('January roster: driving on Republic Day pays it twice', () => {
  const worked = (date: string) => !calendarOf(date) || date === PH;
  const [group] = buildRoster([register(() => false)], days.filter(worked).map(card), days, '2027-02-01', DEFAULT_POLICY);
  expect(group.tripCodes[PH]).toBe('P');
  expect(lineTotals(group.tripCodes, days, {holidays: group.holidays})).toMatchObject({present: 25, holidayWorked: 1, paidDays: 32});
});
