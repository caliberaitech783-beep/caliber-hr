import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {api} from './api';
import type {Machine} from './BiometricMachines';

/* Delete a biometric machine (owner, 23 Nov 2026): one confirmation and the machine is removed at once.
   No Telegram approval or OTP (removed by the owner the same day). Punches already saved are kept. */
type Props={grant:string;machine:Machine;onClose:()=>void;onDeleted:(message:string)=>void};

export default function MachineDeleteDialog({grant,machine,onClose,onDeleted}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){
  if(busy)return;setBusy(true);setError('');
  try{await api(grant,'attendance/devices/delete','POST',{serial:machine.serial});onDeleted(`Machine ${machine.serial} deleted.`);onClose();}
  catch(e){setError((e as Error).message);setBusy(false);}
 }
 const rows:[string,string][]=[['Site',machine.siteName||'Not assigned'],['Machine location',machine.location||'—'],['Machine name',machine.name||'—'],
  ['Serial no.',machine.serial],['IP address',machine.ipAddress||'—'],['Bridge PC',machine.bridgeName||'Not connected yet']];
 return <div className="modal-backdrop"><section className="modal machine-delete-modal" role="dialog" aria-modal="true" aria-labelledby="machine-delete-title">
  <div className="modal-heading"><h2 id="machine-delete-title"><Trash2/>Delete machine {machine.serial}?</h2><button aria-label="Close" disabled={busy} onClick={onClose}>×</button></div>
  <dl className="machine-delete-details">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd className={k==='Serial no.'||k==='IP address'?'machine-serial':''}>{v}</dd></div>)}</dl>
  <p className="help-text">The machine is removed from Biometric machines at once. Its punches already saved are kept.</p>
  <div className="machine-delete-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button>
   <button type="button" className="danger" onClick={()=>void remove()} disabled={busy}><Trash2/>{busy?'Deleting…':'Delete machine'}</button></div>
  {error&&<p className="error" role="alert">{error}</p>}
 </section></div>;
}
