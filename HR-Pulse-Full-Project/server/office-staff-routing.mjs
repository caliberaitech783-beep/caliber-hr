/* Office staff joining route (HO Chandrapur and Regional Office Nagpur), set by the owner on 20 Nov 2026:
   office HR initiates → that office's HR Manager → Directors (any one, final) → employee becomes Active.
   - Nagpur office (CMLL-CO): Nagpur HR initiates, the Nagpur HR Manager approves.
   - Chandrapur HO (CMLL-HO): Chandrapur HR initiates, the Chandrapur HR Manager approves.
   Who is office HR and who is HR Manager comes from Approval Master › Hierarchy for that office
   ("HR Executive" = the office HR who may initiate, "HR Manager" = the approver). The Directors are fixed,
   the same three as for site staff. Every step is sent on the Nagpur Employee Addition bot with
   Approve / Reject buttons (employee-addition-bot.mjs). */
export const OFFICE_SITES={
 'CMLL-CO':{office:'Nagpur Office',defaultHrManager:['vinodpinjarkar']},
 'CMLL-HO':{office:'Chandrapur HO',defaultHrManager:[]},
};
export const OFFICE_DIRECTORS=['mohitchadda','manishchadda','rahulchadda'];
export const officeHrManagerLabel=office=>`HR Manager — ${office}`;
export const OFFICE_DIRECTORS_LABEL='Final approval — any one';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const users=list=>[...new Set((list||[]).map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
const approversOf=(data,label)=>users(data?.steps?.find(s=>s.label===label)?.approvers);
export const isOfficeSite=code=>Object.hasOwn(OFFICE_SITES,code||'');
/* The route for one office. data is the saved hierarchy (or null); requester is the Pulse username submitting. */
export function officeStaffSteps(code,data,requester){
 const site=OFFICE_SITES[code];if(!site)return null;
 const actor=String(requester||'').trim().toLowerCase();
 const officeHr=approversOf(data,'HR Executive');
 const managers=approversOf(data,'HR Manager');
 const hrManager=managers.length?managers:site.defaultHrManager;
 if(!hrManager.length)fail(`Assign the ${site.office} HR Manager in Approval Master › Hierarchy before submitting`);
 if(officeHr.length&&!officeHr.includes(actor)&&!hrManager.includes(actor))fail(`Office staff joining forms for ${site.office} are initiated by ${site.office} HR (${officeHr.join(', ')}).`,403);
 const directors=users([...OFFICE_DIRECTORS,...approversOf(data,OFFICE_DIRECTORS_LABEL)]);
 const steps=[
  {stage:1,label:officeHrManagerLabel(site.office),approvers:hrManager.filter(a=>a!==actor)},
  {stage:2,label:OFFICE_DIRECTORS_LABEL,approvers:directors.filter(a=>a!==actor)},
 ];
 /* When the HR Manager initiates, their step is the initiation: the form goes straight to the Directors. */
 return steps.filter(step=>step.approvers.length);
}
/* Office route for the site of an employee, or null for any other site. */
export async function officeStaffHierarchy(db,siteId,requester){
 if(!siteId)return null;
 const code=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='sites'",[String(siteId)])).rows[0]?.code;
 if(!isOfficeSite(code))return null;
 const row=(await db.query("SELECT * FROM hr_records WHERE kind='joiningHierarchies' AND code=$1",[code])).rows[0];
 return {id:row?.id||null,code,data:{code,steps:officeStaffSteps(code,row?.data,requester)}};
}
