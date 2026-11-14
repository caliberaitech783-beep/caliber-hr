import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import App from './App';
import * as joiningDrafts from './joiningDrafts';
import {DOCS,type Trial} from './trial-workflow-preview/records';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});
it('hides Administration even when assigned in the Pulse session',async()=>{
 const profile={name:'Test user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Dashboard','Administration']}};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('validate')?{profile}:url.endsWith('config')?{profile,modules:{}}:{counts:[],sites:[]})));
 render(<App/>);await screen.findByRole('heading',{name:'Dashboard'},{timeout:3000});expect(screen.queryByRole('button',{name:'Administration'})).toBeNull();
});
describe('HR Pulse',()=>{it('shows login',()=>{render(<App/>);expect(screen.getByText('Sign in to your workspace')).not.toBeNull()});it('toggles password visibility',()=>{render(<App/>);const password=screen.getByLabelText('Password');expect(password.getAttribute('type')).toBe('password');fireEvent.click(screen.getByRole('button',{name:'Toggle password'}));expect(password.getAttribute('type')).toBe('text')})});

it('opens the full trial workflow directly from the Trial Form menu',async()=>{
 const profile={name:'HR user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};
 window.location.hash='Employee%20Master';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async()=>Response.json({profile,modules:{}}));
 const {container}=render(<App/>);
 fireEvent.change(await screen.findByRole('combobox',{name:/^Department$/}),{target:{value:'Driver'}});
 fireEvent.click(await screen.findByRole('button',{name:/^Trial Form$/}));
 await screen.findByRole('button',{name:'Upload Aadhaar Image 1'});
 expect(screen.queryByRole('group',{name:'Trial Form views'})).toBeNull();
 const preview=container.querySelector('[aria-label="Trial workflow local preview"]')?.shadowRoot;
 expect(preview?.querySelector('#tabs button[aria-pressed="true"]')).toHaveTextContent('Upload Aadhaar');
 const stages=preview?.querySelector('#pipe');
 expect(stages).toHaveAttribute('hidden');
 expect(Array.from(stages?.querySelectorAll('.l')??[],label=>label.textContent))
  .toEqual(['Trial pending','Completed','Rejected']);
 expect(screen.getByRole('button',{name:'Upload Aadhaar Image 1'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Upload Aadhaar Image 2'})).toBeEnabled();
 expect(Array.from(preview?.querySelectorAll('#tabs button')??[],button=>button.getAttribute('data-tab')))
  .toEqual(['aadhaar','hr','trainer','approve','overview']);
 for(const tab of ['hr','trainer','approve','overview']){
  fireEvent.click(preview!.querySelector(`[data-tab="${tab}"]`)!);
  expect(stages).not.toHaveAttribute('hidden');
 }
 fireEvent.click(preview!.querySelector('[data-tab="aadhaar"]')!);
 expect(stages).toHaveAttribute('hidden');
 window.location.hash='';
});

it('finds candidates saved under the original sign-in and current HR account keys, and opens Step 2',async()=>{
 const profile={name:'HR user',username:'TestUser',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};
 const currentProfile={...profile,name:'Configured HR user',actor:'testuser'};
 window.location.hash='Employee%20Master';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json({profile:url.endsWith('/config')?currentProfile:profile,modules:{}}));
 vi.spyOn(joiningDrafts,'listJoiningDrafts').mockResolvedValue([]);
 const saveDraft=vi.spyOn(joiningDrafts,'saveJoiningDraft').mockResolvedValue(undefined);
 const writeStorage=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this: Storage,key,value){
  if(key==='hrPulse.trialHandoff')throw new DOMException('Storage full','QuotaExceededError');
  writeStorage.call(this,key,value);
 });
 const trial:Trial={
  id:'passed',formNo:'TF/2026-27/0001',stage:'done',result:'PASS',site:'Jayant OB East',name:'Sample Driver',
  father:'Sample Parent',dob:'2000-04-02',mobile:'9876543210',aadhaar:'',address:'Sample Address',
  dl:'DL123',dlValid:'',referredBy:'',employer:'',batch:'',createdAt:'2026-11-12',trialDate:'2026-11-12T10:00',
  photo:'',post:'Driver',experience:'',vehicles:['Excavator'],otherVehicle:'',
  docs:Object.fromEntries(DOCS.map(([key])=>[key,{seen:'',remarks:''}])) as Trial['docs'],
  history:[{role:'director',action:'Approved',by:'Sample Director',at:'2026-11-12'}],
  outcome:{at:'2026-11-12',result:'PASS',post:'Driver',machine:'Excavator',reason:'',trainer:'Sample Trainer',remarks:''},
 };
 const failed={...trial,id:'failed',formNo:'TF/2026-27/0002',result:'FAIL',name:'Failed trial'};
 const pending={...trial,stage:'trainer',result:'',outcome:undefined};
 const other={...trial,id:'unrelated',formNo:'TF/2026-27/0003',name:'Other account candidate'};
 const key=(owner:string)=>'hrPulse.localTrialWorkflow.v1:'+JSON.stringify([owner,'','']);
 localStorage.setItem(key('TestUser'),JSON.stringify([trial]));
 localStorage.setItem(key('testuser'),JSON.stringify([failed,{...pending,history:[]}]));
 localStorage.setItem(key('other'),JSON.stringify([other]));
 const {container}=render(<App/>);
 await screen.findAllByText('Configured HR user');
 fireEvent.change(await screen.findByRole('combobox',{name:'Department'}),{target:{value:'Driver'}});
 fireEvent.click(await screen.findByRole('button',{name:'Trial Form'}));
 await screen.findByRole('button',{name:'Upload Aadhaar Image 1'});
 const preview=container.querySelector('[aria-label="Trial workflow local preview"]')!.shadowRoot!;
 fireEvent.click(preview.querySelector('[data-tab="overview"]')!);
 expect(preview.querySelector('#ovList')).toHaveTextContent(trial.name);
 expect(preview.querySelector('#ovList')).toHaveTextContent(failed.name);
 expect(preview.querySelector('#ovList')).not.toHaveTextContent(other.name);
 expect(preview.querySelectorAll('#ovList [data-open="passed"]')).toHaveLength(1);
 fireEvent.click(preview.querySelector('[data-stage="done"]')!);
 expect(preview.querySelector('[data-join-trial="failed"]')).toBeNull();
 const open=preview.querySelector('[data-join-trial="passed"]')!;
 expect(open).toHaveTextContent('Open Step 2');
 fireEvent.click(open);
 expect(await screen.findByRole('heading',{name:'Joining & Personal Details',level:2})).toBeVisible();
 expect(screen.getByLabelText(/^Full Name \*/)).toHaveValue(trial.name);
 expect(screen.getByLabelText(/^Mobile \*/)).toHaveValue(trial.mobile);
 expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({owner:'testuser',step:1,trialHandoff:expect.objectContaining({id:trial.id})}));
 const trialDraftIds=saveDraft.mock.calls.flatMap(([draft])=>draft.trialHandoff?.id===trial.id?[draft.id]:[]);
 expect(new Set(trialDraftIds).size).toBe(1);
 window.location.hash='';
});

