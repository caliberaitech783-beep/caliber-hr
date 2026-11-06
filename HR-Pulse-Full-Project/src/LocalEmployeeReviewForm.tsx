import {siteFieldValue} from './siteNames';
import {useEffect,useMemo,useState,type FormEvent} from 'react';

const groups=[
 {name:'Joining & Personal Details',fields:['Employee Code','Joining Category *','Full Name *','Full Name as per Aadhar','Father / Spouse Name *','Date of Birth','Gender','Caste/category','Identification mark','BLOOD GROUP','Mobile *','Alternate Mobile','Candidate E-mail *','Aadhaar No. *','PAN No.','Present Address','Permanent Address','Reference Type','Reference Name','Emergency Contact Name','Emergency Contact Number']},
 {name:'Job & Posting Details',fields:['Site *','Department *','Sub-department *','Designation *','Grade','Employee Category','Reporting To','Joining Date *','Shift *','Resident','Employment Type','Probation Period','Confirmation Status','Salary Type','Skill Category','Salary Structure /Scheme','Monthly Gross Salary','Mess Deduction','Cost Centre / Project Code']},
 {name:'Bank Details',fields:['Bank Name','IFSC Code','Bank Account No','Branch Name','Payment Mode','UAN','PF Account No','PF Deduction','ESIC Account No','ESIC Establishment Code','ESIC Applicable']},
 {name:'Educational Details',repeated:true,fields:['Qualification','Board / University','Institute / College','Year of Passing','Percentage / CGPA']},
 {name:'Family Details',repeated:true,fields:['Family Member Name','Relationship','Family Date of Birth','Contact No.','Occupation','Dependent? (Y/N)']},
 {name:'Previous Work Experience',repeated:true,fields:['Employer Name','Previous Designation','From Date','To Date','Last Drawn Salary','Reason for Leaving']},
 {name:'Mine Compliance',fields:['VT Certificate No.','VTC Centre Name','VTC Valid Upto','WUIN No.','A-Form No.','Medical Examination Date','Medical Fitness Valid Upto','Medical Fitness Status','Safety Induction Date','Driving Licence No.','DL Class','DL Issue Date','DL Valid Upto','Operator Competency Certificate','Other Mine Permit / Training']},
];

