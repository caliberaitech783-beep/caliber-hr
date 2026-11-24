import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ChevronDown, Download} from 'lucide-react';
import {api, downloadBlob} from './api';
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
const formats = [['excel','Excel'], ['pdf','PDF']] as const;
type ExportFormat = typeof formats[number][0];
type Employee = Record<typeof columns[number][0], string> & {id:string;details?:Record<string,string>};
type RegisterColumn = typeof columns[number];
type EditableColumn = Exclude<RegisterColumn,readonly ['region'|'site',string,number]>;
const editableColumns = columns.filter((column):column is EditableColumn=>column[0]!=='region'&&column[0]!=='site');
type EditField = EditableColumn[0] | 'siteCode' | 'leavingDate';
type EditValues = Record<EditField,string>;
type EmployeeEditSnapshot = {
  name:string;
  version:number;
  siteCode:string;
  fields:Partial<EditValues>;
  sites:{code:string;label:string}[];
  canRemove?:boolean;
};
// Why a line is removed. A person who has left is not removed: the status is set to LEFT with the leaving date.
const removeReasons = ['Duplicate line','Wrong entry','Not our employee'] as const;
type EmployeeDetails = {
  name:string;
  fields?:Partial<Employee>;
  sources:{label:string;fields:[string,string][]}[];
};
type Register = {rows:Employee[];detailColumns?:string[];total:number;pageSize:number;sites:{code:string;label:string}[];canImport:boolean};

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

