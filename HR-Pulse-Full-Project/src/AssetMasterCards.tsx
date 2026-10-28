import {useState} from 'react';
import type {RecordRow,Lookup} from './api';
import './assetMasters.css';

const descriptions:Record<string,string>={siteId:'Offices and sites where assets are kept.',department:'Departments recorded against assets.',vendor:'Suppliers and repair partners.',condition:'Condition grades recorded at issue and return.',assetStatus:'Availability and current state of assets.',employeeStatus:'Employment statuses recorded against assets.',movementAction:'Asset movement and service actions.',assetGroup:'Groups used to organise assets.',depreciationMethod:'Depreciation methods recorded for assets.',disposalMethod:'Methods used when retiring assets.'};
export default function AssetMasterCards({rows,columns,lookups,writable,edit,add}:{rows:RecordRow[];columns:{key:string;label:string}[];lookups:Lookup[];writable:boolean;edit:(row:RecordRow)=>void;add:()=>void}){
 const [selected,setSelected]=useState('');
 const names=new Map(lookups.map(x=>[x.id,x.name]));
 return <div className="asset-master-lists"><div className="asset-master-intro"><h3>Other masters</h3><p>Values from the records on this page. Select a value to view or edit its records.</p></div>{columns.map(column=>{
  const groups=new Map<string,{label:string;rows:RecordRow[]}>();
  for(const row of rows){const value=String(row.data[column.key]??'').trim();if(!value)continue;const label=names.get(value)||value;const key=label.toLowerCase().replace(/\s+/g,' ');const group=groups.get(key)||{label,rows:[]};group.rows.push(row);groups.set(key,group);}
  return <section className="asset-master-card" key={column.key}><div className="asset-master-card-heading"><h3>{column.label}</h3><span>{groups.size}</span></div><p>{descriptions[column.key]}</p><div className="asset-master-chips">{[...groups].map(([key,group])=><button key={key} aria-expanded={selected===column.key+key} onClick={()=>setSelected(selected===column.key+key?'':column.key+key)}>{group.label}</button>)}{!groups.size&&<span className="asset-master-empty">No values on this page yet</span>}</div>{[...groups].map(([key,group])=>selected===column.key+key&&<div className="asset-master-matches" key={key}>{group.rows.map(row=><button key={row.id} onClick={()=>edit(row)}>{row.name} <span>{row.status}{row.data.__importDraft==='true'?' · Needs review':''} · {writable?'View / edit':'View'}</span></button>)}</div>)}{writable&&<footer><span>Add a record to include a new {column.label.toLowerCase()} value.</span><button onClick={add}>+ Add record</button></footer>}</section>;
 })}</div>;
}
