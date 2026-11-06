import {expect,it} from 'vitest';
import {ageText,calendarAge} from './age';
it('calculates completed calendar years, months and days',()=>{
 expect(calendarAge('2000-03-15','2026-11-06')).toEqual({years:26,months:7,days:22});
 expect(calendarAge('2000-11-07','2026-11-06')).toEqual({years:25,months:11,days:30});
 expect(ageText('2025-10-05','2026-11-06')).toBe('1 year, 1 month, 1 day');
 expect(ageText('2026-11-06','2026-11-06')).toBe('0 years, 0 months, 0 days');
});
it('handles leap birthdays and month ends without negative days',()=>{
 expect(calendarAge('2000-02-29','2025-02-28')).toEqual({years:25,months:0,days:0});
 expect(calendarAge('2024-01-31','2024-02-29')).toEqual({years:0,months:1,days:0});
 expect(calendarAge('2024-01-31','2024-03-01')).toEqual({years:0,months:1,days:1});
 expect(calendarAge('2024-12-31','2025-01-30')).toEqual({years:0,months:0,days:30});
});
it('does not show misleading ages for blank, invalid or future DOBs',()=>{
 for(const value of ['','2026-02-30','20266-01-01','2026-11-07','garbage'])expect(calendarAge(value,'2026-11-06')).toBeNull();
 expect(ageText('15/03/2000','2026-11-06')).toBe('26 years, 7 months, 22 days');
});
