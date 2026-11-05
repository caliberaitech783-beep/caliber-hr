// Keep saved company IDs and legacy values; use consistent labels in the UI.
export const companyNames:Record<string,string>={
 'Caliber Mining And Logistics Ltd':'CALIBER MINING AND LOGISTICS LIMITED',
 'KSR FREIGHT CARRIERS':'KSR FREIGHT CARRIERS',
 'Caliber Mining And Logistics Ltd SCR JV':'CMPL SCR JOINT VENTURE',
 'CHADDA TRADING COMPANY':'CHADDA TRADING CO.',
};
const normalize=(value:string)=>value.toLowerCase().replace(/&/g,'and').replace(/\bltd\b/g,'limited').replace(/[^a-z0-9]/g,'');
const labels=new Map(Object.entries(companyNames).flatMap(([oldName,label])=>[[normalize(oldName),label],[normalize(label),label]]));
for(const alias of ['Caliber Mining & Logistics','Caliber Mining and Logistics','CMLL','CMPL'])labels.set(normalize(alias),companyNames['Caliber Mining And Logistics Ltd']);
for(const alias of ['CMPL SCR JV','CMPL-SCR-JV'])labels.set(normalize(alias),'CMPL SCR JOINT VENTURE');
const codes:Record<string,string>={CMLL:'CALIBER MINING AND LOGISTICS LIMITED',KSR:'KSR FREIGHT CARRIERS',CHADDA:'CHADDA TRADING CO.',CMPLSCRJV:'CMPL SCR JOINT VENTURE'};
export function companyDisplayName(name:string,code=''){
 return codes[code.toUpperCase().replace(/[^A-Z0-9]/g,'')]||labels.get(normalize(name))||name;
}
