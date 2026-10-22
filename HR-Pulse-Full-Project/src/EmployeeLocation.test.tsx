import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import EmployeeLocation from './EmployeeLocation';

describe('Employee Master tabs',()=>{
 it('shows the four requested tabs and the complete joining workflow',()=>{
  render(<EmployeeLocation/>);
  const labels=['Add New Employee','Update Existing Employee','Region Employee Details','Department & Designation'];
  expect(labels.map(label=>screen.getByRole('button',{name:label}))).toHaveLength(4);
  expect(screen.getByRole('button',{name:'Import'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Employee Details'})).toBeTruthy();
  expect(screen.getByLabelText(/Full Name/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Work Details/}));
  expect(screen.getByLabelText(/Medical Examination Date/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Contract & Policies/}));
  expect(screen.getByLabelText('Employment Type')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Assets & Docs/}));
  expect(screen.getByLabelText('Upload Candidate photo')).toBeTruthy();
  expect(screen.getByLabelText('Upload Signed appointment letter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  expect(screen.queryByRole('textbox')).toBeNull();
 });
});
