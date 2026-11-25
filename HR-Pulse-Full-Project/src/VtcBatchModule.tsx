import {useEffect,useRef,useState} from 'react';
import './vtc-batch-module.css';

type VtcView='batches'|'employee-form';

function VtcFrame({title,src}:{title:string;src:string}){
 const frame=useRef<HTMLIFrameElement>(null);
 const [height,setHeight]=useState(900);
 useEffect(()=>{
  const iframe=frame.current;if(!iframe)return;
  let observer:ResizeObserver|undefined;
  const fit=()=>{
   const document=iframe.contentDocument;if(!document)return;
   setHeight(Math.max(window.innerHeight-160,document.documentElement.scrollHeight,document.body.scrollHeight));
   if(typeof ResizeObserver!=='undefined'){
    observer?.disconnect();observer=new ResizeObserver(fit);observer.observe(document.body);observer.observe(document.documentElement);
   }
  };
  iframe.addEventListener('load',fit);if(iframe.contentDocument?.readyState==='complete')fit();
  window.addEventListener('resize',fit);
  return()=>{iframe.removeEventListener('load',fit);window.removeEventListener('resize',fit);observer?.disconnect();};
 },[src]);
 return <iframe ref={frame} title={title} src={src} style={{height}} sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-downloads"/>;
}

/** The VTC batch planner and the supplied employee VTC / IME form, hosted inside HR Pulse. */
export default function VtcBatchModule(){
 const [view,setView]=useState<VtcView>('batches');
 return <section className="vtc-batch-module" aria-label="VTC Batch Module">
  <nav className="vtc-module-options" aria-label="VTC module options">
   <button type="button" className={view==='batches'?'active':''} aria-pressed={view==='batches'} onClick={()=>setView('batches')}>VTC Batch Planner</button>
   <button type="button" className={view==='employee-form'?'active':''} aria-pressed={view==='employee-form'} onClick={()=>setView('employee-form')}>Employee VTC Form</button>
  </nav>
  {view==='batches'?<VtcFrame title="VTC Batch Module" src="./vtc-batch-module.html"/>:<VtcFrame title="Employee VTC Form" src="./employee-vtc-form.html"/>}
 </section>;
}