it('shows employee and payroll submenus inside the sidebar',async()=>{
 const profile={name:'HR user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};
 window.location.hash='Employee%20Master';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({profile,modules:{}})));
 render(<App/>);
 await screen.findByRole('button',{name:'Attendance Management'});
 const sidebar=screen.getByRole('complementary');
 expect(within(sidebar).getByRole('button',{name:'Leave/OD Management'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Attendance Management'}));
 expect(screen.getByRole('heading',{name:'Attendance Management'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Employee Management'}));
 expect(screen.getByRole('button',{name:'Employee Management'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Payroll Management'}));
 await screen.findByRole('button',{name:'Salary Scheme'});
 expect(within(sidebar).getByRole('button',{name:'Salary Scheme'})).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Salary Scheme Master'})).toBeTruthy();
 for(const name of ['Payroll Processing','Loan and Advances','Expense Claims']){
  fireEvent.click(screen.getByRole('button',{name}));
  expect(screen.getByRole('heading',{name})).toBeTruthy();
 }
 fireEvent.click(screen.getByRole('button',{name:'Asset Management'}));
 expect(screen.getByRole('heading',{name:'Asset Management',level:1})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Calendar'}));
 expect(screen.getByRole('heading',{name:'HR Calendar',level:2})).toBeTruthy();
 window.location.hash='';
});

it.each([true,false])('opens Employee Master from Master Configuration according to employee access (%s)',async(hasEmployeeAccess)=>{
 const profile={name:'HR administrator',actor:'test',permissions:{application:'HR',hrDesktopAccess:hasEmployeeAccess?['Master Configuration','Employee Master']:['Master Configuration']}};
 window.location.hash='Master%20Configuration';
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>Response.json(url.endsWith('/config')?{profile,modules:{}}:url.endsWith('/lookups')?[]:{rows:[],total:0,page:1,pageSize:50}));
 render(<App/>);
 const configuration=await screen.findByRole('region',{name:'Master Configuration'});
 const employeeTab=within(configuration).getByRole('button',{name:'Employee Master'});
 fireEvent.click(employeeTab);
 expect(employeeTab).toHaveAttribute('aria-pressed','true');
 if(hasEmployeeAccess){
  expect(within(configuration).getByRole('region',{name:'Employee Master'})).toBeVisible();
  expect(within(configuration).getByRole('button',{name:'Update Existing Employee'})).toBeVisible();
 }else{
  expect(within(configuration).getByText('Employee Master access is required to manage employees.')).toBeVisible();
 }
 window.location.hash='';
});

 it('opens the existing hierarchy setup screens from Approval Master',async()=>{
  const profile={name:'HR administrator',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Master Configuration']}};
  window.location.hash='Approval%20Master';
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
  const fetchMock=vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('validate')?{profile}:url.endsWith('config')?{profile,modules:{}}:url.endsWith('telegram/account')?{configured:false,connected:false}:url.endsWith('telegram/hierarchies')?{sites:[],accounts:[],employees:[],deliveries:[]}:url.endsWith('hierarchies')?{rows:[],canWrite:true}:{})));
  vi.stubGlobal('fetch',fetchMock);
  render(<App/>);
  expect(await screen.findByRole('button',{name:'Approval Master'})).toBeTruthy();
  await screen.findByRole('heading',{name:'Joining Approval Hierarchy'});
  fireEvent.click(screen.getByRole('button',{name:'Leave'}));
  await screen.findByRole('heading',{name:'Leave Approval Flow'});
  expect(await screen.findByRole('button',{name:'Save leave flow'})).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url])=>url.endsWith('telegram/hierarchies'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'OD'}));
  expect(screen.getByRole('heading',{name:'OD Approval Flow'})).toBeTruthy();
  expect(await screen.findByRole('button',{name:'Save OD flow'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Hierarchy'}));
  await screen.findByRole('heading',{name:'Joining Approval Hierarchy'});
  window.location.hash='';
 });

it('restores a saved session with one authenticated configuration request',async()=>{
 const profile={name:'Saved user',actor:'test',permissions:{application:'HR',hrDesktopAccess:[]}};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 const request=vi.fn(async()=>Response.json({profile,modules:{}}));
 vi.stubGlobal('fetch',request);
 render(<App/>,{reactStrictMode:true});
 await screen.findByText('No HR menus are assigned. Contact your Pulse administrator.');
 expect(request).toHaveBeenCalledTimes(1);
 expect(request).toHaveBeenCalledWith(expect.stringMatching(/\/api\/config$/),expect.anything());
});

it('keeps the saved session during an API outage and retries configuration',async()=>{
 const profile={name:'Saved user',actor:'test',permissions:{application:'HR',hrDesktopAccess:[]}};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 const request=vi.fn()
  .mockResolvedValueOnce(new Response('<html>Service unavailable</html>',{status:503}))
  .mockResolvedValueOnce(Response.json({profile,modules:{}}));
 vi.stubGlobal('fetch',request);
 render(<App/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Unable to complete the request');
 expect(sessionStorage.getItem('hrPulseSession')).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry connection'}));
 await screen.findByText('No HR menus are assigned. Contact your Pulse administrator.');
 expect(request).toHaveBeenCalledTimes(2);
});

it('returns to sign-in when the HR API rejects a saved session',async()=>{
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
 vi.stubGlobal('fetch',async()=>new Response(null,{status:401}));
 render(<App/>);
 await screen.findByRole('button',{name:'Sign in'});
 await waitFor(()=>expect(sessionStorage.getItem('hrPulseSession')).toBeNull());
});
