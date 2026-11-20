import {Fragment, useEffect, useState} from 'react';
import {Pencil, RefreshCw} from 'lucide-react';
import {api} from './api';
import {mapMisAttendance, type AttendanceRow, type CorrectionStatus} from './misAttendanceModel';
import {DEFAULT_POLICY, dutyStatus, workedMinutes, type AttendancePolicy} from '../server/attendance-policy.mjs';
import './mis-attendance.css';

const DUTY: Record<string, string> = {A: 'Absent', HD: 'Half duty', P: 'Full duty'};
/** Trip card / logbook hours rated with the attendance policy (lunch excluded). */
export const logbookDuty = (startMs: number, endMs: number, policy: AttendancePolicy = DEFAULT_POLICY) =>
  DUTY[dutyStatus(workedMinutes(0, Math.round((endMs - startMs) / 60_000), policy), policy)];

const startOfRecords = '2026-11-01';
const dateInIndia = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const displayDate = (date: string) => date.split('-').reverse().join('-');
const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
const columns = ['Date', 'Employee', 'Type', 'Equipment / vehicle', 'Time', 'Output', 'Hours', 'Status', 'Verification', 'OT'];
const refreshMs = 30_000;
const pageSize = 100;

export default function MisAttendance({grant, shiftManagement=false, overtimeOnly=false, policy=DEFAULT_POLICY}: {grant: string; shiftManagement?: boolean; overtimeOnly?: boolean; policy?: AttendancePolicy}) {
  const today = dateInIndia();
  const latest = today < startOfRecords ? startOfRecords : today;
  const [date, setDate] = useState(latest);
  const [site, setSite] = useState('');
  const [shift, setShift] = useState('');
  const [search, setSearch] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{date: string; rows: AttendanceRow[]; updated: Date; canEdit: boolean}>();
  const [failure, setFailure] = useState<{date: string; message: string}>();
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AttendanceRow>();
  const [status, setStatus] = useState<CorrectionStatus>('mis');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [saved, setSaved] = useState('');
  const valid = date >= startOfRecords && date <= latest;
  const error = failure?.date === date ? failure.message : '';

  function selectDate(next: string) {
    setDate(next);
    setPage(0);
    setEditing(undefined);
    setSaved('');
  }

  useEffect(() => {
    if (!valid) return;
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      setLoading(true);
      try {
        const query = new URLSearchParams({from: date, to: date});
        const data = await api<{canEdit: boolean}>(grant, 'attendance/mis?' + query);
        const rows = mapMisAttendance(data).filter(row => row.date === date);
        if (lifetime.signal.aborted) return;
        setResult({date, rows, updated: new Date(), canEdit: data.canEdit});
        setFailure(undefined);
      } catch (error) {
        if (!lifetime.signal.aborted) {
          setFailure({date, message: (error as Error).message});
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
  }, [date, valid, refresh, grant]);

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

  const current = result?.date === date ? result : undefined;
  const awaitingResult = valid && !current && !error;
  const all = current?.rows || [];
  const sites = [...new Set(all.map(row => row.site))];
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

  return <div className="trip-attendance">
    <section className="data-card trip-attendance-card" aria-labelledby="trip-card-heading">
      <div className="trip-attendance-header">
        <div>
          <h2 id="trip-card-heading">{shiftManagement ? 'Shift roster' : overtimeOnly ? 'Overtime' : 'Trip cards & driver logbooks'}</h2>
          <p>Closed MIS batches verify attendance. Two verified back-to-back 8-hour shifts give 8 hours of OT.{!shiftManagement && !overtimeOnly &&
            ` Logbook hours follow the attendance policy: less a ${policy.lunchMinutes} min lunch, under ${policy.absentBelowHours} h is absent, ${policy.fullDutyHours} h or more is full duty, otherwise half duty. The first trip / logbook start counts as the In punch.`}</p>
        </div>
        <button type="button" className="trip-attendance-refresh" disabled={loading || !valid} onClick={() => setRefresh(n => n + 1)}>
          <RefreshCw size={16} aria-hidden="true"/> {loading && valid ? 'Syncing…' : 'Refresh MIS'}
        </button>
      </div>
      <div className="trip-attendance-filters">
        <label>Attendance date<input type="date" min={startOfRecords} max={latest} value={date} disabled={saving} onChange={e => selectDate(e.target.value)}/></label>
        <div className="trip-attendance-day-buttons" aria-label="Browse attendance dates">
          <button type="button" disabled={!valid || date === startOfRecords || saving} onClick={() => selectDate(shiftDate(date, -1))}>Previous day</button>
          <button type="button" disabled={!valid || date === latest || saving} onClick={() => selectDate(shiftDate(date, 1))}>Next day</button>
        </div>
        <label>Site<select value={activeSite} onChange={e => {setSite(e.target.value); setPage(0);}}>
          <option value="">All sites</option>
          {sites.map(name => <option key={name}>{name}</option>)}
        </select></label>
        {shiftManagement && <label>Shift<select value={activeShift} onChange={e => {setShift(e.target.value); setPage(0); setEditing(undefined);}}><option value="">All shifts</option>{shifts.map(value => <option key={value}>{value}</option>)}</select></label>}
        <label>Employee<input type="search" value={search} placeholder="Search name or code" onChange={e => {setSearch(e.target.value); setPage(0);}}/></label>
        <label className="trip-attendance-checkbox"><input type="checkbox" checked={pendingOnly} onChange={e => {setPendingOnly(e.target.checked); setPage(0);}}/> Pending only</label>
      </div>
      {!valid && <p role="alert" className="trip-attendance-feedback">Choose an attendance date from 1 November 2026 through today.</p>}
      {valid && error && <p role="alert" className="trip-attendance-feedback">{current && 'Showing the last successful sync. '}{error}</p>}
      {saved && <p className="trip-attendance-saved" role="status">{saved}</p>}
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
              <td>{row.window ? <>{`${(row.window.endMs - row.window.startMs) / 3_600_000} h`}{row.status !== 'Absent' && <small>{logbookDuty(row.window.startMs, row.window.endMs, policy)}</small>}</> : '—'}</td>
              <td><span className={`trip-attendance-tag ${row.status === 'Absent' ? 'trip-absent' : row.verified ? 'trip-present' : 'trip-pending'}`}>{row.status}</span></td>
              <td>{row.verification}{row.correction && <small>{row.correction.reason} · {row.correction.updatedBy}</small>}</td>
              <td className="trip-attendance-ot" title={row.otNote || undefined}>{row.otHours === null ? '—' : `${row.otHours} h`}{row.otNote && <small>{row.otNote}</small>}</td>
              {current?.canEdit && <td><button type="button" className="trip-attendance-edit" disabled={saving}
                aria-label={`Edit ${row.employeeName}, ${row.date}, ${row.shift}`} aria-expanded={editing?.id === row.id} onClick={() => {
                  setEditing(row); setStatus(row.correction?.status || 'mis'); setEditError(''); setSaved('');
                }}><Pencil size={14} aria-hidden="true"/> Edit</button></td>}
            </tr>
            {editing?.id === row.id && <tr><td colSpan={columns.length + 1}>
              <form className="trip-attendance-editor" onSubmit={saveCorrection} aria-label={`Edit attendance for ${row.employeeName}`}>
                <label>Status<select value={status} onChange={event => setStatus(event.target.value as CorrectionStatus)}>
                  <option value="mis">Use MIS</option><option value="present">Present</option>
                  <option value="absent">Absent</option><option value="pending">Pending</option>
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
