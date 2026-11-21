/* A user's Pulse site rights, shared by the trial form and the employee joining form.
   null means every site (admin or "All sites"); an empty list means none. */
export const trialSitesByRegion:Record<string,string[]>={WCL:['Sasti OB','Dhoptala OB','Majri OB','Gauri Pauni OB','Hindustan Lalpeth OC'],NCL:['Jayant OB East','Jayant OB West','Dudhichua OB East','Dudhichua OB West']};
const trialSiteCodes:Record<string,string>={'Sasti OB':'WCL-SASTI','Dhoptala OB':'WCL-DHOPTALA','Majri OB':'WCL-MAJRI','Gauri Pauni OB':'WCL-GAURI','Hindustan Lalpeth OC':'WCL-LALPETH','Jayant OB East':'NCL-JAYANT','Jayant OB West':'NCL-JAYANT-W','Dudhichua OB East':'NCL-DUDE','Dudhichua OB West':'NCL-DUDW'};
const scopeKey=(value:unknown)=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
export type SiteRight={region:string;site:string};
export function pulseTrialSites(siteScope:unknown,adminLevel:unknown):SiteRight[]|null{
 const values=(Array.isArray(siteScope)?siteScope:[siteScope]).flatMap(value=>typeof value==='string'?value.split('|'):[]).map(value=>value.trim()).filter(Boolean);
 if(!values.length)return /site|location/i.test(String(adminLevel||''))?[]:null;
 if(values.some(value=>value==='*'||['all','allsites','alllocations'].includes(scopeKey(value))))return null;
 const assigned=new Set(values.map(scopeKey));
 return Object.entries(trialSitesByRegion).flatMap(([region,sites])=>sites.filter(site=>{
  const keys=[site,trialSiteCodes[site],site.replace(/\s+(OB|OC)(\s+(East|West))?$/i,'')].map(scopeKey);
  return keys.some(key=>assigned.has(key));
 }).map(site=>({region,site})));
}
