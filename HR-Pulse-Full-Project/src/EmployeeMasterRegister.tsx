import {useEffect, useState, type FormEvent} from 'react';
import {api} from './api';

const columns = [
  ['employeeId','Employee ID'], ['name','Name'], ['region','Region'], ['site','Site / Office'],
  ['department','Department'], ['designation','Designation'], ['category','Category'],
  ['reportingTo','Reporting to'], ['contact','Contact'], ['email','Email'], ['status','Status'],
] as const;
type Employee = Record<typeof columns[number][0], string> & {id:string};
type EmployeeDetails = {
  name:string;
  sources:{label:string;fields:[string,string][]}[];
};
type Register = {rows:Employee[];total:number;pageSize:number;sites:{code:string;label:string}[];canImport:boolean};

export default function EmployeeMasterRegister({grant}:{grant:string}) {
  const [data,setData] = useState<Register>();
  const [site,setSite] = useState('');
  const [search,setSearch] = useState('');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [revision,setRevision] = useState(0);
  const [selectedId,setSelectedId] = useState('');
  const [selected,setSelected] = useState<EmployeeDetails>();
  const [detailError,setDetailError] = useState('');
  const [loading,setLoading] = useState(true);
  const [importing,setImporting] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');

  useEffect(()=>{
    let active = true;
    setLoading(true);
    setError('');
    setSelectedId('');
    const params = new URLSearchParams({site,search:query,page:String(page)});
    api<Register>(grant,`employee-master-register?${params}`).then(result=>{
      if (active) setData(result);
    }).catch(error=>{
      if (active) {
        setData(undefined);
        setError(error.message);
      }
    }).finally(()=>{
      if (active) setLoading(false);
    });
    return ()=>{active=false;};
  },[grant,site,query,page,revision]);

  useEffect(()=>{
    setSelected(undefined);
    setDetailError('');
    if (!selectedId) return;
    let active = true;
    api<EmployeeDetails>(grant,`employee-master-register/${selectedId}`).then(result=>{
      if (active) setSelected(result);
    }).catch(error=>{
      if (active) setDetailError(error.message);
    });
    return ()=>{active=false;};
  },[grant,selectedId]);

  async function importData(file:File) {
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const payload = JSON.parse(await file.text());
      if (payload.format !== 'hr-employee-master-v1' || !Array.isArray(payload.rows) || !payload.rows.length) {
        throw new Error('Choose a prepared HR employee import file.');
      }
      const result = await api<{inserted:number;alreadyImported:number}>(grant,'employee-master-register','POST',payload);
      setMessage(`${result.inserted.toLocaleString('en-IN')} entries added. ${result.alreadyImported.toLocaleString('en-IN')} already imported.`);
      setPage(1);
      setRevision(value=>value+1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to import employee data.');
    } finally {
      setImporting(false);
    }
  }

  function searchEmployees(event:FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  const first = (page-1)*(data?.pageSize ?? 50);
  return <section className="data-card employee-report" aria-labelledby="employee-master-register-title">
    <div className="data-heading">
      <div>
        <h2 id="employee-master-register-title">Employee Master</h2>
        {data && <p>{data.total.toLocaleString('en-IN')} employee entries</p>}
      </div>
      {data?.canImport && <label className="file-label">Import HR employee data
        <input aria-label="Import HR employee data" type="file" accept=".json" disabled={importing||loading} onChange={event=>{
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importData(file);
        }}/>
      </label>}
    </div>
    {data && <form className="filter-bar" onSubmit={searchEmployees}>
      <label>Site
        <select value={site} onChange={event=>{setPage(1);setSite(event.target.value);}}>
          <option value="">All sites</option>{data.sites.map(entry=><option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </select>
      </label>
      <label>Name, employee ID, department or designation
        <input type="search" value={search} onChange={event=>setSearch(event.target.value)}/>
      </label>
      <button type="submit">Search</button>
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {loading || importing ? <p role="status">{importing?'Importing employee data…':'Loading employees…'}</p>
      : data && (data.rows.length ? <>
      <div className="table-scroll" role="region" aria-label="HR employee list" tabIndex={0}>
        <table className="employee-report-table">
          <thead><tr><th scope="col">Serial No</th>{columns.map(([key,label])=><th key={key} scope="col">{label.toUpperCase()}</th>)}<th scope="col">DETAILS</th></tr></thead>
          <tbody>{data.rows.map((row,index)=><tr key={row.id}>
            <td>{first+index+1}</td>{columns.map(([key])=><td key={key}>{row[key]}</td>)}
            <td><button type="button" aria-label={`View details for ${row.name}`} onClick={()=>setSelectedId(row.id)}>View</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="toolbar-buttons" aria-label="Employee pages">
        <button type="button" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button>
        <button type="button" disabled={first+data.pageSize>=data.total} onClick={()=>setPage(page+1)}>Next</button>
      </div>
    </> : <p>No employees match the current selection.</p>)}
    {selectedId && <section aria-label="Employee details">
      <div className="data-heading"><h3>{selected?.name || 'Employee details'}</h3><button type="button" onClick={()=>setSelectedId('')}>Close details</button></div>
      {detailError && <p role="alert" className="error">{detailError}</p>}
      {!selected && !detailError && <p role="status">Loading employee details…</p>}
      {selected?.sources.map((source,index)=><details key={index} open={index===0}>
        <summary>{source.label}</summary>
        <dl>{source.fields.map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </details>)}
    </section>}
  </section>;
}
