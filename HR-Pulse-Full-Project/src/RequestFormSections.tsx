import {useEffect,useState,type ReactNode} from 'react';
import {Check} from 'lucide-react';
import {api,type Field} from './api';
import './requestProgress.css';
import {vtcProblem} from './vtc';

export const requestFormKinds=['leaveRequests','outDutyRequests','gatePasses','employeeTransfers','vtcRequests'];
type Data=Record<string,string|number>;
type Section={title:string;keys:string[]};

// The four numbered parts of the leave and OD forms; any field not listed goes in the last part.
export const formSections:Record<string,Section[]>={
  leaveRequests:[
    {title:'Employee',keys:['employeeId','employeeName','companyId','siteId']},
    {title:'Leave and dates',keys:['leaveTypeId','periodId','fromDate','toDate','halfDay','days']},
    {title:'Reason and handover',keys:['name','chargeHandedOverTo']},
    {title:'Attachment and review',keys:[]},
  ],
  outDutyRequests:[
    {title:'Employee',keys:['employeeId','name','companyId','department','designation','siteId']},
    {title:'Visit and dates',keys:['outDutyDate','toDate','visitLocation','purpose']},
    {title:'Authority and signature',keys:['authorityName','authoritySignature','employeeSignature','signatureDate']},
    {title:'Review',keys:[]},
  ],
  gatePasses:[
    {title:'Employee',keys:['employeeId','name','companyId','department','siteId']},
    {title:'Time out and return',keys:['passDate','passType','outTime','returnTime']},
    {title:'Reason',keys:['purpose']},
    {title:'Review',keys:[]},
  ],
  vtcRequests:[
    {title:'Site and driver / operator',keys:['siteId','employeeId']},
    {title:'Course and dates',keys:['course','courseOther','fromDate','toDate','vtcStatus']},
    {title:'Institute and certificate',keys:['institute','trainer','certificate']},
    {title:'Remarks and review',keys:[]},
  ],
  employeeTransfers:[
    {title:'Site and employee',keys:['fromSiteId','employeeId','transferDate']},
    {title:'Current posting (from Employee Master)',keys:['fromDesignation','fromManager']},
    {title:'New posting',keys:['toSiteId','toDesignation','toManager']},
    {title:'Reason and review',keys:[]},
  ],
};

const problemKeys=['toDate','returnTime','toSiteId'];
const filled=(v:unknown)=>String(v??'').trim()!=='';
const isRequired=(kind:string,field:Field,data:Data)=>kind==='vtcRequests'&&field.key==='courseOther'?data.course==='Other':!!field.required&&!(kind==='leaveRequests'&&field.key==='name'&&filled(data.reasonAudio));

export function dateProblem(kind:string,data:Data){
  if(kind==='vtcRequests')return vtcProblem(data);
  if(kind==='employeeTransfers')return data.fromSiteId&&data.fromSiteId===data.toSiteId?'To location must be different from the current location.':'';
  if(kind==='gatePasses'){const o=String(data.outTime||''),r=String(data.returnTime||'');return o&&r&&r<=o?'Expected return must be after the out time.':'';}
  const from=String(data[kind==='outDutyRequests'?'outDutyDate':'fromDate']||''),to=String(data.toDate||'');
  return from&&to&&to<from?'Date (to) must be on or after the from date.':'';
}

// Required fields still empty, in form order.
export function missingFields(kind:string,fields:Field[],data:Data){return fields.filter(f=>isRequired(kind,f,data)&&!filled(data[f.key]));}

export function formProgress(kind:string,fields:Field[],data:Data){
  const sections=formSections[kind]||[],listed=new Set(sections.flatMap(s=>s.keys));
  const groups=sections.map((s,i)=>({...s,fields:i===sections.length-1?fields.filter(f=>!listed.has(f.key)):s.keys.map(k=>fields.find(f=>f.key===k)).filter((f):f is Field=>!!f)}));
  const required=fields.filter(f=>isRequired(kind,f,data)),done=required.filter(f=>filled(data[f.key])).length,dates=dateProblem(kind,data);
  const complete=groups.map(g=>g.fields.every(f=>!isRequired(kind,f,data)||filled(data[f.key]))&&!(dates&&g.fields.some(f=>problemKeys.includes(f.key))));
  const current=complete.findIndex(c=>!c);
  return {groups,complete,current:current<0?groups.length-1:current,done,total:required.length,ready:done===required.length&&!dates};
}

type Preview={employee:{name:string;companyId:string;siteId:string;department:string;designation:string;reportingTo?:string};route:string[]|null;routeNote:string;missing?:string[]};

