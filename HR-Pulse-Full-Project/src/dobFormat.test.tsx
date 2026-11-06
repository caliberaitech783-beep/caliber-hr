import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useState} from 'react';
import FormInput from './BirthDateInput';
import {dobDisplay,dobIso} from './dobFormat';
afterEach(cleanup);
it('adds DOB separators and validates dates while keeping four year digits',()=>{
 expect(dobDisplay('15')).toBe('15/');expect(dobDisplay('1503')).toBe('15/03/');expect(dobDisplay('15032000')).toBe('15/03/2000');
 expect(dobDisplay('150320000')).toBe('15/03/2000');expect(dobIso('15/03/2000')).toBe('2000-03-15');expect(dobIso('31/02/2000')).toBe('');
});
it('keeps typing and editing working in controlled forms and stores ISO dates',()=>{
 function Form(){const[value,setValue]=useState('2000-03-15');return <form><FormInput name="Date of Birth" type="date" value={value} onChange={e=>setValue(e.target.value)}/><output>{value}</output></form>;}
 const view=render(<Form/>),input=screen.getByLabelText('Date of Birth') as HTMLInputElement;
 expect(input.value).toBe('15/03/2000');
 fireEvent.change(input,{target:{value:'12'}});expect(input.value).toBe('12/');
 fireEvent.change(input,{target:{value:'12/10'}});expect(input.value).toBe('12/10/');
 fireEvent.change(input,{target:{value:'12/10/1999'}});expect(input.value).toBe('12/10/1999');
 expect(new FormData(view.container.querySelector('form')!).get('Date of Birth')).toBe('1999-10-12');
 fireEvent.change(input,{target:{value:'31/02/2000'}});expect(input.validity.valid).toBe(false);
});
it('enforces numeric Aadhaar length on typing and spaced paste',()=>{
 render(<FormInput name="Aadhaar No."/>);const input=screen.getByRole('textbox') as HTMLInputElement;
 expect(input.maxLength).toBe(12);expect(input.minLength).toBe(12);
 fireEvent.input(input,{target:{value:'123456789012345x'}});expect(input.value).toBe('123456789012');
 fireEvent.change(input,{target:{value:'123'}});expect(input.checkValidity()).toBe(false);
 input.select();fireEvent.paste(input,{clipboardData:{getData:()=> '1234 5678 9012'}});
 expect(input.value).toBe('123456789012');expect(input.checkValidity()).toBe(true);
});
it('leaves the full name as per Aadhaar field unrestricted',()=>{
 render(<FormInput name="Full Name as per Aadhar"/>);const input=screen.getByRole('textbox') as HTMLInputElement;
 fireEvent.change(input,{target:{value:'Sample Employee Name'}});expect(input.value).toBe('Sample Employee Name');expect(input.maxLength).not.toBe(12);
});
