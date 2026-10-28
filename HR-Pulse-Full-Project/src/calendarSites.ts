import type {Lookup} from './api';
const aliases:Record<string,string[]>={
 'Dhoptala OC (2nd)':['WCL-DHOPTALA','Dhoptala','Dhoptala OC','Dhoptala OB'],
 'Dudhichua East OC':['NCL-DUDE','DCH-E','NCL-DCH E','Dudichua OB East','Dudhichua East OC'],
 'Dudhichua OC':['NCL-DUDW','DCH W','NCL-DCH W','Dudichua OB west','Dudhichua West OC'],
 'Gauri Pauni OC (2nd)':['WCL-GAURI-PAUNI','Gauri Pauni OB','Gauri Pauni OC'],
 'Jayant OC':['NCL-JAYANT','Jayant OB','Jayant OC'],
 'Lalpeth OC':['WCL-LALPETH','Hindustan Lalpeth OC','Lalpeth OC'],
 'Majri OC':['WCL-MAJRI','Majri','Majri OC','Majri OB'],
 'Sasti OC':['WCL-SASTI','Sasti','Sasti OC','Sasti OB'],
 'Chandrapur HO':['CMLL-HO','CHP','CHO','Chandrapur HO'],
 'Nagpur CO':['CMLL-CO','NGP','Nagpur CO'],
};
export function calendarSite(value:unknown,sites:Lookup[]){
 const raw=String(value||'').trim();if(!raw)return 'All sites';
 const site=sites.find(s=>[s.id,s.code,s.name].some(v=>v.toLowerCase()===raw.toLowerCase()));
 const candidates=[raw,site?.code,site?.name].filter(Boolean).map(v=>v!.toLowerCase());
 return Object.entries(aliases).find(([label,names])=>[label,...names].some(v=>candidates.includes(v.toLowerCase())))?.[0]||site?.name||raw;
}
