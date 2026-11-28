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

it('filters a date range and loads site options even when a site has no duty in that range', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  const request = vi.fn().mockResolvedValue({ok: true, json: async () => ({...report('closed'), sites: ['Jayant OB', 'Sasti OB']})});
  vi.stubGlobal('fetch', request);
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  expect(request.mock.calls[0][0]).toMatch(/from=2026-11-16&to=2026-11-16$/);
  expect(within(screen.getByLabelText('Site')).getByRole('option', {name: 'Sasti OB'})).toBeTruthy();
  expect(screen.queryByRole('row', {name: /S3 Demo Operator/})).toBeNull();
  fireEvent.change(screen.getByLabelText('From date'), {target: {value: '2026-11-15'}});
  await act(async () => {});
  expect(request.mock.calls[1][0]).toMatch(/from=2026-11-15&to=2026-11-16$/);
  const previous = screen.getByRole('row', {name: /S3 Demo Operator/});
  expect(within(previous).getByText('MIS batch closed')).toBeTruthy();
  expect(screen.getByRole('row', {name: /S1 Demo Operator/})).toBeTruthy();
});

it('offers PDF, print and Excel for the complete filtered attendance report', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => report('closed')}));
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', {name: /Print\/Export/}));
  expect(screen.getByRole('menuitem', {name: 'Download as PDF'})).toBeTruthy();
  expect(screen.getByRole('menuitem', {name: 'Smart Print'})).toBeTruthy();
  expect(screen.getByRole('menuitem', {name: 'Download as Excel'})).toBeTruthy();
});

