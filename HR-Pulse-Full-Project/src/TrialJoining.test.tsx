import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EmployeeLocation from './EmployeeLocation';
import * as drafts from './joiningDrafts';
import {prepareTrialJoining,saveTrialHandoff} from './trialHandoff';
import {DOCS,type Trial} from './trial-workflow-preview/records';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});

it('opens a completed operator trial at step two and saves it on the sixth step without employee approval',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const row:Trial={
  id,formNo:'TF/2026-27/0001',stage:'done',result:'PASS',site:'Jayant OB East',name:'Sample Candidate',
  father:'Sample Parent',dob:'2000-04-02',mobile:'9876543210',aadhaar:'',address:'Sample Address',
  dl:'DL123',dlValid:'2028-01-01',referredBy:'Sample Referrer',employer:'Sample Employer',
  batch:'',createdAt:'2026-11-12',trialDate:'2026-11-12T10:00',photo:'',post:'Driver',experience:'',vehicles:['Excavator'],otherVehicle:'',
  docs:Object.fromEntries(DOCS.map(([key])=>[key,{seen:'',remarks:''}])) as Trial['docs'],
  outcome:{at:'2026-11-12',result:'PASS',post:'Operator',machine:'Excavator',reason:'',trainer:'Sample Trainer',remarks:''},
  history:[{role:'pm',by:'Sample PM',at:'2026-11-12',action:'Approved'},{role:'rhr',by:'Sample RHR',at:'2026-11-12',action:'Approved'},{role:'director',by:'Sample Director',at:'2026-11-12',action:'Approved'}],
 };
 const saved=new Map<string,drafts.JoiningDraft>();
 vi.spyOn(drafts,'listJoiningDrafts').mockImplementation(async()=>[...saved.values()]);
 vi.spyOn(drafts,'saveJoiningDraft').mockImplementation(async draft=>{saved.set(draft.id,draft);});
 vi.spyOn(drafts,'removeJoiningDraft').mockImplementation(async key=>{saved.delete(key);});
 vi.spyOn(drafts,'saveEmployeeDocuments').mockResolvedValue(undefined);
 const handoff=await prepareTrialJoining([{...row,id:'failed',result:'FAIL'},row],{
  employeeGroup:'OB / COAL',company:'Caliber Mining And Logistics Ltd',region:'NCL',site:'Jayant OB East',department:'Driver',subdepartment:'Heavy Vehicles',designation:'Tipper Driver',
 },'site-hr');
 expect(saved.size).toBe(1);
 const preparedDraft=[...saved.values()][0];
 expect(preparedDraft.step).toBe(1);
 saved.set(preparedDraft.id,{...preparedDraft,step:0});
 saveTrialHandoff(handoff!,{});
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
 expect(screen.getByRole('heading',{name:'Joining & Personal Details',level:2})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Upload Aadhaar Card'})).toBeNull();
 for(let index=0;index<4;index++)await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save & Continue'}));});
 expect(screen.getByRole('heading',{name:'Document Checklist',level:2})).toBeInTheDocument();
 const form=container.querySelector<HTMLFormElement>('.joining-form')!;
 for(const control of form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[required]')){
  if(control.value||control.disabled)continue;
  if(control instanceof HTMLSelectElement){if(control.options.length>1)fireEvent.change(control,{target:{value:control.options[1].value}});continue;}
  const name=control.name;
  if(control instanceof HTMLInputElement&&control.type==='file'){
   fireEvent.change(control,{target:{files:[new File(['sample'],'sample.jpg',{type:'image/jpeg'})]}});
   continue;
  }
  const value=name==='Employee Code'?'EMP-TEST':name==='PAN No.'?'ABCDE1234F':name==='Aadhaar No.'?'234500000000':control instanceof HTMLInputElement&&control.type==='date'?'2026-11-12':control instanceof HTMLInputElement&&control.type==='email'?'sample@example.test':control instanceof HTMLInputElement&&control.type==='tel'?'9876543211':'Sample';
  fireEvent.change(control,{target:{value}});
 }
 // The selected recommendation changed from Driver to Operator, so choose its posting.
 fireEvent.change(screen.getByRole('combobox',{name:'Sub-department'}),{target:{value:'Drilling'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Designation'}),{target:{value:'Excavator Operator'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save Employee'}));});
 await waitFor(()=>{
  expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
  expect(request.mock.calls.some(([url])=>url.endsWith('/import/trial-employee'))).toBe(true);
 });
 expect(request.mock.calls.some(([url])=>url.endsWith('/import/employees')||url.includes('joining-approvers'))).toBe(false);
});
