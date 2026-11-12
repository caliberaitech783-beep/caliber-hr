import {useEffect,useState} from 'react';
import {api} from './api';
const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(n||0);
export function EmployeeAssets({grant,employeeId,asTable=false}:{grant:string;employeeId:string;asTable?:boolean}){
 const [value,setValue]=useState<any>(null),[error,setError]=useState('');useEffect(()=>{let alive=true;api(grant,'asset-management/employee/'+employeeId).then(v=>{if(alive)setValue(v);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[grant,employeeId]);
 return <section className="data-card employee-assets">
   <h3>Assets &amp; exit clearance</h3>
   {error?<p role="alert">{error}</p>:!value?<p>Loading assets…</p>:<>
     <strong>{value.label}</strong>
     {asTable?(value.assets.length?<div className="table-scroll" role="region" aria-label="Employee assets" tabIndex={0}>
       <table>
         <thead><tr><th scope="col">Asset tag</th><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Recovery amount</th></tr></thead>
         <tbody>{value.assets.map((asset:any)=><tr key={asset.id}>
           <td>{asset.tag}</td><td>{asset.data.name}</td><td>{asset.status}</td>
           <td className="asset-amount">{asset.data.recoveryAmount?money(asset.data.recoveryAmount):'—'}</td>
         </tr>)}</tbody>
       </table>
     </div>:<p>No assets on record.</p>):<ul>{value.assets.map((a:any)=><li key={a.id}>{a.tag} · {a.data.name} · {a.status}{a.data.recoveryAmount?' · Recovery '+money(a.data.recoveryAmount):''}</li>)}</ul>}
   </>}
 </section>;
}
