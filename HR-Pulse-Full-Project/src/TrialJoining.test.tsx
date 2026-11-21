import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EmployeeLocation from './EmployeeLocation';
import * as drafts from './joiningDrafts';
import {prepareTrialJoining,saveTrialHandoff} from './trialHandoff';
import {DOCS,type Trial} from './trial-workflow-preview/records';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
it('locks an existing joining draft when the trial skipped the approval chain',async()=>{
 const clearance={id:'trial',formNo:'TF/2026-27/0001',name:'Pending Candidate',mobile:'9876543210',aadhaar:'',site:'Jayant OB East',post:'Driver' as const,stage:'done' as const,result:'PASS' as const,history:[]};
 const handoff={id:clearance.id,formNo:clearance.formNo,name:clearance.name,site:clearance.site,post:clearance.post,fields:{},owner:'site-hr',clearance};
 const draft:drafts.JoiningDraft={id:'draft',owner:'site-hr',group:'OB / COAL',step:1,category:'Driver',defaults:{joiningCategory:'NCL',site:'Jayant OB East',department:'Driver',subdepartment:'Heavy Vehicles',designation:'Tipper Driver'},fields:{},updatedAt:'2026-11-19',trialHandoff:handoff};
 vi.spyOn(drafts,'listJoiningDrafts').mockResolvedValue([]);
 vi.stubGlobal('fetch',async()=>Response.json({rows:[],total:0}));
 render(<EmployeeLocation draftOwner="site-hr" employeeGroup="OB / COAL" initialTrialDraft={draft}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Joining details are locked until PM, Office HR, Regional HR and Director approvals are complete');
 expect(screen.queryByRole('heading',{name:'Joining & Personal Details',level:2})).toBeNull();
});

it('opens a completed operator trial at step two and saves it on the sixth step without employee approval',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const row:Trial={
  id,formNo:'TF/2026-27/0001',stage:'done',result:'PASS',site:'Jayant OB East',name:'Sample Candidate',
  father:'Sample Parent',dob:'2000-04-02',mobile:'9876543210',aadhaar:'',address:'Sample Address',
  dl:'DL123',dlValid:'2028-01-01',referredBy:'Sample Referrer',employer:'Sample Employer',
  batch:'',createdAt:'2026-11-12',trialDate:'2026-11-12T10:00',photo:'data:image/jpeg;base64,cGhvdG8=',post:'Driver',experience:'',vehicles:['Excavator'],otherVehicle:'',
  docs:Object.fromEntries(DOCS.map(([key])=>[key,{seen:'',remarks:''}])) as Trial['docs'],
  outcome:{at:'2026-11-12',result:'PASS',post:'Operator',machine:'Excavator',reason:'',trainer:'Sample Trainer',remarks:''},
  history:[{role:'pm',by:'Sample PM',at:'2026-11-12',action:'Approved'},{role:'ohr',by:'Sample Office HR',at:'2026-11-12',action:'Approved'},{role:'rhr',by:'Sample RHR',at:'2026-11-12',action:'Approved'},{role:'director',by:'Sample Director',at:'2026-11-12',action:'Approved'}],
 };
 const saved=new Map<string,drafts.JoiningDraft>();
 vi.spyOn(drafts,'listJoiningDrafts').mockImplementation(async()=>[...saved.values()]);
 vi.spyOn(drafts,'saveJoiningDraft').mockImplementation(async draft=>{saved.set(draft.id,draft);});
 vi.spyOn(drafts,'removeJoiningDraft').mockImplementation(async key=>{saved.delete(key);});
 vi.spyOn(drafts,'saveEmployeeDocuments').mockResolvedValue(undefined);
 const aadhaarFile=new File(['aadhaar'],'trial-aadhaar.jpg',{type:'image/jpeg'}),licenceFile=new File(['licence'],'trial-licence.jpg',{type:'image/jpeg'});
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile:{name:'Site HR',permissions:{application:'HR'}}}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{attachments:[
  {name:aadhaarFile.name,mime:aadhaarFile.type,kind:'aadhaar',data:'YWFkaGFhcg=='},
  {name:licenceFile.name,mime:licenceFile.type,kind:'drivingLicence',data:'bGljZW5jZQ=='},
 ]}})));
 const preparedDraft=await prepareTrialJoining([{...row,id:'failed',result:'FAIL'},row],{
  employeeGroup:'OB / COAL',company:'Caliber Mining And Logistics Ltd',region:'NCL',site:'Jayant OB East',department:'Driver',subdepartment:'Heavy Vehicles',designation:'Tipper Driver',
 },'site-hr');
 expect(saved.size).toBe(1);
 expect(preparedDraft?.step).toBe(1);
 saved.set(preparedDraft!.id,{...preparedDraft!,step:0});
 saveTrialHandoff(preparedDraft!.trialHandoff!,{});
 const request=vi.fn(async (url:string)=>{
  if(url.endsWith('/lookups'))return Response.json([{id,kind:'companies',code:'CMLL',name:'Caliber Mining and Logistics'},{id,kind:'sites',code:'NCL-JAYANT',name:'Jayant OB'}]);
  if(url.endsWith('/import/trial-employee'))return Response.json({imported:1,submitted:0,status:'ACTIVE'});
  return Response.json({rows:[],total:0});
 });
 vi.stubGlobal('fetch',request);
 const {container}=render(<EmployeeLocation grant={'a'.repeat(43)} draftOwner="site-hr" employeeGroup="OB / COAL"/>);
 await screen.findByText(/Candidate details are prefilled/);
 expect(screen.getByLabelText(/^Full Name \*/)).toHaveValue('Sample Candidate');
 expect(screen.getByLabelText(/^Mobile \*/)).toHaveValue('9876543210');
 expect(screen.getByLabelText(/^Aadhaar No\./)).toHaveValue('');
 expect(screen.getByLabelText(/^Trial Form No\./)).toHaveValue(row.formNo);
 const fullName=screen.getByLabelText(/^Full Name \*/) as HTMLInputElement;
 expect(fullName).not.toHaveAttribute('readonly');
 expect(fullName).not.toHaveClass('trial-handoff-locked');
 for(const label of [/^Full Name as per Aadhaar/,/^Mobile \*/,/^Trial Form No\./]){
  const control=screen.getByLabelText(label) as HTMLInputElement;
  expect(control).toHaveAttribute('readonly');
  expect(control).toHaveClass('trial-handoff-locked');
 }
 expect(screen.getByLabelText(/^A-Form No\./)).not.toHaveClass('trial-handoff-locked');
 expect(screen.getByRole('heading',{name:'Joining & Personal Details',level:2})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Upload Aadhaar Card'})).toBeNull();
 await waitFor(()=>{
  expect((screen.getByLabelText('Upload Candidate photo') as HTMLInputElement).files?.[0]?.name).toBe('trial-candidate.jpg');
  expect((screen.getByLabelText('Upload Aadhaar (masked display)') as HTMLInputElement).files?.[0]?.name).toBe(aadhaarFile.name);
  expect((screen.getByLabelText('Upload Driving licence') as HTMLInputElement).files?.[0]?.name).toBe(licenceFile.name);
 });
 const form=container.querySelector<HTMLFormElement>('.joining-form')!;
 for(const control of form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[required]')){
  if(control.value||control.disabled||control instanceof HTMLInputElement&&control.type==='file'&&control.files?.length)continue;
  if(control instanceof HTMLSelectElement){if(control.options.length>1)fireEvent.change(control,{target:{value:control.name==='Marital Status'?'Unmarried':control.options[1].value}});continue;}
  const name=control.name;
  if(control instanceof HTMLInputElement&&control.type==='file'){
   fireEvent.change(control,{target:{files:[new File(['sample'],'sample.jpg',{type:'image/jpeg'})]}});
   continue;
  }
  const value=name==='Monthly Gross Salary'?'30000':name==='Employee Code'?'EMP-TEST':name==='PAN No.'?'ABCDE1234F':name==='Aadhaar No.'||name.startsWith('Aadhaar Number')?'234500000000':control instanceof HTMLInputElement&&control.type==='date'?'2026-11-12':control instanceof HTMLInputElement&&control.type==='email'?'sample@example.test':control instanceof HTMLInputElement&&control.type==='tel'?'9876543211':'Sample';
  fireEvent.change(control,{target:{value}});
 }
 // The selected recommendation changed from Driver to Operator, so choose its posting.
 fireEvent.change(screen.getByLabelText('Date of Birth 1'),{target:{value:'01/01/1970'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Sub-department'}),{target:{value:'Drilling'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Designation'}),{target:{value:'Excavator Operator'}});
 fireEvent.change(screen.getByLabelText(/^Mess Plan/),{target:{value:'NO'}});
 fireEvent.input(screen.getByLabelText('Date of Birth 1'),{target:{value:'15032000'}});
 for(let index=0;index<4;index++){
  const relationship=screen.queryByLabelText('Relationship 1');
  if(relationship){
   fireEvent.change(screen.getByLabelText('Family Member Name 1'),{target:{value:'Sample Partner'}});
   fireEvent.change(relationship,{target:{value:'Husband/Wife'}});
  }
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save & Continue'}));});
  expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
 }
 expect(screen.getByRole('heading',{name:'Document Checklist',level:2})).toBeInTheDocument();
 expect((screen.getByLabelText('Upload Candidate photo') as HTMLInputElement).files?.[0]?.name).toBe('trial-candidate.jpg');
 expect((screen.getByLabelText('Upload Aadhaar (masked display)') as HTMLInputElement).files?.[0]?.name).toBe(aadhaarFile.name);
 expect((screen.getByLabelText('Upload Driving licence') as HTMLInputElement).files?.[0]?.name).toBe(licenceFile.name);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save Employee'}));});
 await waitFor(()=>{
  expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
  expect(request.mock.calls.some(([url])=>url.endsWith('/import/trial-employee'))).toBe(true);
 });
 expect(request.mock.calls.some(([url])=>url.endsWith('/import/employees')||url.includes('joining-approvers'))).toBe(false);
},15_000);
