import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import EmployeeLocation,{corporateOfficeExportGrid,normalizeEmploymentCategory,resolveCorporateReferences,validCorporateOfficeHeaders} from './EmployeeLocation';

const officeHeaders=['Sr. No.','Joining Category *','Employee Code','Full Name *','Full Name as per Aadhar','Father / Spouse Name *','Date of Birth','Gender','Caste/category','Identification mark','BLOOD GROUP','Mobile *','Alternate Mobile','Candidate E-mail *','Aadhaar No. *','PAN No.','Present Address','Permanent Address','Emergency Contact Name','Emergency Contact Number','Site *','Department *','Sub-department *','Designation *','Grade','Employee Category','Reporting To','Joining Date *','Shift *','Resident','Employment Type','Probation Period','Confirmation Status','Salary Structure /Scheme','Monthly Gross Salary','Cost Centre / Project Code','Father Name','Spouse Name','Payment Mode','Bank Name','IFSC Code','Bank Account No','UAN','PF Account No','PF Deduction','ESIC Account No','ESIC Establishment Code','ESIC Applicable','Status'];

describe('Corporate / HO import headers',()=>{
 it('accepts the supplied Employee Code-first format and ignores trailing blank columns',()=>{
  const uploaded=[officeHeaders[0],officeHeaders[2],officeHeaders[1],...officeHeaders.slice(3),'','',''];
  expect(validCorporateOfficeHeaders(uploaded)).toBe(true);
  expect(validCorporateOfficeHeaders(officeHeaders)).toBe(true);
  expect(validCorporateOfficeHeaders([...uploaded,'Unexpected'])).toBe(false);
 });
 it('resolves master names and leaves unmatched optional references blank',()=>{
  const rows=resolveCorporateReferences([{siteId:'CMPL NAGPUR',departmentId:'UNKNOWN',designationId:'VP',gradeId:'A1',shiftId:'GENERAL'}],[
   {id:'company-1',kind:'companies',code:'CMLL',name:'Caliber Mining and Logistics'},
   {id:'site-1',kind:'sites',code:'NAG',name:'CMPL Nagpur'},
   {id:'designation-1',kind:'designations',code:'VP',name:'Vice President'},
   {id:'grade-1',kind:'grades',code:'GRADE-A1',name:'A1'},
   {id:'shift-1',kind:'shifts',code:'GEN',name:'General'},
  ]);
  expect(rows[0]).toMatchObject({companyId:'company-1',siteId:'site-1',departmentId:'',designationId:'designation-1',gradeId:'grade-1',shiftId:'shift-1'});
  expect(()=>resolveCorporateReferences([{}],[])).toThrow(/exactly one active Company/);
 });
 it('normalizes spreadsheet employment categories for the API',()=>{
  expect(normalizeEmploymentCategory('PERMANENT')).toBe('Permanent');
  expect(normalizeEmploymentCategory('TEMPORARY')).toBe('Contract');
  expect(normalizeEmploymentCategory(' fixed-term ')).toBe('Contract');
  expect(normalizeEmploymentCategory('TRAINEE')).toBe('Trainee');
 });
 it('exports the exact Update Existing Employee columns and displayed values',()=>{
  const grid=corporateOfficeExportGrid([{id:'1',kind:'employees',code:'EMP-1',name:'Employee One',data:{officeData:{'Sr. No.':1,'Joining Category *':'CORPORATE'}} as any,status:'DRAFT',version:1,updated_at:'2026-10-23'}]);
  expect(grid[0]).toEqual(officeHeaders);
  expect(grid[1][0]).toBe(1);
  expect(grid[1][1]).toBe('CORPORATE');
  expect(grid[1][2]).toBe('EMP-1');
  expect(grid[1][3]).toBe('Employee One');
  expect(grid[1][48]).toBe('DRAFT');
 });
});

