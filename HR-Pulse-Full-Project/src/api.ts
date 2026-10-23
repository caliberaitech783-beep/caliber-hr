export const API='https://hr-api-cmll-783.azurewebsites.net';
export type Profile={name:string;username?:string;email?:string;actor?:string;assignedRole?:string;permissions:{application:string;hrDesktopAccess?:string[];hrMobileAccess?:string[];site?:unknown;adminLevel?:unknown}};
export type Session={grant:string;profile:Profile};
export type Field={key:string;label:string;type:string;required?:boolean;reference?:string;options?:string[];min?:number};
export type Module={autoCode?:boolean;title:string;menu:string;fields:Field[];canWrite:boolean};
export type RecordRow={id:string;kind:string;code:string;name:string;data:Record<string,string|number>;status:string;version:number;updated_at:string};
export type Lookup={id:string;kind:string;code:string;name:string};
export async function pulse(action:string,data:object){
  const response=await fetch('https://pulse.cmll.in/api/integrations/hr/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to sign in');return result;
}
export function clearSession(){localStorage.removeItem('hrPulseSession');sessionStorage.removeItem('hrPulseSession');}
export function savedSession():Session|null{try{return JSON.parse(sessionStorage.getItem('hrPulseSession')||localStorage.getItem('hrPulseSession')||'null');}catch{return null;}}
export async function api<T>(grant:string,path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch(API+'/api/'+path,{method,headers:{Authorization:'Bearer '+grant,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok){if(response.status===401){clearSession();window.dispatchEvent(new Event('hr-session-expired'));}throw new Error(result.error||'Unable to complete the request');}return result;
}
export function csv(columns:string[],rows:Record<string,unknown>[]){
  const cell=(value:unknown)=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[columns.map(cell).join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n');
}
export function download(name:string,value:string){const url=URL.createObjectURL(new Blob([value],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function parseCsv(source:string){
  const text=source.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else throw new Error('Unexpected quote in CSV');}
    else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw new Error('Unclosed quote in CSV');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  const keys=rows.shift()?.map(x=>x.trim())||[];if(!keys.length||new Set(keys).size!==keys.length)throw new Error('CSV must have unique column headings');
  return rows.map((values,i)=>{if(values.length!==keys.length)throw new Error(`CSV row ${i+2} has the wrong number of columns`);return Object.fromEntries(keys.map((key,j)=>[key,values[j]]));});
}
export function prepareImport(source:string,fields:Field[]){
 const rows=parseCsv(source),allowed=new Set(fields.map(f=>f.key));
 const metadata=new Set(['status','updatedAt']);
 const unknown=Object.keys(rows[0]||{}).filter(k=>!allowed.has(k)&&!metadata.has(k));
 if(unknown.length)throw new Error('Unknown CSV columns: '+unknown.join(', '));
 return rows.map((row,index)=>Object.fromEntries(Object.entries(row).filter(([key])=>allowed.has(key)).map(([key,value])=>{
  if(fields.find(f=>f.key===key)?.type==='date'){
   const match=value.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
   if(match){value=`${match[3]}-${match[2]}-${match[1]}`;const parsed=new Date(value+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error(`CSV row ${index+2}: invalid ${key}`);}
  }
  return [key,value];
 })));
}
