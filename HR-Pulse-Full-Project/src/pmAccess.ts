import type {Profile} from './api';

/* Owner, 21 Nov 2026: a PM (Project Manager) login sees only approval menus in HRMS, never employee creation,
   Leave / OD / Gatepass forms, transfers to raise, masters or reports, whatever menus Pulse assigned. */
export const PM_APPROVALS_PAGE='Approval Management';
export const pmApprovalMenus=['Trial Approvals','Employee Verify','Transfer Approvals','All Approvals'] as const;
export type PmApprovalMenu=typeof pmApprovalMenus[number];

type Assignment={role?:unknown};
export function isProjectManager(profile:Profile){
 const role=String(profile.assignedRole||'').toLowerCase().replace(/[^a-z]+/g,' ').trim();
 if(/\bproject manager\b|\bpm\b/.test(role))return true;
 const assignments=(profile.permissions as {hrTrialAssignments?:unknown}).hrTrialAssignments;
 return Array.isArray(assignments)&&assignments.length>0&&(assignments as Assignment[]).every(a=>String(a?.role||'').trim().toUpperCase()==='PM');
}
