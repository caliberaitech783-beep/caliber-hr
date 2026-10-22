import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import EmployeeLocation from './EmployeeLocation';

describe('Employee Master tabs',()=>{
 it('shows only the four requested tabs',()=>{
  render(<EmployeeLocation/>);
  const labels=['Add New Employee','Update Existing Employee','Region Employee Details','Department & Designation'];
  expect(labels.map(label=>screen.getByRole('button',{name:label}))).toHaveLength(4);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  expect(screen.queryByRole('textbox')).toBeNull();
 });
});
