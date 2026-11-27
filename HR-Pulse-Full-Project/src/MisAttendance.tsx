import {Fragment, useEffect, useState} from 'react';
import {ChevronDown, Download, Pencil, Printer, RefreshCw} from 'lucide-react';
import {api} from './api';
import {assetPrintHtml} from './assetPrint';
import {downloadExcel} from './excelFiles';
import {mapMisAttendance, retiredCorrection, type AttendanceRow, type CorrectionStatus} from './misAttendanceModel';
import MisAttendanceChange, {type ChangeTarget} from './MisAttendanceChange';
import {DEFAULT_POLICY, type AttendancePolicy} from '../server/attendance-policy.mjs';
import './mis-attendance.css';


const startOfRecords = '2026-11-01';
const dateInIndia = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const displayDate = (date: string) => date.split('-').reverse().join('-');
const columns = ['Date', 'Employee', 'Type', 'Equipment / vehicle', 'Time', 'Output', 'Hours', 'Status', 'Verification', 'OT'];
const refreshMs = 30_000;
const pageSize = 100;

export default function MisAttendance({grant, shiftManagement=false, overtimeOnly=false, policy=DEFAULT_POLICY}: {grant: string; shiftManagement?: boolean; overtimeOnly?: boolean; policy?: AttendancePolicy}) {
  const today = dateInIndia();
  const latest = today < startOfRecords ? startOfRecords : today;
  const [fromDate, setFromDate] = useState(latest);
  const [toDate, setToDate] = useState(latest);
  const [site, setSite] = useState('');
  const [shift, setShift] = useState('');
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{range: string; rows: AttendanceRow[]; sites: string[]; updated: Date; canEdit: boolean}>();
  const [failure, setFailure] = useState<{range: string; message: string}>();
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AttendanceRow>();
  const [status, setStatus] = useState<CorrectionStatus>('mis');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [saved, setSaved] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  // A present / absent change is made in MIS with the RHR's OTP (MisAttendanceChange). rowId '': Mark present, for a person with no card.
  const [changing, setChanging] = useState<{rowId: string; target?: ChangeTarget}>();
  const range = `${fromDate}:${toDate}`;
  const valid = fromDate >= startOfRecords && toDate <= latest && fromDate <= toDate && Date.parse(toDate) - Date.parse(fromDate) <= 30 * 86_400_000;
  const error = failure?.range === range ? failure.message : '';

  function selectRange(from: string, to: string) {
    setFromDate(from);
    setToDate(to);
    setPage(0);
    setEditing(undefined);
    setChanging(undefined);
    setSaved('');
  }
  function changed(message: string) {
    setChanging(undefined);
    setSaved(message);
    setRefresh(n => n + 1);
  }

  useEffect(() => {
    if (!valid) return;
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      setLoading(true);
      try {
        const query = new URLSearchParams({from: fromDate, to: toDate});
        const data = await api<{canEdit: boolean; sites?: string[]}>(grant, 'attendance/mis?' + query);
        const rows = mapMisAttendance(data).filter(row => row.date >= fromDate && row.date <= toDate);
        if (lifetime.signal.aborted) return;
        setResult({range, rows, sites: data.sites || [], updated: new Date(), canEdit: data.canEdit});
        setFailure(undefined);
      } catch (error) {
        if (!lifetime.signal.aborted) {
          setFailure({range, message: (error as Error).message});
        }
      } finally {
        if (!lifetime.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, refreshMs);
        }
      }
    }
    void load();
    return () => {
      lifetime.abort();
      clearTimeout(timer);
    };
  }, [fromDate, toDate, range, valid, refresh, grant]);

  async function saveCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const fields = new FormData(event.currentTarget);
    const {date, site, siteKey, shift, employeeId, correction} = editing;
    setSaving(true);
    setEditError('');
    try {
      await api(grant, 'attendance/mis/correction', 'POST', {
        date, site, siteKey, shift, employeeId, status, version: correction?.version || 0, reason: fields.get('reason'),
        start: fields.get('start') || '', end: fields.get('end') || ''
      });
      setEditing(undefined);
      setSaved('Attendance correction saved.');
      setRefresh(n => n + 1);
    } catch (error) {
      setEditError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const current = result?.range === range ? result : undefined;
  const awaitingResult = valid && !current && !error;
  const all = current?.rows || [];
  const sites = [...new Set([...(current?.sites || []), ...all.map(row => row.site)].filter(Boolean))].sort();
  const activeSite = sites.includes(site) ? site : '';
  const needle = search.trim().toLowerCase();
  const shifts = [...new Set(all.filter(row => !activeSite || row.site === activeSite).map(row => row.shift))].sort();
  const activeShift = shiftManagement && shifts.includes(shift) ? shift : '';
  const filtered = all.filter(row => (!overtimeOnly || row.otHours !== null) && (!activeSite || row.site === activeSite) && (!activeShift || row.shift === activeShift) &&
    (!needle || [row.employeeName, row.employeeId, row.caliberCode].some(text => text?.toLowerCase().includes(needle))));
  const pending = filtered.filter(row => !row.verified).length;
  const rows = pendingOnly ? filtered.filter(row => !row.verified) : filtered;
  const ot = rows.reduce((hours, row) => hours + (row.otHours ?? 0), 0);
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const activePage = Math.min(page, lastPage);
  const pageStart = activePage * pageSize;

  const exportColumns = [
    {key: 'date', label: 'Date'}, {key: 'employee', label: 'Employee'}, {key: 'code', label: 'Employee code'},
    {key: 'site', label: 'Site'}, {key: 'shift', label: 'Shift'}, {key: 'type', label: 'Type'},
    {key: 'equipment', label: 'Equipment / vehicle'}, {key: 'time', label: 'Time'}, {key: 'output', label: 'Output'},
    {key: 'hours', label: 'Hours'}, {key: 'status', label: 'Status'}, {key: 'verification', label: 'Verification'},
    {key: 'ot', label: 'OT'}, {key: 'note', label: 'Note'}
  ];
  const exportRows = rows.map(row => ({
    date: displayDate(row.date), employee: row.employeeName, code: row.caliberCode || row.employeeId, site: row.site, shift: row.shift,
    type: row.sources.join(', '), equipment: row.equipment.join(', ') || '—',
    time: row.window ? `${row.window.start.slice(-5)} – ${row.window.end.slice(-5)}` : '—', output: row.output || '—',
    hours: row.window ? `${(row.window.endMs - row.window.startMs) / 3_600_000} h` : '—', status: row.status,
    verification: row.verification, ot: row.otHours === null ? '—' : `${row.otHours} h`, note: row.note || ''
  }));
  const reportTitle = shiftManagement ? 'Shift roster' : overtimeOnly ? 'Overtime attendance' : 'Trip cards & driver logbooks';
  function printReport() {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) { setFailure({range, message: 'The print window was blocked. Allow pop-ups for this site, then try Print/Export again.'}); return; }
    popup.document.open();
    popup.document.write(assetPrintHtml(`${reportTitle} · ${displayDate(fromDate)} to ${displayDate(toDate)}`, exportColumns, exportRows));
    popup.document.close(); popup.focus(); setExportOpen(false);
  }
  function exportExcel() {
    const excelRows = exportRows.map(row => Object.fromEntries(exportColumns.map(column => [column.label, row[column.key as keyof typeof row]])));
    downloadExcel(`attendance-${fromDate}-to-${toDate}.xlsx`, exportColumns.map(column => column.label), excelRows);
    setExportOpen(false);
  }

  return <div className="trip-attendance">
    <section className="data-card trip-attendance-card" aria-labelledby="trip-card-heading">
      <div className="trip-attendance-header">
        <div>
          <h2 id="trip-card-heading">{shiftManagement ? 'Shift roster' : overtimeOnly ? 'Overtime' : 'Trip cards & driver logbooks'}</h2>
          <p>MIS is the master of trip card attendance: present or absent is changed in MIS only, with the RHR's OTP, and shows here at once. Closed MIS batches verify attendance. Two verified back-to-back 8-hour shifts give 8 hours of OT.{!shiftManagement && !overtimeOnly &&
            ' A driver or operator with a punched trip card or logbook is present for the day, whatever the hours: no half day from trip card hours.'}</p>
        </div>
        <div className="trip-attendance-header-actions">
          <button type="button" className="trip-attendance-refresh" disabled={loading || !valid} onClick={() => setRefresh(n => n + 1)}>
            <RefreshCw size={16} aria-hidden="true"/> {loading && valid ? 'Syncing…' : 'Refresh MIS'}
          </button>
          {current?.canEdit && !shiftManagement && !overtimeOnly && <button type="button" className="trip-attendance-refresh" disabled={saving} aria-expanded={changing?.rowId === ''}
            onClick={() => {setEditing(undefined); setSaved(''); setChanging(changing?.rowId === '' ? undefined : {rowId: ''});}}>Mark present (OTP)</button>}
          <div className="trip-attendance-export">
            <button type="button" aria-haspopup="menu" aria-expanded={exportOpen} disabled={!rows.length} onClick={() => setExportOpen(open => !open)}>
              <Download size={17} aria-hidden="true"/> Print/Export <ChevronDown size={16} aria-hidden="true"/>
            </button>
            {exportOpen && <div className="trip-attendance-export-menu" role="menu">
              <button type="button" role="menuitem" onClick={printReport}><Download size={17} aria-hidden="true"/> Download as PDF</button>
              <button type="button" role="menuitem" onClick={printReport}><Printer size={17} aria-hidden="true"/> Smart Print</button>
              <button type="button" role="menuitem" onClick={exportExcel}><Download size={17} aria-hidden="true"/> Download as Excel</button>
            </div>}
          </div>
        </div>
      </div>
      <div className="trip-attendance-filters">
        <label>From date<input type="date" min={startOfRecords} max={toDate < latest ? toDate : latest} value={fromDate} disabled={saving} onChange={e => selectRange(e.target.value, toDate)}/></label>
        <label>To date<input type="date" min={fromDate > startOfRecords ? fromDate : startOfRecords} max={latest} value={toDate} disabled={saving} onChange={e => selectRange(fromDate, e.target.value)}/></label>
        <label>Site<select value={activeSite} onChange={e => {setSite(e.target.value); setPage(0);}}>
          <option value="">All sites</option>
          {sites.map(name => <option key={name}>{name}</option>)}
        </select></label>
        {shiftManagement && <label>Shift<select value={activeShift} onChange={e => {setShift(e.target.value); setPage(0); setEditing(undefined);}}><option value="">All shifts</option>{shifts.map(value => <option key={value}>{value}</option>)}</select></label>}
        <label>Employee<input type="search" value={search} placeholder="Search name or code" onChange={e => {setSearch(e.target.value); setPage(0);}}/></label>
        <label className="trip-attendance-checkbox"><input type="checkbox" checked={pendingOnly} onChange={e => {setPendingOnly(e.target.checked); setPage(0);}}/> Pending only</label>
      </div>
      {!valid && <p role="alert" className="trip-attendance-feedback">Choose a date range of up to 31 days from 1 November 2026 through today.</p>}
      {valid && error && <p role="alert" className="trip-attendance-feedback">{current && 'Showing the last successful sync. '}{error}</p>}
      {saved && <p className="trip-attendance-saved" role="status">{saved}</p>}
      {changing?.rowId === '' && <MisAttendanceChange grant={grant} sites={sites} latest={latest} onDone={changed} onCancel={() => setChanging(undefined)}/>}
      <div className="trip-attendance-summary" role="status">
        <span><strong>{rows.length}</strong> duties</span>
        <span><strong>{pending}</strong> pending</span>
        <span><strong>{ot} h</strong> OT</span>
        <span className="trip-attendance-sync">{current ? `Last synced ${current.updated.toLocaleTimeString('en-IN', {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit'})} IST · refreshes every 30 sec` : awaitingResult ? 'Loading MIS attendance…' : ''}</span>
      </div>
      <div className="trip-attendance-table" role="region" aria-label="Trip Cards and Logbook attendance table" tabIndex={0}>
        <table>
          <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}{current?.canEdit && <th scope="col">Action</th>}</tr></thead>
          <tbody>
            {rows.slice(pageStart, pageStart + pageSize).map(row => <Fragment key={row.id}><tr>
              <td>{displayDate(row.date)}<small>{row.site} · {row.shift}</small></td>
              <td><strong>{row.employeeName}</strong><small>{[row.employeeId, row.designation].filter(Boolean).join(' · ')}</small></td>
              <td><div className="trip-attendance-sources">{row.sources.map(type => <span key={type} className="trip-attendance-tag">{type}</span>)}</div></td>
              <td>{row.equipment.join(', ') || '—'}{row.references && <small>{row.references}</small>}</td>
              <td>{row.window ? `${row.window.start.slice(-5)} – ${row.window.end.slice(-5)}` : '—'}
                {row.window && <small>{row.correction?.start ? 'HR corrected' : 'Scheduled'}{row.window.start.slice(0, 10) !== row.window.end.slice(0, 10) && ' · next day end'}</small>}
              </td>
              <td>{row.output || '—'}{row.note && <small>{row.note}</small>}</td>
              <td>{row.window ? <>{`${(row.window.endMs - row.window.startMs) / 3_600_000} h`}</> : '—'}</td>
              <td><span className={`trip-attendance-tag ${row.status === 'Absent' ? 'trip-absent' : row.verified ? 'trip-present' : 'trip-pending'}`}>{row.status}</span></td>
              <td>{row.verification}{row.correction && (retiredCorrection(row.correction)
                ? <small>Earlier HR-only “{row.correction.status}” is not applied ({row.correction.reason} · {row.correction.updatedBy}). Use Mark absent to make it in MIS.</small>
                : <small>{row.correction.reason} · {row.correction.updatedBy}</small>)}</td>
              <td className="trip-attendance-ot" title={row.otNote || undefined}>{row.otHours === null ? '—' : `${row.otHours} h`}{row.otNote && <small>{row.otNote}</small>}</td>
              {current?.canEdit && <td>{row.sources[0] !== 'HR change' && <button type="button" className="trip-attendance-edit" disabled={saving}
                aria-label={`Edit ${row.employeeName}, ${row.date}, ${row.shift}`} aria-expanded={editing?.id === row.id} onClick={() => {
                  setChanging(undefined); setEditing(row); setStatus(row.correction && !retiredCorrection(row.correction) ? row.correction.status : 'mis'); setEditError(''); setSaved('');
                }}><Pencil size={14} aria-hidden="true"/> Edit</button>}
                {/* Present / absent is changed in MIS, with the RHR's OTP: never kept only in HR Pulse. */}
                <button type="button" className="trip-attendance-edit" disabled={saving} aria-expanded={changing?.rowId === row.id}
                  aria-label={`${row.hrChange ? 'Take back the HR change for' : 'Mark absent'} ${row.employeeName}, ${row.date}, ${row.shift}`} onClick={() => {
                    setEditing(undefined); setSaved('');
                    setChanging(changing?.rowId === row.id ? undefined : {rowId: row.id, target: {site: row.site, date: row.date, shift: row.shift, employeeId: row.employeeId, employeeName: row.employeeName, mark: row.hrChange ? 'card' : 'absent'}});
                  }}>{row.hrChange ? 'Take back (OTP)' : 'Mark absent (OTP)'}</button></td>}
            </tr>
            {editing?.id === row.id && <tr><td colSpan={columns.length + 1}>
              <form className="trip-attendance-editor" onSubmit={saveCorrection} aria-label={`Edit attendance for ${row.employeeName}`}>
                <label>Status<select value={status} onChange={event => setStatus(event.target.value as CorrectionStatus)}>
                  <option value="mis">Use MIS</option><option value="present">Present (correct duty times)</option>
                </select></label>
                {status === 'present' && <>
                  <label>Duty start<input type="time" name="start" defaultValue={editing.correction?.start || ''}/></label>
                  <label>Duty end<input type="time" name="end" defaultValue={editing.correction?.end || ''}/></label>
                </>}
                <label className="trip-attendance-reason">Reason<input name="reason" maxLength={500} required placeholder="Reason for the correction"/></label>
                <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save correction'}</button>
                <button type="button" disabled={saving} onClick={() => setEditing(undefined)}>Cancel</button>
                {editError && <p role="alert">{editError}</p>}
              </form>
            </td></tr>}
            {changing?.rowId === row.id && <tr><td colSpan={columns.length + 1}>
              <MisAttendanceChange grant={grant} target={changing.target} latest={latest} onDone={changed} onCancel={() => setChanging(undefined)}/>
            </td></tr>}
            </Fragment>)}
            {!rows.length && <tr><td className="trip-attendance-empty" colSpan={columns.length + Number(Boolean(current?.canEdit))}>
              {awaitingResult ? 'Loading attendance…' : current ? 'No attendance records for this selection.' : 'Attendance is unavailable for this selection.'}
            </td></tr>}
          </tbody>
        </table>
      </div>
      {lastPage > 0 && <div className="trip-attendance-pages" aria-label="Attendance table pages">
        <span>{pageStart + 1}–{Math.min(pageStart + pageSize, rows.length)} of {rows.length} duties</span>
        <button type="button" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous</button>
        <button type="button" disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>Next</button>
      </div>}
    </section>
  </div>;
}
