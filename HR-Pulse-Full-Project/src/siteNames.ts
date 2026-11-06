// Display aliases only: site IDs, codes and stored joining/salary values stay unchanged.
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,string[]>={
 'Dhoptala OB 2nd':['Dhoptala','Dhoptala OB','Dhoptala OC','Dhoptala OB2','Dhoptala OB 2','Dhoptala OC (2nd)','WCL-DHOPTALA'],
 'Gauri Pauni OB 2nd':['Gauri Pauni OB','Gauri Pauni OC','Gauri Pauni OB2','Gauri Pauni OB 2','Gauri Pauni OC (2nd)','Gauri Pouni OB','Gouri Pauni OB','WCL-GAURI','WCL-GAURI-PAUNI'],
 'Lalpeth OB':['Hindustan Lalpeth OC','Hindustan Lalpeth OB','Lalpeth OC','WCL-LALPETH'],
};
const names=new Map(Object.entries(aliases).flatMap(([label,old])=>[label,...old].map(value=>[normalize(value),label])));
export function siteDisplayName(name:string,code=''){return names.get(normalize(code))||names.get(normalize(name))||name;}
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
