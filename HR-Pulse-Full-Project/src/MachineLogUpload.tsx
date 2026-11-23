import {useMemo,useRef,useState,type DragEvent} from 'react';
import {Check,FileText,Sparkles,Upload,X} from 'lucide-react';
import {api} from './api';
import {pickMachine,readMachineLog,type CheckedMachine,type MachineLog,type MachinePick} from './biometricImport';
import './machine-log-upload.css';

/* Upload machine log (owner, 23 Nov 2026): the .dat a site downloads from a machine on a USB stick (or a CSV / text
   punch list) goes in as it is. Step 1 drops one or more files; they are read in the browser. Step 2 shows, per file,
   the machine it came from (serial or machine no. in the file name, the site's only machine, or the machine that
   already knows most of its employee IDs; changeable), its punches, dates and employees, the IDs not linked yet and a
   sample, then Import sends them in parts of 2000. Nothing is saved before Import. */
const CHUNK=2000,MAX_IDS=5000,SAMPLE=8;
const show=(day:string)=>day.slice(8,10)+'-'+day.slice(5,7)+'-'+day.slice(0,4);
type Loaded={log:MachineLog;pick:MachinePick;serial:string};
type Props={grant:string;site:string;onClose:()=>void;onImported:(message:string,range:{from:string;to:string})=>void;onManageMachines?:()=>void};

