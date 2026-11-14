import {useEffect, useRef, useState, type FormEvent} from 'react';
import {api, csv, download, downloadBlob} from './api';
import {assetPrintHtml} from './assetPrint';

const columns = [
  ['employeeId','Employee ID',18], ['name','Name',28], ['region','Region',12], ['site','Site / Office',27],
  ['department','Department',24], ['designation','Designation',29], ['category','Category',18],
  ['reportingTo','Reporting to',25], ['contact','Contact',19], ['email','Email',36], ['status','Status',16],
] as const;
const exportColumns: {key:'serial' | typeof columns[number][0];label:string}[] = [
  {key:'serial',label:'Serial No'},
  ...columns.map(([key,label])=>({key,label:label.toUpperCase()})),
];
const formats = [['excel','Download Excel'], ['csv','Download CSV'], ['pdf','Download PDF']] as const;
type ExportFormat = typeof formats[number][0];
type Employee = Record<typeof columns[number][0], string> & {id:string};
type RegisterColumn = typeof columns[number];
type EditableColumn = Exclude<RegisterColumn,readonly ['region'|'site',string,number]>;
const editableColumns = columns.filter((column):column is EditableColumn=>column[0]!=='region'&&column[0]!=='site');
type EditField = EditableColumn[0] | 'siteCode';
type EditValues = Record<EditField,string>;
type EmployeeEditSnapshot = {
  name:string;
  version:number;
  siteCode:string;
  fields:Partial<EditValues>;
  sites:{code:string;label:string}[];
};
type EmployeeDetails = {
  name:string;
  fields?:Partial<Employee>;
  sources:{label:string;fields:[string,string][]}[];
};
type Register = {rows:Employee[];total:number;pageSize:number;sites:{code:string;label:string}[];canImport:boolean};

function useRegisterDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element = dialog.current!;
    if (typeof element.showModal === 'function') element.showModal();
    else element.open = true;
    return ()=>{if (typeof element.close === 'function') element.close();};
  },[]);
  return dialog;
}

function EmployeeEditDialog({employee,grant,onClose,onSaved}:{
  employee:Employee;grant:string;onClose:()=>void;onSaved:()=>void;
}) {
  const dialog = useRegisterDialog();
  const [snapshot,setSnapshot] = useState<EmployeeEditSnapshot>();
  const [values,setValues] = useState<EditValues>();
  const [original,setOriginal] = useState<EditValues>();
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const path = `employee-master-register/${employee.id}`;

  useEffect(()=>{
    let active = true;
    api<EmployeeEditSnapshot>(grant,`${path}?edit=1`).then(result=>{
      if (!active) return;
      if (!Number.isInteger(result.version) || !Array.isArray(result.sites) || !result.fields) {
        throw new Error('Editing is temporarily unavailable. Try again shortly.');
      }
      const initial = Object.fromEntries(editableColumns.map(([key])=>[key,result.fields[key] ?? ''])) as EditValues;
      initial.name = result.name;
      initial.siteCode = result.siteCode;
      setOriginal(initial);
      setValues(initial);
      setSnapshot(result);
    }).catch(error=>{if (active) setError(error.message);});
    return ()=>{active=false;};
  },[grant,path]);

  const changes = Object.fromEntries(Object.entries(values ?? {}).filter(([key,value])=>value!==original?.[key as EditField])
    .map(([key,value])=>[key,value.trim()]));
  async function save(event:FormEvent) {
    event.preventDefault();
    if (!snapshot || saving || !Object.keys(changes).length) return;
    setSaving(true);
    setError('');
    try {
      await api(grant,path,'PATCH',{version:snapshot.version,changes});
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save employee details.');
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="modal hr-register-details" aria-labelledby="hr-register-edit-title"
    onCancel={event=>{event.preventDefault();if (!saving) onClose();}}>
    <div className="modal-heading">
      <h2 id="hr-register-edit-title">Edit employee details</h2>
      <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
    </div>
    <p>{employee.name}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!snapshot && !error && <p role="status">Loading employee details…</p>}
    {snapshot && values && <form onSubmit={save} aria-label="Employee details form">
      <div className="record-form">
        {editableColumns.map(([key,label])=><label key={key}>{label}
          <input value={values[key]} maxLength={1000} required={key==='name'} disabled={saving}
            onChange={event=>setValues({...values,[key]:event.target.value})}/>
        </label>)}
        <label>Site / Office
          <select value={values.siteCode} disabled={saving} onChange={event=>setValues({...values,siteCode:event.target.value})}>
            {!snapshot.sites.some(site=>site.code===snapshot.siteCode) &&
              <option value={snapshot.siteCode}>{employee.site}</option>}
            {snapshot.sites.map(site=><option key={site.code} value={site.code}>{site.label}</option>)}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving||!values.name.trim()||!Object.keys(changes).length}>
          {saving?'Saving…':'Save changes'}
        </button>
      </div>
    </form>}
  </dialog>;
}

