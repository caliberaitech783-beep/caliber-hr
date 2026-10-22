import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import EmployeeLocation from './EmployeeLocation';

describe('Employee Master tabs',()=>{
 it('shows the four requested tabs and the complete joining workflow',()=>{
  render(<EmployeeLocation/>);
  const labels=['Add New Employee','Update Existing Employee','Region Employee Details','Department & Designation'];
  expect(labels.map(label=>screen.getByRole('button',{name:label}))).toHaveLength(4);
  expect(screen.getByRole('button',{name:'Import'})).toBeTruthy();
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.csv');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xlsx');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xls');
  expect(screen.getByRole('heading',{name:'Employee Details'})).toBeTruthy();
  expect(screen.getByLabelText(/Full Name/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Work Details/}));
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  fireEvent.change(screen.getByLabelText('Employee Group'),{target:{value:'OB / COAL'}});
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  fireEvent.change(screen.getByLabelText('Employee Category'),{target:{value:'Driver'}});
  expect(screen.getByLabelText(/Medical Examination Date/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Contract & Policies/}));
  expect(screen.getByLabelText('Employment Type')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Assets & Docs/}));
  expect(screen.getByLabelText('Upload Candidate photo')).toBeTruthy();
  expect(screen.getByLabelText('Upload VTC certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Medical fitness certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Driving licence')).toBeTruthy();
  expect(screen.getByLabelText('Upload Operator competency certificate')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Employee Group'),{target:{value:'Corporate / HO'}});
  expect(screen.queryByLabelText('Upload VTC certificate')).toBeNull();
  expect(screen.getByLabelText('Upload Signed appointment letter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  expect(screen.queryByRole('textbox')).toBeNull();
 });
});
