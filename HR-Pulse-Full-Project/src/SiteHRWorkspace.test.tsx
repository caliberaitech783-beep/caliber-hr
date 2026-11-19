import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';
import {isSiteHRManager} from './SiteHRWorkspace';

afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const profile={name:'Site manager',actor:'site.hr',assignedRole:'HR Manager',permissions:{application:'HR',adminLevel:'Site',site:'NCL-JAYANT',hrDesktopAccess:['Dashboard','Employee Master','Master Configuration']}};
it('limits site HR managers while preserving unrestricted and other roles',()=>{
 expect(isSiteHRManager(profile)).toBe(true);
 expect(isSiteHRManager({...profile,assignedRole:'Site-wise HR Manager'})).toBe(true);
 expect(isSiteHRManager({...profile,permissions:{...profile.permissions,site:'*'}})).toBe(false);
 expect(isSiteHRManager({...profile,assignedRole:'Driver Trainer'})).toBe(false);
 expect(isSiteHRManager({...profile,permissions:{...profile.permissions,site:''}})).toBe(true);
});
it('opens only the trial screen despite a saved menu and direct master link',async()=>{
 window.location.hash='Master%20Configuration';
 localStorage.setItem('hrPulse.employeeMenu','Attendance Management');
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')?{profile,modules:{}}:url.includes('trial-scope')?{admin:false,sites:[{region:'NCL',site:'Jayant OB East'}]}:{roles:['hr'],name:'Trainer'}));
 const {container}=render(<App/>);
 await screen.findByRole('button',{name:'Upload A/D'},{timeout:5000});
 expect(screen.queryByRole('navigation')).toBeNull();
 expect(screen.queryByRole('button',{name:'Dashboard'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Attendance Management'})).toBeNull();
 expect(screen.getByLabelText('Trial site')).toHaveValue('Jayant OB East');
 expect(container.querySelector('[aria-label="Trial workflow local preview"]')).not.toBeNull();
});
