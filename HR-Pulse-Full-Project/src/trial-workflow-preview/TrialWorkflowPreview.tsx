import {useEffect,useRef,useState} from 'react';
import AadhaarUploader from '../AadhaarUploader';
import {mountTrialPreview} from './mount';
import type {Trial} from './records';

type Workflow = ReturnType<typeof mountTrialPreview>;

export default function TrialWorkflowPreview({owner,name,site,company,department,onCleared}: {
  owner: string; name: string; site: string; company: string; department: string; onCleared?: (rows: Trial[])=>Promise<void>;
}) {
  const host=useRef<HTMLDivElement>(null);
  const [workflow,setWorkflow] = useState<Workflow | null>(null);
  const [disabled,setDisabled] = useState(false);
  const [uploadVersion,setUploadVersion] = useState(0);
  const cleared=useRef(onCleared);
  cleared.current=onCleared;
  useEffect(()=>{
    const node=host.current;
    if (!node) return;
    const mounted = mountTrialPreview(node.shadowRoot||node.attachShadow({mode:'open'}),{owner,name,site,company,department},{
      reset: () => setUploadVersion(version => version + 1),
      setDisabled,
    },onCleared?rows=>cleared.current?.(rows):undefined);
    setDisabled(false);
    setWorkflow(mounted);
    return mounted.dispose;
  },[owner,name,site,company,department]);
  return <div ref={host} aria-label="Trial workflow local preview">
    {workflow && <div slot="aadhaar-upload">
      <AadhaarUploader key={uploadVersion} disabled={disabled} onBusy={workflow.setAadhaarBusy}
        fillDetails={workflow.fillAadhaarDetails} showScanInstructions={false}/>
    </div>}
  </div>;
}
