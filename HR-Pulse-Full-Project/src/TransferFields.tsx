import {useEffect,useState} from 'react';
import {api,type Field,type Lookup} from './api';

/* Employee transfer form boxes (owner, 23 Nov 2026):
   - From location is the employee's current site from Employee Master and cannot be changed here.
   - To location never offers the From location.
   - To designation suggests the Designation master; any other title can still be typed.
   - To reporting manager suggests the managers of the employee's department at the To location. */
export const transferFieldKeys=['fromSiteId','toSiteId','toDesignation','toManager'];
type Data=Record<string,string|number>;
type Props={grant:string;field:Field;data:Data;setData:(f:(d:Data)=>Data)=>void;lookups:Lookup[];disabled:boolean};

function useManagers(grant:string,department:string,site:string){
  const[managers,setManagers]=useState<{label:string;value:string}[]>([]);
  useEffect(()=>{
    setManagers([]);if(!department)return;let live=true;
    api<{managers:{label:string;value:string}[]}>(grant,`reporting-managers?department=${encodeURIComponent(department)}&site=${encodeURIComponent(site)}`).then(r=>{if(live)setManagers(r?.managers||[]);}).catch(()=>{});
    return()=>{live=false;};
  },[grant,department,site]);
  return managers;
}

export default function TransferField({grant,field,data,setData,lookups,disabled}:Props){
  const sites=lookups.filter(x=>x.kind==='sites'),key=field.key,value=String(data[key]??'');
  const set=(v:string)=>setData(d=>({...d,[key]:v,...(key==='toSiteId'?{toManager:''}:{})}));
  const toSiteName=sites.find(x=>x.id===data.toSiteId)?.name||'';
  const managers=useManagers(grant,key==='toManager'?String(data.department||''):'',toSiteName);
  if(key==='fromSiteId'){
    const name=sites.find(x=>x.id===value);
    return <><select disabled aria-readonly="true" value={value} onChange={()=>{}}><option value="">{data.employeeId?'Not saved in Employee Master':'Filled from the employee'}</option>{value&&<option value={value}>{name?`${name.code} · ${name.name}`:'Current site'}</option>}</select></>;
  }
  if(key==='toSiteId')return <select disabled={disabled||!data.employeeId} required={field.required} value={value} onChange={e=>set(e.target.value)}>
    <option value="">{data.employeeId?'Select…':'Choose the employee first'}</option>
    {value&&!sites.some(x=>x.id===value)&&<option value={value}>Existing inactive site</option>}
    {sites.filter(x=>x.id!==data.fromSiteId).map(x=><option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
  </select>;
  const listId='transfer-'+key+'-list';
  const options=key==='toDesignation'?[...new Set(lookups.filter(x=>x.kind==='designations').map(x=>x.name))].map(name=>({label:name,value:name})):managers;
  return <><input list={listId} disabled={disabled} required={field.required} maxLength={300} autoComplete="off" placeholder={key==='toDesignation'?'Choose or type the new designation':toSiteName?'Choose or type the new manager':'Choose the To location first'} value={value} onChange={e=>set(e.target.value)}/>
    <datalist id={listId}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</datalist></>;
}
