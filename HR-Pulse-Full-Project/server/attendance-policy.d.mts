export type AttendancePolicy = {
  lunchMinutes: number; absentBelowHours: number; fullDutyHours: number; graceMinutes: number;
  lateEarlyPerHalfCut: number; gatePassFreeMinutes: number; exemptRoles: string[];
};
export type DutyCode = 'A' | 'HD' | 'P';
export type DayResult = {
  status: DutyCode | 'MP'; exempt: boolean; missPunch: boolean; workedMinutes: number | null;
  late: boolean; early: boolean; gatePassMinutes: number; gatePassDeduction: number;
};
export const DEFAULT_POLICY: Readonly<AttendancePolicy>;
export const GATE_PASS_HOURS_PER_DAY: number;
export function validatePolicy(input?: Partial<AttendancePolicy> | Record<string, unknown>): AttendancePolicy;
export function clockMinutes(value: unknown): number | null;
export function durationMinutes(value: unknown): number | null;
export function workedMinutes(inMinute: number | null, outMinute: number | null, policy?: AttendancePolicy): number;
export function dutyStatus(worked: number, policy?: AttendancePolicy): DutyCode;
export function isLate(inMinute: number | null, shiftStart: number | null, policy?: AttendancePolicy): boolean;
export function isEarly(outMinute: number | null, shiftEnd: number | null): boolean;
export function halfDutyCuts(lateEarlyCount: number, policy?: AttendancePolicy): number;
export function gatePassDeduction(totalMinutes: number, dailyWage: number, policy?: AttendancePolicy): number;
export function isExempt(designation: string, policy?: AttendancePolicy): boolean;
export function noBiometricHalfDay(site: string, designation: string): boolean;
export function evaluateDay(day?: {inMinute?: number | null; outMinute?: number | null; shiftStart?: number | null; shiftEnd?: number | null;
  designation?: string; site?: string; gatePassMinutes?: number; dailyWage?: number}, policy?: AttendancePolicy): DayResult;
export function summarizeMonth(days: Partial<DayResult>[], policy?: AttendancePolicy): {
  full: number; half: number; absent: number; missPunch: number; late: number; early: number; lateEarly: number;
  halfDutyCuts: number; duties: number; gatePassDeduction: number;
};
export function policyRules(policy?: AttendancePolicy): [string, string][];
