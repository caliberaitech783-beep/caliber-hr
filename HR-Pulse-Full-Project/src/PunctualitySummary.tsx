import {useEffect, useState} from 'react';
import {api} from './api';

type Mark = {id:string; code:string; name:string; site:string; shift:string; date:string; late:boolean; early:boolean; in?:string; out?:string};
type Total = {id:string; code:string; name:string; site:string; shift:string; late:number; early:number; halfDutyCuts:number};
type Result = {rows:Mark[]; summary?:Total[]; policy?:{graceMinutes:number; lateEarlyPerHalfCut:number}};

export default function PunctualitySummary({grant,initialMonth}:{grant:string;initialMonth:string}){
 const [month,setMonth]=useState(initialMonth);
 const [result,setResult]=useState<Result>();
 const [error,setError]=useState('');
 const [search,setSearch]=useState('');
 useEffect(()=>{
  let active=true;
  setResult(undefined);
  setError('');
  if(!/^\d{4}-\d{2}$/.test(month))return;
  const [year,number]=month.split('-').map(Number);
  const last=new Date(Date.UTC(year,number,0)).getUTCDate();
  api<Result>(grant,`attendance/punctuality?from=${month}-01&to=${month}-${last}`)
   .then(data=>{if(active)setResult({...data,rows:Array.isArray(data?.rows)?data.rows:[]});})
   .catch(e=>{if(active)setError(e.message);});
  return ()=>{active=false;};
 },[grant,month]);
 const needle=search.trim().toLowerCase();
 const grace=result?.policy?.graceMinutes??15,perCut=result?.policy?.lateEarlyPerHalfCut??3;
 const marks=new Map<string,Mark[]>();
 for(const row of result?.rows||[])marks.set(row.id,[...(marks.get(row.id)||[]),row]);
 const totals:Total[]=(result?.summary||[]).filter(t=>[t.name,t.code,t.site].some(v=>v?.toLowerCase().includes(needle)));
 const dates=(id:string,late:boolean)=>(marks.get(id)||[]).filter(m=>late?m.late:m.early).map(m=>`${m.date.split('-').reverse().join('-')}${late?(m.in?` (${m.in})`:''):(m.out?` (${m.out})`:'')}`);
 return <section className="data-card">
  <h2>Late Come / Early Going</h2>
  <p>In punch more than {grace} min after shift start is a late come; Out punch before shift end is early going (no grace). Every {perCut} late comings or early goings in a month, counted together, cut one half duty. The count starts again each month.</p>
  <div className="attendance-filters">
   <label>Attendance month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
   <label>Employee or site<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  </div>
  {error?<p role="alert">{error}</p>:!month?<p>Select a month.</p>:!result?<p role="status">Loading attendance…</p>:
   <div className="table-scroll"><table><thead><tr>{['Employee','Site','Shift','Late comings','Early goings','Total','Half duty cuts'].map(label=><th key={label}>{label}</th>)}</tr></thead>
   <tbody>{totals.map(t=><tr key={t.id}><td>{t.name} · {t.code}</td><td>{t.site}</td><td>{t.shift}</td>
    {[true,false].map(late=>{const list=dates(t.id,late);const count=late?t.late:t.early;return <td key={String(late)}>{count?<details><summary>{count}</summary>{list.join(', ')}</details>:0}</td>;})}
    <td>{t.late+t.early}</td><td><strong>{t.halfDutyCuts}</strong></td>
   </tr>)}{!totals.length&&<tr><td colSpan={7}>{!result.rows.length?'No late comings or early goings for this month.':'No matching employees.'}</td></tr>}</tbody></table></div>}
 </section>;
}
