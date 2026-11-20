import {hierarchyTemplates,currentHierarchy,withDriverTrainer,withOfficeHr} from './joining-hierarchy.mjs';
import {assignedSites} from './scope.mjs';
import {withTrialRouting} from './trial-routing.mjs';
import {grantedMenus} from './modules.mjs';
const norm=value=>String(value||'').trim().toLowerCase();
const pulseRoles={'HR Manager':'hr','Driver Trainer':'trainer','PM':'pm','Office HR':'ohr','Regional HR':'rhr','Director':'director'};
const aliases={
 'NCL-DUDE':['Dudichua OB East','Dhudhichua OB East','Dudhichua East OC'],'NCL-DUDW':['Dudichua OB West','Dhudhichua OB West','Dudhichua OC'],
 'NCL-JAYANT':['Jayant OC'],'WCL-SASTI':['Sasti OC'],'WCL-MAJRI':['Majri OC'],
 'WCL-DHOPTALA':['Dhoptala OB 2nd','Dhoptala OC (2nd)'],'WCL-GAURI':['Gauri Pauni OB 2nd','Gauri Pauni OC (2nd)'],'WCL-LALPETH':['Lalpeth OB','Lalpeth OC'],
 'CMLL-CO':['Nagpur CO','Nagpur Corporate Office'],'CMLL-HO':['Chandrapur Head Office'],
};
export const trialRoleLabels={hr:'HR Manager',trainer:'Driver Trainer',pm:'Project Manager',ohr:'Office HR — either one',rhr:'HR Manager — either one',director:'Final approval — any one'};
export function trialSite(site){return hierarchyTemplates.find(t=>[t.code,t.name,...(aliases[t.code]||[])].some(value=>norm(value)===norm(site)));}
export function assignedTrialSites(profile){
 const assignments=profile.permissions?.hrTrialAssignments;
 if(!Array.isArray(assignments))return undefined;
 if(profile.permissions?.hrAccountStatus&&profile.permissions.hrAccountStatus!=='Active')return [];
 if(assignments.some(assignment=>assignment?.allSites===true))return null;
 const codes=new Set(assignments.flatMap(assignment=>Array.isArray(assignment?.sites)?assignment.sites:[]).map(site=>trialSite(site?.code)||trialSite(site?.name)).filter(Boolean).map(site=>site.code));
 return hierarchyTemplates.filter(site=>codes.has(site.code));
}
export async function trialAccess(db,profile,target){
 const assignments=profile.permissions?.hrTrialAssignments;
 const template=trialSite(target?.site);
 if(Array.isArray(assignments)){
  if(profile.permissions?.hrAccountStatus&&profile.permissions.hrAccountStatus!=='Active'||!template)return {roles:[],overview:false};
  const siteKeys=[template.code,template.name,...(aliases[template.code]||[])].map(norm);
  const scoped=assignments.filter(assignment=>assignment?.allSites===true||Array.isArray(assignment?.sites)&&assignment.sites.some(site=>[site?.code,site?.name].some(value=>siteKeys.includes(norm(value)))));
  return {roles:[...new Set(scoped.map(assignment=>pulseRoles[assignment?.role]).filter(Boolean))],overview:scoped.some(assignment=>assignment?.role==='Trial Admin')};
 }
 const scope=assignedSites(profile),overview=scope===null&&(grantedMenus(profile).has('Master Configuration')||/\badmin(?:istrator)?\b|super/i.test(String(profile.permissions?.adminLevel||profile.assignedRole||'')));
 if(!template)return {roles:[],overview};
 if(scope!==null){
  const keys=[template.code,template.name,...(aliases[template.code]||[])].map(norm);
  if(!scope.some(value=>keys.includes(value))){
   const site=(await db.query("SELECT id::text FROM hr_records WHERE kind='sites' AND code=$1 AND status='ACTIVE'",[template.code])).rows[0];
   if(!site||!scope.includes(site.id))return {roles:[],overview:false};
  }
 }
 const rows=(await db.query("SELECT code,data FROM hr_records WHERE kind='joiningHierarchies' AND status='ACTIVE'")).rows;
 const saved=rows.find(row=>row.code===template.code);
 const data=withTrialRouting(withOfficeHr(withDriverTrainer(currentHierarchy(saved?.data))));
 const actor=norm(profile.actor);
 const roles=actor?Object.entries(trialRoleLabels).filter(([,label])=>data?.steps?.some(step=>step.label===label&&step.approvers?.some(user=>norm(user)===actor))).map(([role])=>role):[];
 return {roles,overview};
}
export async function requireTrialRole(db,profile,role,target){
 const access=await trialAccess(db,profile,target);
 if(!access.roles.includes(role))throw Object.assign(new Error('Only the assigned '+(trialRoleLabels[role]||role)+' for this site may submit or approve.'),{status:403});
 return access;
}
export const trialStageOf=data=>data?.stage==='PART1'?'trainer':data?.pendingRole||'';
export const canReadTrial=(access,data)=>access.overview||access.roles.includes('hr')||access.roles.includes(trialStageOf(data))||access.roles.includes('director')&&data?.stage==='CLEARED';
