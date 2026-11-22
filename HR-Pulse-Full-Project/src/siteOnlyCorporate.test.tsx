import {render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';
import {siteOnlyLogin} from './siteRights';

/* Owner, 22 Nov 2026: site HR logins (Majri, Sasti and other sites) never see Corporate / HO in Employee Master. */
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const menus=['Dashboard','Employee Master'];
const siteHr={name:'Majri HR',actor:'majrihr',assignedRole:'HR Executive',permissions:{application:'HR',adminLevel:'Site',site:'WCL-MAJRI',hrDesktopAccess:menus}};

it('treats only logins limited to OB / COAL sites as site logins',()=>{
 expect(siteOnlyLogin('WCL-MAJRI','Site')).toBe(true);
 expect(siteOnlyLogin('Sasti|Majri','Site')).toBe(true);
 expect(siteOnlyLogin('','Corporate')).toBe(false);
 expect(siteOnlyLogin('*','Site')).toBe(false);
 expect(siteOnlyLogin('Chandrapur HO','Site')).toBe(false);
 expect(siteOnlyLogin('WCL-MAJRI|Head Office','Site')).toBe(false);
 expect(siteOnlyLogin('','Site',[{region:'WCL',site:'Majri OB'}])).toBe(true);
 expect(siteOnlyLogin('WCL-MAJRI','Site',null)).toBe(false);
});

async function sidebar(profile:typeof siteHr,scope:unknown){
 window.location.hash='Employee%20Master';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile,modules:{}}:url.includes('trial-scope')?scope:url.includes('approvals')?[]:{roles:[]}));
 render(<App/>);
 const nav=await screen.findByRole('navigation',{},{timeout:5000});
 await within(nav).findByRole('button',{name:'OB / COAL'},{timeout:5000});
 return nav;
}

it('hides Corporate / HO from a site HR login',async()=>{
 const nav=await sidebar(siteHr,{admin:false,sites:[{region:'WCL',site:'Majri OB'}]});
 expect(within(nav).queryByRole('button',{name:'Corporate / HO'})).toBeNull();
},20000);

it('keeps Corporate / HO for an all-sites login',async()=>{
 const nav=await sidebar({...siteHr,name:'Office HR',permissions:{...siteHr.permissions,adminLevel:'Corporate',site:''}},{admin:true,sites:[]});
 expect(within(nav).getByRole('button',{name:'Corporate / HO'})).toBeTruthy();
},20000);