// Owner, 28 Nov 2026, on duty times corrected only in HR Pulse: "Yes, send to MIS". They are set in MIS with the RHR's
// OTP like present / absent, and come back from MIS on the duty.
it('sets a duty\'s times in MIS with the OTP from RHR, then shows the times MIS sends', async () => {
  const original = {...report('closed'), canEdit: true};
  const asked = {id: '33333333-3333-4333-8333-333333333333', status: 'sent', sentTo: ['rhr.ncl'], site, date: morning.date, shift: 'S1', employeeId: morning.employeeId, employeeName: 'Demo Operator', mark: 'times', start: '06:00', end: '13:00'};
  const hrTimes = {id: asked.id, start: '06:00', end: '13:00', window: {start: '2026-11-16 06:00', end: '2026-11-16 13:00'}, by: 'Meena', reason: 'Came one hour late', at: '2026-11-28T10:00:00Z'};
  // MIS keeps the Shift Master times in performance and sends HR's times on the duty only.
  const after = {...original, otDuties: original.otDuties.map(row => row.shift === 'S1' ? {...row, hrTimes} : row)};
  const request = vi.fn()
    .mockResolvedValueOnce({ok: true, json: async () => original})
    .mockResolvedValueOnce({ok: true, json: async () => asked})
    .mockResolvedValueOnce({ok: true, json: async () => ({...asked, status: 'used'})})
    .mockResolvedValueOnce({ok: true, json: async () => after});
  vi.stubGlobal('fetch', request);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  // HR Pulse has no correction form of its own any more.
  expect(screen.queryByRole('button', {name: /^Edit /})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Duty times of Demo Operator, 2026-11-16, S1'}));
  const form = screen.getByRole('form', {name: 'Duty times of Demo Operator'});
  expect((within(form).getByLabelText('Duty start') as HTMLInputElement).value).toBe('05:00');
  expect((within(form).getByLabelText('Duty end') as HTMLInputElement).value).toBe('13:00');
  expect(within(form).getByText(/duty times are kept in MIS/)).toBeTruthy();
  fireEvent.change(within(form).getByLabelText('Duty start'), {target: {value: '06:00'}});
  fireEvent.change(within(form).getByLabelText('Reason'), {target: {value: 'Came one hour late'}});
  fireEvent.click(within(form).getByRole('button', {name: 'Send OTP to RHR'}));
  await act(async () => {});
  expect(request.mock.calls[1][0]).toMatch(/attendance\/mis\/change$/);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({site, date: morning.date, shift: 'S1', employeeId: morning.employeeId, mark: 'times', reason: 'Came one hour late', start: '06:00', end: '13:00'});
  const otp = screen.getByRole('form', {name: 'Enter the OTP from RHR'});
  expect(within(otp).getByText(/duty times 06:00–13:00/)).toBeTruthy();
  fireEvent.change(within(otp).getByLabelText('OTP from RHR'), {target: {value: '123456'}});
  fireEvent.click(within(otp).getByRole('button', {name: 'Confirm with OTP'}));
  await act(async () => {});
  await act(async () => {});
  expect(screen.getByText(/The duty times of Demo Operator are now 06:00–13:00 in MIS/)).toBeTruthy();
  const row = screen.getByRole('row', {name: /S1 Demo Operator/});
  expect(within(row).getByText('Set in MIS (OTP)')).toBeTruthy();
  expect(within(row).getByText('7 h')).toBeTruthy();
  expect(within(row).getByText(/Duty times 06:00–13:00 set in MIS · Came one hour late · Meena/)).toBeTruthy();
  expect(within(row).getByRole('button', {name: 'Take back the duty times of Demo Operator, 2026-11-16, S1'})).toBeTruthy();
});

it('times set in MIS move only their own duty: the shift is not a schedule conflict and the others keep their times', () => {
  const second = {...morning, employeeId: 'DEMO-3', employeeName: 'Second Driver', employeeKey: 'DEMO3'};
  const base = report('closed');
  const hrTimes = {id: 't1', start: '06:00', end: '14:00', window: {start: '2026-11-16 06:00', end: '2026-11-16 14:00'}, by: 'Meena', reason: 'Late start', at: ''};
  const rows = mapMisAttendance({...base,
    otDuties: [...base.otDuties.map(row => row.shift === 'S1' ? {...row, hrTimes} : row), saved(second)],
    performance: [...base.performance, {...second, start: '2026-11-16 05:00', end: '2026-11-16 13:00'}]});
  const mine = rows.find(row => row.employeeId === 'DEMO-1' && row.shift === 'S1')!, other = rows.find(row => row.employeeId === 'DEMO-3')!;
  expect([mine.window?.start, mine.window?.end]).toEqual(['2026-11-16 06:00', '2026-11-16 14:00']);
  expect([other.window?.start, other.window?.end]).toEqual(['2026-11-16 05:00', '2026-11-16 13:00']);
  for (const row of [mine, other]) expect([row.status, row.verification]).toEqual(['Present', 'MIS batch closed']);
  // The night duty ends at 05:00 and the corrected one starts at 06:00: no longer back to back, so no OT.
  expect(mine.otHours).toBe(0);
});

it('no longer applies duty times that were kept only in HR Pulse, and says so on the duty', () => {
  const original = report('closed');
  const target = mapMisAttendance(original).find(row => row.employeeId === 'DEMO-1' && row.shift === 'S1')!;
  const correction = {id: target.id, status: 'present' as const, start: '06:00', end: '13:00', reason: 'Roster checked', version: 1, updatedBy: 'test', updatedAt: ''};
  const row = mapMisAttendance({...original, corrections: [correction]}).find(r => r.id === target.id)!;
  expect([row.window?.start, row.window?.end]).toEqual(['2026-11-16 05:00', '2026-11-16 13:00']);
  expect(row.verification).toBe('MIS batch closed');
  expect(row.otHours).toBe(8);
  expect(row.correction?.reason).toBe('Roster checked');
});

// Owner, 27 Nov 2026: MIS is the master of trip card attendance. "If HR makes any changes, it has to be through OTP ...
// the same has to be re-updated in MIS also." HR Pulse keeps no present / absent of its own.
it('marks a duty absent in MIS with the OTP from RHR, then shows what MIS says', async () => {
  const original = {...report('closed'), canEdit: true};
  const asked = {id: '11111111-1111-4111-8111-111111111111', status: 'sent', sentTo: ['rhr.ncl'], site, date: morning.date, shift: 'S1', employeeId: morning.employeeId, employeeName: 'Demo Operator', mark: 'absent'};
  // After the change MIS no longer sends the duty; it lists it among HR's changes instead.
  const after = {...original, otDuties: original.otDuties.filter(row => row.shift !== 'S1'),
    attendanceEquipment: original.attendanceEquipment.filter(row => row.employeeId !== morning.employeeId),
    hrChanges: [{id: asked.id, mark: 'absent', ...morning, siteKey: site.toLowerCase(), by: 'Meena', reason: 'Card filled for the wrong day', at: '2026-11-27T10:00:00Z'}]};
  const request = vi.fn()
    .mockResolvedValueOnce({ok: true, json: async () => original})
    .mockResolvedValueOnce({ok: true, json: async () => asked})
    .mockResolvedValueOnce({ok: true, json: async () => ({...asked, status: 'used'})})
    .mockResolvedValueOnce({ok: true, json: async () => after});
  vi.stubGlobal('fetch', request);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', {name: 'Mark absent Demo Operator, 2026-11-16, S1'}));
  const form = screen.getByRole('form', {name: 'Mark Demo Operator absent'});
  expect(within(form).getByText(/trip card stays in MIS with its trips/)).toBeTruthy();
  fireEvent.change(within(form).getByLabelText('Reason'), {target: {value: 'Card filled for the wrong day'}});
  fireEvent.click(within(form).getByRole('button', {name: 'Send OTP to RHR'}));
  await act(async () => {});
  expect(request.mock.calls[1][0]).toMatch(/attendance\/mis\/change$/);
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({site, date: morning.date, shift: 'S1', employeeId: morning.employeeId, mark: 'absent', reason: 'Card filled for the wrong day'});
  const otp = screen.getByRole('form', {name: 'Enter the OTP from RHR'});
  expect(within(otp).getByText(/OTP sent to RHR \(rhr\.ncl\) on Telegram .* Nothing changes until the OTP is entered/)).toBeTruthy();
  fireEvent.change(within(otp).getByLabelText('OTP from RHR'), {target: {value: '123456'}});
  fireEvent.click(within(otp).getByRole('button', {name: 'Confirm with OTP'}));
  await act(async () => {});
  expect(request.mock.calls[2][0]).toMatch(/attendance\/mis\/change\/verify$/);
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({id: asked.id, otp: '123456'});
  await act(async () => {});
  expect(screen.getByText(/Demo Operator is now absent in MIS/)).toBeTruthy();
  const row = screen.getByRole('row', {name: /S1 Demo Operator/});
  expect(within(row).getByText('Absent')).toBeTruthy();
  expect(within(row).getByText(/Marked absent in HR Pulse \(OTP\) · trip card kept in MIS/)).toBeTruthy();
  // The only thing left to do for it is to take the change back, again with an OTP.
  expect(within(row).getByRole('button', {name: 'Take back the HR change for Demo Operator, 2026-11-16, S1'})).toBeTruthy();
  expect(within(row).queryByRole('button', {name: /^Edit /})).toBeNull();
  expect(within(row).queryByRole('button', {name: /^Duty times of /})).toBeNull();
});

it('no longer applies an absent that was kept only in HR Pulse, and says so on the duty', () => {
  const original = report('closed');
  const target = mapMisAttendance(original).find(row => row.employeeId === 'DEMO-1' && row.shift === 'S1')!;
  for (const correction of [{id: target.id, status: 'absent', start: '', end: '', reason: 'Old HR mark', version: 1, updatedBy: 'test', updatedAt: ''},
    {id: target.id, status: 'absent', retired: true, start: '', end: '', reason: 'Old HR mark', version: 1, updatedBy: 'test', updatedAt: ''}]) {
    const row = mapMisAttendance({...original, corrections: [correction]}).find(r => r.id === target.id)!;
    expect(row.status).toBe('Present');
    expect(row.verification).toBe('MIS batch closed');
    expect(row.correction?.reason).toBe('Old HR mark');
  }
});

it('asks who, where, when and why to mark a person with no card present in MIS', async () => {
  const original = {...report('closed'), canEdit: true, sites: [site]};
  const asked = {id: '22222222-2222-4222-8222-222222222222', status: 'sent', sentTo: ['rhr.ncl'], site, date: '2026-11-16', shift: 'S2', employeeId: 'CMLL77', employeeName: 'New Person', mark: 'present'};
  const request = vi.fn().mockResolvedValueOnce({ok: true, json: async () => original}).mockResolvedValueOnce({ok: true, json: async () => asked});
  vi.stubGlobal('fetch', request);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T06:00:00Z'));
  render(<MisAttendance grant="test"/>);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', {name: 'Mark present (OTP)'}));
  const form = screen.getByRole('form', {name: 'Mark present in MIS'});
  fireEvent.change(within(form).getByLabelText('Employee ID'), {target: {value: 'CMLL77'}});
  fireEvent.change(within(form).getByLabelText('Site'), {target: {value: site}});
  fireEvent.change(within(form).getByLabelText('Shift'), {target: {value: 'S2'}});
  fireEvent.change(within(form).getByLabelText('Reason'), {target: {value: 'short'}});
  fireEvent.click(within(form).getByRole('button', {name: 'Send OTP to RHR'}));
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(1);
  expect(within(form).getByRole('alert').textContent).toMatch(/at least 10 letters/);
  fireEvent.change(within(form).getByLabelText('Reason'), {target: {value: 'Punched, card not made'}});
  fireEvent.click(within(form).getByRole('button', {name: 'Send OTP to RHR'}));
  await act(async () => {});
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({site, date: '2026-11-16', shift: 'S2', employeeId: 'CMLL77', mark: 'present', reason: 'Punched, card not made'});
  expect(screen.getByRole('form', {name: 'Enter the OTP from RHR'})).toBeTruthy();
});
