import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
// @ts-expect-error Shared server schema is JavaScript.
import {modules} from '../server/modules.mjs';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const lookups=[{id:'employee',kind:'employees',code:'CMLL00012',name:'Apurva Kopulwar'},{id:'site',kind:'sites',code:'CMLL-HO',name:'Nagpur HO'}];
const gateModule={title:'Gate Pass',menu:'Employee Master',fields:modules.gatePasses.fields,autoCode:true,canWrite:true};

it('draws gate passes as cards with the gate out time on the step bar',async()=>{
 const row={id:'r1',kind:'gatePasses',code:'GP-7',name:'Apurva Kopulwar',status:'PENDING',version:2,updated_at:'2026-11-20T07:00:00Z',data:{employeeId:'employee',name:'Apurva Kopulwar',passDate:'2026-11-20',outTime:'13:00',returnTime:'15:00',passType:'Personal'},progress:{state:'PENDING',stage:2,steps:[{label:'HOD',at:'2026-11-20T07:20:00Z'},{label:'Gate out',at:'2026-11-20T07:34:00Z'},{label:'Back in'}]}};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[row],total:1,page:1,pageSize:50}))));
 render(<Records grant="t" kind="gatePasses" module={gateModule} notice={()=>{}} actionLabel="Apply gate pass"/>);
 expect(await screen.findByText('Pending · step 4 of 4')).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Gate Pass'})).toBeTruthy();
 expect(screen.getByText(/Out 13:00 → back 15:00/)).toBeTruthy();
 expect(screen.getByText('Gate out')).toBeTruthy();expect(screen.getByText('Back in')).toBeTruthy();
 expect(screen.getAllByText(/20 Nov/).length).toBeGreaterThan(0);
 expect(screen.queryByRole('table')).toBeNull();
 expect(screen.getByRole('button',{name:'Cancel request'})).toBeTruthy();
});

it('gate pass form checks the return time and shows the route',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Apurva Kopulwar',companyId:'',siteId:'site',department:'Workshop',designation:''},route:['HOD (concerned)','Gate out','Back in'],routeNote:'',missing:['Company']}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="t" kind="gatePasses" module={gateModule} notice={()=>{}} actionLabel="Apply gate pass"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply gate pass'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply gate pass'}));
 expect(screen.getByRole('heading',{name:'Apply gate pass'})).toBeTruthy();
 expect(screen.getByText('Time out and return')).toBeTruthy();
 fireEvent.change(screen.getByLabelText(/Employee ID/),{target:{value:'employee'}});
 await waitFor(()=>expect(screen.getByLabelText(/Employee name/)).toHaveValue('Apurva Kopulwar'));
 expect(screen.getByLabelText('Department')).toHaveValue('Workshop');
 expect(screen.getByText('This pass will go to:')).toBeTruthy();expect(screen.getByText('Gate out')).toBeTruthy();
 fireEvent.change(screen.getByLabelText(/Out time/),{target:{value:'15:00'}});
 fireEvent.change(screen.getByLabelText(/Expected return/),{target:{value:'13:00'}});
 expect(screen.getByText('Expected return must be after the out time.')).toBeTruthy();
});

it('says why company or site stays blank on the leave form',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Apurva Kopulwar',companyId:'',siteId:'',department:'',designation:''},route:null,routeNote:'',missing:['Company','Site']}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[],total:0,page:1,pageSize:50}));
 }));
 // @ts-expect-error Shared server schema is JavaScript.
 const {requestFields}=await import('../server/leave.mjs');
 render(<Records grant="t" kind="leaveRequests" module={{title:'Leave requests',menu:'Holiday & Leave',fields:requestFields,autoCode:true,canWrite:true}} notice={()=>{}} actionLabel="Apply leave"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Apply leave'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Apply leave'}));
 fireEvent.change(screen.getByLabelText(/Employee ID/),{target:{value:'employee'}});
 expect(await screen.findByText(/has no Company or Site saved in Employee Master/)).toBeTruthy();
});
