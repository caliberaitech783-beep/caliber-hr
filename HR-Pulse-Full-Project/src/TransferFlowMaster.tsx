import {useEffect,useState} from 'react';
import {api} from './api';
/* Approval Master › Employee Transfer: Site HR (from location) → PM (from location) → Office HR → Regional HR Head → Director. */
type Common={officeHr:string;regionalHrHead:string;directors:string;enabled:boolean;version:number};
type SiteRow={id:string;code:string;name:string;siteHr:string;pm:string};
type Data={canWrite:boolean;common:Common;sites:SiteRow[]};
export default function TransferFlowMaster({grant}:{grant:string}){
 const[data,setData]=useState<Data|null>(null),[common,setCommon]=useState<Common>({officeHr:'',regionalHrHead:'',directors:'',enabled:false,version:0}),[site,setSite]=useState(''),[siteHr,setSiteHr]=useState(''),[pm,setPm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){try{const result=await api<Data>(grant,'transfer-flows');setData(result);setCommon(result.common);const row=result.sites.find(s=>s.code===site);if(row){setSiteHr(row.siteHr);setPm(row.pm);}setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[grant]);
 function pick(code:string){setSite(code);const row=data?.sites.find(s=>s.code===code);setSiteHr(row?.siteHr||'');setPm(row?.pm||'');setMessage('');}
 async function action(fn:()=>Promise<void>,done:string){setBusy(true);setError('');setMessage('');try{await fn();await load();setMessage(done);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const configured=data?.sites.filter(s=>s.siteHr&&s.pm)||[];
 return <section className="data-card" aria-label="Employee transfer approval"><h2>Employee Transfer – Approval flow</h2>
  <ol className="transfer-route"><li><b>Site HR</b> (from location)</li><li><b>PM</b> (from location)</li><li><b>Office HR</b></li><li><b>Regional HR Head</b></li><li><b>Director</b> – final, any one</li></ol>
  <p className="help-text">Site HR and PM are taken from the employee's <b>current</b> location. Any one listed approver can complete a step. On final approval the employee's posting moves to the destination site and company.</p>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {data&&<>
  <form onSubmit={e=>{e.preventDefault();void action(async()=>{await api(grant,'transfer-flows','POST',{scope:'common',...common});},'Transfer approvers saved.');}}>
   <h3>Common approvers</h3>
   <div className="record-form">
    <label>Office HR — comma-separated Pulse usernames<input required value={common.officeHr} onChange={e=>setCommon({...common,officeHr:e.target.value})}/></label>
    <label>Regional HR Head — comma-separated Pulse usernames<input required value={common.regionalHrHead} onChange={e=>setCommon({...common,regionalHrHead:e.target.value})}/></label>
    <label>Directors — comma-separated Pulse usernames (final – any one)<input required value={common.directors} onChange={e=>setCommon({...common,directors:e.target.value})}/></label>
    <label>Enable transfer routing<select value={String(common.enabled)} onChange={e=>setCommon({...common,enabled:e.target.value==='true'})}><option value="false">No — transfers stay as drafts</option><option value="true">Yes</option></select></label>
   </div>
   <button className="primary" disabled={busy||!data.canWrite}>Save common approvers</button>
  </form>
  <form onSubmit={e=>{e.preventDefault();void action(async()=>{await api(grant,'transfer-flows','POST',{scope:'site',code:site,siteHr,pm});},'Site approvers saved.');}}>
   <h3>Per-location approvers (from location)</h3>
   <div className="record-form">
    <label>Site / office<select required value={site} onChange={e=>pick(e.target.value)}><option value="">Select site</option>{data.sites.map(s=><option key={s.code} value={s.code}>{s.name}{s.siteHr&&s.pm?' ✓':''}</option>)}</select></label>
    <label>Site HR — comma-separated Pulse usernames<input required value={siteHr} onChange={e=>setSiteHr(e.target.value)}/></label>
    <label>PM — comma-separated Pulse usernames<input required value={pm} onChange={e=>setPm(e.target.value)}/></label>
   </div>
   <button className="primary" disabled={busy||!site||!data.canWrite}>Save site approvers</button>
  </form>
  <p className="help-text">{configured.length?`Configured locations: ${configured.map(s=>s.name).join(', ')}.`:'No location has Site HR and PM yet — transfers from a location without them cannot be submitted.'}{!data.canWrite&&' Editing needs unrestricted site access.'}</p>
  </>}
 </section>;
}