export default function MachineLogUpload({grant,site,onClose,onImported,onManageMachines}:Props){
 const input=useRef<HTMLInputElement>(null);
 const [files,setFiles]=useState<Loaded[]>([]),[machines,setMachines]=useState<CheckedMachine[]|null>(null);
 const [reading,setReading]=useState(false),[importing,setImporting]=useState(''),[error,setError]=useState(''),[dragging,setDragging]=useState(false),[tried,setTried]=useState(false);

 async function add(list:File[]){
  if(!list.length||reading||importing)return;
  setReading(true);setError('');setTried(false);
  try{
   const logs:MachineLog[]=[],problems:string[]=[];
   for(const file of list){try{logs.push(readMachineLog(file.name,await file.text()));}catch(e){problems.push((e as Error).message);}}
   const all=[...files.map(f=>f.log),...logs];
   const ids=[...new Set(all.flatMap(l=>l.ids))].slice(0,MAX_IDS);
   const check=await api<{machines:CheckedMachine[]}>(grant,'attendance/punches/import/check','POST',{site,ids});
   const found=Array.isArray(check?.machines)?check.machines:[];
   setMachines(found);
   // Files already on the list keep a machine chosen by hand.
   setFiles(all.map(log=>{const old=files.find(f=>f.log===log),pick=pickMachine(log,found);return old&&old.serial!==old.pick.serial?{...old,pick}:{log,pick,serial:pick.serial};}));
   if(problems.length)setError(problems.join(' · '));
  }catch(e){setError((e as Error).message);}
  finally{setReading(false);}
 }
 const drop=(event:DragEvent)=>{event.preventDefault();setDragging(false);void add([...event.dataTransfer.files]);};
 const choose=(index:number,serial:string)=>{setFiles(list=>list.map((f,i)=>i===index?{...f,serial}:f));setTried(false);};
 const remove=(index:number)=>setFiles(list=>list.filter((_,i)=>i!==index));

 const byId=useMemo(()=>new Map((machines||[]).map(m=>[m.serial,new Map(m.ids.map(i=>[i.biometricId,i]))])),[machines]);
 const serialOf=(f:Loaded)=>(row:{serial:string})=>row.serial||f.serial;
 const summary=useMemo(()=>{
  let punches=0,linked=0;const unlinked=new Set<string>(),people=new Set<string>();
  for(const f of files){
   punches+=f.log.rows.length;
   const known=byId.get(f.serial);
   for(const id of f.log.ids){people.add(f.serial+'|'+id);if(known?.get(id)?.employeeName)linked++;else unlinked.add(id);}
  }
  const days=files.flatMap(f=>[f.log.from,f.log.to]).sort();
  return {punches,linked,unlinked:[...unlinked].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),people:people.size,from:days[0]||'',to:days[days.length-1]||''};
 },[files,byId]);
 const sample=files.flatMap(f=>f.log.rows.slice(0,SAMPLE).map(row=>({row,serial:serialOf(f)(row),file:f.log.fileName}))).slice(0,SAMPLE);
 const missing=files.filter(f=>f.log.needsMachine&&!f.serial);
 const label=(m:CheckedMachine)=>[m.machineNo?`No. ${m.machineNo}`:'',m.name||m.location,m.serial].filter(Boolean).join(' · ');

 async function send(){
  setTried(true);
  if(!files.length||missing.length||importing)return;
  setError('');
  const rows=files.flatMap(f=>f.log.rows.map(row=>({...row,serial:row.serial||f.serial})));
  let received=0,added=0;
  try{
   for(let at=0;at<rows.length;at+=CHUNK){
    setImporting(`Importing ${Math.min(at+CHUNK,rows.length).toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} punches…`);
    const part=await api<{received:number;added:number}>(grant,'attendance/punches/import','POST',{site,rows:rows.slice(at,at+CHUNK)});
    received+=Number(part.received)||0;added+=Number(part.added)||0;
   }
   const same=received-added;
   onImported(`${added.toLocaleString('en-IN')} new biometric punch${added===1?'':'es'} imported from ${files.length===1?files[0].log.fileName:files.length+' files'}${same?` · ${same.toLocaleString('en-IN')} already in HR Pulse`:''}.`,{from:summary.from,to:summary.to});
   onClose();
  }catch(e){setError(`Import stopped after ${received.toLocaleString('en-IN')} punches: ${(e as Error).message}`);}
  finally{setImporting('');}
 }

 const busy=reading||Boolean(importing);
 return <div className="modal-backdrop"><section className="modal machine-log-upload" role="dialog" aria-modal="true" aria-labelledby="machine-log-title">
  <div className="modal-heading"><h2 id="machine-log-title"><Upload/>Upload machine log · {site}</h2><button type="button" aria-label="Close" disabled={Boolean(importing)} onClick={onClose}>×</button></div>

  <div className={'machine-log-drop'+(dragging?' dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={drop}>
   <Upload aria-hidden="true"/>
   <p><b>Drop .dat files here</b> or <button type="button" className="machine-log-link" disabled={busy} onClick={()=>input.current?.click()}>choose files</button></p>
   <small>The attlog.dat from the machine’s USB download, as it is. Several files at once. CSV and text punch lists work too.</small>
   <input ref={input} hidden type="file" multiple accept=".dat,.txt,.csv,text/plain,text/csv,application/octet-stream" aria-label="Machine log files" onChange={e=>{const list=[...(e.target.files||[])];e.target.value='';void add(list);}}/>
  </div>
  {reading&&<p className="machine-log-note" role="status">Reading files and checking {site}’s machines…</p>}
  {error&&<p className="error" role="alert">{error}</p>}
  {machines&&!machines.length&&<p className="error" role="alert">{site} has no biometric machine in Machine master yet. Add the machine there, then upload again.{onManageMachines&&<> <button type="button" className="machine-log-link" onClick={()=>{onClose();onManageMachines();}}>Open Machine master</button></>}</p>}

  {files.length>0&&<>
   <h3>Check before import</h3>
   <ul className="machine-log-files">{files.map((f,index)=>{
    const pick=f.serial===f.pick.serial?f.pick:null,needs=f.log.needsMachine;
    return <li key={f.log.fileName+index} className={needs&&!f.serial&&tried?'invalid':''}>
     <div className="machine-log-file-head">
      <span className="machine-log-name"><FileText aria-hidden="true"/>{f.log.fileName}</span>
      {!needs?<span className="machine-log-pill ok"><Check aria-hidden="true"/>Machine serial in the file</span>
       :pick?.reason==='file-name'?<span className="machine-log-pill ok"><Check aria-hidden="true"/>Serial in the file name</span>
       :pick?.reason==='machine-no'?<span className="machine-log-pill ok"><Check aria-hidden="true"/>Machine no. in the file name</span>
       :pick?.reason==='only'?<span className="machine-log-pill ok"><Check aria-hidden="true"/>{site}’s only machine</span>
       :pick?.reason==='ids'?<span className="machine-log-pill guess"><Sparkles aria-hidden="true"/>Best match by employee IDs · {pick.matched} of {f.log.ids.length}</span>
       :f.serial?<span className="machine-log-pill ok"><Check aria-hidden="true"/>Chosen</span>
       :<span className="machine-log-pill warn">Choose the machine</span>}
      <button type="button" className="machine-log-remove" aria-label={`Remove ${f.log.fileName}`} disabled={busy} onClick={()=>remove(index)}><X/></button>
     </div>
     {needs&&machines&&machines.length>0&&<label className="machine-log-machine">Machine<select value={f.serial} disabled={busy} aria-invalid={!f.serial&&tried} onChange={e=>choose(index,e.target.value)}>
      <option value="">Choose the machine this file came from…</option>{machines.map(m=><option key={m.serial} value={m.serial}>{label(m)}</option>)}
     </select></label>}
     <small>{f.log.rows.length.toLocaleString('en-IN')} punch{f.log.rows.length===1?'':'es'} · {show(f.log.from)} to {show(f.log.to)} · {f.log.ids.length} employee{f.log.ids.length===1?'':'s'}{f.log.skipped.length?` · ${f.log.skipped.length} line${f.log.skipped.length===1?'':'s'} left out (not a punch: line ${f.log.skipped.slice(0,5).join(', ')}${f.log.skipped.length>5?'…':''})`:''}</small>
    </li>;})}
   </ul>
   {tried&&missing.length>0&&<p className="error" role="alert">Choose the machine for {missing.map(f=>f.log.fileName).join(', ')}.</p>}

   <div className="machine-log-stats">
    <div><span>Punches</span><b>{summary.punches.toLocaleString('en-IN')}</b></div>
    <div><span>Dates</span><b>{show(summary.from)} to {show(summary.to)}</b></div>
    <div><span>Employees linked</span><b>{summary.linked}</b></div>
    <div className={summary.unlinked.length?'warn':''}><span>IDs not linked</span><b>{summary.unlinked.length}</b></div>
   </div>
   {summary.unlinked.length>0&&<p className="machine-log-warn">{summary.unlinked.length} machine ID{summary.unlinked.length===1?'':'s'} ({summary.unlinked.slice(0,12).join(', ')}{summary.unlinked.length>12?'…':''}) {summary.unlinked.length===1?'is':'are'} not linked to an employee. Their punches are saved too and show with the employee once linked in Machine punches.</p>}

   <div className="attendance-table"><table aria-label="Punches to import (sample)">
    <thead><tr><th>Machine ID</th><th>Employee</th><th>Punch time</th><th>Machine</th></tr></thead>
    <tbody>{sample.map(({row,serial},i)=>{const who=byId.get(serial)?.get(row.biometricId),m=machines?.find(x=>x.serial===serial);return <tr key={i}>
     <td>{row.biometricId}</td>
     <td className={who?.employeeName?'':'attendance-unlinked'}>{who?.employeeName?`${who.employeeCode} · ${who.employeeName}`:row.name||who?.machineName?`Not linked (${row.name||who?.machineName})`:'Not linked'}</td>
     <td>{show(row.punchedAt.slice(0,10))} {row.punchedAt.slice(11)}</td>
     <td>{m?m.name||m.location||m.serial:serial||'—'}</td>
    </tr>;})}</tbody>
   </table></div>
   {summary.punches>sample.length&&<small className="machine-log-note">First {sample.length} of {summary.punches.toLocaleString('en-IN')} punches. Punches already in HR Pulse are skipped on import.</small>}
  </>}

  <div className="machine-log-actions">
   {importing&&<span className="machine-log-note" role="status">{importing}</span>}
   <button type="button" disabled={Boolean(importing)} onClick={onClose}>Cancel</button>
   <button type="button" className="primary" disabled={!files.length||busy} onClick={()=>void send()}><Upload/>{importing?'Importing…':`Import ${summary.punches.toLocaleString('en-IN')} punch${summary.punches===1?'':'es'}`}</button>
  </div>
 </section></div>;
}
