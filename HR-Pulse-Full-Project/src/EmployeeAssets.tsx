import {useEffect,useState} from 'react';
import {api} from './api';
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n||0);
export function EmployeeAssets({grant,employeeId}:{grant:string;employeeId:string}){
 const [value,setValue]=useState<any>(null),[error,setError]=useState('');useEffect(()=>{let alive=true;api(grant,'asset-management/employee/'+employeeId).then(v=>{if(alive)setValue(v);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[grant,employeeId]);
 return <section className="data-card"><h3>Assets & exit clearance</h3>{error?<p role="alert">{error}</p>:!value?<p>Loading assets…</p>:<><strong>{value.label}</strong><ul>{value.assets.map((a:any)=><li key={a.id}>{a.tag} · {a.data.name} · {a.status}{a.data.recoveryAmount?' · Recovery '+money(a.data.recoveryAmount):''}</li>)}</ul></>}</section>;
}
