import {useEffect,useRef,useState} from 'react';
import {Printer,Save} from 'lucide-react';
import {AadhaarUpload} from './EmployeeLocation';
import './trial-form.css';

/* Trial Joining Form – Driver & Operator. Mirrors Trial_Joining_Form_Driver_Operator.docx.
   Shown under Employee Master when the top bar's department is Driver or Operator. */
export type TrialSelection={employeeGroup:'Corporate / HO'|'OB / COAL';company:string;region:string;site:string;department:string;subdepartment:string;designation:string};
const SELECTION_KEY='hrPulse.employeeSelection',DRAFT_KEY='hrPulse.trialForm',COUNTER_KEY='hrPulse.trialForm.counter';
const companyShort:Record<string,string>={'Caliber Mining And Logistics Ltd':'CMLL','Caliber Mining And Logistics Ltd SCR JV':'CMPL SCR JV','KSR FREIGHT CARRIERS':'KSR','CHADDA TRADING COMPANY':'CHADDA TRADING CO.'};
export const emptySelection:TrialSelection={employeeGroup:'Corporate / HO',company:'',region:'',site:'',department:'',subdepartment:'',designation:''};
export function loadSelection():TrialSelection{try{return {...emptySelection,...JSON.parse(sessionStorage.getItem(SELECTION_KEY)||'{}')};}catch{return emptySelection;}}
export function saveSelection(selection:TrialSelection){try{sessionStorage.setItem(SELECTION_KEY,JSON.stringify(selection));}catch{/* storage unavailable */}}
export const showsTrialForm=(selection:TrialSelection)=>['Driver','Operator'].includes(selection.department);
function fiscalYear(){const d=new Date(),start=d.getMonth()<3?d.getFullYear()-1:d.getFullYear();return `${start}-${String(start+1).slice(-2)}`;}
function nextFormNo(){let n=0;try{n=Number(localStorage.getItem(COUNTER_KEY)||0)+1;localStorage.setItem(COUNTER_KEY,String(n));}catch{n=Date.now()%10000;}return `TF/${fiscalYear()}/${String(n).padStart(4,'0')}`;}
function age(dob:string){const d=new Date(dob+'T00:00:00');if(Number.isNaN(d.valueOf()))return '';const now=new Date();let a=now.getFullYear()-d.getFullYear();if(now<new Date(now.getFullYear(),d.getMonth(),d.getDate()))a--;return `${a} yrs`;}
const digits=(v:string,max:number)=>v.replace(/\D/g,'').slice(0,max);

