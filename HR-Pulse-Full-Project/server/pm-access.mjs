/* Owner, 21 Nov 2026: a PM (Project Manager) login only approves in HRMS. It may not create, import, edit,
   submit or delete employees, whatever menus Pulse assigned; its approvals need only Approval Management.
   Same rule as isProjectManager in src/pmAccess.ts. */
export const PM_EMPLOYEE_WRITE_ERROR='A PM login can only approve employees. Site HR adds and edits employees.';
export function isProjectManager(profile){
 const role=String(profile?.assignedRole||'').toLowerCase().replace(/[^a-z]+/g,' ').trim();
 if(/\bproject manager\b|\bpm\b/.test(role))return true;
 const assignments=profile?.permissions?.hrTrialAssignments;
 return Array.isArray(assignments)&&assignments.length>0&&assignments.every(a=>String(a?.role||'').trim().toUpperCase()==='PM');
}
