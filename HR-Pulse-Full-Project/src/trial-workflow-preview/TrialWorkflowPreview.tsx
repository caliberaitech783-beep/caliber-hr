import {useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import AadhaarUploader from '../AadhaarUploader';
import DrivingLicenceUploader from '../DrivingLicenceUploader';
import {savedSession} from '../api';
import {mountTrialPreview,type PrepareJoining} from './mount';
import {fetchTrialTrainer} from './telegramSend';
import type {TrialChecklistDocuments} from '../trialHandoff';

type Workflow = ReturnType<typeof mountTrialPreview>;

export default function TrialWorkflowPreview({owner,legacyOwner,name,site,region,group,company,department,designation='',onCleared}: {
  owner: string; legacyOwner?: string; name: string; site: string; region: string; group: string; company: string; department: string; designation?:string; onCleared?: (rows:Parameters<PrepareJoining>[0],documents:TrialChecklistDocuments)=>ReturnType<PrepareJoining>;
}) {
  const host=useRef<HTMLDivElement>(null);
  const [workflow,setWorkflow] = useState<Workflow | null>(null);
  const [disabled,setDisabled] = useState(false);
  const [uploadVersion,setUploadVersion] = useState(0);
  const [uploadMenu,setUploadMenu] = useState<'root'|'aadhaar'|'front'|'back'|'complete'>();
  const [aadhaarFile,setAadhaarFile] = useState<File>();
  const [licenceFront,setLicenceFront] = useState<File>();
  const checklistDocuments=useRef<TrialChecklistDocuments>({});
  checklistDocuments.current={aadhaar:aadhaarFile,drivingLicence:licenceFront};
  const signerName=name||savedSession()?.profile?.name||savedSession()?.profile?.username||'';
  const cleared=useRef(onCleared);
  cleared.current=onCleared;
  useEffect(()=>{
    const node=host.current;
    if (!node) return;
    const mounted = mountTrialPreview(node.shadowRoot||node.attachShadow({mode:'open'}),{owner,legacyOwner,name:signerName,site,region,group,company,department,designation},{
      reset: () => {setUploadVersion(version => version + 1);setAadhaarFile(undefined);setLicenceFront(undefined);},
      setDisabled,
      documents:()=>checklistDocuments.current,
    },onCleared?async rows=>cleared.current?.(rows,checklistDocuments.current):undefined);
    setDisabled(Boolean(savedSession()?.grant));
    setWorkflow(mounted);
    let active=true;
    const refreshTrainer=()=>{
      if(!savedSession()?.grant)return;
      void fetchTrialTrainer({site,region,group,company,department})
        .then(trainer=>{if(active){mounted.setTrainer(trainer.name,trainer.reason);mounted.setTrainers(trainer.trainers||[]);mounted.setRoles(trainer.roles,trainer.overview);}})
        .catch(error=>{if(active){mounted.setTrainer('',error instanceof Error?error.message:'Could not load the Driver Trainer hierarchy.');mounted.setRoles([]);}});
    };
    window.addEventListener('focus',refreshTrainer);
    if(savedSession()?.grant){
      void fetchTrialTrainer({site,region,group,company,department})
        .then(trainer=>{if(active){mounted.setTrainer(trainer.name,trainer.reason);mounted.setTrainers(trainer.trainers||[]);mounted.setRoles(trainer.roles,trainer.overview);}})
        .catch(error=>{if(active){mounted.setTrainer('',error instanceof Error?error.message:'Could not load the Driver Trainer hierarchy.');mounted.setRoles([]);}});
    } else mounted.setTrainer(signerName);
    return ()=>{active=false;window.removeEventListener('focus',refreshTrainer);mounted.dispose();};
  },[owner,legacyOwner,signerName,site,region,group,company,department]);
  useEffect(()=>{
    const preview=host.current?.shadowRoot;
    if(!preview)return;
    const vehicle=({'Loader Operator':'Loader','Dumper Operator':'Dumper/Tipper','Grader Operator':'Grader','Excavator Operator':'Excavator','Drill Operator':'Other'} as Record<string,string>)[designation];
    preview.querySelectorAll<HTMLInputElement>('input[name="f_vehicle"]').forEach(input=>{input.checked=input.value===vehicle;});
    const other=preview.querySelector<HTMLInputElement>('#f_vother');
    if(other){other.hidden=vehicle!=='Other';other.value=vehicle==='Other'?'Drill':'';}
  },[designation,workflow]);
  return <div ref={host} aria-label="Trial workflow local preview">
    {workflow && <div slot="aadhaar-upload" className="trial-document-uploads">
      <div className="trial-document-menu">
        <button disabled={disabled} type="button" className="employee-import" aria-expanded={Boolean(uploadMenu)} onClick={()=>setUploadMenu(menu=>menu?undefined:'root')}><Upload/>Upload A/D</button>
        {uploadMenu==='root'&&<div className="aadhaar-source-menu trial-document-options">
          <button type="button" onClick={()=>setUploadMenu('aadhaar')}>Upload Aadhaar Image</button>
          <button type="button" onClick={()=>setUploadMenu('front')}>Upload Front Driving License Image</button>
          <button type="button" onClick={()=>setUploadMenu('back')}>Upload Back Driving License Image</button>
          <button type="button" onClick={()=>setUploadMenu('complete')}>Upload Complete Driving License</button>
        </div>}
      </div>
      <AadhaarUploader key={uploadVersion} disabled={disabled} onBusy={workflow.setAadhaarBusy} photo={aadhaarFile} onPhoto={setAadhaarFile}
        fillDetails={workflow.fillAadhaarDetails} showScanInstructions={false}
        primaryButtonLabel="Upload Aadhar Image" combineSides hideSecond hidePrimary openMenu={uploadMenu==='aadhaar'} onMenuChange={open=>!open&&setUploadMenu(undefined)}/>
      <DrivingLicenceUploader key={'dl-'+uploadVersion} disabled={disabled} onBusy={workflow.setDrivingLicenceBusy} onFront={setLicenceFront} allowComplete
        onReady={workflow.setDrivingLicenceReady} onDetails={workflow.fillDrivingLicenceDetails} hideLaunchers openMenu={uploadMenu==='front'||uploadMenu==='back'||uploadMenu==='complete'?uploadMenu:undefined} onMenuChange={menu=>!menu&&setUploadMenu(undefined)}/>
    </div>}
  </div>;
}
