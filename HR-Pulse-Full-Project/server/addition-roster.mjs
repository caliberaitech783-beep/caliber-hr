/* Everyone on the employee addition routes (owner, 20 Nov 2026), for "Send connect links" in Approval Master:
   - NCL / WCL sites: Office staff steps (Site HR, PM / HOD, Office HR) plus the fixed Regional HR and Directors;
   - Nagpur office / Chandrapur HO: office HR (HR Executive), the office HR Manager and the Directors.
   Site HR and office HR initiate the form; they are on the list too because every step is reported to them. */
import {hierarchyTemplates,currentHierarchy,withOfficeHr,withDriverTrainer,officeStepsOf} from './joining-hierarchy.mjs';
import {withSiteStaffRouting,roleTitle} from './site-staff-routing.mjs';
import {OFFICE_SITES,OFFICE_DIRECTORS} from './office-staff-routing.mjs';
const norm=value=>String(value||'').trim().toLowerCase();
export function additionRoster(savedRows){
 const people=new Map();
 const add=(actor,role,place)=>{const a=norm(actor);if(!/^[-a-z0-9_.@]{1,100}$/.test(a))return;const p=people.get(a)||{actor:a,roles:new Set()};p.roles.add(place?`${role} · ${place}`:role);people.set(a,p);};
 for(const template of hierarchyTemplates){
  const saved=savedRows.find(row=>row.code===template.code);
  if(OFFICE_SITES[template.code]){
   const site=OFFICE_SITES[template.code],steps=saved?.data?.steps||[];
   for(const a of steps.find(s=>s.label==='HR Executive')?.approvers||[])add(a,'Office HR',site.office);
   const managers=steps.find(s=>s.label==='HR Manager')?.approvers||[];
   for(const a of managers.length?managers:site.defaultHrManager)add(a,'HR Manager',site.office);
   continue;
  }
  if(!saved||saved.status!=='ACTIVE')continue;   /* a site whose hierarchy is not enabled takes no joining forms yet */
  const data=withSiteStaffRouting(withOfficeHr(withDriverTrainer(currentHierarchy(saved.data))),officeStepsOf);
  for(const step of data.officeSteps||officeStepsOf(data.steps))for(const a of step.approvers||[])add(a,roleTitle(step.label),template.name);
 }
 for(const a of OFFICE_DIRECTORS)add(a,'Directors (final)');
 return [...people.values()].map(p=>({actor:p.actor,roles:[...p.roles]})).sort((a,b)=>a.actor.localeCompare(b.actor));
}
/* Message sent through a bot the person already uses, carrying their personal link to the Nagpur bot. */
export function connectInviteMessage({roles,url,botUsername}){
 return ['🔗 Connect to Employee Addition approvals','',`Employee addition (joining) approvals now come on @${botUsername} with ✅ Approve / ❌ Reject buttons.`,`Your role: ${roles.join('; ')}`,'','Tap this link and press Start (valid 7 days):',url].join('\n');
}
