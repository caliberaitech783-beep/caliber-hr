import {fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';

/* Owner, 22 Nov 2026 (latest): every HR login (site HR, office HR, regional HR) sees every HRMS menu and sub menu,
   Corporate / HO included. The server gives every HR login every menu (server/hr-staff-access.mjs). Only PM logins keep their approvals-only menu. */
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const menus=['Dashboard','Employee Master','Attendance Management','Payroll Management','Master Configuration','Approval Master','Reports & MIS'];
const employeeMasterMenus=['Corporate / HO','OB / COAL','Trial Form','Employee Management','Leave / OD / Gatepass','Employee Transfer'];
const siteHr={name:'Majri HR',actor:'majrihr',assignedRole:'HR Executive',permissions:{application:'HR',adminLevel:'Site',site:'WCL-MAJRI',hrDesktopAccess:menus}};
const majri=[{region:'WCL',site:'Majri OB'}];

async function sidebar(profile:typeof siteHr,scope:unknown,savedMenu='Leave / OD / Gatepass'){
 window.location.hash='Employee%20Master';
 localStorage.setItem('hrPulse.employeeMenu',savedMenu);
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile,modules:{}}:url.includes('trial-scope')?scope:url.includes('approvals')?[]:{roles:[]}));
 render(<App/>);
 const nav=await screen.findByRole('navigation',{},{timeout:5000});
 await within(nav).findByRole('button',{name:'OB / COAL'},{timeout:5000});
 return nav;
}
async function expectEveryMenu(nav:HTMLElement){
 for(const menu of menus)expect(within(nav).getAllByRole('button',{name:menu}).length).toBeGreaterThan(0);
 fireEvent.click(within(nav).getByRole('button',{name:'OB / COAL'}));
 await within(nav).findByRole('button',{name:'Trial Form'},{timeout:5000});
 for(const menu of employeeMasterMenus)expect(within(nav).getByRole('button',{name:menu})).toBeTruthy();
 expect(within(within(nav).getByLabelText('Employee Master submenus')).getByRole('button',{name:'Employee Master'})).toBeTruthy();
}

it('shows a site HR login every menu and every Employee Master sub menu, Corporate / HO included',async()=>{
 const nav=await sidebar(siteHr,{admin:false,sites:majri});
 await expectEveryMenu(nav);
 fireEvent.click(within(nav).getByRole('button',{name:'Employee Management'}));
 await screen.findByRole('button',{name:'Rejoining Form'},{timeout:5000});
 const tabs=document.querySelector('.employee-tabs') as HTMLElement;
 expect(within(tabs).getAllByRole('button').map(button=>button.textContent)).toEqual(['Add Temp. Employee','Rejoining Form','Update Existing Employee','Employee Verify','Completed Form','Reports']);
},20000);

it('keeps the site HR Manager on a saved menu instead of forcing OB / COAL',async()=>{
 const nav=await sidebar({...siteHr,assignedRole:'HR Manager',permissions:{...siteHr.permissions,site:'NCL-JAYANT'}},{admin:false,sites:[{region:'NCL',site:'Jayant OB East'}]},'Employee Transfer');
 expect(within(nav).getByRole('button',{name:'Employee Transfer'})).toHaveAttribute('aria-pressed','true');
 await expectEveryMenu(nav);
},20000);

it('shows office HR every menu',async()=>{
 await expectEveryMenu(await sidebar({...siteHr,name:'Office HR',permissions:{...siteHr.permissions,adminLevel:'Corporate',site:'Chandrapur HO'}},{admin:true,sites:[]}));
},20000);

it('shows regional HR every menu even with only site rights',async()=>{
 await expectEveryMenu(await sidebar({...siteHr,name:'Virat Singh',actor:'viratsingh',assignedRole:'HR Manager',permissions:{...siteHr.permissions,site:'WCL-SASTI|WCL-MAJRI'}},{admin:false,sites:[{region:'WCL',site:'Sasti OB'},...majri]}));
},20000);
