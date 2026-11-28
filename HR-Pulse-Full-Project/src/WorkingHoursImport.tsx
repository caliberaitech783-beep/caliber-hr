import {useEffect, useRef, useState} from 'react';
import {api} from './api';
import {readWorkingHoursSheets, type WorkingHoursEntry, type WorkingHoursProblem} from '../server/working-hours-sheet.mjs';

/* Working Hours from the sites' hour-wise Excel (owner, 28 Nov 2026): matched by Employee ID, and only Working Hours
   is written. Nothing is saved until the user has seen what will change and pressed Update. */
type HeldLine = {employeeId:string;name:string;sheet:string;row:number;hours:string;detail:string};
type HeldKey = 'notFound'|'twoLines'|'otherName'|'twoHours';
type Result = {
  applied:boolean;rows:number;people:number;updated:number;same:number;registerLines:number;joinedEmployees:number;
  held:Record<HeldKey,number>;lists:Record<HeldKey,HeldLine[]>;listLimit:number;
};
type Sheet = {sheet:string;rows:number;read:number;idColumn?:string;hoursColumn?:string;note?:string};
type Preview = {file:string;entries:WorkingHoursEntry[];problems:WorkingHoursProblem[];sheets:Sheet[];result:Result};

const heldTitles:Record<HeldKey,string> = {
  notFound:'Employee ID not in Employee Master',
  twoLines:'Employee ID on two lines of Employee Master',
  otherName:'A different name on this Employee ID',
  twoHours:'Two different hours for one Employee ID in the file',
};
const count = (value:number) => value.toLocaleString('en-IN');

export async function readWorkingHoursWorkbook(file:File) {
  const {read,utils} = await import('xlsx');
  const workbook = read(await file.arrayBuffer(),{type:'array'});
  return readWorkingHoursSheets(workbook.SheetNames.map(name=>({name,rows:utils.sheet_to_json<unknown[]>(workbook.Sheets[name],{header:1,defval:''})})));
}

export default function WorkingHoursImport({grant,disabled,onDone}:{grant:string;disabled?:boolean;onDone:(message:string)=>void}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [preview,setPreview] = useState<Preview>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element = dialog.current;
    if (!element || !preview) return;
    if (typeof element.showModal==='function' && !element.open) element.showModal(); else element.open = true;
  },[preview]);
  const send = (entries:WorkingHoursEntry[],apply:boolean) => api<Result>(grant,'employee-master-working-hours','POST',{apply,rows:entries});

  async function choose(file:File) {
    setBusy(true); setError(''); setPreview(undefined);
    try {
      if (!/\.xlsx?$/i.test(file.name)) throw new Error('Choose the hour-wise Excel file.');
      const sheets = await readWorkingHoursWorkbook(file);
      if (!sheets.entries.length) throw new Error('No Employee ID with working hours was found in this file.');
      setPreview({file:file.name,...sheets,result:await send(sheets.entries,false)});
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to read the working hours file.');
    } finally { setBusy(false); }
  }
  async function update() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      const result = await send(preview.entries,true);
      close();
      onDone(`Working Hours updated for ${count(result.updated)} employee${result.updated===1?'':'s'}. ${count(result.same)} already had the same hours. Nothing else was changed.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update working hours.');
    } finally { setBusy(false); }
  }
  function close() { dialog.current?.close?.(); setPreview(undefined); }

  const result = preview?.result, heldTotal = result ? Object.values(result.held).reduce((sum,value)=>sum+value,0) : 0;
  return <>
    <label className="file-label">{busy&&!preview?'Reading…':'Update Working Hours from Excel'}
      <input aria-label="Update Working Hours from Excel" type="file" accept=".xlsx,.xls" disabled={disabled||busy} onChange={event=>{
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void choose(file);
      }}/>
    </label>
    {error && !preview && <p role="alert" className="error">{error}</p>}
    {preview && result && <dialog ref={dialog} className="modal hr-register-details" aria-labelledby="working-hours-import-title"
      onCancel={event=>{event.preventDefault();if (!busy) close();}}>
      <div className="modal-heading">
        <h2 id="working-hours-import-title">Update Working Hours</h2>
        <button type="button" disabled={busy} onClick={close}>Cancel</button>
      </div>
      <p>{preview.file}: only Working Hours is written, matched by Employee ID. No employee is added, removed or moved and no other detail is changed.</p>
      <dl>
        <div><dt>Rows read from the file</dt><dd>{count(preview.entries.length)}</dd></div>
        <div><dt>Working Hours will be updated</dt><dd><strong>{count(result.updated)}</strong></dd></div>
        <div><dt>Already the same hours</dt><dd>{count(result.same)}</dd></div>
        <div><dt>Held, nothing changes for them</dt><dd>{count(heldTotal)}</dd></div>
        <div><dt>Rows of the file left out</dt><dd>{count(preview.problems.length)}</dd></div>
      </dl>
      <details>
        <summary>Sheets read</summary>
        <ul>{preview.sheets.map(sheet=><li key={sheet.sheet}>{sheet.sheet}: {sheet.note || `${count(sheet.read)} of ${count(sheet.rows)} rows (Employee ID from "${sheet.idColumn}", hours from "${sheet.hoursColumn}")`}</li>)}</ul>
      </details>
      {(Object.keys(heldTitles) as HeldKey[]).filter(key=>result.held[key]).map(key=><details key={key}>
        <summary>{heldTitles[key]}: {count(result.held[key])}</summary>
        <ul>{result.lists[key].map((line,index)=><li key={index}>{line.employeeId} {line.name} ({line.sheet} row {line.row}, {line.hours}){line.detail?` · ${line.detail}`:''}</li>)}</ul>
        {result.held[key]>result.lists[key].length && <p>The first {count(result.listLimit)} are shown.</p>}
      </details>)}
      {preview.problems.length>0 && <details>
        <summary>Rows of the file left out: {count(preview.problems.length)}</summary>
        <ul>{preview.problems.slice(0,300).map((line,index)=><li key={index}>{line.sheet} row {line.row}: {line.reason}{line.employeeId?` (${line.employeeId})`:''}</li>)}</ul>
      </details>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={close}>Cancel</button>
        <button type="button" className="primary" disabled={busy||!result.updated} onClick={()=>void update()}>
          {busy?'Updating…':`Update Working Hours of ${count(result.updated)} employee${result.updated===1?'':'s'}`}
        </button>
      </div>
    </dialog>}
  </>;
}
