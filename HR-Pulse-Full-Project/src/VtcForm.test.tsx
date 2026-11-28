import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
import {LeaveRequests} from './LeaveMaster';
import {dateProblem,missingFields} from './RequestFormSections';
import {requestSummary} from './RequestProgress';
import {vtcProblem} from './vtc';
import type {Field,RecordRow} from './api';
// @ts-expect-error Shared server schema is JavaScript.
import {modules} from '../server/modules.mjs';
// @ts-expect-error Shared server rules are JavaScript.
import {vtcProblem as serverProblem} from '../server/vtc.mjs';

/* VTC Form and VTC approvals beside OD (owner, 28 Nov 2026). Pulse-II keeps the record; HR keeps the request and approval. */
const vtc={...modules.vtcRequests,canWrite:true};
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-28T06:00:00Z'));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('puts VTC Form and VTC approvals after OD, spaced like the other forms',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('vtc/pending')?{rows:[]}:url.includes('/records/')?{rows:[],total:0,page:1,pageSize:50}:url.endsWith('/lookups')?[]:{}))));
  const form={title:'Form',menu:'Employee Master',fields:[],canWrite:true};
  const {container}=render(<LeaveRequests grant="test" module={form} odModule={form} gateModule={form} vtcModule={vtc} actor="hr" canApprove={true} notice={()=>{}}/>);
  const tabs=[...container.querySelector('.leave-form-tabs')!.children].filter(el=>el.tagName!=='P').map(el=>el.tagName==='SPAN'?'|':el.textContent);
  expect(tabs).toEqual(['Employee Leave Form','Approve / reject','|','OD Form','OD approvals','|','VTC Form','VTC approvals','|','Gate Pass','Gate pass approvals','|']);
  fireEvent.click(screen.getByRole('button',{name:'VTC Form'}));
  expect(await screen.findByRole('button',{name:'Add VTC form'})).toBeTruthy();
  expect(screen.getByText(/Site HR initiates → HOD \(concerned\) → Regional HR, the same approvers as OD/)).toBeTruthy();
});

it('leaves the VTC tabs out where no VTC module is given (leave-only logins) and for approvers-only tab',()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}')));
  const form={title:'Form',menu:'Employee Master',fields:[],canWrite:true};
  render(<LeaveRequests grant="test" module={form} odModule={form} gateModule={form} actor="hr" canApprove={false} notice={()=>{}}/>);
  expect(screen.queryByRole('button',{name:'VTC Form'})).toBeNull();
  expect(screen.queryByRole('button',{name:'VTC approvals'})).toBeNull();
});

/* Owner, 28 Nov 2026 ("move the VTC to in OB/coal"): Workspace gives the VTC module only on the OB / COAL side. */
it('goes back to the leave form when the side changes to Corporate / HO while a VTC tab is open',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('vtc/pending')?{rows:[]}:url.includes('/records/')?{rows:[],total:0,page:1,pageSize:50}:url.endsWith('/lookups')?[]:{}))));
  const form={title:'Form',menu:'Employee Master',fields:[],canWrite:true};
  const view=(vtcModule?:typeof vtc)=><LeaveRequests grant="test" module={form} odModule={form} gateModule={form} vtcModule={vtcModule} actor="hr" canApprove={true} notice={()=>{}}/>;
  const {rerender}=render(view(vtc));
  fireEvent.click(screen.getByRole('button',{name:'VTC approvals'}));
  rerender(view(undefined));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Employee Leave Form'})).toHaveClass('selected'));
  expect(screen.queryByRole('button',{name:'VTC Form'})).toBeNull();
});

