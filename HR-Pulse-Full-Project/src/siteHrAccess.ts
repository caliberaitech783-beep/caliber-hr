import type {Profile} from './api';
import {pulseTrialSites,siteOnlyLogin,type SiteRight} from './siteRights';

/* Owner, 22 Nov 2026: every HR who works at a site (Site HR, the site's HR Manager, HR executives at Majri,
   Sasti and the other OB / COAL sites) sees only Employee Master › OB / COAL and Trial Form in HRMS.
   HR at the Head Office, the Nagpur office or a regional office (Office HR, Regional HR) keeps every menu.
   Owner, 22 Nov 2026 (later): site HR also gets Leave / OD / Gatepass and Employee Transfer. */
export const SITE_HR_PAGE='Employee Master';
export const siteHrMenus=['OB / COAL','Trial Form','Leave / OD / Gatepass','Employee Transfer'] as const;
/* The Employee Master screens a site HR may open (OB / COAL opens Employee Management). */
export const siteHrViews:readonly string[]=['Employee Management','Trial Form','Leave / OD / Gatepass','Employee Transfer'];

/* The fixed Regional HR (server/site-staff-routing.mjs) always keeps every menu, whatever their site rights. */
const REGIONAL_HR_LOGINS=['vinodpinjarkar','viratsingh','cmpl3399','cmpl18114','3399','18114'];
const OFFICE_ROLES=['Office HR','Regional HR','Director','Trial Admin'];
const key=(value:unknown)=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');

export function isSiteHRManager(profile:Profile){
 const role=String(profile.assignedRole||'').toLowerCase().replace(/[^a-z]+/g,' ').trim();
 return /\bhr\b/.test(role)&&/\bmanager\b/.test(role)&&pulseTrialSites(profile.permissions.site,profile.permissions.adminLevel)!==null;
}

export function officeOrRegionalHr(profile:Profile){
 const logins=[profile.actor,profile.username,profile.email?.split('@')[0],(profile as {employeeId?:unknown}).employeeId].map(key);
 if(logins.some(login=>login&&REGIONAL_HR_LOGINS.includes(login)))return true;
 if(/\b(regional|office|corporate|head\s*office|ho)\b/i.test(String(profile.assignedRole||'')))return true;
 const assignments=(profile.permissions as {hrTrialAssignments?:unknown}).hrTrialAssignments;
 return Array.isArray(assignments)&&assignments.some(a=>(a as {allSites?:unknown})?.allSites===true||OFFICE_ROLES.includes(String((a as {role?:unknown})?.role||'').trim()));
}

/* A site HR login: its site rights cover only OB / COAL sites (or it is a site HR Manager), and it is not office or regional HR. */
export function siteHrOnly(profile:Profile,resolved?:SiteRight[]|null){
 const p=profile.permissions;
 if(officeOrRegionalHr(profile))return false;
 if(siteOnlyLogin(p.site,p.adminLevel,resolved))return true;
 const sites=(Array.isArray(p.site)?p.site:[p.site]).join('|');
 return resolved!==null&&isSiteHRManager(profile)&&!/\b(head|corporate)\s*office\b|\bHO\b|\bCO\b|nagpur\s*office/i.test(sites);
}