// Fills the chosen employee's details in and fetches the approval route the request would take.
function usePreview(grant:string,kind:string,employeeId:string,setData:(f:(d:Data)=>Data)=>void,autofill:boolean,siteId=''){
  const[preview,setPreview]=useState<Preview|null>(null),[failure,setFailure]=useState('');
  useEffect(()=>{
    setFailure('');if(!employeeId){setPreview(null);return;}
    let live=true;
    api<Preview>(grant,`request-preview?kind=${kind}&employeeId=${encodeURIComponent(employeeId)}`+(kind==='vtcRequests'?`&siteId=${encodeURIComponent(siteId)}`:'')).then(p=>{
      if(!live||!p?.employee)return;setPreview(p);
      /* VTC: the server reads the employee's details from Employee Master when the request is saved. */
      if(kind==='vtcRequests')return;
      /* Transfers: the From side is always the employee's current posting; department only narrows the manager list. */
      if(autofill)setData(d=>kind==='employeeTransfers'
        ?{...d,fromSiteId:p.employee.siteId||'',fromDesignation:p.employee.designation||d.fromDesignation||'',fromManager:p.employee.reportingTo||d.fromManager||'',department:p.employee.department||'',...(d.toSiteId&&d.toSiteId===p.employee.siteId?{toSiteId:'',toManager:''}:{})}
        :kind==='leaveRequests'
        ?{...d,companyId:p.employee.companyId||d.companyId||'',siteId:p.employee.siteId||d.siteId||''}
        :kind==='gatePasses'?{...d,name:p.employee.name||d.name||'',companyId:p.employee.companyId||d.companyId||'',siteId:p.employee.siteId||d.siteId||'',department:p.employee.department||d.department||''}
        :{...d,name:p.employee.name||d.name||'',companyId:p.employee.companyId||d.companyId||'',siteId:p.employee.siteId||d.siteId||'',department:d.department||p.employee.department||'',designation:d.designation||p.employee.designation||''});
    }).catch(e=>{if(live){setPreview(null);setFailure((e as Error).message||'Could not load the employee details.');}});
    return()=>{live=false;};
  },[grant,kind,employeeId,autofill,siteId]);// eslint-disable-line react-hooks/exhaustive-deps
  return {preview,failure};
}

export default function RequestFormSections({grant,kind,fields,data,setData,render,showMissing,writable}:{grant:string;kind:string;fields:Field[];data:Data;setData:(f:(d:Data)=>Data)=>void;render:(f:Field)=>ReactNode;showMissing:boolean;writable:boolean}){
  const p=formProgress(kind,fields,data),{preview,failure}=usePreview(grant,kind,String(data.employeeId||''),setData,writable,String(data.siteId||''));
  const missing=new Set(showMissing?missingFields(kind,fields,data).map(f=>f.key):[]),dates=dateProblem(kind,data);
  const pct=p.total?Math.round(p.done/p.total*100):100;
  const last=p.groups.length-1;
  return <div className="request-form">
    {writable&&<div className="request-form-progress" aria-live="polite">
      <div className="rfp-text"><span>{p.ready?'All required fields filled · ready to submit':`Step ${p.current+1} of ${p.groups.length} · ${p.groups[p.current]?.title}`}</span><span>{p.done} of {p.total} required filled</span></div>
      <div className="rfp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Form completion"><div className={p.ready?'full':''} style={{width:pct+'%'}}/></div>
    </div>}
    {p.groups.map((g,i)=><section key={g.title} className="request-form-section">
      <h3><span className={'rfs-num'+(p.complete[i]?' ok':i===p.current&&writable?' now':'')} aria-hidden="true">{p.complete[i]?<Check/>:i+1}</span>{g.title}</h3>
      {i===0&&writable&&data.employeeId&&(failure||preview?.missing?.length)?<p className="rfs-note" role="status">{failure?`Employee details could not be filled in: ${failure}`:`This employee has no ${preview?.missing?.join(' or ')} saved in Employee Master, so ${preview?.missing?.length===1?'it stays':'they stay'} blank. Choose ${preview?.missing?.length===1?'it':'them'} here, or update the employee record.`}</p>:null}
      {g.fields.length>0&&<div className="record-form">{g.fields.map(f=><div key={f.key} className={'rfs-field'+(missing.has(f.key)?' rfs-missing':'')}>{render(f)}{missing.has(f.key)&&<small className="rfs-error">Fill this field</small>}</div>)}</div>}
      {g.fields.some(f=>problemKeys.includes(f.key))&&dates&&<p className="rfs-error" role="alert">{dates}</p>}
      {i===last&&<div className="request-route"><span>{kind==='gatePasses'?'This pass will go to:':kind==='employeeTransfers'?'This transfer will go to:':'This request will go to:'}</span>{preview?.route?<ol>{preview.route.map((s,j)=><li key={j}>{s}</li>)}</ol>:<em>{data.employeeId?(preview?.routeNote||'Checking the approval route…'):'Choose the employee to see the approval route.'}</em>}</div>}
    </section>)}
    {missing.size>0&&<p className="rfs-error rfs-summary" role="alert">Fill the {missing.size===1?'field':missing.size+' fields'} marked in red.</p>}
  </div>;
}
