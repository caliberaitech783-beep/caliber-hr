import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import BiometricExceptionMaster from './BiometricExceptionMaster';

afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('finds an employee in Employee Master, adds them to the exception list and takes them off again',async()=>{
  let entries:Record<string,unknown>[] = [];
  const posts:{url:string;body:Record<string,unknown>}[] = [];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if (options?.method==='POST') {
      const body = JSON.parse(String(options.body));
      posts.push({url,body});
      if (url.endsWith('/remove')) { entries = []; return Response.json({removed:true,lastDay:'2026-11-27'}); }
      entries = [{id:'40000000-0000-4000-8000-000000000001',employeeId:'CMLL101',name:'STORE KEEPER ONE',site:'Majri OB',department:'STORE',designation:'STORE KEEPER',
        fromDate:body.fromDate,toDate:'',reason:body.reason,addedBy:'hr-admin',addedAt:'2026-11-28T10:00:00Z',removedBy:'',removedAt:null,removeReason:''}];
      return Response.json({added:true,id:entries[0].id,employeeId:'CMLL101',name:'STORE KEEPER ONE',fromDate:body.fromDate});
    }
    if (url.includes('find=')) return Response.json({employees:[
      {employeeId:'CMLL101',name:'STORE KEEPER ONE',site:'Majri OB',department:'STORE',designation:'STORE KEEPER',status:'ACTIVE',onList:false,driver:false},
      {employeeId:'CMLL102',name:'DRIVER ONE',site:'Majri OB',department:'',designation:'TIPPER DRIVER',status:'',onList:false,driver:true}]});
    return Response.json({entries,today:'2026-11-28',canEdit:true});
  }));
  render(<BiometricExceptionMaster grant={'a'.repeat(43)}/>);
  expect(await screen.findByText('No employee is on the exception list. Everyone follows the biometric process.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Employee ID or name'),{target:{value:'one'}});
  fireEvent.click(screen.getByRole('button',{name:/Find in Employee Master/}));
  const found = await screen.findByRole('list',{name:'Employees found'});
  // A driver is shown and cannot be chosen: attendance comes from the trip card.
  expect(found).toHaveTextContent('CMLL102 DRIVER ONE');
  expect(found).toHaveTextContent('Driver: attendance from trip card');
  expect(within(found).queryByRole('button',{name:/DRIVER ONE/})).toBeNull();
  fireEvent.click(within(found).getByRole('button',{name:'Select STORE KEEPER ONE (CMLL101)'}));
  expect(screen.getByLabelText('Exempt from')).toHaveValue('2026-11-28');
  fireEvent.change(screen.getByLabelText('Exempt from'),{target:{value:'2026-11-24'}});
  fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Works from the stores office'}});
  fireEvent.click(screen.getByRole('button',{name:/Add to exception list/}));
  expect(await screen.findByText(/STORE KEEPER ONE \(CMLL101\) is exempt from biometric punching from 24-11-2026\. Attendance will be marked present by the system\./)).toBeInTheDocument();
  expect(posts[0]).toEqual({url:expect.stringMatching(/\/api\/biometric-exceptions$/),body:{employeeId:'CMLL101',fromDate:'2026-11-24',reason:'Works from the stores office'}});
  const table = within(screen.getByRole('region',{name:'Biometric exception list'}));
  expect(await table.findByText('CMLL101')).toBeInTheDocument();
  expect(table.getByText('On the list')).toBeInTheDocument();
  expect(screen.getByText('1 employee on the list')).toBeInTheDocument();
  // Removing asks why first.
  fireEvent.click(table.getByRole('button',{name:'Remove STORE KEEPER ONE from the exception list'}));
  const confirm = screen.getByRole('button',{name:'Confirm removal'});
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('Reason for removing'),{target:{value:'Back on site duty'}});
  fireEvent.click(confirm);
  await waitFor(()=>expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual({url:expect.stringMatching(/\/api\/biometric-exceptions\/40000000-0000-4000-8000-000000000001\/remove$/),body:{reason:'Back on site duty'}});
  expect(await screen.findByText(/is off the exception list\. Exempt up to 27-11-2026; from today biometric punching applies again\./)).toBeInTheDocument();
});
