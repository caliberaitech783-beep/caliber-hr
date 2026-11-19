import {hierarchyTemplates,currentHierarchy,withDriverTrainer,withOfficeHr} from './joining-hierarchy.mjs';
import {assignedSites} from './scope.mjs';
import {grantedMenus} from './modules.mjs';
const norm=value=>String(value||'').trim().toLowerCase();
const aliases={
 'NCL-DUDE':['Dudichua OB East','Dhudhichua OB East'],'NCL-DUDW':['Dudichua OB West','Dhudhichua OB West'],
 'WCL-DHOPTALA':['Dhoptala OB 2nd'],'WCL-GAURI':['Gauri Pauni OB 2nd'],'WCL-LALPETH':['Lalpeth OB'],
 'CMLL-CO':['Nagpur CO','Nagpur Corporate Office'],'CMLL-HO':['Chandrapur Head Office'],
};
export const trialRoleLabels={hr:'HR Manager',trainer:'Driver Trainer',pm:'Project Manager',ohr:'Office HR — either one',rhr:'HR Manager — either one',director:'Final approval — any one'};
export function trialSite(site){return hierarchyTemplates.find(t=>[t.code,t.name,...(aliases[t.code]||[])].some(value=>norm(value)===norm(site)));}
export async function trialAccess(db,profile,target){
 const scope=assignedSites(profile),overview=scope===null&&(grantedMenus(profile).has('Master Configuration')||/\badmin(?:istrator)?\b|super/i.test(String(profile.permissions?.adminLevel||profile.assignedRole||''))),template=trialSite(target?.site);
 if(!template)return {roles:[],overview:false};
 if(scope!==null){
  const keys=[template.code,template.name,...(aliases[template.code]||[])].map(norm);
  if(!scope.some(value=>keys.includes(value))){
   const site=(await db.query("SELECT id::text FROM hr_records WHERE kind='sites' AND code=$1 AND status='ACTIVE'",[template.code])).rows[0];
   if(!site||!scope.includes(site.id))return {roles:[],overview:false};
  }
 }
 const rows=(await db.query("SELECT code,data FROM hr_records WHERE kind='joiningHierarchies' AND status='ACTIVE'")).rows;
 const saved=rows.find(row=>row.code===template.code);
 const data=withOfficeHr(withDriverTrainer(currentHierarchy(saved?.data)));
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
export const canReadTrial=(access,data)=>access.overview||access.roles.includes('hr')||access.roles.includes(trialStageOf(data));