it('picks the site and a driver / operator from Employee Master, checks the dates, saves the draft and submits',async()=>{
  const posts:{url:string;body:any}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
    if(options?.method==='POST'){posts.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(url.endsWith('/submit')?{status:'PENDING'}:{id:'r1',version:1}));}
    if(url.endsWith('/lookups'))return new Response(JSON.stringify([{id:'site',kind:'sites',code:'MAJRI',name:'Majri OC'}]));
    if(url.includes('vtc/options'))return new Response(JSON.stringify({inScope:true,employees:[{value:'reg:line',code:'CMPL8812',name:'Ramesh Kumar',label:'CMPL8812 · Ramesh Kumar – Dumper Operator'}]}));
    if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Ramesh Kumar',companyId:'',siteId:'site',department:'Operations',designation:'Dumper Operator'},route:['HOD','Regional HR'],routeNote:'',missing:[]}));
    return new Response(JSON.stringify({rows:[],total:0,page:1,pageSize:50}));
  }));
  render(<Records grant="test" kind="vtcRequests" module={vtc} notice={()=>{}} actionLabel="Add VTC form"/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Add VTC form'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Add VTC form'}));
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByRole('combobox',{name:'Site'})).toHaveValue('Majri OC');   // the login's only site
  expect(within(dialog).queryByLabelText(/Caliber ID$/)).toBeNull();                      // never typed
  const employee=within(dialog).getByRole('combobox',{name:'Employee (Caliber ID · name)'});
  await waitFor(()=>expect(employee).toBeEnabled());
  fireEvent.click(employee);
  fireEvent.click(screen.getByRole('option',{name:'CMPL8812 · Ramesh Kumar – Dumper Operator'}));
  expect(await within(dialog).findByText('Regional HR')).toBeTruthy();
  expect(within(dialog).queryByLabelText(/Course name \(Other\)/)).toBeNull();
  fireEvent.change(within(dialog).getByLabelText(/^Course/),{target:{value:'Other'}});
  expect(within(dialog).getByLabelText(/Course name \(Other\)/)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText(/Course name \(Other\)/),{target:{value:'Crane operator'}});
  fireEvent.change(within(dialog).getByLabelText(/From date/),{target:{value:'2026-11-20'}});
  fireEvent.change(within(dialog).getByLabelText(/To date/),{target:{value:'2026-12-02'}});
  expect(within(dialog).getByLabelText(/^Status/)).toHaveValue('Ongoing');
  fireEvent.change(within(dialog).getByLabelText(/^Status/),{target:{value:'Completed'}});
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Completed can be chosen only when the To date is today or earlier.');
  fireEvent.change(within(dialog).getByLabelText(/^Status/),{target:{value:'Ongoing'}});
  fireEvent.change(within(dialog).getByLabelText(/Institute \/ place/),{target:{value:'VTC Majri'}});
  expect(screen.getByRole('progressbar',{name:'Form completion'})).toHaveAttribute('aria-valuenow','100');
  fireEvent.click(within(dialog).getByRole('button',{name:'Submit for approval'}));
  await waitFor(()=>expect(posts.length).toBe(2));
  expect(posts[0].url).toMatch(/records\/vtcRequests$/);
  expect(posts[0].body).toMatchObject({siteId:'site',employeeId:'reg:line',course:'Other',courseOther:'Crane operator',fromDate:'2026-11-20',toDate:'2026-12-02',institute:'VTC Majri',vtcStatus:'Ongoing'});
  expect(posts[1].url).toMatch(/records\/vtcRequests\/r1\/submit$/);
});

it('uses the same date rules as the server, and shows an approved request that is not yet in Pulse-II',()=>{
  const fields=vtc.fields as Field[];
  for(const data of [{fromDate:'2026-10-30',toDate:'2026-11-02'},{fromDate:'2026-11-01',toDate:'2027-02-10'},{fromDate:'2027-01-25',toDate:'2027-01-30'},{fromDate:'2026-11-20',toDate:'2026-11-30',vtcStatus:'Completed'},{fromDate:'2026-11-20',toDate:'2026-11-27',vtcStatus:'Completed'}])
    expect(vtcProblem(data,'2026-11-28')).toBe(serverProblem(data,'2026-11-28'));
  expect(dateProblem('vtcRequests',{fromDate:'2026-10-30',toDate:'2026-11-02'})).toMatch(/01-11-2026/);
  expect(missingFields('vtcRequests',fields,{course:'Other'}).map(f=>f.key)).toContain('courseOther');
  expect(missingFields('vtcRequests',fields,{course:'Refresher'}).map(f=>f.key)).not.toContain('courseOther');
  const row={id:'r',kind:'vtcRequests',code:'VTC0001/20-11-2026/CMPL8812',name:'Ramesh Kumar',status:'APPROVED',version:3,updated_at:'',data:{empCode:'CMPL8812',name:'Ramesh Kumar',fromDate:'2026-11-20',toDate:'2026-11-27',course:'Refresher',institute:'VTC Majri',vtcStatus:'Ongoing',pulse:{state:'failed',error:'Pulse-II did not answer.'} as unknown as string}} as RecordRow;
  const s=requestSummary('vtcRequests',row,new Map());
  expect(s.who).toBe('CMPL8812 · Ramesh Kumar');
  expect(s.details).toEqual(['20-11-2026 → 27-11-2026','Refresher','VTC Majri','Ongoing','VTC0001/20-11-2026/CMPL8812','Not yet in Pulse-II: Pulse-II did not answer.']);
  expect(requestSummary('vtcRequests',{...row,data:{...row.data,pulse:{state:'sent'} as unknown as string}},new Map()).details).not.toContain('Not yet in Pulse-II');
});
