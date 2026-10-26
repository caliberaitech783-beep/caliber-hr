import {useEffect,useState} from 'react';
import {pulse,csv,download} from './api';
type Person={employeeId:string;name:string;category:string;designation:string;department:string;reportingTo:string;contact:string;email:string;status:string;siteId:string;site:string;region:string};
type Directory={source:string;fetchedAt:string;sites:{id:string;label:string;region:string}[];rows:Person[]};
const columns:[keyof Person,string][]=[['employeeId','Employee ID'],['name','Name'],['region','Region'],['site','Site / Office'],['department','Department'],['designation','Designation'],['category','Category'],['reportingTo','Reporting to'],['contact','Contact'],['email','Email'],['status','Status']];
const office=(label:string)=>/\b(head|corporate) office\b|\bHO\b|\bCO\b/i.test(label);
export default function PulseDirectoryReport({grant,employeeGroup}:{grant?:string;employeeGroup:'Corporate / HO'|'OB / COAL'}){
 const[data,setData]=useState<Directory|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const[region,setRegion]=useState(''),[site,setSite]=useState(''),[department,setDepartment]=useState(''),[designation,setDesignation]=useState(''),[search,setSearch]=useState('');
 useEffect(()=>{setRegion('');setSite('');setDepartment('');setDesignation('');setSearch('');},[employeeGroup]);
 useEffect(()=>{let live=true;if(!grant){setError('Sign in to load Pulse C-Directory.');return;}setLoading(true);setError('');setData(null);pulse('directory',{grant}).then(result=>{if(!Array.isArray(result.rows)||!Array.isArray(result.sites))throw Error('Pulse returned an invalid directory response.');if(live)setData(result);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[grant,attempt]);
 const sites=(data?.sites||[]).filter(item=>employeeGroup==='Corporate / HO'?office(item.label):!office(item.label));
 const regions=[...new Set(sites.map(item=>item.region))].sort();
 const ids=new Set(sites.filter(item=>(!region||item.region===region)&&(!site||item.id===site)).map(item=>item.id));
 const base=(data?.rows||[]).filter(row=>ids.has(row.siteId));
 const departments=[...new Set(base.map(row=>row.department).filter(Boolean))].sort();
 const designations=[...new Set(base.filter(row=>!department||row.department===department).map(row=>row.designation).filter(Boolean))].sort();
 const rows=base.filter(row=>(!department||row.department===department)&&(!designation||row.designation===designation)&&(!search||[row.employeeId,row.name,row.designation].some(value=>value.toLowerCase().includes(search.toLowerCase()))));
 return <section className="data-card"><div className="data-heading"><div><h2>Region Employee Details</h2><p>{employeeGroup} · Live from Caliber Pulse C-Directory</p>{data&&<p>Last fetched: {new Date(data.fetchedAt).toLocaleString('en-IN')} · {rows.length} employees</p>}</div><div className="toolbar-buttons"><button disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Refresh directory</button><button disabled={!data||loading||!rows.length} onClick={()=>download('region-employee-details.csv',csv(columns.map(([key])=>key),rows))}>Export CSV</button></div></div>
 {error&&<p className="error" role="alert">{error}</p>}
 {loading?<p role="status">Loading Pulse C-Directory…</p>:data&&<><div className="filter-bar">
 {employeeGroup==='OB / COAL'&&<label>Region<select aria-label="Report region" value={region} onChange={e=>{setRegion(e.target.value);setSite('');setDepartment('');setDesignation('');}}><option value="">All regions</option>{regions.map(value=><option key={value}>{value}</option>)}</select></label>}
 <label>{employeeGroup==='Corporate / HO'?'Office':'Site'}<select aria-label="Report site or office" value={site} onChange={e=>{setSite(e.target.value);setDepartment('');setDesignation('');}}><option value="">All {employeeGroup==='Corporate / HO'?'offices':'sites'}</option>{sites.filter(item=>!region||item.region===region).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
 <label>Department<select aria-label="Report department" value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('');}}><option value="">All departments</option>{departments.map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Designation<select aria-label="Report designation" value={designation} onChange={e=>setDesignation(e.target.value)}><option value="">All designations</option>{designations.map(value=><option key={value}>{value}</option>)}</select></label>
 <label>Name or employee ID<input aria-label="Search Pulse employees" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search directory…"/></label></div>
 <div className="table-scroll"><table><thead><tr>{columns.map(([key,label])=><th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={`${row.siteId}-${row.employeeId}-${index}`}>{columns.map(([key])=><td key={key}>{row[key]||'—'}</td>)}</tr>)}</tbody></table></div>{!rows.length&&<p className="empty">No employees match the selected filters.</p>}</>}
 </section>;
}
