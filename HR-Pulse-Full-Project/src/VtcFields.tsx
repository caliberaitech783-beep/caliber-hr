import {useEffect,useState} from 'react';
import {api,type Field,type Lookup} from './api';
import TransferPicker from './TransferPicker';

/* VTC Form (owner, 28 Nov 2026): the site comes first (only this login's sites, chosen by itself when there is one), then the
   driver or operator of that site as "Caliber ID · name – designation" (Employee Master register and HR-joined employees). */
export const vtcFieldKeys=['siteId','employeeId'];
type Data=Record<string,string|number>;
type Option={label:string;value:string;code:string};
type Props={grant:string;field:Field;data:Data;setData:(f:(d:Data)=>Data)=>void;lookups:Lookup[];disabled:boolean};

function useVtcEmployees(grant:string,siteId:string){
  const[result,setResult]=useState<{siteId:string;employees?:Option[];inScope?:boolean}|null>(null);
  useEffect(()=>{
    if(!siteId){setResult(null);return;}
    let live=true;
    api<{employees:Option[];inScope:boolean}>(grant,`vtc/options?siteId=${encodeURIComponent(siteId)}`)
      .then(r=>{if(live)setResult({siteId,employees:r.employees,inScope:r.inScope});})
      .catch(()=>{if(live)setResult({siteId});});
    return()=>{live=false;};
  },[grant,siteId]);
  return result?.siteId===siteId?result:null;
}

export default function VtcField({grant,field,data,setData,lookups,disabled}:Props){
  const value=String(data[field.key]??''),siteId=String(data.siteId||'');
  const seen=new Set<string>(),sites=lookups.filter(x=>x.kind==='sites').filter(x=>{const k=x.name.trim().toLowerCase();if(seen.has(k)&&x.id!==value)return false;seen.add(k);return true;});
  const result=useVtcEmployees(grant,field.key==='employeeId'?siteId:'');
  useEffect(()=>{if(field.key==='siteId'&&!value&&!disabled&&sites.length===1)setData(d=>({...d,siteId:sites[0].id}));},[field.key,value,disabled,sites.length]);// eslint-disable-line react-hooks/exhaustive-deps
  if(field.key==='siteId')return <TransferPicker label={field.label} value={value} required={field.required} disabled={disabled}
    placeholder={sites.length?'Search sites…':'No site is assigned to this login'} options={sites.map(s=>({value:s.id,label:s.name.trim()}))}
    savedLabel={value?'Saved site':undefined} onChange={next=>setData(d=>d.siteId===next?d:{...d,siteId:next,employeeId:''})}/>;
  const staff=result?.employees||[];
  const placeholder=!siteId?'Choose the site first':!result?'Loading drivers and operators…':!result.employees?'Could not load the employees of this site':
    result.inScope===false?'This login cannot list staff of this site':staff.length?'Search by Caliber ID or name…':'No driver or operator with a Caliber ID at this site';
  const savedLabel=value?[data.empCode,data.name].filter(Boolean).join(' · ')||'Saved employee':undefined;
  return <TransferPicker key={siteId} label={field.label} value={value} required={field.required} disabled={disabled||!siteId||!staff.length}
    placeholder={placeholder} savedLabel={savedLabel} options={staff.map(e=>({value:e.value,label:e.label,employeeCode:e.code}))}
    onChange={next=>setData(d=>({...d,employeeId:next}))}/>;
}

type Pending={id:string;code:string;name:string;empCode?:string;fromDate?:string;toDate?:string;error:string;tries:number;at:string|null};
export const VTC_RETRY_MS=5*60_000;

/* Approved VTC requests that Pulse-II has not taken yet (refused or not answered at the final approval). They stay approved;
   Retry sends them again with this user's Pulse sign-in, and while this tab is open they are retried every 5 minutes. */
export function VtcPulsePending({grant,notice}:{grant:string;notice:(s:string)=>void}){
  const[rows,setRows]=useState<Pending[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('');
  async function load(){try{setRows((await api<{rows:Pending[]}>(grant,'vtc/pending')).rows||[]);setError('');}catch(e){setError((e as Error).message);}}
  async function retry(id?:string,quiet=false){
    setBusy(id||'all');
    try{const r=await api<{sent:number;failed:number}>(grant,'vtc/retry','POST',id?{id}:{});if(!quiet||r.sent)notice(r.sent?`${r.sent} VTC request${r.sent===1?'':'s'} sent to Pulse-II.`:'Pulse-II did not take it yet. The reason is shown below.');}
    catch(e){if(!quiet)setError((e as Error).message);}
    finally{setBusy('');await load();}
  }
  useEffect(()=>{void load();},[grant]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!rows.length)return;const timer=window.setInterval(()=>{void retry(undefined,true);},VTC_RETRY_MS);return()=>window.clearInterval(timer);},[rows.length,grant]);// eslint-disable-line react-hooks/exhaustive-deps
  if(!rows.length&&!error)return null;
  return <section className="data-card vtc-pending" aria-labelledby="vtc-pending-title">
    <div className="data-heading"><div><h2 id="vtc-pending-title">Approved, not yet in Pulse-II</h2><p>These VTC requests are approved, but Pulse-II has not taken them yet, so their days are not present on the roster. They are retried every 5 minutes while this page is open.</p></div>
      {rows.length>1&&<button disabled={!!busy} onClick={()=>void retry()}>{busy==='all'?'Sending…':'Retry all'}</button>}</div>
    {error&&<p className="error" role="alert">{error}</p>}
    <ul className="vtc-pending-list">{rows.map(r=><li key={r.id}><b>{[r.empCode,r.name].filter(Boolean).join(' · ')}</b> · {r.code}<br/><small>Not yet in Pulse-II: {r.error}{r.tries>1?` (${r.tries} tries)`:''}</small> <button disabled={!!busy} onClick={()=>void retry(r.id)}>{busy===r.id?'Sending…':'Retry'}</button></li>)}</ul>
  </section>;
}
