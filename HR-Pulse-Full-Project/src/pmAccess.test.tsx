import {fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';
import {isProjectManager} from './pmAccess';

afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const menus=['Dashboard','Employee Master','Attendance Management','Payroll Management','Asset Management','Calendar','Master Configuration','Approval Master','Recruitment Management','Approval Management'];
const pm={name:'Chitranjan',actor:'chitranjan',assignedRole:'PM',permissions:{application:'HR',adminLevel:'Site',site:'WCL-MAJRI',hrDesktopAccess:menus}};

it('recognises PM logins by role or by PM-only trial assignments, and nobody else',()=>{
 expect(isProjectManager(pm)).toBe(true);
 expect(isProjectManager({...pm,assignedRole:'Project Manager'})).toBe(true);
 expect(isProjectManager({...pm,assignedRole:'Site PM'})).toBe(true);
 expect(isProjectManager({...pm,assignedRole:'',permissions:{...pm.permissions,hrTrialAssignments:[{role:'PM',sites:[{code:'WCL-MAJRI'}]}]}} as never)).toBe(true);
 expect(isProjectManager({...pm,assignedRole:'HR Manager'})).toBe(false);
 expect(isProjectManager({...pm,assignedRole:'Director'})).toBe(false);
 expect(isProjectManager({...pm,assignedRole:'',permissions:{...pm.permissions,hrTrialAssignments:[{role:'PM'},{role:'Office HR'}]}} as never)).toBe(false);
 expect(isProjectManager({...pm,assignedRole:''})).toBe(false);
});

it('shows a PM only the approval menus, even with Employee Master assigned and a saved Employee Management link',async()=>{
 window.location.hash='Employee%20Master';
 localStorage.setItem('hrPulse.employeeMenu','Employee Management');
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile:pm}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile:pm,modules:{}}:url.includes('trial-scope')?{admin:false,sites:[{region:'WCL',site:'Majri OB'}]}:url.includes('approvals')?[]:{roles:['pm']}));
 render(<App/>);
 const nav=await screen.findByRole('navigation',{},{timeout:5000});
 const top=within(nav).getAllByRole('button').filter(b=>b.getAttribute('title')).map(b=>b.getAttribute('title'));
 expect(top).toEqual(['Approval Management']);
 expect(within(nav).getAllByRole('button').filter(b=>!b.getAttribute('title')).map(b=>b.textContent)).toEqual(['Trial Approvals','Employee Verify','Transfer Approvals','All Approvals']);
 for(const hidden of ['Employee Master','Dashboard','Payroll Management','Approval Master','Employee Management','Leave / OD / Gatepass'])expect(within(nav).queryByRole('button',{name:hidden})).toBeNull();
 expect(screen.queryByText('Add Temp. Employee')).toBeNull();
 fireEvent.click(within(nav).getByRole('button',{name:'Employee Verify'}));
 expect(await screen.findByRole('heading',{name:'Employee Verify'})).toBeTruthy();
 expect(screen.queryByText('Add Temp. Employee')).toBeNull();
});

it('keeps the full menu for non-PM HR users',async()=>{
 const hr={...pm,name:'Office HR',actor:'ohr',assignedRole:'Office HR'};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile:hr}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile:hr,modules:{}}:{counts:[],sites:[]}));
 render(<App/>);
 const nav=await screen.findByRole('navigation',{},{timeout:5000});
 expect(within(nav).getByRole('button',{name:'Employee Master'})).toBeTruthy();
});
