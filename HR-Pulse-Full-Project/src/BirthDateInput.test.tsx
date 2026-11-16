import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import FormInput from './BirthDateInput';
import {lockAadhaarField} from './EmployeeLocation';
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
it('saves the calendar choice in its own family row and respects scanned DOB locks',async()=>{
 const prototype=HTMLInputElement.prototype;
 const original=Object.getOwnPropertyDescriptor(prototype,'showPicker');
 const showPicker=vi.fn();
 Object.defineProperty(prototype,'showPicker',{configurable:true,value:showPicker});
 try{
  today();
  const view=render(<form><FormInput name="Date of Birth 1"/><FormInput name="Date of Birth 2"/></form>);
  const form=view.container.querySelector('form')!;
  const second=screen.getByRole('textbox',{name:'Date of Birth 2'});
  const button=screen.getByRole('button',{name:'Choose Date of Birth 2'});
  const picker=second.parentElement!.querySelector<HTMLInputElement>('input[type=date]')!;
  const onInput=vi.fn(()=>new FormData(form).get('Date of Birth 2'));
  form.addEventListener('input',onInput);

  fireEvent.click(button);
  expect(showPicker.mock.contexts).toEqual([picker]);
  fireEvent.input(picker,{target:{value:'2000-03-15'}});
  expect(onInput.mock.results[0].value).toBe('2000-03-15');
  expect(second).toHaveValue('15/03/2000');
  expect(screen.getAllByLabelText('Age')[1]).toHaveTextContent('26 years, 7 months, 22 days');
  expect([...new FormData(form).entries()]).toEqual([['Date of Birth 1',''],['Date of Birth 2','2000-03-15']]);

  const saved=form.elements.namedItem('Date of Birth 2') as HTMLInputElement;
  await act(async()=>{lockAadhaarField(form,'Date of Birth 2');});
  expect(saved.dataset.aadhaarLocked).toBe('1');
  expect(second).toHaveAttribute('readonly');
  expect(screen.queryByRole('button',{name:'Choose Date of Birth 2'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Choose Date of Birth 1'})).toBeEnabled();
 }finally{
  if(original)Object.defineProperty(prototype,'showPicker',original);
  else Reflect.deleteProperty(prototype,'showPicker');
 }
});
it('shows a separate age column beside each family DOB in approved reviews',()=>{
 today();render(<LocalEmployeeReviewForm record={{id:'e',code:'E',name:'Employee',data:{officeData:{'Family Date of Birth':'2000-03-15 | 2025-10-05'}}}} owner="test" readOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'Family Details'}));
 expect(screen.getAllByRole('columnheader').map(header=>header.textContent)).toEqual(['No.','Family Member Name','Relationship','Family Date of Birth','Age','Contact No.','Occupation','Dependent? (Y/N)']);
 expect(screen.getByLabelText('Age 1').textContent).toBe('26 years, 7 months, 22 days');
 expect(screen.getByLabelText('Age 2').textContent).toBe('1 year, 1 month, 1 day');
 expect((screen.getByLabelText('Family Date of Birth 1') as HTMLInputElement).readOnly).toBe(true);
});