function EmployeeEditDialog({employee,grant,onClose,onSaved,onRemoved}:{
  employee:Employee;grant:string;onClose:()=>void;onSaved:()=>void;onRemoved:()=>void;
}) {
  const dialog = useRegisterDialog();
  const [snapshot,setSnapshot] = useState<EmployeeEditSnapshot>();
  const [values,setValues] = useState<EditValues>();
  const [original,setOriginal] = useState<EditValues>();
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const [reason,setReason] = useState('');
  const [sure,setSure] = useState(false);
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
      initial.leavingDate = result.fields.leavingDate ?? '';
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

  // An employee is deleted only here, never in Pulse-II (owner, 23 Nov 2026). Pulse-II takes the removal within a minute.
  async function remove() {
    if (!snapshot || saving || !reason) return;
    setSaving(true);
    setError('');
    try {
      await api(grant,path+'/remove','POST',{version:snapshot.version,reason});
      onRemoved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to remove this line.');
      setSaving(false);
      setSure(false);
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
        <label>Leaving date (when Status is LEFT)
          <input type="date" value={values.leavingDate} disabled={saving} onChange={event=>setValues({...values,leavingDate:event.target.value})}/>
        </label>
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
    {snapshot?.canRemove && <section className="hr-register-remove" aria-label="Remove this line">
      <h3>Remove this line</h3>
      <p>Only for a line that should not be in Employee Master. For a person who has left, set Status to LEFT with the leaving date instead. Pulse-II stops matching a removed person on new cards within a minute.</p>
      <div className="record-form">
        <label>Why it is removed
          <select value={reason} disabled={saving} onChange={event=>{setReason(event.target.value);setSure(false);}}>
            <option value="">Choose a reason</option>
            {removeReasons.map(item=><option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="form-actions">
        {!sure ? <button type="button" disabled={saving||!reason} onClick={()=>setSure(true)}>Remove this line</button>
          : <>
            <strong role="alert">Remove {employee.name}{employee.employeeId?` (${employee.employeeId})`:''} from Employee Master?</strong>
            <button type="button" className="remove" disabled={saving} onClick={remove}>{saving?'Removing…':'Yes, remove'}</button>
            <button type="button" disabled={saving} onClick={()=>setSure(false)}>No</button>
          </>}
      </div>
    </section>}
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
  const [downloadOpen,setDownloadOpen] = useState(false);
  const downloadButton = useRef<HTMLButtonElement>(null);
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
      let skipped = 0;
      let payload;
      if (/\.xlsx?$/i.test(file.name)) {
        const {employeeWorkbook} = await import('./employeeWorkbook');
        const existing = await api<{complete:boolean;rows:Employee[]}>(grant,'employee-master-register?export=1');
        if (!existing.complete || !data) throw new Error('Could not verify the current register. Please retry.');
        const parsed = await employeeWorkbook(await file.arrayBuffer(),data.sites,columns,existing.rows.map(({details:_,...row})=>row));
        skipped = parsed.skipped;
        if (!parsed.rows.length) {
          setMessage(`0 entries added. ${skipped.toLocaleString('en-IN')} already imported.`);
          return;
        }
        payload = {format:'hr-employee-master-v1',rows:parsed.rows};
      } else {
        payload = JSON.parse(await file.text());
      }
      if (payload.format !== 'hr-employee-master-v1' || !Array.isArray(payload.rows) || !payload.rows.length) {
        throw new Error('Choose a prepared HR employee import file.');
      }
      const result = await api<{inserted:number;alreadyImported:number;numberOnAnotherLine?:number}>(grant,'employee-master-register','POST',payload);
      // One number on one line: a line whose Employee ID another line already holds is not added (server/employee-number.mjs).
      const held = result.numberOnAnotherLine || 0;
      setMessage(`${result.inserted.toLocaleString('en-IN')} entries added. ${(result.alreadyImported+skipped).toLocaleString('en-IN')} already imported.`+(held?` ${held.toLocaleString('en-IN')} not added: the Employee ID is already on another line.`:''));
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
      const {complete,rows,detailColumns=[]} = await api<{complete:boolean;rows:Employee[];detailColumns?:string[]}>(grant,`employee-master-register?${params}`);
      if (!complete) throw new Error('The full employee export is temporarily unavailable. Try again shortly.');
      if (!rows.length) throw new Error('No employees match the current selection.');
      if (format==='excel') {
        const {regionEmployeeExcel} = await import('./regionEmployeeExcel');
        const workbook = await regionEmployeeExcel(
          [...columns.map(([,header,width])=>({header,width})),...detailColumns.map(header=>({header,width:24}))],
          rows.map(row=>[...columns.map(([key])=>row[key] ?? ''),...detailColumns.map(label=>row.details?.[label] ?? '')]),
        );
        downloadBlob('hr-employee-master.xlsx',workbook);
      } else {
        const records = rows.map((row,index)=>({...row,...row.details,serial:index+1}));
        const allExportColumns=[...exportColumns,...detailColumns.map(label=>({key:label,label}))];
        if (popup) {
          if (popup.closed) throw new Error('The PDF window was closed. Choose PDF from the Export menu again.');
          popup.document.open();
          popup.document.write(assetPrintHtml('Employee Master',allExportColumns,records));
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
  const canDownload = !loading && !importing && !exporting && Boolean(data?.total);
  return <section className="data-card employee-report" aria-labelledby="employee-master-register-title">
    <div className="data-heading">
      <div>
        <h2 id="employee-master-register-title">Employee Master</h2>
        {data && <p>{data.total.toLocaleString('en-IN')} employee entries</p>}
      </div>
      <div className="employee-export hr-register-download"
        onBlur={event=>{
          if (!event.currentTarget.contains(event.relatedTarget)) setDownloadOpen(false);
        }}
        onKeyDown={event=>{
          if (event.key!=='Escape' || !downloadOpen) return;
          event.preventDefault();
          setDownloadOpen(false);
          downloadButton.current?.focus();
        }}>
        <button ref={downloadButton} type="button" className="employee-import" disabled={!canDownload}
          aria-expanded={downloadOpen&&canDownload} aria-controls="hr-register-download-formats"
          onClick={()=>setDownloadOpen(open=>!open)}>
          <Download aria-hidden="true"/>{exporting?'Preparing…':'Export'}<ChevronDown aria-hidden="true"/>
        </button>
        <div id="hr-register-download-formats" className="employee-export-menu" role="group" aria-label="Download format"
          hidden={!downloadOpen||!canDownload}>
          {formats.map(([format,label])=><button type="button" key={format} onClick={()=>{
            setDownloadOpen(false);
            downloadButton.current?.focus();
            void exportEmployees(format);
          }}>{label}</button>)}
        </div>
      </div>
      {data?.canImport && <label className="file-label">Import Excel
        <input aria-label="Import HR employee data" type="file" accept=".xlsx,.xls,.json" disabled={importing||loading} onChange={event=>{
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
          <thead><tr><th scope="col">Serial No</th>{columns.map(([key,label])=><th key={key} scope="col">{label.toUpperCase()}</th>)}{(data.detailColumns||[]).map(label=><th key={label} scope="col">{label.toUpperCase()}</th>)}<th scope="col">DETAILS</th></tr></thead>
          <tbody>{data.rows.map((row,index)=><tr key={row.id}>
            <td>{first+index+1}</td>{columns.map(([key])=><td key={key}>{row[key]}</td>)}{(data.detailColumns||[]).map(label=><td key={label}>{row.details?.[label]||''}</td>)}
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
      }}
      onRemoved={()=>{
        closeDetails();
        setMessage('The line was removed from Employee Master.');
        setRevision(value=>value+1);
      }}/>}
  </section>;
}
