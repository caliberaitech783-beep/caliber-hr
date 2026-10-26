import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import EmployeeLocation,{aadhaarDetails,corporateOfficeExportGrid,joiningOfficeData,normalizeEmploymentCategory,resolveCorporateReferences,validCorporateOfficeHeaders} from './EmployeeLocation';

const officeHeaders=['Sr. No.','Joining Category *','Employee Code','Full Name *','Full Name as per Aadhar','Father / Spouse Name *','Date of Birth','Gender','Caste/category','Identification mark','BLOOD GROUP','Mobile *','Alternate Mobile','Candidate E-mail *','Aadhaar No. *','PAN No.','Present Address','Permanent Address','Emergency Contact Name','Emergency Contact Number','Site *','Department *','Sub-department *','Designation *','Grade','Employee Category','Reporting To','Joining Date *','Shift *','Resident','Employment Type','Probation Period','Confirmation Status','Salary Structure /Scheme','Monthly Gross Salary','Cost Centre / Project Code','Father Name','Spouse Name','Payment Mode','Bank Name','IFSC Code','Bank Account No','UAN','PF Account No','PF Deduction','ESIC Account No','ESIC Establishment Code','ESIC Applicable','Status'];

describe('Corporate / HO import headers',()=>{
 it('extracts the main Aadhaar fields from OCR text',()=>{
  expect(aadhaarDetails('APURVA PRIYADARSHINI KOPULWAR\nDOB: 06/12/2000\nFEMALE\nC/O: Dyaninath Kopulwar\nAddress: Chandrapur, Maharashtra - 442507\n8573 5149 3646')).toMatchObject({name:'APURVA PRIYADARSHINI KOPULWAR',dob:'2000-12-06',gender:'Female',uid:'857351493646',relationName:'Dyaninath Kopulwar',address:expect.stringContaining('Chandrapur')});
 });
 it('extracts letter-style Aadhaar details without an Address label',()=>{
  const result=aadhaarDetails('Government of India\nTo\nSanskar Vinod Manohare\nS/O: Vinod Manohare\nplot no-18\ngorewada road\nutthan nagar\nNatraj Society\nKatolroad\nNagpur Maharashtra - 440013\n9595554841\nYour Aadhaar No.\n2631 8416 3169\nSanskar Vinod Manohare\nDOB: 23/03/2001\nMALE');
  expect(result).toMatchObject({name:'Sanskar Vinod Manohare',relationName:'Vinod Manohare',dob:'2001-03-23',gender:'Male',uid:'263184163169'});
  expect(result.address).toContain('plot no-18');expect(result.address).toContain('440013');expect(result.address).not.toContain('9595554841');
 });
 it('removes OCR border noise around the employee name',()=>{
  expect(aadhaarDetails('To\n5 eon fee mw\n2 Sanskar Vinod Manohare 1\nS/O: Vinod Manchare\nplot no-18\nNagpur Maharashtra - 440013\nSanskar Vinod Manohare ]\nDOB: 23/03/2001\nMALE')).toMatchObject({name:'Sanskar Vinod Manohare',relationName:'Vinod Manchare'});
 });
 it('extracts a name when OCR joins it onto the DOB line',()=>{
  expect(aadhaarDetails('Government of India\nStupal Baba Moon DOB: 07/07/2004\nMale\n3774 5039 2569')).toMatchObject({name:'Stupal Baba Moon',dob:'2004-07-07',gender:'Male',uid:'377450392569',relationName:''});
 });
 it('extracts the English name when OCR merges it with Hindi text',()=>{
  expect(aadhaarDetails('भारत सरकार\nस्तूपल बाबा मून Stupal Baba Moon\nजन्म तिथि Stupal Baba Moon DOB: 07/07/2004\nपुरुष Male\n3774 5039 2569')).toMatchObject({name:'Stupal Baba Moon',relationName:'',dob:'2004-07-07',gender:'Male'});
 });
 it('rejects fragmented OCR noise instead of filling a false name',()=>{
  expect(aadhaarDetails('Government of India\nSw NE A Ee\nDOB: 07/07/2004\nMale\n3774 5039 2569')).toMatchObject({name:'',relationName:'',dob:'2004-07-07',gender:'Male'});
 });
 it('keeps an explicitly printed father name instead of inferring it from the full name',()=>{
  expect(aadhaarDetails('Stupal Baba Moon\nS/O: Ramesh Moon\nDOB: 07/07/2004\nMale')).toMatchObject({name:'Stupal Baba Moon',relationName:'Ramesh Moon'});
 });
 it('rejects Aadhaar labels misread as a father name and uses the stronger OCR pass',()=>{
  const result=aadhaarDetails('C/O: vmmenoringa AADHAAR\nDOB: 07/04/1998\nFEMALE\n--- next focused pass ---\nAPURVA PRIYADARSHINI KOPULWAR\nD/O: Dyaninath Kopulwar\nDOB: 07/04/1998\nFEMALE');
  expect(result).toMatchObject({name:'APURVA PRIYADARSHINI KOPULWAR',relationName:'Dyaninath Kopulwar',dob:'1998-04-07',gender:'Female'});
 });
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
  expect(resolveCorporateReferences([{}],[{id:'old-company',kind:'companies',code:'OLD',name:'Old company'},{id:'company-1',kind:'companies',code:'CMLL',name:'Caliber Mining and Logistics'}])[0]).toMatchObject({companyId:'company-1'});
  expect(()=>resolveCorporateReferences([{}],[])).toThrow(/CMLL Company master/);
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
 it('keeps the selected job designation separate from experience and preserves section details',()=>{
  expect(joiningOfficeData({
   'Designation':'IT Executive','Designation 1':'Assistant Manager','Designation 2':'',
   'Qualification 1':'B.Tech','Qualification 2':'','Board / University 1':'VNIT Nagpur',
   'Family Member Name 1':'Parent One','Date of Birth 1':'1970-05-20',
   'Employer Name 1':'Example Pvt Ltd','Upload Candidate photo':'candidate.jpg','Upload Aadhaar (masked display)':'aadhaar.pdf',
  })).toMatchObject({
   'Designation *':'IT Executive','Previous Designation':'Assistant Manager',Qualification:'B.Tech','Board / University':'VNIT Nagpur',
   'Family Member Name':'Parent One','Family Date of Birth':'1970-05-20','Employer Name':'Example Pvt Ltd',
   'Candidate photo':'candidate.jpg','Aadhaar (masked display)':'aadhaar.pdf',
  });
 });
});

