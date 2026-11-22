import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
// @ts-expect-error Shared server schema is JavaScript.
import {modules} from '../server/modules.mjs';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const lookups=[{id:'employee',kind:'employees',code:'CMLL00012',name:'Ankit Tiwari'},{id:'home',kind:'sites',code:'SASTI',name:'Sasti OC'},{id:'far',kind:'sites',code:'PAUNI',name:'Pauni OC'},{id:'d1',kind:'designations',code:'SUP',name:'Supervisor'}];
const transferModule={title:'Employee transfers',menu:'Employee Master',fields:modules.employeeTransfers.fields,autoCode:true,canWrite:true};

// Owner, 23 Nov 2026: the transfer form is numbered automatically, fills the current posting from Employee Master and never offers the same site.
it('transfer form fills the current posting, hides the reference and never offers the same site',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Ankit Tiwari',companyId:'c',siteId:'home',department:'Operations',designation:'Operator',reportingTo:'R. Sharma – Manager'},route:['Site HR (from location)','PM (from location)','Office HR','Regional HR Head','Director'],routeNote:''}));
  if(url.includes('reporting-managers'))return new Response(JSON.stringify({managers:[{label:'P. Rao – Manager (Pauni OC)',value:'P. Rao – Manager'}]}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="t" kind="employeeTransfers" module={transferModule} notice={()=>{}} actionLabel="Create transfer"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create transfer'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Create transfer'}));
 expect(screen.getByRole('heading',{name:'Request employee transfer'})).toBeTruthy();
 expect(screen.queryByLabelText(/Transfer reference/)).toBeNull();
 expect(screen.queryByLabelText(/Transfer title/)).toBeNull();
 expect((screen.getByLabelText(/Transfer date/) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 fireEvent.change(screen.getByLabelText(/^Employee/),{target:{value:'employee'}});
 await waitFor(()=>expect(screen.getByLabelText(/From designation/)).toHaveValue('Operator'));
 expect(screen.getByLabelText(/From reporting manager/)).toHaveValue('R. Sharma – Manager');
 expect(screen.getByLabelText(/From location/)).toHaveValue('home');
 expect(screen.getByLabelText(/From location/)).toBeDisabled();
 const to=screen.getByLabelText(/To location/);
 expect(within(to).queryByText('SASTI · Sasti OC')).toBeNull();
 expect(within(to).getByText('PAUNI · Pauni OC')).toBeTruthy();
 fireEvent.change(to,{target:{value:'far'}});
 await waitFor(()=>expect(document.querySelector('#transfer-toManager-list option')).toHaveValue('P. Rao – Manager'));
 expect(document.querySelector('#transfer-toDesignation-list option')).toHaveValue('Supervisor');
 expect(screen.getByLabelText(/Reason for transfer/).tagName).toBe('TEXTAREA');
 expect(screen.getByText('This transfer will go to:')).toBeTruthy();expect(screen.getByText('Regional HR Head')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Submit for approval'})).toBeTruthy();
});