export default function TrialForm({selection}:{selection:TrialSelection}){
 const form=useRef<HTMLFormElement>(null),[step,setStep]=useState(0),[photo,setPhoto]=useState<File|undefined>(),[photo2,setPhoto2]=useState<File|undefined>(),[formNo]=useState(()=>{try{return sessionStorage.getItem(DRAFT_KEY+'.no')||'';}catch{return '';}}),[saved,setSaved]=useState(''),[error,setError]=useState(''),
 const no=useRef(formNo);if(!no.current){no.current=nextFormNo();try{sessionStorage.setItem(DRAFT_KEY+'.no',no.current);}catch{/* ignore */}}
 const heading=`${companyShort[selection.company]||selection.company||'CMLL'}  –  ${(selection.site||'SITE').toUpperCase()}`;
 /* After the Aadhaar is read into the hidden joining-style fields, copy them into the trial form and open it. */
 useEffect(()=>{const f=form.current;if(!f)return;const copy=()=>{const v=(n:string)=>(f.elements.namedItem(n) as HTMLInputElement|null)?.value||'';const set=(n:string,val:string)=>{const el=f.elements.namedItem(n) as HTMLInputElement|null;if(el&&!el.value&&val)el.value=val;};
  set('Name of candidate',v('Full Name as per Aadhaar')||v('Full Name'));set("Father's name",v('Father / Spouse Name'));const dob=v('Date of Birth');if(dob)set('Date of birth / Age',`${dob.split('-').reverse().join('/')}${age(dob)?' · '+age(dob):''}`);set('Aadhaar no.',digits(v('Aadhaar No.'),12));set('Address',v('Permanent Address'));
  };
  f.addEventListener('change',copy);return()=>f.removeEventListener('change',copy);},[]);
 useEffect(()=>{const f=form.current;if(!f)return;const post=f.elements.namedItem('Post applied for') as RadioNodeList|null;if(post&&!post.value&&['Driver','Operator'].includes(selection.department))post.value=selection.department;},[selection.department,step]);
 function save(){const f=form.current;if(!f)return;setError('');const data:Record<string,string>={};for(const el of Array.from(f.elements)){if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement)||!el.name||el.type==='file')continue;if(el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)){if(el.checked)data[el.name]=(data[el.name]?data[el.name]+', ':'')+el.value;continue;}data[el.name]=el.value;}
  if(!data['Name of candidate']){setError('Candidate name is required.');return;}
  const record={formNo:no.current,heading,...selection,savedAt:new Date().toISOString(),fields:data};
  try{const list=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');list.unshift(record);localStorage.setItem(DRAFT_KEY,JSON.stringify(list.slice(0,200)));}catch{/* ignore */}
  setSaved(`Trial form ${no.current} saved for ${data['Name of candidate']} · ${heading}${data['Result']?' · Result: '+data['Result']:''}.`);}
 const Row=({label,name,children,span}:{label:string;name?:string;children?:React.ReactNode;span?:number})=><tr><td>{label}</td><td colSpan={span}>{children||<input name={name||label}/>}</td></tr>;
 const Chk=({name,options}:{name:string;options:string[]})=><span className="tf-chk">{options.map(o=><label key={o}><input type="checkbox" name={name} value={o}/> {o}</label>)}</span>;
 const Radio=({name,options}:{name:string;options:string[]})=><span className="tf-chk">{options.map(o=><label key={o}><input type="radio" name={name} value={o}/> {o}</label>)}</span>;
 const YesNo=({name}:{name:string})=><select name={name} defaultValue=""><option value="">Select</option><option>Yes</option><option>No</option></select>;
 return <div className="joining-form trial-form"><form ref={form} noValidate onSubmit={e=>{e.preventDefault();save();}}>
  <div className="joining-steps" style={{gridTemplateColumns:'repeat(2,minmax(0,1fr))'}}><button type="button" className={step===0?'active':''} onClick={()=>setStep(0)}><i>1</i><span>Upload Aadhaar Card</span></button><button type="button" className={step===1?'active':''} onClick={()=>setStep(1)}><i>2</i><span>Trial Joining Form – Driver &amp; Operator</span></button></div>
  <div className="joining-card">
   <div hidden={step!==0}>
    <div className="joining-heading"><div><h2>Trial Form – Upload Aadhaar Card</h2><p>Same procedure as the joining form. Candidate name, father's name, date of birth, Aadhaar number and address are filled into the trial form from the Aadhaar.</p></div></div>
    <AadhaarUpload form={form} photo={photo} photo2={photo2} onPhoto={setPhoto} onPhoto2={setPhoto2}/>
    {/* hidden joining-style fields that AadhaarUpload fills */}
    <div hidden>{['Full Name','Full Name as per Aadhaar','Father / Spouse Name','Date of Birth','Gender','Aadhaar No.','Permanent Address'].map(n=><input key={n} name={n} readOnly/>)}</div>
    <div className="joining-actions"><button type="button" disabled>Previous</button><button type="button" className="next" onClick={()=>setStep(1)}>Save &amp; Continue</button></div>
   </div>
   <div hidden={step!==1}>
    <div className="tf">
     <div className="tf-hd"><b>{heading.split('  –  ')[0]}</b><span className="tf-site">{heading.split('  –  ')[1]}</span></div>
     <h3>TRIAL JOINING FORM – DRIVER &amp; OPERATOR</h3><p className="tf-note">Candidate joins only after the vehicle / machine trial result is PASS.</p>
     <h4>1. CANDIDATE DETAILS</h4>
     <table><tbody>
      <tr><td>Form No.</td><td><input name="Form No." value={no.current} readOnly className="tf-ro"/></td><td className="tf-photo" rowSpan={7}>Paste / Photo</td></tr>
      <Row label="Name of candidate"/><Row label="Father's name"/><Row label="Date of birth / Age"/>
      <Row label="Mobile no."><input name="Mobile no." inputMode="numeric" maxLength={10} placeholder="10-digit mobile" onInput={e=>{const i=e.currentTarget;i.value=digits(i.value,10);}}/></Row>
      <Row label="Aadhaar no."><input name="Aadhaar no." inputMode="numeric" maxLength={12} onInput={e=>{const i=e.currentTarget;i.value=digits(i.value,12);}}/></Row>
      <Row label="Address"/>
      <Row label="Post applied for" span={2}><Radio name="Post applied for" options={['Driver','Operator']}/></Row>
      <Row label="Vehicle / equipment for trial" span={2}><Chk name="Vehicle / equipment for trial" options={['Dumper/Tipper','Excavator','Loader','Dozer','Grader']}/><input name="Other equipment" className="tf-inline" placeholder="Other"/></Row>
      <Row label="Driving licence no. & class" span={2}><input name="Driving licence no. & class" placeholder="DL number – class (HMV / LMV / Transport)"/></Row>
      <Row label="DL valid up to" span={2}><input name="DL valid up to" type="date"/></Row>
      <Row label="Total experience (years)" span={2}><input name="Total experience (years)" type="number" min={0} step={0.5}/></Row>
      <Row label="Previous employer" span={2}/>
      <Row label="Trial date & time" span={2}><input name="Trial date & time" type="datetime-local"/></Row>
      <Row label="Referred by" span={2}/>
     </tbody></table>
     <h4>2. DOCUMENT CHECK (BEFORE TRIAL)</h4>
     <table><thead><tr><th>Document</th><th style={{width:150}}>Seen (Yes / No)</th><th>Remarks</th></tr></thead><tbody>
      <tr><td>Original driving licence (valid, class)</td><td><YesNo name="Seen – Original driving licence"/></td><td><input name="Remarks – Original driving licence"/></td></tr>
      <tr><td>Original licence (HEMM, LMV, Heavy)</td><td><YesNo name="Seen – Original licence (HEMM, LMV, Heavy)"/></td><td><input name="Remarks – Original licence (HEMM, LMV, Heavy)"/></td></tr>
      <tr><td>Aadhaar card</td><td><select name="Seen – Aadhaar card" defaultValue={photo||photo2?'Yes':''}><option value="">Select</option><option>Yes</option><option>No</option></select></td><td><input name="Remarks – Aadhaar card" defaultValue={photo||photo2?'Uploaded in step 1':''}/></td></tr>
     </tbody></table><p className="tf-warn">No trial if the driving licence or medical fitness is missing.</p>
     <h4>4. TRIAL RESULT</h4>
     <table><tbody>
      <Row label="Result"><Radio name="Result" options={['PASS','FAIL']}/></Row>
      <Row label="If PASS – recommended for"><Radio name="If PASS – recommended for" options={['Driver','Operator']}/> – Machine: <input name="Machine" className="tf-inline"/></Row>
      <Row label="If FAIL – reason"/><Row label="Trial conducted by"><input name="Trial conducted by" placeholder="Driver Trainer name"/></Row>
      <Row label="Re-trial allowed after (date)"><input name="Re-trial allowed after (date)" type="date"/></Row><Row label="Examiner remarks"/>
     </tbody></table>
     <div className="tf-sign"><span>DRIVER TRAINER</span><span>HR MANAGER</span><span>PM SIR</span></div>
    </div>
    {error&&<p className="employee-import-error" role="alert">{error}</p>}{saved&&<p className="shift-success" role="status">{saved}</p>}
    <div className="joining-actions"><button type="button" onClick={()=>setStep(0)}>Previous</button><button type="button" onClick={()=>window.print()}><Printer/> Print / Download PDF</button><button type="submit" className="next"><Save/> Save Trial Form</button></div>
   </div>
  </div>
 </form></div>;}
