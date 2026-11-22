import {read, utils} from 'xlsx';

type Site = {code:string;label:string};
type Fields = Record<string,string>;
const headerKey = (value:string) => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const siteKey = (value:string) => headerKey(value.replace(/gouri/ig,'gauri').replace(/pouni/ig,'pauni'));
const aliases:Record<string,string> = {
  site:'site',sitecode:'site',sitename:'site',office:'site',employeename:'name',fullname:'name',
  empid:'employeeId',employeecode:'employeeId',empcode:'employeeId',
};
function identity(site:string,row:Fields) {
  const id = (row.employeeId || '').trim().toUpperCase().replace(/^CMPL/,'CMLL');
  return JSON.stringify([site,id || ['name','department','designation','category','reportingTo','contact','email','status']
    .map(key=>(row[key] || '').trim().toLowerCase())]);
}

export async function employeeWorkbook(buffer:ArrayBuffer,sites:Site[],columns:readonly (readonly [string,string,number])[],existing:Fields[]) {
  const workbook = read(buffer,{type:'array'});
  const headings = new Map(columns.map(([key,label])=>[headerKey(label),key]));
  const seen = new Set(existing.map(row=>identity(siteKey(row.site),row)));
  let skipped = 0;
  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const grid = utils.sheet_to_json<string[]>(sheet,{header:1,raw:false,defval:'',blankrows:true,range:0});
    const first = grid.findIndex(row=>row.some(value=>value.trim()));
    if(first<0) continue;
    const keys = grid[first].map(value=>headings.get(headerKey(value)) || aliases[headerKey(value)]);
    if(!keys.includes('site') || !keys.includes('name')) throw new Error(sheetName+' needs Name and Site / Office columns.');
    const mapped = keys.filter(Boolean);
    if(new Set(mapped).size!==mapped.length) throw new Error(sheetName+' contains duplicate employee column headings.');
    for(let index=first+1;index<grid.length;index++){
      const cells=grid[index];
      if(!cells.some(value=>value.trim())) continue;
      const row:Fields=Object.fromEntries(columns.map(([key])=>[key,'']));
      keys.forEach((key,i)=>{if(key)row[key]=(cells[i] || '').trim();});
      const where=sheetName+' row '+(index+1);
      const input=siteKey(row.site);
      const matches=input ? sites.filter(site=>[site.code,site.label,site.label.replace(/\s+OB(?:\s+2nd)?$/i,'')].some(value=>siteKey(value)===input)) : [];
      if(matches.length!==1) throw new Error(where+': enter a recognized, unambiguous Site / Office name or code.');
      if(!row.name) throw new Error(where+': employee name is required.');
      const site=matches[0];
      const identifier=identity(siteKey(site.label),row);
      if(seen.has(identifier)){skipped++;continue;}
      seen.add(identifier);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('employee-master-excel:'+identifier));
      const key=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      rows.push({...row,key,siteCode:site.code,sources:[{label:where,fields:columns.filter(([key])=>row[key]).map(([key,label])=>[label,row[key]])}]});
    }
  }
  if(!rows.length && !skipped) throw new Error('The workbook contains no employee rows.');
  return {rows,skipped};
}
