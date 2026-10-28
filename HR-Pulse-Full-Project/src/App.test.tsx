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
 expect(screen.getByRole('heading',{name:'Asset Management',level:2})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Calendar'}));
 expect(screen.getByRole('heading',{name:'Calendar',level:2})).toBeTruthy();
 window.location.hash='';
});
