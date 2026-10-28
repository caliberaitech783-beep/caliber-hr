import {it,expect} from 'vitest';
import {monthDays} from './HRCalendar';
it('lays October 2026 out Sunday-first with the preceding dates',()=>{
 const days=monthDays('2026-10');expect(days[0]).toBe('2026-09-27');expect(days.at(-1)).toBe('2026-10-31');expect(days).toHaveLength(35);
});
it('handles leap years and year boundaries',()=>{
 expect(monthDays('2028-02')).toContain('2028-02-29');expect(monthDays('2026-01')[0]).toBe('2025-12-28');expect(monthDays('2026-08')).toHaveLength(42);
});
