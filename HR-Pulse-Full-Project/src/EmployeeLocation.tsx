import {useEffect,useRef,useState,type ChangeEvent,type ReactNode} from 'react';
import {ChevronDown,Download,FileSpreadsheet,Printer,Upload} from 'lucide-react';
import {read,utils,writeFile} from 'xlsx';
import {api,type Lookup,type Module,type RecordRow} from './api';

const locations={Site:['NCL','WCL'],Office:['Nagpur CO','Chandrapur HO']};
const tabs=['Add New Employee','Update Existing Employee','Region Employee Details','Department & Designation'];
const steps=['Employee Details','Work Details','Contract & Policies','Assets','Docs'];
const corporateOfficeHeaders=['Sr. No.','Joining Category *','Employee Code','Full Name *','Full Name as per Aadhar','Father / Spouse Name *','Date of Birth','Gender','Caste/category','Identification mark','BLOOD GROUP','Mobile *','Alternate Mobile','Candidate E-mail *','Aadhaar No. *','PAN No.','Present Address','Permanent Address','Emergency Contact Name','Emergency Contact Number','Site *','Department *','Sub-department *','Designation *','Grade','Employee Category','Reporting To','Joining Date *','Shift *','Resident','Employment Type','Probation Period','Confirmation Status','Salary Structure /Scheme','Monthly Gross Salary','Cost Centre / Project Code','Father Name','Spouse Name','Payment Mode','Bank Name','IFSC Code','Bank Account No','UAN','PF Account No','PF Deduction','ESIC Account No','ESIC Establishment Code','ESIC Applicable','Status'];
const corporateOfficeUploadHeaders=[corporateOfficeHeaders[0],corporateOfficeHeaders[2],corporateOfficeHeaders[1],...corporateOfficeHeaders.slice(3)];
const corporateDateHeaders=new Set(['Date of Birth','Joining Date *']);
export function validCorporateOfficeHeaders(values:unknown[]){
 const headers=values.map(value=>String(value??'').trim());while(headers.at(-1)==='')headers.pop();
 return [corporateOfficeHeaders,corporateOfficeUploadHeaders].some(format=>headers.length===format.length&&headers.every((header,index)=>header===format[index]));
}
function importDate(value:unknown){if(typeof value==='number'){const date=new Date(Date.UTC(1899,11,30)+value*86400000);return date.toISOString().slice(0,10)}return String(value??'').trim()}
const employmentCategories=new Map([['permanent','Permanent'],['contract','Contract'],['temporary','Contract'],['fixed-term','Contract'],['fixed term','Contract'],['trainee','Trainee'],['consultant','Consultant']]);
export function normalizeEmploymentCategory(value:unknown){return employmentCategories.get(String(value??'').trim().toLowerCase())||String(value??'').trim()}
function corporateImportRow(row:Record<string,unknown>){
 const officeData=Object.fromEntries(corporateOfficeHeaders.map(header=>[header,corporateDateHeaders.has(header)?importDate(row[header]):row[header]??'']));
 return {code:String(row['Employee Code']??'').trim(),name:String(row['Full Name *']||row['Full Name as per Aadhar']||'').trim(),email:String(row['Candidate E-mail *']??'').trim(),mobile:String(row['Mobile *']??'').trim(),dateOfBirth:importDate(row['Date of Birth']),joiningDate:importDate(row['Joining Date *']),category:normalizeEmploymentCategory(row['Employment Type']),siteId:String(row['Site *']??'').trim(),departmentId:String(row['Department *']??'').trim(),designationId:String(row['Designation *']??'').trim(),gradeId:String(row.Grade??'').trim(),shiftId:String(row['Shift *']??'').trim(),__officeData:officeData};
}
const corporateReferences={siteId:'sites',departmentId:'departments',designationId:'designations',gradeId:'grades',shiftId:'shifts'} as const;
export function resolveCorporateReferences(rows:Record<string,unknown>[],lookups:Lookup[]){
 const companies=lookups.filter(item=>item.kind==='companies');if(companies.length!==1)throw new Error('Configure exactly one active Company master before importing the Corporate / HO workbook');
 return rows.map(row=>{const resolved:Record<string,unknown>={...row,companyId:companies[0].id};for(const [field,kind] of Object.entries(corporateReferences)){const value=String(row[field]??'').trim().toLowerCase();if(!value){resolved[field]='';continue;}const matches=lookups.filter(item=>item.kind===kind&&[item.code,item.name].some(candidate=>candidate.trim().toLowerCase()===value));resolved[field]=matches.length===1?matches[0].id:'';}return resolved;});
}
const employeeExportColumns=[
 'Joining Category','Employee Code','Full Name','Father / Spouse Name','Date of Birth','Gender','Caste / Category','Identification Mark','Blood Group','Mobile','Alternate Mobile','Candidate E-mail','Aadhaar No.','PAN No.','Present Address','Permanent Address','Emergency Contact Name','Emergency Contact Number',
 'Qualification','Board / University','Institute / College','Year of Passing','Percentage / CGPA','Family Member Name','Relationship','Date of Birth','Occupation','Dependent? (Y/N)',
 'Site','Department','Sub-department','Designation','Grade','Employee Category','Reporting To','Joining Date','Shift','Resident','VT Certificate No.','VTC Centre Name','VTC Valid Upto','WUIN No.','A-Form No.','Medical Examination Date','Medical Fitness Valid Upto','Medical Fitness Status','Safety Induction Date','Driving Licence No.','DL Class','DL Issue Date','DL Valid Upto','Operator Competency Certificate','Other Mine Permit / Training',
 'Employer Name','Designation','From Date','To Date','Last Drawn Salary / Reason for Leaving','Employment Type','Probation Period','Confirmation Status','Salary Structure / Scheme','Monthly Gross Salary','Cost Centre / Project Code','Candidate Declaration','Candidate Signature / Date','Prepared By (HR) / Date','Site HR Verification / Date','Final Approval Reference / Date','Employee Code (after approval)',
 'Asset Type','Asset / Tag No.','Serial No.','Issue Date','Return Date','Remarks','Candidate photo','Aadhaar (masked display)','PAN','Education certificates','Previous employment / experience proof','Bank proof / cancelled cheque','UAN / PF details','ESIC details','VTC certificate','Medical fitness certificate','Driving licence','Operator competency certificate','Address proof','Signed offer letter','Signed appointment letter','Verified By','Remarks'
];

