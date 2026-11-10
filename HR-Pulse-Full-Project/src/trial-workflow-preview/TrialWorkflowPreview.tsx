import {useEffect,useRef} from 'react';
import {mountTrialPreview} from './mount';

export default function TrialWorkflowPreview({owner,name,site,company,department}: {
  owner: string; name: string; site: string; company: string; department: string;
}) {
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=host.current;
    if (!node) return;
    return mountTrialPreview(node.shadowRoot||node.attachShadow({mode:'open'}),{owner,name,site,company,department});
  },[owner,name,site,company,department]);
  return <div ref={host} aria-label="Trial workflow local preview"/>;
}
