import {hrApiOrigin,hrSessionEndpoint} from './hr-paths';
import {displaySiteRecords} from './siteNames';
export const API=hrApiOrigin;
export type Profile={name:string;username?:string;email?:string;actor?:string;assignedRole?:string;permissions:{application:string;hrDesktopAccess?:string[];hrMobileAccess?:string[];site?:unknown;adminLevel?:unknown;leaveOnly?:boolean}};
export type Session={grant:string;profile:Profile};
export type Field={key:string;label:string;type:string;required?:boolean;reference?:string;options?:string[];min?:number};
export type Module={autoCode?:boolean;title:string;menu:string;category?:string;fields:Field[];canWrite:boolean};
export type HRConfig={profile:Profile;modules:Record<string,Module>};
export type RecordRow={id:string;kind:string;code:string;name:string;data:Record<string,string|number>;status:string;version:number;updated_at:string;progress?:{state:string;stage:number;steps:{label:string}[]}|null};
export type Lookup={department_id?:string;site_id?:string;id:string;kind:string;code:string;name:string};
export async function pulse(action:string,data:object){
  const response=await fetch(hrSessionEndpoint+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to sign in');return result;
}
export function clearSession(){localStorage.removeItem('hrPulseSession');sessionStorage.removeItem('hrPulseSession');}
export function savedSession():Session|null{try{return JSON.parse(sessionStorage.getItem('hrPulseSession')||localStorage.getItem('hrPulseSession')||'null');}catch{return null;}}
const READ_RETRY_STATUSES=new Set([429,500,502,503,504]);
let apiRetryPause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Tests remove the retry delay; production keeps the short backoff. */
export const setApiRetryPause=(pause:typeof apiRetryPause)=>{apiRetryPause=pause;};
/** timeoutMs: how long the browser waits; a heavier read (a site's biometric day) may ask for longer. */
export async function api<T>(grant:string,path:string,method='GET',body?:unknown,timeoutMs=30000):Promise<T>{
  const read=method==='GET',streamedAttendance=/^attendance\/(?:mis|site-register|manual-biometric)(?:\?|$)/.test(path),retryHere=read&&!streamedAttendance,attempts=retryHere?3:1;
  for(let attempt=1;attempt<=attempts;attempt++){
    let response:Response;
    try{response=await fetch(API+'/api/'+path,{method,headers:{Authorization:'Bearer '+grant,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeoutMs)});}
    catch(error){if(retryHere&&attempt<attempts){await apiRetryPause(350*attempt);continue;}throw new Error(error instanceof DOMException&&error.name==='TimeoutError'?'HR Pulse took too long to answer. Try again.':'HR Pulse could not be reached. Check the connection and try again.');}
    if(!response.ok){
      if(response.status===401){clearSession();window.dispatchEvent(new Event('hr-session-expired'));}
      const result=await response.json().catch(()=>null);
      if(retryHere&&attempt<attempts&&READ_RETRY_STATUSES.has(response.status)){await apiRetryPause(350*attempt);continue;}
      throw new Error(result?.error||`Unable to complete the request (HTTP ${response.status}).`);
    }
    const result=await response.json();
    return displaySiteRecords(result,path.split('?')[0]==='hierarchies'||/^records\/(sites|joiningHierarchies)(\/|$)/.test(path.split('?')[0]));
  }
  throw new Error('Unable to complete the request. Try again.');
}
export function csv(columns:string[],rows:Record<string,unknown>[]){
  const cell=(value:unknown)=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[columns.map(cell).join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n');
}
export function download(name:string,value:string){downloadBlob(name,new Blob([value],{type:'text/csv;charset=utf-8'}));}
export function downloadBlob(name:string,blob:Blob){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function parseCsv(source:string){
  const text=source.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else throw new Error('Unexpected quote in CSV');}
    else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
  if(quoted)throw new Error('Unclosed quote in CSV');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  const keys=rows.shift()?.map(x=>x.trim())||[];if(!keys.length||new Set(keys).size!==keys.length)throw new Error('CSV must have unique column headings');
  return rows.map((values,i)=>{if(values.length!==keys.length)throw new Error(`CSV row ${i+2} has the wrong number of columns`);return Object.fromEntries(keys.map((key,j)=>[key,values[j]]));});
}
export function prepareImport(source:string,fields:Field[],columns:{key:string;label:string}[]=[]){
 const normalize=(s:string)=>s.trim().toLowerCase();
 const aliases=new Map([...fields.flatMap(f=>[[normalize(f.key),f.key],[normalize(f.label),f.key]]),...columns.map(c=>[normalize(c.label),c.key]),['status','status'],['updatedat','updatedAt'],['last updated','updatedAt']] as [string,string][]);
 const rows=parseCsv(source).map(row=>{const mapped:Record<string,string>={};for(const [key,value] of Object.entries(row)){const target=aliases.get(normalize(key))||key;if(target in mapped)throw new Error('Duplicate CSV column: '+key);mapped[target]=value;}return mapped;}),allowed=new Set(fields.map(f=>f.key));
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