function downloadEmployeeExcel(){
 const sheet=utils.aoa_to_sheet([employeeExportColumns]);sheet['!cols']=employeeExportColumns.map(column=>({wch:Math.min(Math.max(column.length+2,14),38)}));
 const workbook=utils.book_new();utils.book_append_sheet(workbook,sheet,'Employee Form');writeFile(workbook,'employee-master-form.xlsx');
}
function downloadEmployeePdf(){
 const popup=window.open('','_blank','noopener,noreferrer');if(!popup)return;
 const rows=employeeExportColumns.reduce((html,column,index)=>html+(index%2===0?'<tr>':'')+`<td><strong>${column}</strong><br><br></td>`+(index%2===1?'</tr>':''),'')+(employeeExportColumns.length%2?'<td></td></tr>':'');
 popup.document.write(`<!doctype html><html><head><title>Employee Master Form</title><style>body{font:12px Arial;padding:24px}h1{font-size:22px}table{width:100%;border-collapse:collapse}td{border:1px solid #bbb;padding:7px;width:50%}@page{size:A4;margin:12mm}</style></head><body><h1>Employee Master Form</h1><table>${rows}</table></body></html>`);popup.document.close();popup.focus();popup.print();
}

type FieldProps={label:string;required?:boolean;placeholder?:string;type?:string;options?:string[];wide?:boolean;value?:string;onChange?:(value:string)=>void};
function Field({label,required,placeholder='',type='text',options,wide,value,onChange}:FieldProps){
 const id=label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
 return <label className={'joining-field '+(wide?'wide':'')} htmlFor={id}><span>{label}{required&&<b> *</b>}</span>{options?<select id={id} required={required} value={value} onChange={onChange?event=>onChange(event.target.value):undefined}><option value="">Select</option>{options.map(option=><option key={option}>{option}</option>)}</select>:type==='textarea'?<textarea id={id} required={required} placeholder={placeholder}/>:<input id={id} required={required} type={type} placeholder={placeholder}/>}</label>;
}
function Section({title,children}:{title:string;children:ReactNode}){return <section className="joining-section"><h3>{title}</h3>{children}</section>}
function EntryTable({columns,rows=5}:{columns:string[];rows?:number}){return <div className="joining-table-wrap"><table className="joining-table"><thead><tr><th>S.No.</th>{columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{Array.from({length:rows},(_,index)=><tr key={index}><td>{index+1}</td>{columns.map(column=><td key={column}><input aria-label={`${column} ${index+1}`} type={column.includes('Date')?'date':'text'}/></td>)}</tr>)}</tbody></table></div>}

const documents=[
 ['Candidate photo','Mandatory'],['Aadhaar (masked display)','Mandatory / secure handling'],['PAN','As applicable'],['Education certificates','As per role'],['Previous employment / experience proof','If experienced'],['Bank proof / cancelled cheque','Before payroll'],['UAN / PF details','If applicable'],['ESIC details','If applicable'],['VTC certificate','OB / COAL where applicable'],['Medical fitness certificate','OB / COAL where applicable'],['Driving licence','Drivers/operators'],['Operator competency certificate','Operators where applicable'],['Address proof','As per policy'],['Signed offer letter','After approval'],['Signed appointment letter','After approval']
];
const conditionalDocuments=new Set(['VTC certificate','Medical fitness certificate','Driving licence','Operator competency certificate']);
const regionSites={WCL:['Sasti OB','Dhoptala OB','Gauri Pauni OB','Majri OB'],NCL:['Jayant OB','Dudhichua OB West','Dudhichua OB East']};

function RegionEmployeeDetails({employeeGroup}:{employeeGroup:'Corporate / HO'|'OB / COAL'}){
 const[region,setRegion]=useState('');
 useEffect(()=>setRegion(''),[employeeGroup]);
 return <div className="joining-card employee-tab-panel region-details-row"><div className="joining-heading"><div><h2>Region Employee Details</h2><p>{employeeGroup}</p></div></div><div className="region-inline-fields">{employeeGroup==='Corporate / HO'?<Field label="Office" options={['Nagpur CO','Chandrapur HO']}/>:<><Field label="Coalfield" options={['WCL','NCL']} value={region} onChange={setRegion}/><Field label="Site" options={region?regionSites[region as keyof typeof regionSites]:[]} /></>}</div></div>;
}

function ExistingEmployees({rows,loading,error,employeeGroup}:{rows:RecordRow[];loading:boolean;error:string;employeeGroup:'Corporate / HO'|'OB / COAL'}){
 const corporate=employeeGroup==='Corporate / HO';
 return <div className="joining-card employee-tab-panel"><div className="joining-heading"><div><h2>Update Existing Employee</h2><p>{corporate?'Corporate / HO bulk employee format. Imported drafts appear here for review and updating.':'OB / COAL bulk format will be configured separately.'}</p></div></div>{error&&<p className="employee-import-error" role="alert">{error}</p>}{loading?<p role="status">Loading employees…</p>:corporate?<div className="joining-table-wrap"><table className="joining-table existing-employees corporate-office-employees"><thead><tr>{corporateOfficeHeaders.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map(row=>{const data=(row.data.officeData&&typeof row.data.officeData==='object'?row.data.officeData:{}) as Record<string,unknown>;return <tr key={row.id}>{corporateOfficeHeaders.map(header=><td key={header}>{String(data[header]??(header==='Employee Code'?row.code:header==='Full Name *'?row.name:header==='Status'?row.status:''))}</td>)}</tr>})}</tbody></table>{!rows.length&&<p className="employee-empty">No imported Corporate / HO employee records found.</p>}</div>:<p className="employee-empty">OB / COAL employee import format is not configured yet.</p>}</div>;
}

function JoiningForm({employeeGroup}:{employeeGroup:'Corporate / HO'|'OB / COAL'}){
 const[step,setStep]=useState(0),[employeeCategory,setEmployeeCategory]=useState('');
 useEffect(()=>{if(employeeGroup==='Corporate / HO')setEmployeeCategory('');},[employeeGroup]);
 const showMineCompliance=employeeGroup==='OB / COAL'&&['Driver','Operator'].includes(employeeCategory);
 const visibleDocuments=documents.filter(([name])=>!conditionalDocuments.has(name)||showMineCompliance);
 return <form className="joining-form" onSubmit={event=>event.preventDefault()}>
  <div className="joining-steps" aria-label="Employee joining steps">{steps.map((label,index)=><button type="button" key={label} className={step===index?'active':''} onClick={()=>setStep(index)}><i>{index+1}</i><span>{label}</span></button>)}</div>
  <div className="joining-card">
   <div className="joining-heading"><div><h2>{steps[step]}</h2><p>Complete all applicable details from the CMLL employee joining form.</p></div></div>
   {step===0&&<>
    <Section title="Joining & Personal Details"><div className="joining-grid">
     <Field label="Joining Category" required options={['OB','COAL','CORPORATE','HO']}/><Field label="Employee Code" required placeholder="Enter employee code"/><Field label="Full Name" required placeholder="As per Aadhaar"/><Field label="Father / Spouse Name" required placeholder="Enter full name"/><Field label="Date of Birth" type="date"/><Field label="Gender" options={['Male','Female','Other']}/><Field label="Caste / Category" options={['SC','ST','OBC','General']}/><Field label="Identification Mark"/><Field label="Blood Group" options={['A+','A-','B+','B-','AB+','AB-','O+','O-']}/><Field label="Mobile" required type="tel" placeholder="10-digit mobile number"/><Field label="Alternate Mobile" type="tel" placeholder="Optional"/><Field label="Candidate E-mail" required type="email" placeholder="name@example.com"/><Field label="Aadhaar No." required placeholder="12-digit Aadhaar number"/><Field label="PAN No." placeholder="Optional / as applicable"/><Field label="Present Address" type="textarea" wide placeholder="House, street, city, state, PIN"/><Field label="Permanent Address" type="textarea" wide placeholder="If same, write 'Same as present'"/><Field label="Emergency Contact Name"/><Field label="Emergency Contact Number" type="tel" placeholder="10-digit number"/>
    </div></Section>
    <Section title="Educational Details"><EntryTable columns={['Qualification','Board / University','Institute / College','Year of Passing','Percentage / CGPA']}/></Section>
    <Section title="Family Details"><EntryTable columns={['Family Member Name','Relationship','Date of Birth','Occupation','Dependent? (Y/N)']}/></Section>
   </>}
   {step===1&&<>
    <Section title="Job & Posting Details"><div className="joining-grid">
     <Field label="Site" required placeholder="Select site"/><Field label="Department" required placeholder="Select department"/><Field label="Sub-department" required placeholder="Select sub-department"/><Field label="Designation" required placeholder="Select designation"/><Field label="Grade" placeholder="Auto from designation master"/><Field label="Employee Category" options={['Staff','Worker','Driver','Operator','Security','Contract']} value={employeeCategory} onChange={setEmployeeCategory}/><Field label="Reporting To" placeholder="Name / designation"/><Field label="Joining Date" required type="date"/><Field label="Shift" required options={['General','Rotational']}/><Field label="Resident" options={['CAMP','LOCAL','Non-local']}/>
    </div></Section>
    {showMineCompliance&&<Section title="Mine Compliance (OB / COAL where applicable)"><div className="joining-grid">
     <Field label="VT Certificate No." placeholder="Required as applicable"/><Field label="VTC Centre Name" placeholder="Training centre"/><Field label="VTC Valid Upto" type="date"/><Field label="WUIN No." placeholder="If applicable"/><Field label="A-Form No." placeholder="If applicable"/><Field label="Medical Examination Date" required type="date"/><Field label="Medical Fitness Valid Upto" type="date"/><Field label="Medical Fitness Status" options={['Fit','Pending','Unfit']}/><Field label="Safety Induction Date" type="date"/><Field label="Driving Licence No." placeholder="Mandatory for drivers/operators where applicable"/><Field label="DL Class" options={['LMV','HMV','Transport','Other']}/><Field label="DL Issue Date" type="date"/><Field label="DL Valid Upto" type="date"/><Field label="Operator Competency Certificate" placeholder="No. / type / validity"/><Field label="Other Mine Permit / Training" type="textarea" wide placeholder="Details"/>
    </div></Section>}
    <Section title="Previous Work Experience"><EntryTable columns={['Employer Name','Designation','From Date','To Date','Last Drawn Salary / Reason for Leaving']}/></Section>
   </>}
   {step===2&&<>
    <Section title="Contract & Employment Details"><div className="joining-grid">
     <Field label="Employment Type" options={['Permanent','Fixed-term','Contract','Trainee']}/><Field label="Probation Period" placeholder="As per company policy"/><Field label="Confirmation Status" options={['Probation','Pending','Confirmed','Extended','Not Confirmed']}/><Field label="Salary Structure / Scheme" placeholder="Link to approved salary master"/><Field label="Monthly Gross Salary" type="number" placeholder="₹"/><Field label="Cost Centre / Project Code" placeholder="If applicable"/>
    </div></Section>
    <Section title="Declaration & Sign-off"><div className="joining-grid">
     <label className="joining-check wide"><input type="checkbox"/><span><strong>Candidate Declaration</strong><small>I declare that the information and documents submitted are true and complete.</small></span></label><Field label="Candidate Signature / Date"/><Field label="Prepared By (HR) / Date"/><Field label="Site HR Verification / Date"/><Field label="Final Approval Reference / Date"/><Field label="Employee Code (after approval)"/>
    </div></Section>
   </>}
   {step===3&&<Section title="Asset Details"><EntryTable columns={['Asset Type','Asset / Tag No.','Serial No.','Issue Date','Return Date','Remarks']}/></Section>}
   {step===4&&<Section title="Document Checklist"><div className="joining-table-wrap"><table className="joining-table documents-table"><thead><tr><th>S.No.</th><th>Document Name</th><th>Mandatory / Conditional</th><th>Upload</th><th>Verified By</th><th>Remarks</th></tr></thead><tbody>{visibleDocuments.map(([name,rule],index)=><tr key={name}><td>{index+1}</td><td>{name}</td><td>{rule}</td><td><input aria-label={`Upload ${name}`} type="file"/></td><td><input aria-label={`Verified by ${name}`}/></td><td><input aria-label={`Remarks for ${name}`}/></td></tr>)}</tbody></table></div></Section>}
   <div className="joining-actions"><button type="button" disabled={step===0} onClick={()=>setStep(step-1)}>Previous</button>{step<steps.length-1?<button type="button" className="next" onClick={()=>setStep(step+1)}>Save & Continue</button>:<button type="submit" className="next">Submit Employee</button>}</div>
  </div>
 </form>;
}

export default function EmployeeLocation({title='Employee Master',grant,module,notice,employeeGroup='Corporate / HO'}:{title?:string;grant?:string;module?:Module;notice?:(message:string)=>void;employeeGroup?:'Corporate / HO'|'OB / COAL'}){
 const[tab,setTab]=useState('Add New Employee');
 const[exportOpen,setExportOpen]=useState(false);
 const[type,setType]=useState<keyof typeof locations|''>(''),[location,setLocation]=useState('');
 const importInput=useRef<HTMLInputElement>(null),[importStatus,setImportStatus]=useState(''),[importError,setImportError]=useState(''),[importRows,setImportRows]=useState<Record<string,unknown>[]>([]),[importBusy,setImportBusy]=useState(false);
 const[employees,setEmployees]=useState<RecordRow[]>([]),[employeesLoading,setEmployeesLoading]=useState(false),[employeesError,setEmployeesError]=useState(''),[employeesVersion,setEmployeesVersion]=useState(0);
 useEffect(()=>{if(tab!=='Update Existing Employee'||!grant)return;let canceled=false;setEmployeesLoading(true);api<{rows:RecordRow[]}>(grant,'records/employees?page=1&search=&status=').then(result=>{if(!canceled){setEmployees(result.rows);setEmployeesError('');}}).catch(error=>{if(!canceled)setEmployeesError((error as Error).message);}).finally(()=>{if(!canceled)setEmployeesLoading(false);});return()=>{canceled=true;};},[tab,grant,employeesVersion]);
 async function importEmployees(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];if(!file)return;
  setImportStatus('');setImportError('');
  try{
   const extension=file.name.split('.').pop()?.toLowerCase();let rows:Record<string,unknown>[];
   if(employeeGroup==='OB / COAL')throw new Error('OB / COAL bulk import format is not configured yet');
   if(extension!=='xlsx'&&extension!=='xls')throw new Error('Choose the Corporate / HO Excel format (.xlsx or .xls)');
   const workbook=read(await file.arrayBuffer(),{type:'array'}),sheet=workbook.Sheets[workbook.SheetNames[0]];if(!sheet)throw new Error('The workbook does not contain a worksheet');
   const grid=utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:''});
   if(!validCorporateOfficeHeaders(grid[0]||[]))throw new Error('Use the Corporate / HO Employee Master Office Format columns');
   rows=utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:''}).map(corporateImportRow);
   if(!rows.length||rows.length>500)throw new Error('Choose a file with 1–500 employee rows');
   const invalidIndex=rows.findIndex(row=>!row.code||!row.name);if(invalidIndex>=0){const row=rows[invalidIndex];throw new Error(`Row ${invalidIndex+2}${row.name?` (${row.name})`:''}: ${!row.code?'Employee Code':'Full Name *'} is required`);}
   setImportRows(rows);
   setImportStatus(`${file.name} ready · ${rows.length} employee ${rows.length===1?'row':'rows'} loaded`);
  }catch(error){setImportRows([]);setImportError((error as Error).message);}finally{event.target.value='';}
 }
 async function saveImport(){if(!grant||!importRows.length)return;setImportBusy(true);setImportError('');try{const lookups=await api<Lookup[]>(grant,'lookups');const records=resolveCorporateReferences(importRows,lookups);const result=await api<{imported:number}>(grant,'import/employees','POST',{records});setImportRows([]);setImportStatus('');setEmployeesVersion(version=>version+1);setTab('Update Existing Employee');notice?.(`${result.imported} employee drafts saved to Azure`);}catch(error){setImportError((error as Error).message);}finally{setImportBusy(false);}}
 if(title==='Employee Master')return <section className="employee-master" aria-label="Employee Master"><div className="employee-tabs-row"><div className="employee-tabs">{tabs.map(value=><button key={value} className={tab===value?'selected':''} onClick={()=>setTab(value)}>{value}</button>)}</div><input ref={importInput} className="employee-import-input" aria-label="Import employee file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={event=>void importEmployees(event)}/><button className="employee-import" type="button" onClick={()=>importInput.current?.click()}><Upload/>Import</button><div className="employee-export"><button className="employee-import" type="button" aria-haspopup="menu" aria-expanded={exportOpen} onClick={()=>setExportOpen(open=>!open)}><Download/>Print/Export<ChevronDown/></button>{exportOpen&&<div className="employee-export-menu" role="menu"><button type="button" role="menuitem" onClick={()=>{downloadEmployeePdf();setExportOpen(false)}}><Download/>Download as PDF</button><button type="button" role="menuitem" onClick={()=>{downloadEmployeeExcel();setExportOpen(false)}}><FileSpreadsheet/>Download as Excel</button><button type="button" role="menuitem" onClick={()=>{window.print();setExportOpen(false)}}><Printer/>Smart Print</button></div>}</div></div>{importStatus&&<div className="employee-import-status" role="status"><span>{importStatus}</span>{grant&&<button type="button" disabled={importBusy} onClick={()=>void saveImport()}>{importBusy?'Importing…':`Import ${importRows.length} drafts`}</button>}</div>}{importError&&<p className="employee-import-error" role="alert">{importError}</p>}{tab==='Add New Employee'&&<JoiningForm employeeGroup={employeeGroup}/>} {tab==='Update Existing Employee'&&<ExistingEmployees rows={employees} loading={employeesLoading} error={employeesError} employeeGroup={employeeGroup}/>} {tab==='Region Employee Details'&&<RegionEmployeeDetails employeeGroup={employeeGroup}/>}</section>;
 return <section className="employee-master" aria-labelledby="employee-master-title"><div className="page-title"><h1 id="employee-master-title">{title}</h1></div><div className="employee-location-panel"><fieldset><legend>Site / Office</legend><div className="employee-location-types">{Object.keys(locations).map(value=><label key={value}><input type="radio" name="employee-location-type" value={value} checked={type===value} onChange={()=>{setType(value as keyof typeof locations);setLocation('')}}/>{value}</label>)}</div></fieldset>{type&&<div className="employee-location-select"><label htmlFor="employee-location">{type}</label><select id="employee-location" value={location} onChange={event=>setLocation(event.target.value)}><option value="">Select {type.toLowerCase()}</option>{locations[type].map(value=><option key={value} value={value}>{value}</option>)}</select></div>}</div></section>;
}
