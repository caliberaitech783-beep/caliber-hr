import {useEffect,useState} from 'react';
import {api,type Field,type Lookup} from './api';

/* Employee transfer form boxes (owner, 23 Nov 2026):
   - From location comes first and lists only the sites this login covers (chosen by itself when there is one).
   - Employee lists only the employees of that site, as "Emp ID · Name".
   - From / To designation are dropdowns of the Designation master and the designations used in Employee Master.
   - From / To reporting manager are dropdowns of the Manager-and-above people of the From / To site, with their employee ID.
   - To location never offers the From location.
   "Other" in a dropdown opens a box to write a value that is not listed. */
export const transferFieldKeys=['fromSiteId','employeeId','toSiteId','fromDesignation','toDesignation','fromManager','toManager'];
type Data=Record<string,string|number>;
type Option={label:string;value:string};
type Options={employees?:Option[];staff?:{register:number;joined:number;inScope:boolean};designations:string[];fromManagers:Option[];toManagers:Option[]};
type Props={grant:string;field:Field;data:Data;setData:(f:(d:Data)=>Data)=>void;lookups:Lookup[];disabled:boolean};
const OTHER='__other__';
const cache=new Map<string,Promise<Options>>();
/* Fresh lists every time the form opens (called by the record editor). */
export function resetTransferOptions(){cache.clear();}

function useTransferOptions(grant:string,fromSiteId:string,toSiteId:string){
  const path=`transfer-options?fromSiteId=${encodeURIComponent(fromSiteId)}&toSiteId=${encodeURIComponent(toSiteId)}`;
  const key=JSON.stringify([grant,path]);
  const[result,setResult]=useState<{key:string;options?:Options}|null>(null);
  useEffect(()=>{
    let live=true;
    if(!cache.has(key))cache.set(key,api<Options>(grant,path).catch(e=>{cache.delete(key);throw e;}));
    cache.get(key)!.then(options=>{if(live)setResult({key,options});}).catch(()=>{if(live)setResult({key});});
    return()=>{live=false;};
  },[grant,key,path]);
  return result?.key===key?result:null;
}

function ListOrOther({value,options,placeholder,disabled,required,onChange,label}:{value:string;options:Option[];placeholder:string;disabled:boolean;required?:boolean;onChange:(v:string)=>void;label:string}){
  const listed=options.some(o=>o.value===value);
  const[other,setOther]=useState(false);
  const writing=other||(!!value&&!listed&&options.length===0);
  const list=value&&!listed&&!other?[{label:value,value},...options]:options;
  return <>
    <select disabled={disabled} required={required&&!writing} value={writing?OTHER:value} onChange={e=>{if(e.target.value===OTHER){setOther(true);onChange('');}else{setOther(false);onChange(e.target.value);}}}>
      <option value="">{placeholder}</option>
      {list.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      <option value={OTHER}>Other (write it)</option>
    </select>
    {writing&&<input className="transfer-other" aria-label={label} disabled={disabled} required={required} maxLength={300} autoComplete="off" placeholder="Write it here" value={value} onChange={e=>onChange(e.target.value)}/>}
  </>;
}

export default function TransferField({grant,field,data,setData,lookups,disabled}:Props){
  const sites=lookups.filter(x=>x.kind==='sites'),key=field.key,value=String(data[key]??'');
  const fromSiteId=String(data.fromSiteId||''),toSiteId=String(data.toSiteId||'');
  const result=useTransferOptions(grant,fromSiteId,toSiteId);
  const options=result?.options;
  const set=(v:string)=>setData(d=>({...d,[key]:v,...(key==='toSiteId'?{toManager:''}:{})}));
  /* Owner, 23 Nov 2026: site boxes show the site name only (no region code); a name shared by two site masters is listed once. */
  const siteLabel=(x:Lookup)=>x.name.trim().replace(/\s+/g,' ');
  const siteKey=(x?:Lookup)=>x?siteLabel(x).toLowerCase():'';
  const selectedSite=sites.find(x=>x.id===value);
  const siteByName=new Map<string,Lookup>();
  for(const site of sites){
    const name=siteKey(site);
    if(!siteByName.has(name)||site===selectedSite)siteByName.set(name,site);
  }
  const siteList=[...siteByName.values()];
  const fromName=siteKey(sites.find(x=>x.id===fromSiteId));
  /* One site for this login: choose it straight away. */
  useEffect(()=>{if(key==='fromSiteId'&&!value&&!disabled&&siteList.length===1)setData(d=>({...d,fromSiteId:siteList[0].id}));},[key,value,disabled,siteList.length]);// eslint-disable-line react-hooks/exhaustive-deps
  if(key==='fromSiteId')return <select disabled={disabled} required={field.required} value={value} onChange={e=>{const next=e.target.value;const nextName=siteKey(sites.find(x=>x.id===next));setData(d=>({...d,fromSiteId:next,employeeId:'',fromDesignation:'',fromManager:'',...(nextName&&siteKey(sites.find(x=>x.id===d.toSiteId))===nextName?{toSiteId:'',toManager:''}:{})}));}}>
    <option value="">{sites.length?'Select site…':'No site is assigned to this login'}</option>
    {value&&!sites.some(x=>x.id===value)&&<option value={value}>Current site</option>}
    {siteList.map(x=><option key={x.id} value={x.id}>{siteLabel(x)}</option>)}
  </select>;
  if(key==='employeeId'){
    const staff=options?.employees||[];
    const placeholder=!fromSiteId?'Choose the From location first':!result?'Loading employees…':
      !options?'Could not load employees for this site':options.staff?.inScope===false?'This login cannot list staff of this site':
      staff.length?'Select employee ('+staff.length+')…':'No employees with an ID are available at this site';
    return <select disabled={disabled||!fromSiteId||!staff.length} required={field.required} value={value} onChange={e=>set(e.target.value)}>
      <option value="">{placeholder}</option>
      {value&&!staff.some(x=>x.value===value)&&<option value={value} disabled>{[data.empCode,data.employeeName||lookups.find(x=>x.id===value)?.name||'Saved employee'].filter(Boolean).join(' · ')}</option>}
      {staff.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
    </select>;
  }
  if(key==='toSiteId')return <select disabled={disabled||!data.employeeId} required={field.required} value={value} onChange={e=>set(e.target.value)}>
    <option value="">{data.employeeId?'Select…':'Choose the employee first'}</option>
    {value&&!lookups.some(x=>x.kind==='sites'&&x.id===value)&&<option value={value}>Existing inactive site</option>}
    {siteList.filter(x=>x.id!==fromSiteId&&siteKey(x)!==fromName).map(x=><option key={x.id} value={x.id}>{siteLabel(x)}</option>)}
  </select>;
  if(key==='fromDesignation'||key==='toDesignation')return <ListOrOther label={field.label} value={value} disabled={disabled} required={field.required} onChange={set}
    options={(options?.designations||[]).map(name=>({label:name,value:name}))} placeholder={options?'Select designation…':'Loading designations…'}/>;
  const managers=(key==='fromManager'?options?.fromManagers:options?.toManagers)||[],site=key==='fromManager'?fromSiteId:toSiteId;
  return <ListOrOther label={field.label} value={value} disabled={disabled} required={field.required} onChange={set} options={managers}
    placeholder={!site?(key==='toManager'?'Choose the To location first':'Choose the site first'):!options?'Loading managers…':managers.length?'Select manager (ID · name)…':'No manager found at this site'}/>;
}
