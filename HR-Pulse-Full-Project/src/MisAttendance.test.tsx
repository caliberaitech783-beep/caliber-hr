import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import MisAttendance from './MisAttendance';
import {mapMisAttendance} from './misAttendanceModel';

const site = 'Jayant OB';
const night = {site, date: '2026-11-15', shift: 'S3', employeeId: 'DEMO-1', employeeName: 'Demo Operator', employeeKey: 'DEMO1'};
const morning = {...night, date: '2026-11-16', shift: 'S1'};
const saved = (duty: typeof night) => ({...duty, doors: 'DT-1', equipment: 'Dumper', category: 'Operator', logBooks: ['VLB', 'ELB'], books: 'Demo card', trips: 6});
const batch = (duty: typeof night, state: string) => ({...duty, siteKey: site.toLowerCase(), state, batch: 'Demo ' + duty.shift});
const report = (morningState: string) => ({
  attendanceEquipment: [
    {...morning, doors: 'DT-1', trips: 6, status: 'Present — with trips', reason: '', remarks: ''},
    {...morning, doors: 'EX-1', trips: null, status: 'Present — with trips', reason: '', remarks: ''},
    {...morning, employeeId: 'DEMO-2', employeeName: 'Standby Driver', employeeKey: 'DEMO2',
      doors: '', trips: 0, status: 'Present — 0 trips', reason: 'Standby', remarks: ''}
  ],
  attendanceShifts: [batch(night, 'closed'), batch(morning, morningState)],
  otDuties: [saved(night), saved(morning)],
  performance: [
    {...night, start: '2026-11-15 21:00', end: '2026-11-16 05:00'},
    {...morning, start: '2026-11-16 05:00', end: '2026-11-16 13:00'}
  ],
  ot: [], details: [], exceptions: []
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('counts a duty once across multiple cards, keeps zero-trip duty, and awards OT once across midnight', () => {
  const rows = mapMisAttendance(report('closed'));
  expect(rows).toHaveLength(3);
  expect(rows.find(row => row.employeeId === 'DEMO-2')).toMatchObject({status: 'Present · 0 trips', otHours: 0});
  expect(rows.find(row => row.employeeId === 'DEMO-1' && row.shift === 'S1')).toMatchObject({
    equipment: ['DT-1', 'EX-1'], sources: ['Trip card', 'Job card'], status: 'Present', otHours: 8
  });
  expect(rows.find(row => row.shift === 'S3')?.otHours).toBe(0);
});

it('picks up a newly closed MIS batch and calculates overtime on the next automatic sync', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  const fetchMis = vi.fn()
    .mockResolvedValueOnce({ok: true, json: async () => report('vlb')})
    .mockResolvedValueOnce({ok: true, json: async () => report('closed')});
  vi.stubGlobal('fetch', fetchMis);
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  const morningDuty = screen.getByRole('row', {name: /S1 Demo Operator/});
  expect(within(morningDuty).getByText('Pending')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetchMis).toHaveBeenCalledTimes(2);
  expect(within(morningDuty).getByText('Present')).toBeTruthy();
  expect(within(morningDuty).getAllByText('8 h')).toHaveLength(2);
});

it('saves a correction with the duty identity and version and reloads it from HR', async () => {
  const original = {...report('closed'), canEdit: true};
  const target = mapMisAttendance(original).find(row => row.employeeId === 'DEMO-1' && row.shift === 'S1')!;
  const correction = {id: target.id, status: 'absent', start: '', end: '', reason: 'Roster checked', version: 1, updatedBy: 'test'};
  const request = vi.fn()
    .mockResolvedValueOnce({ok: true, json: async () => original})
    .mockResolvedValueOnce({ok: true, json: async () => correction})
    .mockResolvedValueOnce({ok: true, json: async () => ({...original, corrections: [correction]})});
  vi.stubGlobal('fetch', request);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', {name: 'Edit Demo Operator, 2026-11-16, S1'}));
  const form = screen.getByRole('form', {name: 'Edit attendance for Demo Operator'});
  fireEvent.change(within(form).getByLabelText('Status'), {target: {value: 'absent'}});
  fireEvent.change(within(form).getByLabelText('Reason'), {target: {value: 'Roster checked'}});
  fireEvent.click(within(form).getByRole('button', {name: 'Save correction'}));
  await act(async () => {});
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
    date: morning.date, site, shift: 'S1', employeeId: morning.employeeId, status: 'absent', version: 0, reason: 'Roster checked'
  });
  const row = screen.getByRole('row', {name: /S1 Demo Operator/});
  expect(within(row).getByText('Absent')).toBeTruthy();
  expect(within(row).getByText('0 h')).toBeTruthy();
});
