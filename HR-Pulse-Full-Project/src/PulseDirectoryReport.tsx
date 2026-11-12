import {siteDisplayName} from './siteNames';
import {useEffect,useState} from 'react';
import {pulse,csv,download,downloadBlob} from './api';
type Person={employeeId:string;name:string;category:string;designation:string;department:string;reportingTo:string;contact:string;email:string;status:string;siteId:string;site:string;region:string};
type Directory={source:string;fetchedAt:string;sites:{id:string;label:string;region:string}[];rows:Person[]};
const columns:[keyof Person,string,number][]=[
 ['employeeId','Employee ID',18],['name','Name',27],['region','Region',14],['site','Site / Office',29],
 ['department','Department',22],['designation','Designation',32],['category','Category',17],
 ['reportingTo','Reporting to',25],['contact','Contact',19],['email','Email',37],['status','Status',16],
];
const office=(label:string)=>/\b(head|corporate) office\b|\bHO\b|\bCO\b/i.test(label);
export default function PulseDirectoryReport({grant,employeeGroup}:{grant?:string;employeeGroup:'Corporate / HO'|'OB / COAL'}){
 const[data,setData]=useState<Directory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const[exporting,setExporting]=useState(false);
 const[region,setRegion]=useState(''),[site,setSite]=useState(''),[department,setDepartment]=useState(''),[designation,setDesignation]=useState(''),[search,setSearch]=useState('');
 useEffect(()=>{setRegion('');setSite('');setDepartment('');setDesignation('');setSearch('');},[employeeGroup]);
 useEffect(()=>{let live=true;if(!grant){setError('Sign in to load Pulse C-Directory.');return;}setLoading(true);setError('');setData(null);pulse('directory',{grant}).then(result=>{if(!Array.isArray(result.rows)||!Array.isArray(result.sites))throw Error('Pulse returned an invalid directory response.');if(live)setData({...result,sites:result.sites.map((site:Directory['sites'][number])=>({...site,label:siteDisplayName(site.label)})),rows:result.rows.map((row:Person)=>({...row,site:siteDisplayName(row.site)}))});}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[grant,attempt]);
 const sites=(data?.sites||[]).filter(item=>employeeGroup==='Corporate / HO'?office(item.label):!office(item.label));
 const regions=[...new Set(sites.map(item=>item.region))].sort();
 const ids=new Set(sites.filter(item=>(!region||item.region===region)&&(!site||item.id===site)).map(item=>item.id));
 const base=(data?.rows||[]).filter(row=>ids.has(row.siteId));
 const departments=[...new Set(base.map(row=>row.department).filter(Boolean))].sort();
 const designations=[...new Set(base.filter(row=>!department||row.department===department).map(row=>row.designation).filter(Boolean))].sort();
 const rows=base.filter(row=>(!department||row.department===department)&&(!designation||row.designation===designation)&&(!search||[row.employeeId,row.name,row.designation].some(value=>value.toLowerCase().includes(search.toLowerCase()))));
 async function exportExcel(){
  setExporting(true);
  setError('');
  try{
   const {regionEmployeeExcel}=await import('./regionEmployeeExcel');
   const workbook=await regionEmployeeExcel(
    columns.map(([,header,width])=>({header,width})),
    rows.map(row=>columns.map(([key])=>String(row[key]??''))),
   );
   downloadBlob('employee-master-report-gray.xlsx',workbook);
  }catch{
   setError('Could not export the Excel report. Please try again.');
  }finally{
   setExporting(false);
  }
 }
 return <section className="data-card employee-report" aria-labelledby="employee-report-title">
  <div className="data-heading">
   <div>
    <h2 id="employee-report-title">Region Employee Details</h2>
    <p>{employeeGroup} · Live from Caliber Pulse C-Directory</p>
    {data&&<p>Last fetched: {new Date(data.fetchedAt).toLocaleString('en-IN')} · {rows.length} employees</p>}
   </div>
   <div className="toolbar-buttons">
    <button type="button" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Refresh directory</button>
    <button type="button" className="primary" disabled={loading||exporting||!rows.length} onClick={()=>void exportExcel()}>{exporting?'Preparing Excel…':'Export formatted Excel'}</button>
    <button type="button" disabled={!data||loading||!rows.length} onClick={()=>download('region-employee-details.csv',csv(columns.map(([key])=>key),rows))}>Export CSV</button>
   </div>
  </div>
  {error&&<p className="error" role="alert">{error}</p>}
  {loading?<p role="status">Loading Pulse C-Directory…</p>:data&&<>
   <div className="filter-bar" role="group" aria-label="Report filters">
    {employeeGroup==='OB / COAL'&&<label>Region
     <select aria-label="Report region" value={region} onChange={e=>{setRegion(e.target.value);setSite('');setDepartment('');setDesignation('');}}>
      <option value="">All regions</option>{regions.map(value=><option key={value}>{value}</option>)}
     </select>
    </label>}
    <label>{employeeGroup==='Corporate / HO'?'Office':'Site'}
     <select aria-label="Report site or office" value={site} onChange={e=>{setSite(e.target.value);setDepartment('');setDesignation('');}}>
      <option value="">All {employeeGroup==='Corporate / HO'?'offices':'sites'}</option>
      {sites.filter(item=>!region||item.region===region).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
     </select>
    </label>
    <label>Department
     <select aria-label="Report department" value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('');}}>
      <option value="">All departments</option>{departments.map(value=><option key={value}>{value}</option>)}
     </select>
    </label>
    <label>Designation
     <select aria-label="Report designation" value={designation} onChange={e=>setDesignation(e.target.value)}>
      <option value="">All designations</option>{designations.map(value=><option key={value}>{value}</option>)}
     </select>
    </label>
    <label>Name or employee ID
     <input aria-label="Search Pulse employees" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search directory…"/>
    </label>
   </div>
   <div className="table-scroll" role="region" aria-label="Region employee details table" tabIndex={0}>
    <table className="employee-report-table">
     <thead><tr>{columns.map(([key,label])=><th key={key} scope="col">{label}</th>)}</tr></thead>
     <tbody>{rows.map((row,index)=><tr key={`${row.siteId}-${row.employeeId}-${index}`}>
      {columns.map(([key])=><td key={key}>{row[key]||'—'}</td>)}
     </tr>)}</tbody>
    </table>
   </div>
   {!rows.length&&<p className="empty">No employees match the selected filters.</p>}
  </>}
 </section>;
}
