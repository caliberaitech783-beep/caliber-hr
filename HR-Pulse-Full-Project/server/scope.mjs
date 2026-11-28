import {complianceKinds} from './modules.mjs';
const complianceSql = complianceKinds.map(kind => `'${kind}'`).join(',');

import {managementModules} from './management-modules.mjs';
const managementKindsSql = Object.keys(managementModules).map(kind => "'" + kind + "'").join(',');
// Pulse is the authority for a user's location scope. Unknown scopes fail closed.
// A Pulse Super Admin at Admin / Super Admin level has every site: the location on their Pulse record is where they sit,
// not a limit. Site / Location admin levels stay limited to their sites.
export function isAllSiteAdmin(profile){
 return profile?.role==='super'&&['admin','super admin'].includes(String(profile.permissions?.adminLevel||'').trim().toLowerCase());
}
export function assignedSites(profile){
 if(isAllSiteAdmin(profile))return null;
 const value=profile.permissions?.site;
 if(value==null||value===''){
  if(/site|location/i.test(String(profile.permissions?.adminLevel||'')))return [];
  return null;
 }
 const values=Array.isArray(value)?value:[value];
 if(values.some(x=>typeof x!=='string'))throw Object.assign(new Error('Unsupported Pulse site assignment. Contact your Pulse administrator.'),{status:403});
 const normalized=values.flatMap(x=>x.split('|')).map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(normalized.some(x=>['*','all','all sites','all locations'].includes(x)))return null;
 return normalized;
}
/** The 403 text when a site is outside the login: names the sites the login does have, so the Pulse record can be fixed. */
export function siteAccessMessage(profile){
 let scope;try{scope=assignedSites(profile);}catch{scope=[];}
 return `This site is not assigned to your login. ${profile?.login||'This login'} has: ${scope===null?'all sites':scope.length?scope.join(', '):'no site'} (Pulse › Users & employees › Site).`;
}
export async function siteIds(db,profile){
 const scope=assignedSites(profile);if(scope===null)return null;
 return (await db.query("SELECT id FROM hr_records WHERE kind='sites' AND (lower(code)=ANY($1) OR lower(name)=ANY($1) OR id::text=ANY($1))",[scope])).rows.map(x=>x.id);
}
export function scopeSql(alias,parameter,actorParameter){
 const own=actorParameter?` OR ((${alias}.status='DRAFT' OR (${alias}.kind='leaveAllocations' AND ${alias}.status='ACTIVE')) AND ${alias}.data->>'__importDraft'='true' AND ${alias}.created_by=${actorParameter})`:'';
 return `(${parameter}::text[] IS NULL${own} OR ${alias}.kind NOT IN (${managementKindsSql},${complianceSql},'calendarEvents','assets','holidayDocuments','employees','leaveRequests','leaveAllocations','leaveEncashments','employeeTransfers','outDutyRequests','gatePasses','assetEmployees','assetAllocationLog','assetExitClearances','sites','shifts','holidays','leaveBlocks','vtcRequests') OR (${alias}.kind='sites' AND ${alias}.id::text=ANY(${parameter})) OR (${alias}.kind IN (${managementKindsSql},${complianceSql},'calendarEvents','assets','employees','shifts','holidays','leaveBlocks','vtcRequests') AND ${alias}.data->>'siteId'=ANY(${parameter})) OR (${alias}.kind='holidays' AND EXISTS(SELECT 1 FROM hr_records holiday_site WHERE holiday_site.kind='sites' AND holiday_site.id::text=ANY(${parameter}) AND (${alias}.data->>'siteId'=holiday_site.code OR ${alias}.data->>'siteId'=holiday_site.name))) OR (${alias}.kind IN ('holidays','leaveBlocks') AND COALESCE(${alias}.data->>'siteId','')='') OR (${alias}.kind IN ('leaveRequests','leaveAllocations','leaveEncashments','employeeTransfers','outDutyRequests','gatePasses','assetEmployees','assetAllocationLog','assetExitClearances') AND EXISTS(SELECT 1 FROM hr_records scoped_employee WHERE scoped_employee.id::text=${alias}.data->>'employeeId' AND scoped_employee.data->>'siteId'=ANY(${parameter}))) OR (${alias}.kind='employeeTransfers' AND COALESCE(${alias}.data->>'employeeId','')='' AND ${alias}.data->>'fromSiteId'=ANY(${parameter})))`;
}