export type ReviewRecord={id:string;code:string;name:string;data:Record<string,unknown>};
type LocalForm={code:string;name:string;office:Record<string,string>};
const core:Record<string,string>={'Employee Code':'code','Full Name *':'name','Candidate E-mail *':'email','Mobile *':'mobile','Date of Birth':'dateOfBirth','Joining Date *':'joiningDate','Employment Type':'category'};
function originalForm(record:ReviewRecord):LocalForm{
 const source=record.data.officeData;
 const office=source&&typeof source==='object'&&!Array.isArray(source)?Object.fromEntries(Object.entries(source).map(([key,value])=>[key,String(value??'')])):{};
 for(const [label,key] of Object.entries(core))if(office[label]===undefined)office[label]=String(record.data[key]??(key==='code'?record.code:key==='name'?record.name:''));
 return {code:record.code,name:record.name,office};
}
function storedForm(key:string,source:string,fallback:LocalForm){
 try{const raw=localStorage.getItem(key);if(!raw)return {form:fallback,message:''};const saved=JSON.parse(raw);if(saved.source!==source)return {form:fallback,message:'The submitted details changed. Showing the latest form instead of the older local copy.'};
  if(typeof saved.form?.code!=='string'||typeof saved.form?.name!=='string'||!saved.form.office||typeof saved.form.office!=='object'||Array.isArray(saved.form.office)||Object.values(saved.form.office).some(value=>typeof value!=='string'))throw Error('Invalid local copy');
  return {form:saved.form as LocalForm,message:'Your saved local changes have been restored.'};
 }catch{return {form:fallback,message:'The saved local copy could not be read. Showing the submitted details.'};}
}
export default function LocalEmployeeReviewForm({record,owner,onChange,readOnly=false}:{record:ReviewRecord;owner:string;readOnly?:boolean;onChange?:(changed:boolean)=>void}){
 const initial=useMemo(()=>originalForm(record),[record]),source=JSON.stringify(record),key=`hr-local-employee-review:${encodeURIComponent(owner)}:${encodeURIComponent(record.id)}`;
 const[restored]=useState(()=>owner&&!readOnly?storedForm(key,source,initial):{form:initial,message:''});
 const[form,setForm]=useState<LocalForm>(restored.form),[section,setSection]=useState(groups[0].name),[message,setMessage]=useState(restored.message),[error,setError]=useState('');
 const[editing,setEditing]=useState(false),[savedForm,setSavedForm]=useState<LocalForm>(restored.form);
 const displayedForm=readOnly?initial:form;
 const changed=!readOnly&&JSON.stringify(form)!==JSON.stringify(initial);
 useEffect(()=>{onChange?.(changed);},[changed,onChange]);
 function update(label:string,value:string){if(readOnly||!editing)return;setMessage('');setForm(current=>({...current,...(label==='Employee Code'?{code:value}:label==='Full Name *'?{name:value}:{}),office:{...current.office,[label]:value}}));}
 function repeated(label:string,index:number,value:string){const values=(form.office[label]||'').split(/\s*\|\s*/);while(values.length<=index)values.push('');values[index]=value;update(label,values.join(' | '));}
 function field(label:string,value:string,change:(value:string)=>void,accessible=label){
  if(readOnly||!editing)value=String(siteFieldValue(label,value));
  const choices:Record<string,string[]>={Relationship:['Mother','Father','Spouse','Son','Daughter'],Gender:['Male','Female','Other'],'Employment Type':['Permanent','Fixed-term','Contract','Trainee','Consultant'],'BLOOD GROUP':['A+','A-','B+','B-','AB+','AB-','O+','O-']};
  if(choices[label])return <select aria-label={accessible} disabled={readOnly||!editing} value={value} onChange={event=>change(event.target.value)}><option value="">Select</option>{value&&!choices[label].includes(value)&&<option>{value}</option>}{choices[label].map(option=><option key={option}>{option}</option>)}</select>;
  if(/address|reason|remarks/i.test(label))return <textarea aria-label={accessible} readOnly={readOnly||!editing} value={value} onChange={event=>change(event.target.value)}/>;
  const date=/Date|Valid Upto/.test(label)&&(!value||/^\d{4}-\d{2}-\d{2}$/.test(value));
  return <input aria-label={accessible} readOnly={readOnly||!editing} type={date?'date':'text'} max={date?'9999-12-31':undefined} value={value} onChange={event=>change(event.target.value)}/>;
 }
 function save(event:FormEvent){event.preventDefault();if(!editing)return;setError('');if(!owner){setError('Sign in to save a local copy.');return;}try{localStorage.setItem(key,JSON.stringify({source,form,savedAt:new Date().toISOString()}));setSavedForm(form);setEditing(false);setMessage('Changes saved locally on this browser. Form locked.');}catch{setError('Local storage is unavailable or full. Keep this form open so you do not lose your changes.');}}
 function reset(){if(!editing)return;try{localStorage.removeItem(key);setForm(initial);setSavedForm(initial);setEditing(false);setMessage('Submitted details restored.');setError('');}catch{setError('The saved local copy could not be cleared.');}}
 const known=new Set(groups.flatMap(group=>group.fields)),extra=Object.keys(displayedForm.office).filter(label=>!known.has(label)),tabs=[...groups.map(group=>group.name),...(extra.length?['Additional details']:[])],group=groups.find(group=>group.name===section);
 return <form className="local-employee-review-form" aria-label="Editable joining review form" onSubmit={save}>
  <div className="local-review-toolbar">{readOnly?<p><strong>Approved form · Read only</strong></p>:<><p><strong>{editing?'Editing':'Form locked'}</strong><br/>Changes are saved on this browser only.</p><div className="toolbar-buttons">{editing?<><button type="button" onClick={()=>{setForm(savedForm);setEditing(false);setError('');setMessage('Editing cancelled. Form locked.');}}>Cancel</button><button type="button" onClick={reset}>Reset to submitted form</button><button type="submit" className="primary">Save &amp; Lock</button></>:<button type="button" className="primary" disabled={!owner} onClick={()=>{setEditing(true);setError('');setMessage('');}}>Edit</button>}</div></>}</div>
  {!readOnly&&message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  <div className="module-tabs" aria-label="Review form sections">{tabs.map(tab=><button type="button" key={tab} className={section===tab?'selected':''} aria-pressed={section===tab} onClick={()=>setSection(tab)}>{tab}</button>)}</div>
  <section className="joining-section"><h3>{section}</h3>{group?.repeated?<div className="joining-table-wrap"><table className="joining-table"><thead><tr><th>No.</th>{group.fields.map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{Array.from({length:Math.max(5,...group.fields.map(label=>(displayedForm.office[label]||'').split('|').length))},(_,index)=><tr key={index}><td>{index+1}</td>{group.fields.map(label=><td key={label}>{field(label,(displayedForm.office[label]||'').split(/\s*\|\s*/)[index]||'',value=>repeated(label,index,value),`${label} ${index+1}`)}</td>)}</tr>)}</tbody></table></div>:<div className="joining-grid">{(group?.fields||extra).map(label=><label className="joining-field" key={label}><span>{label}</span>{field(label,displayedForm.office[label]||'',value=>update(label,value))}</label>)}</div>}</section>
 </form>;
}
