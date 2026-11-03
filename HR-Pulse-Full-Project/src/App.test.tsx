import {fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import App from './App';
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});
it('hides Administration even when assigned in the Pulse session',async()=>{
 const profile={name:'Test user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Dashboard','Administration']}};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('validate')?{profile}:url.endsWith('config')?{profile,modules:{}}:{counts:[],sites:[]})));
 render(<App/>);await screen.findByRole('heading',{name:'Dashboard'},{timeout:3000});expect(screen.queryByRole('button',{name:'Administration'})).toBeNull();
});
describe('HR Pulse',()=>{it('shows login',()=>{render(<App/>);expect(screen.getByText('Sign in to your workspace')).not.toBeNull()});it('toggles password visibility',()=>{render(<App/>);const password=screen.getByLabelText('Password');expect(password.getAttribute('type')).toBe('password');fireEvent.click(screen.getByRole('button',{name:'Toggle password'}));expect(password.getAttribute('type')).toBe('text')})});

it('shows employee and payroll submenus inside the sidebar',async()=>{
 const profile={name:'HR user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};
 window.location.hash='Employee%20Master';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({profile,modules:{}})));
 render(<App/>);
 await screen.findByRole('button',{name:'Attendance Management'});
 const sidebar=screen.getByRole('complementary');
 expect(within(sidebar).getByRole('button',{name:'Leave/OD Management'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Attendance Management'}));
 expect(screen.getByRole('heading',{name:'Attendance Management'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Employee Management'}));
 expect(screen.getByRole('button',{name:'Employee Management'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Payroll Management'}));
 await screen.findByRole('button',{name:'Salary Schema'});
 expect(within(sidebar).getByRole('button',{name:'Salary Schema'})).toBeTruthy();
 for(const name of ['Salary Schema','Payroll Processing','Loan and Advances','Expense Claims']){
  fireEvent.click(screen.getByRole('button',{name}));
  expect(screen.getByRole('heading',{name})).toBeTruthy();
 }
 fireEvent.click(screen.getByRole('button',{name:'Asset Management'}));
 expect(screen.getByRole('heading',{name:'Asset Management',level:1})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Calendar'}));
 expect(screen.getByRole('heading',{name:'HR Calendar',level:2})).toBeTruthy();
 window.location.hash='';
});

 it('opens the existing hierarchy setup screens from Approval Master',async()=>{
  const profile={name:'HR administrator',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Master Configuration']}};
  window.location.hash='Approval%20Master';
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
  const fetchMock=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('validate')?{profile}:url.endsWith('config')?{profile,modules:{}}:url.endsWith('telegram/account')?{configured:false,connected:false}:url.endsWith('telegram/hierarchies')?{sites:[],accounts:[],employees:[],deliveries:[]}:url.endsWith('hierarchies')?{rows:[],canWrite:true}:{})));
  vi.stubGlobal('fetch',fetchMock);
  render(<App/>);
  expect(await screen.findByRole('button',{name:'Approval Master'})).toBeTruthy();
  await screen.findByRole('heading',{name:'Joining Approval Hierarchy'});
  fireEvent.click(screen.getByRole('button',{name:'Leave'}));
  await screen.findByRole('heading',{name:'Leave Approval Hierarchy'});
  expect(await screen.findByRole('button',{name:'Save hierarchy'})).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url])=>url.endsWith('telegram/hierarchies'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'OD'}));
  expect(screen.getByRole('heading',{name:'OD Approval Hierarchy'})).toBeTruthy();
  expect(screen.getByText(/HOD \(APURVAKOPULWAR\).*Regional HR \(MAYURIUMATE\)/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Hierarchy'}));
  await screen.findByRole('heading',{name:'Joining Approval Hierarchy'});
  window.location.hash='';
 });
