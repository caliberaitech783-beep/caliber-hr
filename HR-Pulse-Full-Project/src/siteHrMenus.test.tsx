import {fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';
import {isSiteHRManager,siteHrOnly} from './siteHrAccess';

/* Owner, 22 Nov 2026: site HR sees only Employee Master › OB / COAL (every tab), Trial Form, Leave / OD / Gatepass and Employee Transfer; office and regional HR see every menu. */
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const menus=['Dashboard','Employee Master','Attendance Management','Payroll Management','Master Configuration','Approval Master','Reports & MIS'];
const siteHr={name:'Majri HR',actor:'majrihr',assignedRole:'HR Executive',permissions:{application:'HR',adminLevel:'Site',site:'WCL-MAJRI',hrDesktopAccess:menus}};
const majri=[{region:'WCL',site:'Majri OB'}];

it('tells site HR apart from office and regional HR',()=>{
 expect(siteHrOnly(siteHr,majri)).toBe(true);
 expect(siteHrOnly({...siteHr,assignedRole:'HR Manager',permissions:{...siteHr.permissions,site:''}},[])).toBe(true);
 expect(isSiteHRManager({...siteHr,assignedRole:'Site-wise HR Manager'})).toBe(true);
 expect(siteHrOnly({...siteHr,permissions:{...siteHr.permissions,site:'Chandrapur HO'}},null)).toBe(false);
 expect(siteHrOnly({...siteHr,permissions:{...siteHr.permissions,site:'*'}},null)).toBe(false);
 expect(siteHrOnly({...siteHr,actor:'viratsingh',permissions:{...siteHr.permissions,site:'WCL-SASTI|WCL-MAJRI'}},majri)).toBe(false);
 expect(siteHrOnly({...siteHr,assignedRole:'Regional HR'},majri)).toBe(false);
 expect(siteHrOnly({...siteHr,assignedRole:'Office HR'},majri)).toBe(false);
 expect(siteHrOnly({...siteHr,permissions:{...siteHr.permissions,hrTrialAssignments:[{role:'Office HR',sites:[{code:'WCL-MAJRI'}]}]}} as typeof siteHr,majri)).toBe(false);
});

async function sidebar(profile:typeof siteHr,scope:unknown,savedLeave=true){
 window.location.hash='Employee%20Master';
 if(savedLeave)localStorage.setItem('hrPulse.employeeMenu','Leave / OD / Gatepass');
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile,modules:{}}:url.includes('trial-scope')?scope:url.includes('approvals')?[]:{roles:[]}));
 render(<App/>);
 const nav=await screen.findByRole('navigation',{},{timeout:5000});
 await within(nav).findByRole('button',{name:'OB / COAL'},{timeout:5000});
 return nav;
}
const names=(nav:HTMLElement)=>within(nav).getAllByRole('button').map(button=>button.textContent?.trim());

const siteHrNav=['Employee Master','OB / COAL','Trial Form','Leave / OD / Gatepass','Employee Transfer'];
it('shows a site HR login only OB / COAL, Trial Form, Leave / OD / Gatepass and Employee Transfer',async()=>{
 const nav=await sidebar(siteHr,{admin:false,sites:majri});
 await within(nav).findByRole('button',{name:'Trial Form'},{timeout:5000});
 expect(names(nav)).toEqual(siteHrNav);
 expect(within(nav).getByRole('button',{name:'Leave / OD / Gatepass'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(within(nav).getByRole('button',{name:'Employee Transfer'}));
 expect(within(nav).getByRole('button',{name:'Employee Transfer'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(within(nav).getByRole('button',{name:'OB / COAL'}));
 expect(within(nav).getByRole('button',{name:'OB / COAL'})).toHaveAttribute('aria-pressed','true');
 const tabs=document.querySelector('.employee-tabs') as HTMLElement;
 expect(within(tabs).getAllByRole('button').map(button=>button.textContent)).toEqual(['Add Temp. Employee','Rejoining Form','Update Existing Employee','Employee Verify','Completed Form','Reports']);
},20000);

it('gives the site HR Manager the same menus and never opens a menu site HR does not have',async()=>{
 localStorage.setItem('hrPulse.employeeMenu','Attendance Management');
 const nav=await sidebar({...siteHr,assignedRole:'HR Manager',permissions:{...siteHr.permissions,site:'NCL-JAYANT'}},{admin:false,sites:[{region:'NCL',site:'Jayant OB East'}]},false);
 await within(nav).findByRole('button',{name:'Trial Form'},{timeout:5000});
 expect(names(nav)).toEqual(siteHrNav);
 expect(within(nav).getByRole('button',{name:'OB / COAL'})).toHaveAttribute('aria-pressed','true');
},20000);

it('keeps every menu for office HR and regional HR',async()=>{
 const office=await sidebar({...siteHr,name:'Office HR',assignedRole:'HR Executive',permissions:{...siteHr.permissions,adminLevel:'Corporate',site:'Chandrapur HO'}},{admin:true,sites:[]});
 for(const menu of menus)expect(within(office).getByRole('button',{name:menu})).toBeTruthy();
 expect(within(office).getByRole('button',{name:'Corporate / HO'})).toBeTruthy();
 fireEvent.click(within(office).getByRole('button',{name:'Employee Management'}));
 await screen.findByRole('button',{name:'Rejoining Form'},{timeout:5000});
 const tabs=document.querySelector('.employee-tabs') as HTMLElement;
 expect(within(tabs).getAllByRole('button').map(button=>button.textContent)).toEqual(['Add Temp. Employee','Rejoining Form','Update Existing Employee','Employee Verify','Completed Form','Reports']);
},20000);

it('keeps every menu for the fixed regional HR even with only site rights',async()=>{
 const regional=await sidebar({...siteHr,name:'Virat Singh',actor:'viratsingh',assignedRole:'HR Manager',permissions:{...siteHr.permissions,site:'WCL-SASTI|WCL-MAJRI'}},{admin:false,sites:[{region:'WCL',site:'Sasti OB'},...majri]});
 for(const menu of menus)expect(within(regional).getByRole('button',{name:menu})).toBeTruthy();
 fireEvent.click(within(regional).getByRole('button',{name:'OB / COAL'}));
 await within(regional).findByRole('button',{name:'Trial Form'},{timeout:5000});
 for(const menu of employeeMasterMenus)expect(within(regional).getByRole('button',{name:menu})).toBeTruthy();
},20000);

const employeeMasterMenus=['Corporate / HO','OB / COAL','Trial Form','Employee Management','Leave / OD / Gatepass','Employee Transfer'];
it('shows Corporate / HO and every Employee Master menu to office HR whose site rights list only sites',async()=>{
 const officeHr={...siteHr,name:'Apurva Kopulwar',actor:'apurvakopulwar',assignedRole:'HR Executive',permissions:{...siteHr.permissions,site:'NCL-JAYANT|NCL-DUDE',hrTrialAssignments:[{role:'Office HR',sites:[{code:'NCL-JAYANT'},{code:'NCL-DUDE'}]}]}};
 const nav=await sidebar(officeHr as typeof siteHr,{admin:false,sites:[{region:'NCL',site:'Jayant OB East'},{region:'NCL',site:'Dudhichua OB East'}]});
 fireEvent.click(within(nav).getByRole('button',{name:'OB / COAL'}));
 await within(nav).findByRole('button',{name:'Trial Form'},{timeout:5000});
 for(const menu of employeeMasterMenus)expect(within(nav).getByRole('button',{name:menu})).toBeTruthy();
 for(const menu of menus)expect(within(nav).getByRole('button',{name:menu})).toBeTruthy();
},20000);
