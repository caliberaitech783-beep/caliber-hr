import {useEffect,useRef,useState} from 'react';
import {Camera,Printer,Save,Send,X} from 'lucide-react';
import {api,savedSession} from './api';
import {AadhaarUpload} from './EmployeeLocation';
import './trial-form.css';
import {saveTrialHandoff,type TrialHandoff} from './trialHandoff';

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

export default function TrialForm({selection,onPassed,canManage=false}:{selection:TrialSelection;onPassed?:(handoff:TrialHandoff)=>void;canManage?:boolean}){
 const form=useRef<HTMLFormElement>(null),[step,setStep]=useState(0),[photo,setPhoto]=useState<File|undefined>(),[photo2,setPhoto2]=useState<File|undefined>(),[formNo]=useState(()=>{try{return sessionStorage.getItem(DRAFT_KEY+'.no')||'';}catch{return '';}}),[saved,setSaved]=useState(''),[error,setError]=useState(''),[candidatePhoto,setCandidatePhoto]=useState<string>(''),photoInput=useRef<HTMLInputElement>(null),pendingHandoff=useRef<TrialHandoff|null>(null),[popup,setPopup]=useState<{result:string;message:string;connected:string[];recipients:number}|null>(null),[saving,setSaving]=useState(false);
 const no=useRef(formNo);if(!no.current){no.current=nextFormNo();try{sessionStorage.setItem(DRAFT_KEY+'.no',no.current);}catch{/* ignore */}}
 const heading=`${companyShort[selection.company]||selection.company||'CMLL'}  –  ${(selection.site||'SITE').toUpperCase()}`;
 /* After the Aadhaar is read into the hidden joining-style fields, copy them into the trial form and open it. */
 useEffect(()=>{const f=form.current;if(!f)return;const copy=()=>{const v=(n:string)=>(f.elements.namedItem(n) as HTMLInputElement|null)?.value||'';const set=(n:string,val:string)=>{const el=f.elements.namedItem(n) as HTMLInputElement|null;if(el&&!el.value&&val)el.value=val;};
  set('Name of candidate',v('Full Name as per Aadhaar')||v('Full Name'));set("Father's name",v('Father / Spouse Name'));const dob=v('Date of Birth');if(dob)set('Date of birth / Age',`${dob.split('-').reverse().join('/')}${age(dob)?' · '+age(dob):''}`);set('Aadhaar no.',digits(v('Aadhaar No.'),12));set('Address',v('Permanent Address'));
  };
  f.addEventListener('change',copy);return()=>f.removeEventListener('change',copy);},[]);
 useEffect(()=>{const f=form.current;if(!f)return;const post=f.elements.namedItem('Post applied for') as RadioNodeList|null;if(post&&!post.value&&['Driver','Operator'].includes(selection.department))post.value=selection.department;},[selection.department,step]);
 async function save(){const f=form.current;if(!f)return;setError('');const data:Record<string,string>={};for(const el of Array.from(f.elements)){if(!(el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement)||!el.name||el.type==='file')continue;if(el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)){if(el.checked)data[el.name]=(data[el.name]?data[el.name]+', ':'')+el.value;continue;}data[el.name]=el.value;}
  if(!data['Name of candidate']){setError('Candidate name is required.');return;}
  if(!data['Result']){setError('Select the trial Result (PASS / FAIL) before saving.');return;}
  const record={formNo:no.current,heading,...selection,savedAt:new Date().toISOString(),fields:data,photo:candidatePhoto||undefined};
  try{const list=JSON.parse(localStorage.getItem(DRAFT_KEY)||'[]');list.unshift(record);localStorage.setItem(DRAFT_KEY,JSON.stringify(list.slice(0,200)));}catch{/* ignore */}
  const grant=savedSession()?.grant;if(!grant){setError('Sign in again to save the trial form.');return;}
  setSaving(true);let tg:{result:string;message:string;connected:string[];recipients:number}|null=null;
  try{const out=await api<{result:string;telegram:{recipients:number;connected:string[];message:string}}>(grant,'telegram/trial-forms','POST',{formNo:no.current,heading,site:selection.site,company:selection.company,department:selection.department,fields:data});tg={result:out.result,...out.telegram};setPopup(tg);}
  catch(e){setError((e as Error).message);setSaving(false);return;}
  finally{setSaving(false);}
  if(data['Result']==='PASS'){const v=(n:string)=>(f.elements.namedItem(n) as HTMLInputElement|null)?.value||'',dobRaw=v('Date of Birth'),post=data['If PASS – recommended for']||data['Post applied for']||selection.department;
   const fields:Record<string,string>={'Full Name':data['Name of candidate'],'Full Name as per Aadhaar':v('Full Name as per Aadhaar')||data['Name of candidate'],'Father / Spouse Name':data["Father's name"],'Date of Birth':dobRaw,'Gender':v('Gender'),'Mobile':data['Mobile no.'],'Aadhaar No.':data['Aadhaar no.'],'Permanent Address':data['Address'],'Reference Name':data['Referred by'],'Driving Licence No.':data['Driving licence no. & class'],'DL Valid Upto':data['DL valid up to'],'Trial Form No.':no.current,'Trial Result':`PASS – ${post}${data['Machine']?' · '+data['Machine']:''}`};
   const handoff:TrialHandoff={id:no.current,formNo:no.current,name:data['Name of candidate'],site:selection.site,post,fields,photo:candidatePhoto||undefined};saveTrialHandoff(handoff,{photo,photo2});
   setSaved(`Trial form ${no.current} saved – PASS. Close the Telegram preview to open Employee Management with the details filled in.`);pendingHandoff.current=handoff;return;}
  setSaved(`Trial form ${no.current} saved for ${data['Name of candidate']} · ${heading}${data['Result']?' · Result: '+data['Result']+' – candidate not sent to Employee Management':''}.`);}
 function closePopup(){setPopup(null);const h=pendingHandoff.current;if(h){pendingHandoff.current=null;onPassed?.(h);}}
 const recipientName=(phone:string)=>{try{const list=JSON.parse(sessionStorage.getItem('hrPulse.trialRecipients')||'[]') as {phone:string;name:string}[];return list.find(r=>r.phone===phone)?.name||phone;}catch{return phone;}};
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
      <tr><td>Form No.</td><td><input name="Form No." value={no.current} readOnly className="tf-ro"/></td><td className="tf-photo" rowSpan={7}><input ref={photoInput} type="file" accept="image/*" capture="user" hidden aria-label="Upload candidate photo" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>5*1024*1024){setError('Photo must be 5 MB or smaller.');return;}const r=new FileReader();r.onload=()=>setCandidatePhoto(String(r.result));r.readAsDataURL(f);}}/>
       {candidatePhoto?<><img src={candidatePhoto} alt="Candidate"/><div className="tf-photo-actions"><button type="button" onClick={()=>photoInput.current?.click()}>Change</button><button type="button" aria-label="Remove photo" onClick={()=>setCandidatePhoto('')}><X/></button></div></>:<button type="button" className="tf-photo-upload" onClick={()=>photoInput.current?.click()}><Camera/><span>Upload photo</span><small>Camera or gallery</small></button>}</td></tr>
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
    <div className="joining-actions"><button type="button" onClick={()=>setStep(0)}>Previous</button><button type="button" onClick={()=>window.print()}><Printer/> Print / Download PDF</button><button type="submit" className="next" disabled={saving}><Save/> {saving?'Saving…':'Save Trial Form'}</button></div>
   </div>
  </div>
 </form>
  {popup&&<div className="salary-ov" onClick={()=>closePopup()}><div className="salary-md tf-tg" role="dialog" aria-label="Telegram message" onClick={e=>e.stopPropagation()}>
   <div className="salary-mh"><h4><Send/> Telegram – Vehicle trial result</h4><button type="button" className="salary-x" aria-label="Close" onClick={()=>closePopup()}><X/></button></div>
   <pre className="tf-tg-msg">{popup.message}</pre>
   <p className="tf-tg-status">{popup.recipients===0?'No Telegram recipient is set up yet – add the person under "Telegram recipients" below.':popup.connected.length?`Sent to ${popup.connected.map(p=>recipientName(p)).join(', ')}.`:'Queued – the recipient has not connected Telegram yet. Share their connect link (below) so they receive this and future results.'}</p>
   <div className="joining-actions"><button type="button" className="next" onClick={()=>closePopup()}>OK</button></div></div></div>}
  {canManage&&step===1&&<TrialRecipients/>}
 </div>;}


