import {grantedMenus} from './modules.mjs';
export const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
export function role(profile){
 const menus=grantedMenus(profile);const explicit=profile.permissions?.assetRole||profile.assignedRole||profile.role;
 if(['Admin','HR','Manager','Employee'].includes(explicit))return explicit;
 if(menus.has('Administration'))return 'Admin';
 if(menus.has('Employee Master')||menus.has('Master Configuration'))return 'HR';
 if(menus.has('Asset Management'))return 'Manager';
 return 'Employee';
}
export function permit(profile,operation){const r=role(profile);const allowed=operation==='read'||operation==='move'&&['Admin','HR','Manager'].includes(r)||operation==='write'&&['Admin','HR'].includes(r)||operation==='admin'&&r==='Admin';if(!allowed)fail('Your Pulse role does not allow this asset operation',403);return r;}
export function bookValue(asset,category,asOf=new Date()){
 const cost=Number(asset.purchaseCost||0);if(['Lost','Disposed'].includes(asset.status))return 0;
 const years=Math.max(0,(+asOf-Date.parse(asset.purchaseDate))/86400000/365.25);const r=Number(category.rate||0)/100;
 if(!Number.isFinite(years))return cost;
 return Math.round(Math.max(cost*.05,category.method==='SLM'?cost*(1-r*years):cost*Math.pow(1-r,years))*100)/100;
}
export const states={'Issue':['Available','Assigned'],'Return':['Assigned','Available'],'Transfer':['Assigned','Assigned'],'Send for repair':['Available','Under Repair'],'Repair done':['Under Repair','Available'],'Mark lost':[['Available','Assigned','Under Repair'],'Lost'],'Found':['Lost','Available'],'Dispose':[['Available','Under Repair','Lost'],'Disposed']};
export function transition(asset,input,employee){
 const rule=states[input.action];if(!rule||![rule[0]].flat().includes(asset.status))fail('Invalid asset status transition');
 if(['Issue','Transfer'].includes(input.action)){
  if(!employee||!['ACTIVE','APPROVED'].includes(employee.status)||/exited|terminated|inactive/i.test(String(employee.data.employmentStatus||employee.data.officeData?.['Employment Status']||employee.data.officeData?.Status||'')))fail('Choose an active employee; exited employees cannot receive assets');
  if(input.action==='Transfer'&&asset.employee_id===employee.id)fail('Choose a different employee');
 }
 if(input.action==='Mark lost'&&(!Number.isFinite(Number(input.amount))||Number(input.amount)<0||input.amount==null||input.amount===''))fail('Enter a valid recovery amount');
 if(input.action==='Dispose'&&(!String(input.method||'').trim()||input.amount==null||input.amount===''||!Number.isFinite(Number(input.amount))||Number(input.amount)<0))fail('Enter a disposal method and valid amount');
 const status=input.action==='Return'&&input.toRepair?'Under Repair':rule[1];
 return {status,employee_id:status==='Assigned'?employee.id:null};
}
export function date(value,label,required=false){if(!value&&!required)return '';if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail(label+': enter a valid date');return value;}
export function categoryData(input){
 const name=String(input.name||'').trim(),prefix=String(input.prefix||'').trim().toUpperCase();
 if(!name||name.length>120||!/^([A-Z][A-Z0-9]{1,11})$/.test(prefix))fail('Enter a category name and a 2–12 character tag prefix');
 if(!['IT','Office','Vehicles & Tools','Other'].includes(input.group)||!['WDV','SLM'].includes(input.method)||!Number.isFinite(Number(input.rate))||Number(input.rate)<0||Number(input.rate)>100)fail('Invalid group, depreciation method or rate');
 const fields=input.fields||[];if(!Array.isArray(fields)||fields.length>30)fail('Maximum 30 custom fields');
 const keys=new Set();for(const field of fields){if(!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(field.key)||keys.has(field.key)||!String(field.label||'').trim()||!['text','number','date','dropdown'].includes(field.type))fail('Custom fields need unique keys, labels and valid types');keys.add(field.key);if(field.type==='dropdown'&&(!Array.isArray(field.options)||!field.options.length||field.options.some(x=>typeof x!=='string'||!x.trim())))fail('Dropdown fields need options');}
 return {name,prefix,group:input.group,method:input.method,rate:Number(input.rate),serialMandatory:!!input.serialMandatory,fields};
}
export function customData(fields,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid custom fields');const result={};
 for(const f of fields){const value=input[f.key];if(value==null||value===''){if(f.required)fail(f.label+' is required');continue;}if(f.type==='number'&&(!Number.isFinite(Number(value))))fail(f.label+' must be a number');if(f.type==='date')date(value,f.label,true);if(f.type==='dropdown'&&!f.options.includes(value))fail('Invalid '+f.label);if(String(value).length>2000)fail(f.label+' is too long');result[f.key]=f.type==='number'?Number(value):String(value);}
 return result;
}
export async function nextTag(db,prefix){const {rows}=await db.query('INSERT INTO hr_asset_counters(prefix,value) VALUES($1,1) ON CONFLICT(prefix) DO UPDATE SET value=hr_asset_counters.value+1 RETURNING value',[prefix]);return prefix+'-'+String(rows[0].value).padStart(4,'0');}
export const seeds=[['Laptop','LAP','IT',40],['Desktop','DES','IT',40],['Monitor','MON','IT',40],['Mobile','MOB','IT',15],['SIM','SIM','IT',0],['Software licence','LIC','IT',33,'SLM'],['Furniture','FUR','Office',10],['ID/Access card','IDC','Office',0],['Keys/Locker','KEY','Office',0],['Vehicle','VEH','Vehicles & Tools',15],['Fuel card','FLC','Vehicles & Tools',0],['Tools','TLS','Vehicles & Tools',15]];
