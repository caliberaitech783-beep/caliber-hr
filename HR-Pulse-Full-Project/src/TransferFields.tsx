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
type Options={designations:string[];fromManagers:Option[];toManagers:Option[]};
type Props={grant:string;field:Field;data:Data;setData:(f:(d:Data)=>Data)=>void;lookups:Lookup[];disabled:boolean};
const OTHER='__other__';
const cache=new Map<string,Promise<Options>>();

function useTransferOptions(grant:string,fromSiteId:string,toSiteId:string){
  const[options,setOptions]=useState<Options|null>(null);
  useEffect(()=>{
    let live=true;const key=`transfer-options?fromSiteId=${encodeURIComponent(fromSiteId)}&toSiteId=${encodeURIComponent(toSiteId)}`;
    if(!cache.has(key))cache.set(key,api<Options>(grant,key).catch(e=>{cache.delete(key);throw e;}));
    cache.get(key)!.then(o=>{if(live)setOptions(o);}).catch(()=>{if(live)setOptions({designations:[],fromManagers:[],toManagers:[]});});
    return()=>{live=false;};
  },[grant,fromSiteId,toSiteId]);
  return options;
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
  const options=useTransferOptions(grant,fromSiteId,toSiteId);
  const set=(v:string)=>setData(d=>({...d,[key]:v,...(key==='toSiteId'?{toManager:''}:{})}));
  const siteLabel=(x:Lookup)=>`${x.code} · ${x.name}`;
  /* One site for this login: choose it straight away. */
  useEffect(()=>{if(key==='fromSiteId'&&!value&&!disabled&&sites.length===1)setData(d=>({...d,fromSiteId:sites[0].id}));},[key,value,disabled,sites.length]);// eslint-disable-line react-hooks/exhaustive-deps
  if(key==='fromSiteId')return <select disabled={disabled} required={field.required} value={value} onChange={e=>{const next=e.target.value;setData(d=>({...d,fromSiteId:next,employeeId:'',fromDesignation:'',fromManager:'',...(d.toSiteId===next?{toSiteId:'',toManager:''}:{})}));}}>
    <option value="">{sites.length?'Select site…':'No site is assigned to this login'}</option>
    {value&&!sites.some(x=>x.id===value)&&<option value={value}>Current site</option>}
    {sites.map(x=><option key={x.id} value={x.id}>{siteLabel(x)}</option>)}
  </select>;
  if(key==='employeeId'){
    const people=lookups.filter(x=>x.kind==='employees'&&(!fromSiteId||x.site_id===fromSiteId)).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}));
    return <select disabled={disabled||!fromSiteId} required={field.required} value={value} onChange={e=>set(e.target.value)}>
      <option value="">{!fromSiteId?'Choose the site first':people.length?`Select employee (${people.length})…`:'No active employee at this site'}</option>
      {value&&!people.some(x=>x.id===value)&&<option value={value}>{lookups.find(x=>x.id===value)?.name||'Saved employee'}</option>}
      {people.map(x=><option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
    </select>;
  }
  if(key==='toSiteId')return <select disabled={disabled||!data.employeeId} required={field.required} value={value} onChange={e=>set(e.target.value)}>
    <option value="">{data.employeeId?'Select…':'Choose the employee first'}</option>
    {value&&!lookups.some(x=>x.kind==='sites'&&x.id===value)&&<option value={value}>Existing inactive site</option>}
    {sites.filter(x=>x.id!==fromSiteId).map(x=><option key={x.id} value={x.id}>{siteLabel(x)}</option>)}
  </select>;
  if(key==='fromDesignation'||key==='toDesignation')return <ListOrOther label={field.label} value={value} disabled={disabled} required={field.required} onChange={set}
    options={(options?.designations||[]).map(name=>({label:name,value:name}))} placeholder={options?'Select designation…':'Loading designations…'}/>;
  const managers=(key==='fromManager'?options?.fromManagers:options?.toManagers)||[],site=key==='fromManager'?fromSiteId:toSiteId;
  return <ListOrOther label={field.label} value={value} disabled={disabled} required={field.required} onChange={set} options={managers}
    placeholder={!site?(key==='toManager'?'Choose the To location first':'Choose the site first'):!options?'Loading managers…':managers.length?'Select manager (ID · name)…':'No manager found at this site'}/>;
}
