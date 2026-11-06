import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import FormInput from './BirthDateInput';
import {restoreJoiningFields} from './joiningDrafts';
import LocalEmployeeReviewForm from './LocalEmployeeReviewForm';
afterEach(()=>{cleanup();vi.useRealTimers();});
function today(){vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T08:00:00Z'));}
it('updates the age automatically beside DOB when entered, changed or cleared',()=>{
 today();render(<form><FormInput name="Date of Birth" type="date"/></form>);
 const input=screen.getByLabelText('Date of Birth');fireEvent.change(input,{target:{value:'2000-03-15'}});
 expect(screen.getByLabelText('Age').textContent).toBe('26 years, 7 months, 22 days');
 fireEvent.input(input,{target:{value:'2025-10-05'}});expect(screen.getByLabelText('Age').textContent).toBe('1 year, 1 month, 1 day');
 fireEvent.change(input,{target:{value:''}});expect(screen.getByLabelText('Age').textContent).toBe('—');
});
it('shows ages for restored drafts and scanned values without saving a derived age as a form field',()=>{
 today();const view=render(<form><FormInput name="Date of Birth" type="date"/></form>),form=view.container.querySelector('form')!;
 act(()=>restoreJoiningFields(form,{'Date of Birth':[{value:'2000-03-15'}]}));
 // Programmatic restoration notifies the same listener as scanned Aadhaar data.

 expect(screen.getByLabelText('Age').textContent).toBe('26 years, 7 months, 22 days');
 expect([...new FormData(form).keys()]).toEqual(['Date of Birth']);
});
it('shows a separate age column beside each family DOB in approved reviews',()=>{
 today();render(<LocalEmployeeReviewForm record={{id:'e',code:'E',name:'Employee',data:{officeData:{'Family Date of Birth':'2000-03-15 | 2025-10-05'}}}} owner="test" readOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'Family Details'}));
 expect(screen.getAllByRole('columnheader').map(header=>header.textContent)).toEqual(['No.','Family Member Name','Relationship','Family Date of Birth','Age','Contact No.','Occupation','Dependent? (Y/N)']);
 expect(screen.getByLabelText('Age 1').textContent).toBe('26 years, 7 months, 22 days');
 expect(screen.getByLabelText('Age 2').textContent).toBe('1 year, 1 month, 1 day');
 expect((screen.getByLabelText('Family Date of Birth 1') as HTMLInputElement).readOnly).toBe(true);
});