describe('Employee Master tabs',()=>{
 it('loads only finally approved employees for Update Existing Employee',async()=>{
  const fetchMock=vi.fn(async(_url:string)=>new Response(JSON.stringify({rows:[]})));vi.stubGlobal('fetch',fetchMock);
  render(<EmployeeLocation grant="test-grant"/>);fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  await waitFor(()=>expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls.some(([url])=>String(url).includes('records/employees?page=1&search=&status=ACTIVE'))).toBe(true);
 });
 it('shows the requested tabs and the complete joining workflow',()=>{
  const view=render(<EmployeeLocation/>);
  const labels=['Add Temp. Employee','Update Existing Employee','Employee Verify','Completed Form','Reports'];
  expect(labels.map(label=>screen.getByRole('button',{name:label}))).toHaveLength(5);
  expect(screen.queryByRole('button',{name:'T to P C.Id'})).toBeNull();
  expect(screen.getByRole('button',{name:'Import'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Print\/Export/}));
  expect(screen.getByRole('menuitem',{name:/Download as PDF/})).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:/Download as Excel/})).toBeTruthy();
  expect(screen.getByRole('menuitem',{name:/Smart Print/})).toBeTruthy();
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.csv');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xlsx');
  expect(screen.getByLabelText('Import employee file').getAttribute('accept')).toContain('.xls');
  for(const section of ['Upload Aadhaar Card','Joining & Personal Details','Educational Details','Family Details','Previous Work Experience','Document Checklist'])expect(screen.getByRole('button',{name:new RegExp(section)})).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Job & Posting Details/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Contract & Policies/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Assets$/})).toBeNull();
  expect(screen.queryByText(/Approval Tracker/i)).toBeNull();
  expect(screen.getByRole('heading',{name:'Upload Aadhaar Card'})).toBeTruthy();
  expect(screen.queryByText('Fill Data by Candidate')).toBeNull();
  expect(screen.getByLabelText(/^Full Name \*/)).toBeTruthy();
  expect(screen.getByLabelText(/Employee Code/)).toBeTruthy();
  expect(screen.getByLabelText('Employee group')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Upload Aadhaar Image 1'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Upload Aadhaar Image 2'})).toBeTruthy();
  expect(screen.getByLabelText('Choose second Aadhaar image')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Upload Aadhaar Image 1'}));
  expect(screen.getByRole('button',{name:'Camera'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Gallery / Document'})).toBeTruthy();
  const aadhaarInput=screen.getByLabelText('Choose Aadhaar card from gallery');
  for(const format of ['.jpg','.jpeg','.png','.pdf'])expect(aadhaarInput.getAttribute('accept')).toContain(format);
  fireEvent.change(aadhaarInput,{target:{files:[new File(['aadhaar'],'aadhaar.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('button',{name:/Joining & Personal Details/}));
  expect((screen.getByLabelText(/^Full Name \*/) as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText(/Full Name as per Aadhaar/) as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText(/PAN No\./) as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText(/Employee Code/) as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText(/Employment Type/) as HTMLSelectElement).required).toBe(true);
  expect(screen.getByRole('button',{name:'Employee Category'}).getAttribute('aria-required')).toBe('true');
  const employeeCategory=screen.getByRole('button',{name:'Employee Category'});
  fireEvent.click(employeeCategory);
  fireEvent.click(screen.getByRole('option',{name:'Staff'}));
  expect(screen.getByRole('button',{name:'Employee Category'}).textContent).toContain('Staff');
  expect((screen.getByLabelText(/A-Form No\./) as HTMLInputElement).required).toBe(false);
  fireEvent.change(screen.getByLabelText('Corporate / HO subtype'),{target:{value:'Corporate'}});
  fireEvent.change(screen.getByLabelText('Corporate / HO site'),{target:{value:'KSR'}});
  fireEvent.change(screen.getByLabelText('Department'),{target:{value:'Production'}});
  expect(screen.getAllByRole('option',{name:'Operations'}).length).toBeGreaterThan(0);
  expect(screen.queryByRole('option',{name:'Preventive Maintenance'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Sub-department'),{target:{value:'Operations'}});
  expect(screen.getAllByRole('option',{name:'Production Manager'}).length).toBeGreaterThan(0);
  expect(screen.queryByRole('option',{name:'Maintenance Manager'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Designation'),{target:{value:'Production Manager'}});
  expect((screen.getByLabelText(/Joining Category/) as HTMLSelectElement).value).toBe('CORPORATE');
  expect((screen.getAllByLabelText(/Site/).at(-1) as HTMLSelectElement).value).toBe('KSR');
  expect((screen.getAllByLabelText(/Department/).at(-1) as HTMLSelectElement).value).toBe('Production');
  expect((screen.getAllByLabelText(/Sub-department/).at(-1) as HTMLSelectElement).value).toBe('Operations');
  expect((document.querySelector('select[name="Designation"]') as HTMLSelectElement).value).toBe('Production Manager');
  expect(screen.getByLabelText('UAN No.')).toBeTruthy();
  expect(screen.getByLabelText('ESIC')).toBeTruthy();
  expect(screen.getByRole('heading',{name:'Job & Posting Details'})).toBeTruthy();
  expect(screen.getByLabelText(/Employment Type/)).toBeTruthy();
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  view.rerender(<EmployeeLocation employeeGroup="OB / COAL"/>);
  fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[new File(['aadhaar'],'aadhaar.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('button',{name:/Joining & Personal Details/}));
  fireEvent.change(screen.getByLabelText('OB / COAL subtype'),{target:{value:'WCL'}});
  expect(screen.getAllByRole('option',{name:'Sasti OB'}).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('OB / COAL site'),{target:{value:'Sasti OB'}});
  expect((screen.getByLabelText(/Joining Category/) as HTMLSelectElement).value).toBe('WCL');
  expect((screen.getAllByLabelText(/Site/).at(-1) as HTMLSelectElement).value).toBe('Sasti OB');
  expect(screen.queryByRole('heading',{name:/Mine Compliance/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Employee Category'}));
  fireEvent.click(screen.getByRole('listbox',{name:'Employee Category options'}).querySelector('[role="option"][aria-selected="false"]:nth-of-type(3)')!);
  expect(screen.getByRole('button',{name:'Employee Category'}).textContent).toContain('Driver');
  expect((screen.getByLabelText(/A-Form No\./) as HTMLInputElement).required).toBe(true);
  expect(screen.queryByRole('button',{name:/Mine Compliance/})).toBeNull();
  expect(screen.getByRole('heading',{name:/Mine Compliance/})).toBeTruthy();
  expect(screen.getByLabelText(/Medical Examination Date/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Contract & Policies/})).toBeNull();
  expect(screen.queryByRole('button',{name:/Assets$/})).toBeNull();
  for(const [name,value] of [['A-Form No.','AF-1'],['Full Name','Employee One'],['Full Name as per Aadhaar','Employee One'],['Employee Code','EMP-1'],['Father / Spouse Name','Parent One'],['Mobile','9876543210'],['Candidate E-mail','employee@example.com'],['Aadhaar No.','123412341234'],['PAN No.','ABCDE1234F']] as const)fireEvent.input(document.querySelector(`[name="${name}"]`)!,{target:{value}});
  fireEvent.change(screen.getByLabelText(/Joining Date/),{target:{value:'2026-10-26'}});
  fireEvent.change(screen.getByLabelText(/Shift/),{target:{value:'General'}});
  fireEvent.change(screen.getByLabelText(/Employment Type/),{target:{value:'Permanent'}});
  fireEvent.change(screen.getByLabelText(/Medical Examination Date/),{target:{value:'2026-10-26'}});
  fireEvent.click(screen.getByRole('button',{name:/Educational Details/}));
  expect(screen.getByLabelText('Qualification 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Family Details/}));
  expect(screen.getByLabelText('Family Member Name 1')).toBeTruthy();
  expect(screen.getByLabelText('Contact No. 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Previous Work Experience/}));
  expect(screen.getByLabelText('Employer Name 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Document Checklist/}));
  expect(screen.queryByRole('columnheader',{name:'Mandatory / Conditional'})).toBeNull();
  for(const input of screen.getAllByLabelText(/^Upload /))expect(input.getAttribute('accept')).toBe('.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf');
  expect((screen.getByLabelText('Upload Candidate photo') as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText('Upload Aadhaar (masked display)') as HTMLInputElement).required).toBe(true);
  expect((screen.getByLabelText('Upload PAN') as HTMLInputElement).required).toBe(false);
  expect(screen.getAllByRole('button',{name:'Preview'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getAllByRole('button',{name:'Remove'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
  expect(screen.getByLabelText('Upload VTC certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Medical fitness certificate')).toBeTruthy();
  expect(screen.getByLabelText('Upload Driving licence')).toBeTruthy();
  expect(screen.getByLabelText('Upload Operator competency certificate')).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="Corporate / HO"/>);
  expect(screen.getAllByRole('option',{name:'Nagpur CO'}).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('option',{name:'Chandrapur HO'}).length).toBeGreaterThan(0);
  expect(screen.getByRole('option',{name:'KSR'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Document Checklist/}));
  expect(screen.queryByLabelText('Upload VTC certificate')).toBeNull();
  expect(screen.getByLabelText('Upload Signed appointment letter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Update Existing Employee'}));
  expect(screen.getByRole('button',{name:'Delete All'}).hasAttribute('disabled')).toBe(true);
  const sectionHeading=screen.getByRole('heading',{name:'Joining & Personal Details'}).parentElement?.parentElement;
  expect(sectionHeading?.querySelector('.joining-heading-tools')?.contains(screen.getByRole('button',{name:'Import'}))).toBe(true);
  expect(sectionHeading?.querySelector('.joining-heading-tools')?.contains(screen.getByRole('button',{name:/Print\/Export/}))).toBe(true);
  expect(sectionHeading?.querySelector('.joining-heading-tools')?.contains(screen.getByRole('button',{name:'Delete All'}))).toBe(true);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('columnheader',{name:'Sr. No.'})).toBeNull();
  expect(screen.getByRole('columnheader',{name:'Employee Code'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'ESIC Applicable'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Job & Posting Details/}));
  expect(screen.getByRole('columnheader',{name:'Site *'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Educational Details/}));
  expect(screen.getByRole('columnheader',{name:'Qualification'})).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="OB / COAL"/>);
  expect(screen.getByRole('option',{name:'WCL'})).toBeTruthy();
  expect(screen.getByRole('option',{name:'NCL'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('OB / COAL subtype'),{target:{value:'WCL'}});
  for(const site of ['Sasti OB','Dhoptala OB','Majri OB','Gauri Pauni OB'])expect(screen.getAllByRole('option',{name:site}).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('OB / COAL subtype'),{target:{value:'NCL'}});
  for(const site of ['Jayant OB','Dudichua OB west','Dudichua OB East'])expect(screen.getAllByRole('option',{name:site}).length).toBeGreaterThan(0);
  expect(screen.getByRole('button',{name:/Mine Compliance/})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:/Mine Compliance/}));
  expect(screen.getByRole('columnheader',{name:'Medical Examination Date'})).toBeTruthy();
  view.rerender(<EmployeeLocation employeeGroup="Corporate / HO"/>);
  fireEvent.click(screen.getByRole('button',{name:'Reports'}));
  expect(screen.getByRole('button',{name:'Region Employee Details'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Department & Designation'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Region Employee Details'}));
  expect(screen.getAllByRole('option',{name:'Nagpur CO'}).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('option',{name:'Chandrapur HO'}).length).toBeGreaterThan(0);
  expect(screen.getByText('Sign in to load Pulse C-Directory.')).toBeTruthy();
 },15000);
});


describe('Aadhaar printed field positions',()=>{
 it('prefers the holder name above DOB over repeated names in the address',()=>{
  const text='To\nOther Person Name\nS/O: Sanjay Umate\nOther Person Name\nAddress: D/O: Sanjay Umate, House 12\nNagpur Maharashtra 440013\nमयुरी संजय उमाटे\nMayuri Sanjay Umate\nजन्म तारीख/DOB: 07/04/1998\nFEMALE';
  expect(aadhaarDetails(text)).toMatchObject({name:'Mayuri Sanjay Umate',relationName:'Sanjay Umate',dob:'1998-04-07',address:expect.stringContaining('D/O: Sanjay Umate')});
 });
 it('reads the S/O line and includes it in a letter address',()=>{
  expect(aadhaarDetails('To\nArun Vijay Sharma\nS/O: Vijay Sharma\nHouse 12\nNagpur 440013\nArun Vijay Sharma\nDOB: 01/02/1990')).toMatchObject({name:'Arun Vijay Sharma',relationName:'Vijay Sharma',address:expect.stringContaining('S/O: Vijay Sharma')});
 });
 it('does not use an address relationship as the holder name when immediately above DOB',()=>{
  expect(aadhaarDetails('To\nArun Vijay Sharma\nS/O: Vijay Sharma\nDOB: 01/02/1990').name).toBe('Arun Vijay Sharma');
 });
 it('does not guess a father name from the holder name on a front-only card',()=>{
  expect(aadhaarDetails('Mayuri Sanjay Umate\nDOB: 07/04/1998\nFEMALE')).toMatchObject({name:'Mayuri Sanjay Umate',relationName:''});
 });
});
