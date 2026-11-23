// Display aliases only: site IDs, codes and stored joining/salary values stay unchanged.
// The list lives in server/site-display-names.mjs, so the server can find a site the screen names by its display name.
import {siteDisplayName} from '../server/site-display-names.mjs';
export {siteDisplayName};
// Covers legacy saved site masters and hierarchies without changing database identifiers.
export function displaySiteRecords<T>(value:T,siteRecord=false):T{
 if(Array.isArray(value))return value.map(item=>displaySiteRecords(item,siteRecord)) as T;
 if(!value||typeof value!=='object')return value;
 const record=value as Record<string,unknown>;
 const isSite=siteRecord||record.kind==='sites'||record.kind==='joiningHierarchies';
 return Object.fromEntries(Object.entries(record).map(([key,item])=>[key,
  key==='name'&&typeof item==='string'&&isSite?siteDisplayName(item,String(record.code||'')):
  key==='siteName'&&typeof item==='string'?siteDisplayName(item):
  displaySiteRecords(item,isSite&&(key==='data'||key==='rows'))])) as T;
}

export function siteFieldValue(field:string,value:unknown){return /^(site(?:\s*\*)?|site \/ project|site \/ office)$/i.test(field)&&typeof value==='string'?siteDisplayName(value):value;}
