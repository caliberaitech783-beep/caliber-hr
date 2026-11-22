import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
// @ts-expect-error Shared server schema is JavaScript.
import {requestFields} from '../server/leave.mjs';
// @ts-expect-error Shared server schema is JavaScript.
import {modules} from '../server/modules.mjs';
afterEach(()=>vi.unstubAllGlobals());
it('shows leave fields, calculates days, accepts dictated text reasons and keeps attachments optional',async()=>{
 let saved:any;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
  if(options?.method==='POST'){saved=JSON.parse(options.body);return new Response('{}');}
  return new Response(JSON.stringify(url.endsWith('/lookups')?[{id:'employee',kind:'employees',code:'E-01',name:'Test Employee'},{id:'company',kind:'companies',code:'C-01',name:'Test Company'},{id:'site',kind:'sites',code:'SITE-01',name:'Nagpur CO'},{id:'cl',kind:'leaveTypes',code:'CL',name:'Casual leave'},{id:'p26',kind:'leavePeriods',code:'P26',name:'2026-27'}]:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="test" kind="leaveRequests" module={{title:'Leave requests',menu:'Holiday & Leave',fields:requestFields,autoCode:true,canWrite:true}} notice={()=>{}} actionLabel="Apply leave"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply leave'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply leave'}));
 fireEvent.change(screen.getByLabelText(/Date \(from\)/),{target:{value:'2026-10-26'}});
 fireEvent.change(screen.getByLabelText(/Date \(to\)/),{target:{value:'2026-10-28'}});
 fireEvent.change(screen.getByLabelText(/Employee ID/),{target:{value:'employee'}});
 fireEvent.change(screen.getByLabelText('Location'),{target:{value:'site'}});
 expect(screen.getByLabelText('Location')).toHaveValue('site');
 expect(screen.getByLabelText('Name')).toHaveValue('Test Employee');
 expect(screen.getByLabelText('No. of Days')).toHaveValue(3);
 expect(screen.getByLabelText(/Attachment \(optional/)).not.toBeRequired();
 expect(screen.queryByLabelText('Upload audio reason')).toBeNull();
 expect(screen.getByRole('button',{name:'Speak reason'})).toBeTruthy();
 expect(screen.getByLabelText('Reason (write-up)')).toBeRequired();
 fireEvent.change(screen.getByLabelText('Reason (write-up)'),{target:{value:'Medical appointment'}});
 expect(screen.queryByLabelText(/Reporting to/)).toBeNull();
 fireEvent.change(screen.getByLabelText(/Leave type/),{target:{value:'cl'}});fireEvent.change(screen.getByLabelText(/Period/),{target:{value:'p26'}});
 expect(screen.getByRole('progressbar',{name:'Form completion'})).toHaveAttribute('aria-valuenow','100');
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(saved?.name).toBe('Medical appointment'));
 expect(saved.siteId).toBe('site');
 expect(saved.approver).toBeUndefined();expect(saved.attachment).toBeUndefined();
});