function EmployeeDetailsDialog({employee,grant,onClose}:{employee:Employee;grant:string;onClose:()=>void}) {
  const dialog = useRegisterDialog();
  const [details,setDetails] = useState<EmployeeDetails>();
  const [error,setError] = useState('');
  const [retry,setRetry] = useState(0);

  useEffect(()=>{
    let active = true;
    setError('');
    api<EmployeeDetails>(grant,`employee-master-register/${employee.id}`).then(result=>{
      if (active) setDetails(result);
    }).catch(error=>{
      if (active) setError(error.message);
    });
    return ()=>{active=false;};
  },[grant,employee.id,retry]);

  return <dialog
    ref={dialog}
    className="modal hr-register-details"
    aria-labelledby="hr-register-details-title"
    onCancel={event=>{event.preventDefault();onClose();}}
  >
    <div className="modal-heading">
      <h2 id="hr-register-details-title">{employee.name}</h2>
      <button type="button" onClick={onClose}>Close details</button>
    </div>
    <p>{[employee.employeeId,employee.site].filter(Boolean).join(' · ')}</p>
    {error && <>
      <p role="alert" className="error">{error}</p>
      <button type="button" onClick={()=>setRetry(attempt=>attempt+1)}>Retry</button>
    </>}
    {!details && !error && <p role="status">Loading employee details…</p>}
    {details?.fields && <details open>
      <summary>Current employee details</summary>
      <dl>{editableColumns.map(([key,label])=><div key={key}><dt>{label}</dt>
        <dd>{details.fields?.[key] || '—'}</dd></div>)}</dl>
    </details>}
    {details?.sources.length===0 && <p>No workbook details are available for this entry.</p>}
    {details?.sources.map((source,index)=><details key={index} open={!details.fields&&index===0}>
      <summary>{source.label}</summary>
      <dl>{source.fields.map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </details>)}
  </dialog>;
}

export default function EmployeeMasterRegister({grant}:{grant:string}) {
  const [data,setData] = useState<Register>();
  const [site,setSite] = useState('');
  const [search,setSearch] = useState('');
  const [query,setQuery] = useState('');
  const [page,setPage] = useState(1);
  const [revision,setRevision] = useState(0);
  const [selected,setSelected] = useState<{employee:Employee;mode:'view'|'edit'}>();
  const dialogButton = useRef<HTMLButtonElement>(null);
  const [loading,setLoading] = useState(true);
  const [importing,setImporting] = useState(false);
  const [exporting,setExporting] = useState<ExportFormat>();
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');

  useEffect(()=>{
    let active = true;
    setLoading(true);
    setError('');
    setSelected(undefined);
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

  async function exportEmployees(format:ExportFormat) {
    setError('');
    const popup = format==='pdf' ? window.open('','_blank') : null;
    if (format==='pdf' && !popup) {
      setError('The PDF window was blocked. Allow pop-ups for HR Pulse and try again.');
      return;
    }
    if (popup) {
      popup.opener = null;
      popup.document.title = 'Employee Master';
      popup.document.body.textContent = 'Preparing employee report…';
    }
    setExporting(format);
    try {
      const params = new URLSearchParams({site,search:query,export:'1'});
      const {complete,rows} = await api<{complete:boolean;rows:Employee[]}>(grant,`employee-master-register?${params}`);
      if (!complete) throw new Error('The full employee export is temporarily unavailable. Try again shortly.');
      if (!rows.length) throw new Error('No employees match the current selection.');
      if (format==='excel') {
        const {regionEmployeeExcel} = await import('./regionEmployeeExcel');
        const workbook = await regionEmployeeExcel(
          columns.map(([,header,width])=>({header,width})),
          rows.map(row=>columns.map(([key])=>row[key] ?? '')),
        );
        downloadBlob('hr-employee-master.xlsx',workbook);
      } else {
        const records = rows.map((row,index)=>({...row,serial:index+1}));
        if (format==='csv') {
          const headings = exportColumns.map(({label})=>label);
          const values = records.map(row=>Object.fromEntries(exportColumns.map(({key,label})=>[label,row[key]])));
          download('hr-employee-master.csv',csv(headings,values));
        } else if (popup) {
          if (popup.closed) throw new Error('The PDF window was closed. Try Download PDF again.');
          popup.document.open();
          popup.document.write(assetPrintHtml('Employee Master',exportColumns,records));
          popup.document.close();
          popup.focus();
          popup.print();
        }
      }
    } catch (error) {
      popup?.close();
      setError(error instanceof Error ? error.message : 'Unable to download employee data.');
    } finally {
      setExporting(undefined);
    }
  }

  function searchEmployees(event:FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  function closeDetails() {
    setSelected(undefined);
    requestAnimationFrame(()=>dialogButton.current?.focus({preventScroll:true}));
  }

  const first = (page-1)*(data?.pageSize ?? 50);
  return <section className="data-card employee-report" aria-labelledby="employee-master-register-title">
    <div className="data-heading">
      <div>
        <h2 id="employee-master-register-title">Employee Master</h2>
        {data && <p>{data.total.toLocaleString('en-IN')} employee entries</p>}
      </div>
      <div className="toolbar-buttons" aria-label="Download employee data">
        {formats.map(([format,label])=><button
          type="button" key={format}
          disabled={loading||importing||Boolean(exporting)||!data?.total}
          onClick={()=>void exportEmployees(format)}
        >{exporting===format?'Preparing…':label}</button>)}
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
            <td className="row-actions">
              <button type="button" aria-label={`View details for ${row.name}`} onClick={event=>{
                dialogButton.current = event.currentTarget;
                setSelected({employee:row,mode:'view'});
              }}>View</button>
              <button type="button" aria-label={`Edit details for ${row.name}`} onClick={event=>{
                dialogButton.current = event.currentTarget;
                setSelected({employee:row,mode:'edit'});
              }}>Edit</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="toolbar-buttons" aria-label="Employee pages">
        <button type="button" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button>
        <button type="button" disabled={first+data.pageSize>=data.total} onClick={()=>setPage(page+1)}>Next</button>
      </div>
    </> : <p>No employees match the current selection.</p>)}
    {selected?.mode==='view' && <EmployeeDetailsDialog key={selected.employee.id} employee={selected.employee} grant={grant} onClose={closeDetails}/>}
    {selected?.mode==='edit' && <EmployeeEditDialog key={selected.employee.id} employee={selected.employee} grant={grant} onClose={closeDetails}
      onSaved={()=>{
        closeDetails();
        setMessage('Employee details saved.');
        setRevision(value=>value+1);
      }}/>}
  </section>;
}
