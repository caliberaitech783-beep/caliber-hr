import {menus} from './modules.mjs';
import {isProjectManager} from './pm-access.mjs';

/* Owner, 22 Nov 2026 (latest): while the HRMS is still being built, every HR login (site HR, office HR,
   regional HR) gets every HRMS menu and sub menu, whatever menus Pulse assigned. Site rights still limit
   which sites' records they see. PM logins keep their approvals-only menu, and employees who only raise
   their own leave / OD / gate pass (leave-only logins) keep that one form. */
const LEAVE_MENU='Leave / OD / Gatepass';
const HR_TRIAL_ROLES=['Site HR','Office HR','Regional HR','HR Manager','Trial Admin'];

export function isHrStaff(profile){
 const p=profile?.permissions;
 if(!p||p.application!=='HR'||p.leaveOnly===true||isProjectManager(profile))return false;
 const assigned=(Array.isArray(p.hrDesktopAccess)?p.hrDesktopAccess:[]).filter(menu=>menus.includes(menu));
 if(assigned.some(menu=>menu!==LEAVE_MENU))return true;
 if(/\bhr\b/i.test(String(profile.assignedRole||'').replace(/[^a-z]+/gi,' ')))return true;
 return Array.isArray(p.hrTrialAssignments)&&p.hrTrialAssignments.some(a=>HR_TRIAL_ROLES.includes(String(a?.role||'').trim()));
}

export function withAllHrMenus(profile){
 if(!isHrStaff(profile))return profile;
 return {...profile,permissions:{...profile.permissions,hrDesktopAccess:[...menus]}};
}