describe('Employee Master tabs',()=>{
 it('shows the four requested tabs and the complete joining workflow',()=>{
  const view=render(<EmployeeLocation/>);
  const labels=['Add New Employee','Update Existing Employee','Region Employee Details','Department & Designation'];
  expect(labels.map(label=>screen.getByRole('button',{name:label}))).toHaveLength(4);
  expect(screen.getByRole('button',{name:'Import'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Print\/Export/}));
  expect(screen.getByRole('menuitem',{name:/Download as PDF/})).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:/Download as Excel/})).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:/Smart Print/})).toBeTruthy();
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.csv');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xlsx');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xls');
  for(const section of ['Joining & Personal Details','Job & Posting Details','Educational Details','Family Details','Previous Work Experience','Document Checklist'])expect(screen.getByRole('button',{name:new RegExp(section)})).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Contract & Policies/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Assets$/})).toBeNull();
  expect(screen.queryByText(/Approval Tracker/i)).toBeNull();
  expect(screen.getAllByRole('heading',{name:'Joining & Personal Details'})).toHaveLength(2);
  expect(screen.queryByText('Fill Data by Candidate')).toBeNull();
  expect(screen.getByLabelText(/Full Name/)).toBeTruthy();
  expect(screen.getByLabelText(/Employee Code/)).toBeTruthy();
  expect(screen.queryByLabelText('Employee Group')).toBeNull();
  expect(screen.getByLabelText('UAN No.')).toBeTruthy();
  expect(screen.getByLabelText('ESIC')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Job & Posting Details/}));
  expect(screen.getByLabelText('Employment Type')).toBeTruthy();
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  view.rerender(<EmployeeLocation employeeGroup="OB / COAL"/>);
  fireEvent.click(screen.getByRole('button',{name:/Job & Posting Details/}));
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  fireEvent.change(screen.getByLabelText('Employee Category'),{target:{value:'Driver'}});
  expect(screen.getByRole('button',{name:/Mine Compliance/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Mine Compliance/}));
  expect(screen.getByLabelText(/Medical Examination Date/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Contract & Policies/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Assets$/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:/Educational Details/}));
  expect(screen.getByLabelText('Qualification 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Family Details/}));
  expect(screen.getByLabelText('Family Member Name 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Previous Work Experience/}));
  expect(screen.getByLabelText('Employer Name 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Document Checklist/}));
  expect(screen.getByLabelText('Upload Candidate photo')).toBeTruthy();
  expect(screen.getByLabelText('Upload VTC certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Medical fitness certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Driving licence')).toBeTruthy();
  expect(screen.getByLabelText('Upload Operator competency certificate')).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="Corporate / HO"/>);
  fireEvent.click(screen.getByRole('button',{name:/Document Checklist/}));
  expect(screen.queryByLabelText('Upload VTC certificate')).toBeNull();
  expect(screen.getByLabelText('Upload Signed appointment letter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  expect(screen.getByRole('button',{name:'Delete All'}).hasAttribute('disabled')).toBe(true);
  const sectionHeading=screen.getByRole('heading',{name:'Joining & Personal Details'}).parentElement?.parentElement;
  expect(sectionHeading?.querySelector('.joining-heading-tools')?.contains(screen.getByRole('button',{name:'Import'}))).toBe(true);
  expect(sectionHeading?.querySelector('.joining-heading-tools')?.contains(screen.getByRole('button',{name:/Print\/Export/}))).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('columnheader',{name:'Sr. No.'})).toBeNull();
  expect(screen.getByRole('columnheader',{name:'Employee Code'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'ESIC Applicable'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Job & Posting Details/}));
  expect(screen.getByRole('columnheader',{name:'Site *'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Educational Details/}));
  expect(screen.getByRole('columnheader',{name:'Qualification'})).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="OB / COAL"/>);
  expect(screen.getByRole('button',{name:/Mine Compliance/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Mine Compliance/}));
  expect(screen.getByRole('columnheader',{name:'Medical Examination Date'})).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="Corporate / HO"/>);
  fireEvent.click(screen.getByRole('button',{name:'Region Employee Details'}));
  expect(screen.getByRole('option',{name:'Nagpur CO'})).toBeTruthy();
  expect(screen.getByRole('option',{name:'Chandrapur HO'})).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="OB / COAL"/>);
  fireEvent.change(screen.getByLabelText('Coalfield'),{target:{value:'WCL'}});
  for(const site of ['Sasti OB','Dhoptala OB','Gauri Pauni OB','Majri OB'])expect(screen.getByRole('option',{name:site})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Coalfield'),{target:{value:'NCL'}});
  for(const site of ['Jayant OB','Dudhichua OB West','Dudhichua OB East'])expect(screen.getByRole('option',{name:site})).toBeTruthy();
 });
});
