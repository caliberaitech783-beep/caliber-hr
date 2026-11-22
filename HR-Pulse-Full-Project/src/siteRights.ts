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

/* Owner, 22 Nov 2026: a site login (HR at Majri, Sasti and other OB / COAL sites) never sees Corporate / HO in
   Employee Master. A login is a site login when its site rights are limited to OB / COAL sites (not admin, not
   "All sites") and none of its assigned sites is an office (Head Office, Corporate Office, HO, CO). */
const officeScope=(value:string)=>/\b(head|corporate)\s*office\b|\bHO\b|\bCO\b|\bCO-HO\b|nagpur\s*office/i.test(value);
export function siteOnlyLogin(siteScope:unknown,adminLevel:unknown,resolved?:SiteRight[]|null):boolean{
 const values=(Array.isArray(siteScope)?siteScope:[siteScope]).flatMap(value=>typeof value==='string'?value.split('|'):[]).map(value=>value.trim()).filter(Boolean);
 if(values.some(officeScope))return false;
 const sites=resolved===undefined?pulseTrialSites(siteScope,adminLevel):resolved;
 return sites!==null&&sites.length>0;
}
