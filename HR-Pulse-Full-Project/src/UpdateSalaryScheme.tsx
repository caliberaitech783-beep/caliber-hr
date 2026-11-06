import {siteDisplayName} from './siteNames';
import {useRef,useState,type ChangeEvent} from 'react';
import {Check,Eye,FileText,Plus,Send,Trash2,Upload,X} from 'lucide-react';
import {MESS_PLANS,type MessRule,type MessSite} from './salaryCalc';
import {approve,currentMaster,diff,loadProposals,reject,saveProposals,type GrFile,type MasterValues,type Proposal} from './salaryProposals';

const inr=(n:number)=>'₹'+n.toLocaleString('en-IN');
const when=(iso:string)=>new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const MAX_GR=4*1024*1024;
type NumKey={[K in keyof MasterValues]:MasterValues[K] extends number?K:never}[keyof MasterValues];

export default function UpdateSalaryScheme({actor,canApprove,onApplied}:{actor:string;canApprove:boolean;onApplied:()=>void}){
 const[m,setM]=useState<MasterValues>(currentMaster),[gr,setGr]=useState<GrFile|null>(null),[note,setNote]=useState(''),[preview,setPreview]=useState<GrFile|null>(null),[list,setList]=useState<Proposal[]>(loadProposals),[msg,setMsg]=useState(''),[err,setErr]=useState(''),[remark,setRemark]=useState<Record<string,string>>({});
 const file=useRef<HTMLInputElement>(null),live=currentMaster(),changes=diff(live,m);
 const num=(k:NumKey)=>({type:'number',value:m[k],onChange:(e:ChangeEvent<HTMLInputElement>)=>setM({...m,[k]:+e.target.value})});
 function pick(e:ChangeEvent<HTMLInputElement>){const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>MAX_GR){setErr('GR file must be 4 MB or smaller.');return;}const r=new FileReader();r.onload=()=>setGr({name:f.name,type:f.type,size:f.size,dataUrl:String(r.result)});r.readAsDataURL(f);setErr('');}
 function submit(){if(!changes.length&&!gr){setErr('Nothing to submit – change at least one value or attach a wage rate GR.');return;}
  const p:Proposal={id:'SS-'+Date.now().toString(36).toUpperCase(),createdAt:new Date().toISOString(),by:actor||'HR',note,status:'Pending',master:m,gr,changes:changes.length?changes:['Wage rate GR attached – no value changes']};
  const next=[p,...list];saveProposals(next);setList(next);setGr(null);setNote('');setErr('');setMsg(`Proposal ${p.id} submitted to the Director for approval. Values stay unchanged until approved.`);}
 function decide(id:string,ok:boolean){const r=remark[id]||'';const next=ok?approve(list,id,actor||'Director',r):reject(list,id,actor||'Director',r);setList(next);if(ok){setM(currentMaster());onApplied();setMsg(`Proposal ${id} approved – the new salary scheme is now live.`);}else setMsg(`Proposal ${id} rejected.`);}
 const setSite=(i:number,p:Partial<MessSite>)=>setM({...m,sites:m.sites.map((s,j)=>j===i?{...s,...p}:s)});
 const Flag=({k,f}:{k:keyof MasterValues['schemes'];f:keyof MasterValues['schemes']['STD']})=><td><input type="checkbox" checked={m.schemes[k][f]} onChange={e=>setM({...m,schemes:{...m.schemes,[k]:{...m.schemes[k],[f]:e.target.checked}}})}/></td>;
 const pending=list.filter(p=>p.status==='Pending');
 return <div className="salary-update">
  <div className="salary-update-head"><div><h2>Update New Salary Scheme</h2><p>Edit any value below, attach the wage rate GR, and submit. Nothing takes effect until the Director approves.</p></div>
   <div className="salary-update-actions"><input ref={file} type="file" accept=".pdf,image/*" hidden onChange={pick} aria-label="Upload wage rate GR"/>
    <button type="button" className="shift-remove salary-btn" onClick={()=>file.current?.click()}><Upload/>Upload wage rate GR</button>
    {gr&&<button type="button" className="shift-remove salary-btn" onClick={()=>setPreview(gr)}><Eye/>Preview</button>}
    <button type="button" className="shift-add salary-save" onClick={submit}><Send/>Submit to Director</button></div></div>
  {gr&&<p className="salary-gr"><FileText/>{gr.name} · {(gr.size/1024).toFixed(0)} KB<button type="button" aria-label="Remove GR" onClick={()=>setGr(null)}><X/></button></p>}
  {err&&<p className="employee-import-error">{err}</p>}{msg&&<p className="shift-success">{msg}</p>}
  <label className="salary-note-field">Note for the Director<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. HPC wage revision as per GR dated …"/></label>

  <div className="shift-grid">
   <div>
    <div className="shift-card"><h2>HPC Salary – wage rate master (per day)</h2><div className="shift-table-wrap"><table><thead><tr><th>Code</th><th>Category</th><th>Daily wage rate (₹)</th><th>Gross for {m.days} days</th></tr></thead><tbody>
     {m.wage.map((w,i)=><tr key={i}><td><input className="salary-code" value={w.code} onChange={e=>setM({...m,wage:m.wage.map((x,j)=>j===i?{...x,code:e.target.value}:x)})}/></td><td><input value={w.category} onChange={e=>setM({...m,wage:m.wage.map((x,j)=>j===i?{...x,category:e.target.value}:x)})}/></td><td><input type="number" value={w.rate} onChange={e=>setM({...m,wage:m.wage.map((x,j)=>j===i?{...x,rate:+e.target.value}:x)})}/></td><td>{inr(w.rate*m.days)}</td></tr>)}
    </tbody></table></div></div>
    <div className="shift-card"><h2>HPC / Non-HPC – calculation parameters</h2><div className="shift-fields">
     <label>Basic days limit<input {...num('days')}/></label><label>EPF rate (% of Basic)<input {...num('epfRate')} step={0.5}/></label>
     <label>EPF Basic ceiling (₹)<input {...num('epfCeil')}/></label><label>EPF fixed above ceiling (₹)<input {...num('epfFixed')}/></label>
    </div></div>
    <div className="shift-card"><h2>TDS master – new tax regime</h2><div className="shift-fields">
     <label>Standard deduction (₹/year)<input {...num('std')}/></label><label>Sec 87A rebate limit (₹)<input {...num('rebate')}/></label><label>Health &amp; education cess (%)<input {...num('cess')} step={0.5}/></label>
    </div><div className="shift-table-wrap" style={{marginTop:16}}><table><thead><tr><th>Income above (₹)</th><th>Up to (₹)</th><th>Tax rate (%)</th></tr></thead><tbody>
     {m.slabs.map((s,i)=><tr key={i}><td>{inr(s.from)}</td><td>{s.to===null?'and above':<input type="number" value={s.to} onChange={e=>setM({...m,slabs:m.slabs.map((x,j)=>j===i?{...x,to:+e.target.value}:j===i+1?{...x,from:+e.target.value}:x)})}/>}</td><td><input type="number" value={s.rate} onChange={e=>setM({...m,slabs:m.slabs.map((x,j)=>j===i?{...x,rate:+e.target.value}:x)})}/></td></tr>)}
    </tbody></table></div></div>
   </div>
   <div>
    <div className="shift-card"><h2>Standard Salary – structure</h2><div className="shift-fields">
     <label>A – Basic (% of earned gross)<input {...num('basicPct')}/></label><label>B – HRA (% of Basic)<input {...num('hraPct')}/></label><label>C – Medical (₹ per month)<input {...num('medical')}/></label>
     <label>ESIC rate on Basic (%)<input {...num('esicRate')} step={0.05}/></label><label>ESIC Basic limit (₹)<input {...num('esicLimit')}/></label>
    </div></div>
    <div className="shift-card"><h2>Standard Salary – scheme matrix</h2><div className="shift-table-wrap"><table><thead><tr><th>Scheme</th><th>PF</th><th>ESIC</th><th>PT</th><th>TDS</th></tr></thead><tbody>
     {([['STD','Standard Salary (Corporate / Head Office)'],['STDW','Standard Salary (Women)'],['WC','Without Compliance']] as const).map(([k,n])=><tr key={k}><td>{n}</td><Flag k={k} f="pf"/><Flag k={k} f="esic"/><Flag k={k} f="pt"/><Flag k={k} f="tds"/></tr>)}
    </tbody></table></div></div>
    <div className="shift-card"><h2>Non-HPC Salary – rules</h2><p className="shift-help">Per-day salary = Salary ÷ Month days (rounded) · Unit days = Earnings ÷ Govt rate · Basic = Govt rate × MIN(Unit days, {m.days}) · deductions as HPC. These rules are fixed; only the parameters on the left change them.</p></div>
   </div>
  </div>

  <div className="shift-card salary-sites"><h2>Site-wise mess deduction master</h2><div className="shift-table-wrap"><table><thead><tr><th>Site</th><th>Company</th><th>Category</th><th>Duty / rate type</th><th>Deduction (₹)</th><th>Per</th><th>Food</th><th>Remark</th><th></th></tr></thead><tbody>
   {m.sites.map((S,si)=>{const rows=S.plans?1:Math.max(S.rules.length,1),head=<><td rowSpan={rows}><input value={siteDisplayName(S.site)} onChange={e=>setSite(si,{site:e.target.value})}/></td><td rowSpan={rows}><input value={S.company} onChange={e=>setSite(si,{company:e.target.value})}/></td></>;
    if(S.plans)return <tr key={si} className="salary-site-first">{head}<td colSpan={5}><b>Mess plan – worker chooses:</b> {MESS_PLANS.filter(p=>p.t!=='none').map(p=>p.label).join(', ')}</td><td><small>Per day / per month options</small></td><td className="salary-site-actions"><button type="button" className="shift-remove" onClick={()=>setSite(si,{plans:false,rules:[]})}>Use site rules</button><button type="button" className="shift-remove" aria-label="Remove site" onClick={()=>setM({...m,sites:m.sites.filter((_,j)=>j!==si)})}><Trash2/></button></td></tr>;
    if(!S.rules.length)return <tr key={si} className="salary-site-first">{head}<td colSpan={6}>No rules – no deduction</td><td className="salary-site-actions"><button type="button" className="shift-remove" onClick={()=>setSite(si,{rules:[{category:'Camp',duty:'HPC',rate:205,per:'day',food:'Allowed',remark:'Only for HPC Rate (8 hrs duty)'}]})}>Add rule</button><button type="button" className="shift-remove" aria-label="Remove site" onClick={()=>setM({...m,sites:m.sites.filter((_,j)=>j!==si)})}><Trash2/></button></td></tr>;
    return S.rules.map((r,ri)=>{const upd=(p:Partial<MessRule>)=>setSite(si,{rules:S.rules.map((x,j)=>j===ri?{...x,...p}:x)});
     return <tr key={si+'-'+ri} className={ri===0?'salary-site-first':''}>{ri===0&&head}
      <td><select value={r.category} onChange={e=>upd({category:e.target.value as MessRule['category']})}><option value="Camp">Camp (Non-local)</option><option value="NonCamp">Non-Camp (Local)</option></select></td>
      <td><select value={r.duty} onChange={e=>upd({duty:e.target.value as MessRule['duty']})}><option value="HPC">HPC Rate (8 hrs duty)</option><option value="Fixed">Fixed Rate (12 hrs duty)</option></select></td>
      <td><input type="number" step={0.5} placeholder="No deduction" value={r.rate??''} onChange={e=>upd({rate:e.target.value===''?null:+e.target.value})}/></td>
      <td><select value={r.per} disabled={!r.rate} onChange={e=>upd({per:e.target.value as MessRule['per']})}><option value="day">Per day</option><option value="month">Per month</option></select></td>
      <td><select value={r.food} onChange={e=>upd({food:e.target.value as MessRule['food']})}><option>Allowed</option><option>Not Allowed</option></select></td>
      <td><input value={r.remark} onChange={e=>upd({remark:e.target.value})}/></td>
      <td className="salary-site-actions">{ri===S.rules.length-1&&<button type="button" className="shift-remove" aria-label="Add rule" onClick={()=>setSite(si,{rules:[...S.rules,{category:'Camp',duty:'Fixed',rate:null,per:'day',food:'Allowed',remark:'Fixed Rate (12 hrs duty)'}]})}><Plus/></button>}<button type="button" className="shift-remove" aria-label="Remove rule" onClick={()=>setSite(si,{rules:S.rules.filter((_,j)=>j!==ri)})}><Trash2/></button></td></tr>;});})}
  </tbody></table></div><div className="salary-site-foot"><button type="button" className="shift-remove salary-btn" onClick={()=>setM({...m,sites:[...m.sites,{site:'',company:'',plans:false,rules:[]}]})}><Plus/>Add site</button><button type="button" className="shift-remove salary-btn" onClick={()=>setM({...m,sites:[...m.sites,{site:'',company:'',plans:true,rules:[]}]})}><Plus/>Add mess-plan site</button></div></div>

  <div className="shift-card salary-sites"><h2>Pending changes in this proposal</h2>{changes.length?<ul className="salary-changes">{changes.map(c=><li key={c}>{c}</li>)}</ul>:<p className="shift-help">No changes yet – values match the live master.</p>}</div>

  <div className="shift-card salary-sites"><h2>Director approval – submitted proposals{pending.length?<span className="salary-badge">{pending.length} pending</span>:null}</h2>
   {list.length?<div className="shift-table-wrap"><table><thead><tr><th>Proposal</th><th>Submitted</th><th>Changes</th><th>GR</th><th>Status</th><th>{canApprove?'Director action':'Decision'}</th></tr></thead><tbody>
    {list.map(p=><tr key={p.id}><td><b>{p.id}</b><small>by {p.by}{p.note?` · ${p.note}`:''}</small></td><td>{when(p.createdAt)}</td><td><ul className="salary-changes">{p.changes.map(c=><li key={c}>{c}</li>)}</ul></td><td>{p.gr?<button type="button" className="shift-remove salary-btn" onClick={()=>setPreview(p.gr)}><Eye/>Preview</button>:'–'}</td><td><span className={'salary-status '+p.status.toLowerCase()}>{p.status}</span>{p.decidedAt&&<small>{p.decidedBy} · {when(p.decidedAt)}{p.remark?` · ${p.remark}`:''}</small>}</td>
     <td>{p.status==='Pending'?(canApprove?<div className="salary-decide"><input placeholder="Remark (optional)" value={remark[p.id]||''} onChange={e=>setRemark({...remark,[p.id]:e.target.value})}/><button type="button" className="shift-add salary-save" onClick={()=>decide(p.id,true)}><Check/>Approve</button><button type="button" className="shift-remove salary-btn" onClick={()=>decide(p.id,false)}><X/>Reject</button></div>:<small>Awaiting Director</small>):<small>Closed</small>}</td></tr>)}
   </tbody></table></div>:<p className="shift-help">No proposals submitted yet.</p>}</div>

  {preview&&<div className="salary-ov" onClick={()=>setPreview(null)}><div className="salary-md salary-gr-md" role="dialog" aria-label="Wage rate GR preview" onClick={e=>e.stopPropagation()}><div className="salary-mh"><h4>{preview.name}</h4><button type="button" className="salary-x" aria-label="Close" onClick={()=>setPreview(null)}><X/></button></div>
   {preview.type==='application/pdf'?<iframe title="Wage rate GR" src={preview.dataUrl}/>:<img alt="Wage rate GR" src={preview.dataUrl}/>}</div></div>}
 </div>}