it('marks missing leave fields in red instead of saving, and submits once complete',async()=>{
 const posts:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
  if(options?.method==='POST'){posts.push(url);return new Response(JSON.stringify({id:'00000000-0000-4000-8000-000000000001',version:1}));}
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Test Employee',companyId:'company',siteId:'site',department:'',designation:''},route:['HOD (concerned)','PM Sir','Regional HR','Directors'],routeNote:''}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?[{id:'employee',kind:'employees',code:'E-01',name:'Test Employee'},{id:'company',kind:'companies',code:'C-01',name:'Test Company'},{id:'site',kind:'sites',code:'SITE-01',name:'Nagpur CO'},{id:'cl',kind:'leaveTypes',code:'CL',name:'Casual leave'},{id:'p26',kind:'leavePeriods',code:'P26',name:'2026-27'}]:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="test" kind="leaveRequests" module={{title:'Leave requests',menu:'Holiday & Leave',fields:requestFields,autoCode:true,canWrite:true}} notice={()=>{}} actionLabel="Apply leave"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply leave'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply leave'}));
 expect(screen.getByRole('heading',{name:'Apply leave'})).toBeTruthy();
 expect(screen.getByText('0 of 6 required filled')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Submit for approval'}));
 expect(await screen.findByText('Fill the 6 fields marked in red.')).toBeTruthy();
 expect(screen.getAllByText('Fill this field')).toHaveLength(6);
 expect(posts).toHaveLength(0);
 fireEvent.change(screen.getByLabelText(/Employee ID/),{target:{value:'employee'}});
 expect(await screen.findByText('PM Sir')).toBeTruthy();
 await waitFor(()=>expect(screen.getByLabelText('Company')).toHaveValue('company'));
 expect(screen.getByLabelText('Location')).toHaveValue('site');
 fireEvent.change(screen.getByLabelText(/Date \(from\)/),{target:{value:'2026-10-28'}});
 fireEvent.change(screen.getByLabelText(/Date \(to\)/),{target:{value:'2026-10-26'}});
 expect(screen.getByText('Date (to) must be on or after the from date.')).toBeTruthy();
 fireEvent.change(screen.getByLabelText(/Date \(to\)/),{target:{value:'2026-10-29'}});
 fireEvent.change(screen.getByLabelText(/Leave type/),{target:{value:'cl'}});fireEvent.change(screen.getByLabelText(/Period/),{target:{value:'p26'}});
 fireEvent.change(screen.getByLabelText('Reason (write-up)'),{target:{value:'Family function'}});
 expect(screen.getByText('All required fields filled · ready to submit')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Submit for approval'}));
 await waitFor(()=>expect(posts.some(u=>u.endsWith('/submit'))).toBe(true));
});

it('prefills the Pulse employee and Caliber company while limiting locations to assigned lookups',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?[
  {id:'employee',kind:'employees',code:'E-01',name:'Pulse Employee'},
  {id:'company',kind:'companies',code:'CMLL',name:'CALIBER MINING AND LOGISTICS LIMITED'},
  {id:'site-a',kind:'sites',code:'SITE-A',name:'Sasti OC'},
  {id:'site-b',kind:'sites',code:'SITE-B',name:'Majri OC'},
 ]:{rows:[],total:0,page:1,pageSize:50}))));
 render(<Records grant="test" kind="leaveRequests" module={{title:'Leave requests',menu:'Holiday & Leave',fields:requestFields,autoCode:true,canWrite:true}} notice={()=>{}} actionLabel="Apply leave" pulseIdentity/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply leave'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply leave'}));
 expect(screen.getByLabelText(/Employee ID/)).toHaveValue('employee');
 expect(screen.getByLabelText(/Employee ID/)).toBeDisabled();
 expect(screen.getByLabelText('Name')).toHaveValue('Pulse Employee');
 expect(screen.getByLabelText('Company')).toHaveValue('company');
 expect(screen.getByLabelText('Company')).toBeDisabled();
 expect(screen.getByLabelText('Location')).toHaveValue('');
 expect(screen.getByLabelText('Location').querySelectorAll('option')).toHaveLength(3);
});

for(const [kind,button] of [['outDutyRequests','Add OD form'],['gatePasses','Apply gate pass']] as const)it(`prefills Pulse identity in ${kind}`,async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Pulse Employee',companyId:'company',siteId:'site',department:'Workshop',designation:'Engineer'},route:[],routeNote:''}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?[
   {id:'employee',kind:'employees',code:'E-01',name:'Pulse Employee'},
   {id:'company',kind:'companies',code:'CMLL',name:'CALIBER MINING AND LOGISTICS LIMITED'},
   {id:'site',kind:'sites',code:'SITE-A',name:'Sasti OC'},
  ]:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="test" kind={kind} module={{...modules[kind],canWrite:true}} notice={()=>{}} actionLabel={button} pulseIdentity/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:button})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:button}));
 await waitFor(()=>expect(screen.getByLabelText(/Employee name/)).toHaveValue('Pulse Employee'));
 expect(screen.getByLabelText(/Employee ID/)).toHaveValue('employee');
 expect(screen.getByLabelText(/Employee ID/)).toBeDisabled();
 expect(screen.getByLabelText('Company')).toHaveValue('company');
 expect(screen.getByLabelText('Company')).toBeDisabled();
 expect(screen.getByLabelText(kind==='outDutyRequests'?/Site \/ Location/:/^Location/)).toHaveValue('site');
});
