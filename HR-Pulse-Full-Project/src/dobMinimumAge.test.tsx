import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import FormInput from './BirthDateInput';
import {latestBirthDate,minimumAgeMessage} from './age';
afterEach(()=>{cleanup();vi.useRealTimers();});
function today(){vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));}
it('accepts an 18th birthday on today and refuses one day younger or a future date',()=>{
 expect(minimumAgeMessage('2008-11-21',18,'2026-11-21')).toBe('');
 expect(minimumAgeMessage('1990-01-01',18,'2026-11-21')).toBe('');
 expect(minimumAgeMessage('2008-11-22',18,'2026-11-21')).toMatch(/at least 18 years.*21\/11\/2008/);
 expect(minimumAgeMessage('2027-01-01',18,'2026-11-21')).toMatch(/cannot be after today/);
 expect(minimumAgeMessage('',18,'2026-11-21')).toBe('');
 expect(latestBirthDate(18,'2028-02-29')).toBe('2010-02-28');
});
it('blocks an employee DOB under 18 on the form and caps the calendar',()=>{
 today();
 const view=render(<form><FormInput name="Date of Birth" minAge={18}/></form>);
 const input=screen.getByRole('textbox',{name:'Date of Birth'}) as HTMLInputElement;
 fireEvent.change(input,{target:{value:'22/11/2008'}});
 expect(input.validity.valid).toBe(false);
 expect(screen.getByRole('alert')).toHaveTextContent('Age must be at least 18 years as of today (born on or before 21/11/2008).');
 fireEvent.change(input,{target:{value:'21/11/2008'}});
 expect(input.validity.valid).toBe(true);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(view.container.querySelector('input[type=date]')?.getAttribute('max')).toBe('2008-11-21');
});
it('leaves family member DOBs without the 18-year rule',()=>{
 today();
 render(<form><FormInput name="Date of Birth 1"/></form>);
 const input=screen.getByRole('textbox',{name:'Date of Birth 1'}) as HTMLInputElement;
 fireEvent.change(input,{target:{value:'05/10/2025'}});
 expect(input.validity.valid).toBe(true);
});