type Recipient={phone:string;name:string;connected?:boolean};
function TrialRecipients(){
 const[list,setList]=useState<Recipient[]>([]),[bot,setBot]=useState(''),[configured,setConfigured]=useState(true),[links,setLinks]=useState<Record<string,string>>({}),[msg,setMsg]=useState(''),[err,setErr]=useState(''),grant=savedSession()?.grant||'';
 const load=async()=>{try{const r=await api<{recipients:Recipient[];botUsername:string;configured:boolean}>(grant,'telegram/trial-recipients');setList(r.recipients);setBot(r.botUsername);setConfigured(r.configured);try{sessionStorage.setItem('hrPulse.trialRecipients',JSON.stringify(r.recipients));}catch{/* ignore */}}catch(e){setErr((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 const save=async(next:Recipient[])=>{setErr('');setMsg('');try{await api(grant,'telegram/trial-recipients','POST',{recipients:next});await load();setMsg('Recipients saved.');}catch(e){setErr((e as Error).message);}};
 const connect=async(phone:string)=>{setErr('');try{const r=await api<{url:string}>(grant,'telegram/trial-connect','POST',{phone});setLinks({...links,[phone]:r.url});}catch(e){setErr((e as Error).message);}};
 return <div className="joining-card tf-recipients"><h3><Send/> Telegram recipients for trial results</h3>
  <p className="help-text">Every saved trial form (PASS or FAIL) is sent to these people on Telegram. A bot cannot message a phone number directly – each person must open the bot once: create their connect link, share it with them on Telegram, and they tap <b>Start</b>. After that every result reaches them automatically.{!configured&&' Telegram bot is not configured on the server yet.'}</p>
  {err&&<p className="employee-import-error" role="alert">{err}</p>}{msg&&<p className="shift-success" role="status">{msg}</p>}
  <table className="tf-recipient-table"><thead><tr><th>Name</th><th>Mobile (Telegram number)</th><th>Status</th><th></th></tr></thead><tbody>
   {list.map((r,i)=><tr key={i}><td><input value={r.name} onChange={e=>setList(list.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder="Name"/></td><td><input value={r.phone} inputMode="numeric" maxLength={10} onChange={e=>setList(list.map((x,j)=>j===i?{...x,phone:e.target.value.replace(/\D/g,'').slice(0,10)}:x))}/></td>
    <td>{r.connected?<span className="salary-status approved">Connected</span>:<span className="salary-status pending">Not connected</span>}{!r.connected&&links[r.phone]&&<div className="tf-link"><input readOnly value={links[r.phone]} onFocus={e=>e.currentTarget.select()}/><a href={`https://t.me/share/url?url=${encodeURIComponent(links[r.phone])}&text=${encodeURIComponent('Open this link and tap Start to receive vehicle trial results from Caliber HR')}`} target="_blank" rel="noreferrer">Share on Telegram</a><button type="button" className="shift-remove" onClick={()=>{void navigator.clipboard?.writeText(links[r.phone]);}}>Copy</button></div>}</td>
    <td className="salary-site-actions">{!r.connected&&r.phone.length===10&&<button type="button" className="shift-remove" onClick={()=>void connect(r.phone)}>{links[r.phone]?'New link':'Connect link'}</button>}<button type="button" className="shift-remove" aria-label="Remove recipient" onClick={()=>void save(list.filter((_,j)=>j!==i))}><X/></button></td></tr>)}
   {!list.length&&<tr><td colSpan={4} className="shift-empty">No recipients yet</td></tr>}
  </tbody></table>
  <div className="salary-site-foot"><button type="button" className="shift-remove salary-btn" onClick={()=>setList([...list,{phone:'',name:''}])}>+ Add person</button><button type="button" className="shift-add salary-save" onClick={()=>void save(list)}>Save recipients</button>{bot&&<small>Bot: @{bot}</small>}</div>
 </div>;}
