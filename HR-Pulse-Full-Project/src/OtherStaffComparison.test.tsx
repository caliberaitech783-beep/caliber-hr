import '@testing-library/jest-dom/vitest';
import {render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import OtherStaffComparison from './OtherStaffComparison';

describe('Comparison tab',()=>{
 it('shows import, site and dates, and Check final attendance',()=>{
  render(<OtherStaffComparison grant="g" sites={['Sasti','Majri']} today="2026-11-28"/>);
  expect(screen.getByText('1 · Import Excel attendance')).toBeInTheDocument();
  expect(screen.getByText('Import Excel attendance')).toBeInTheDocument();
  expect(screen.getByText('2 · Site, From date and To date')).toBeInTheDocument();
  expect(screen.getByLabelText('Site')).toBeInTheDocument();
  expect(screen.getByLabelText('From date')).toBeDisabled();
  expect(screen.getByLabelText('To date')).toBeDisabled();
  expect(screen.getByRole('button',{name:/Check final attendance/})).toBeDisabled();
  expect(screen.getByText('Import the Excel file first.')).toBeInTheDocument();
 });
});
