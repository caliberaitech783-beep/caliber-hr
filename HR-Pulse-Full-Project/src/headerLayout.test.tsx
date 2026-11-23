import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';

/* Owner, 23 Nov 2026: with the side menu open, Sign out sat on top of the clock and date in the top bar.
   The bar now measures its own width and gives way in a set order (styles.css, "Top bar"), so nothing overlaps
   with the menu open, closed or on auto-hide. Only a browser can measure the layout itself; this check keeps the
   row the stylesheet depends on: without `header-row` the bar cannot restyle itself from its own width. */
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();window.location.hash='';});
const menus=['Dashboard','Employee Master','Attendance Management'];
const profile={name:'Majri HR',actor:'majrihr',assignedRole:'HR Executive',permissions:{application:'HR',adminLevel:'Site',site:'WCL-MAJRI',hrDesktopAccess:menus}};

it('keeps the top bar in one measured row: page name and Sign out, clock, then the buttons',async()=>{
 window.location.hash='Attendance%20Management';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')||url.endsWith('validate')?{profile,modules:{}}:url.includes('approvals')||url.includes('trial-scope')?[]:{roles:[]}));
 render(<App/>);
 await screen.findByRole('navigation',{},{timeout:5000});
 const row=document.querySelector('.workspace-header>.header-row');
 expect(row).toBeTruthy();
 expect([...row!.children].map(child=>child.className)).toEqual(['header-left','header-clock','header-utilities']);
 const left=row!.querySelector('.header-left')!;
 expect([...left.children].map(child=>child.className)).toEqual(['header-menu','header-back','header-breadcrumbs','header-signout']);
 // Icon-only states still say what the button does, and a shortened page name shows in full on hover.
 expect(left.querySelector('.header-signout')!.getAttribute('title')).toBe('Sign out');
 expect(left.querySelector('.header-menu')!.getAttribute('title')).toMatch(/^(Hide|Show) menu$/);
 const name=left.querySelector('.header-breadcrumbs strong')!;
 expect(name.textContent).toBeTruthy();
 expect(name.getAttribute('title')).toBe(name.textContent);
});
