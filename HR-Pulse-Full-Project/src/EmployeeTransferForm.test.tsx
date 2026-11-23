import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
// @ts-expect-error Shared server schema is JavaScript.
import {modules} from '../server/modules.mjs';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const lookups=[{id:'employee',kind:'employees',code:'CMLL00012',name:'Ankit Tiwari',site_id:'home'},{id:'e2',kind:'employees',code:'CMLL00031',name:'Ravi Kumar',site_id:'home'},{id:'e3',kind:'employees',code:'CMLL00077',name:'Pauni Person',site_id:'far'},{id:'home',kind:'sites',code:'SASTI',name:'Sasti OC'},{id:'far',kind:'sites',code:'PAUNI',name:'Pauni OC'},{id:'d1',kind:'designations',code:'SUP',name:'Supervisor'}];
const transferModule={title:'Employee transfers',menu:'Employee Master',fields:modules.employeeTransfers.fields,autoCode:true,canWrite:true};
function search(label:string,query:string){
 const input=screen.getByRole('combobox',{name:label});
 fireEvent.click(input);
 if(query)fireEvent.change(input,{target:{value:query}});
 return within(screen.getByRole('listbox',{name:label}));
}
function pick(label:string,query:string,option:string){
 fireEvent.click(search(label,query).getByRole('option',{name:option}));
}

// Owner, 23 Nov 2026: site first, then that site's employees; designations and managers (with employee ID) are dropdowns.
it('transfer form lists the site employees, fills the current posting and offers designation and manager dropdowns',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url.includes('request-preview'))return new Response(JSON.stringify({employee:{name:'Ankit Tiwari',companyId:'c',siteId:'home',department:'Operations',designation:'Operator',reportingTo:'R. Sharma – Manager'},route:['Site HR (from location)','PM (from location)','Office HR','Regional HR Head','Director'],routeNote:''}));
  if(url.includes('transfer-options'))return new Response(JSON.stringify({employees:url.includes('fromSiteId=home')?[{value:'employee',label:'CMLL00502 · Ankit Tiwari'},{value:'e2',label:'CMLL00031 · Ravi Kumar'},{value:'reg:r5',label:'CMLL00440 · Register Only'}]:[],designations:['Operator','Supervisor'],fromManagers:[{label:'CMLL00005 · R. Sharma – Manager',value:'CMLL00005 · R. Sharma'}],toManagers:url.includes('toSiteId=far')?[{label:'CMLL00099 · P. Rao – Project Manager',value:'CMLL00099 · P. Rao'}]:[]}));
  return new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[],total:0,page:1,pageSize:50}));
 }));
 render(<Records grant="t" kind="employeeTransfers" module={transferModule} notice={()=>{}} actionLabel="Create transfer"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create transfer'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Create transfer'}));
 expect(screen.getByRole('heading',{name:'Request employee transfer'})).toBeTruthy();
 expect(screen.queryByLabelText(/Transfer reference/)).toBeNull();
 expect((screen.getByLabelText(/Transfer date/) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 expect(screen.getByLabelText(/^Employee/)).toBeDisabled();
 pick('From location','sast','Sasti OC');
 const employee=screen.getByRole('combobox',{name:'Employee'});
 await waitFor(()=>expect(employee).toBeEnabled());
 const staff=search('Employee','');
 expect(staff.getByText('CMLL00440 · Register Only')).toBeTruthy();
 expect(staff.queryByText('CMLL00077 · Pauni Person')).toBeNull();
 fireEvent.change(employee,{target:{value:'502'}});
 expect(staff.getAllByRole('option')).toHaveLength(1);
 expect(staff.getByText('CMLL00502 · Ankit Tiwari')).toBeTruthy();
 fireEvent.keyDown(employee,{key:'Enter'});
 expect(employee).toHaveValue('CMLL00502 · Ankit Tiwari');
 await waitFor(()=>expect(screen.getByLabelText(/From designation/)).toHaveValue('Operator'));
 pick('From designation','oper','Operator');
 pick('From reporting manager','00005','CMLL00005 · R. Sharma – Manager');
 expect(search('To location','').queryByText('Sasti OC')).toBeNull();
 pick('To location','pauni','Pauni OC');
 const managers=search('To reporting manager','00099');
 fireEvent.click(await managers.findByRole('option',{name:'CMLL00099 · P. Rao – Project Manager'}));
 expect(screen.getByRole('combobox',{name:'To reporting manager'})).toHaveValue('CMLL00099 · P. Rao – Project Manager');
 pick('To designation','super','Supervisor');
 pick('To designation','other','Other (write it)');
 expect(screen.getByRole('textbox',{name:'To designation (custom)'})).toBeTruthy();
 expect(screen.getByLabelText(/Reason for transfer/).tagName).toBe('TEXTAREA');
 expect(screen.getByText('This transfer will go to:')).toBeTruthy();expect(screen.getByText('Regional HR Head')).toBeTruthy();
});

// Owner, 23 Nov 2026: transfers show the same step bar as leave requests.
it('draws transfers as cards with the approval step bar',async()=>{
 const row={id:'t1',kind:'employeeTransfers',code:'TR0007/24-11-2026/CMLL00012',name:'New project',status:'PENDING',version:2,updated_at:'2026-11-23T07:00:00Z',data:{employeeId:'employee',transferDate:'2026-11-24',fromSiteId:'home',toSiteId:'far',toDesignation:'Supervisor'},progress:{state:'PENDING',stage:1,steps:[{label:'Site HR',at:'2026-11-23T07:20:00Z'},{label:'PM'},{label:'Office HR'},{label:'Regional HR Head'},{label:'Director'}]}};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[row],total:1,page:1,pageSize:50}))));
 render(<Records grant="t" kind="employeeTransfers" module={transferModule} notice={()=>{}} actionLabel="Create transfer"/>);
 expect(await screen.findByText('Pending · step 3 of 6')).toBeTruthy();
 expect(screen.getByText(/Sasti OC → Pauni OC/)).toBeTruthy();
 for(const step of ['Submitted','Site HR','PM','Office HR','Regional HR Head','Director'])expect(screen.getByText(step)).toBeTruthy();
 expect(screen.queryByRole('table')).toBeNull();
});

it('lists each site name once and clears employee options when switching to an empty site',async()=>{
 const more=[...lookups,{id:'home2',kind:'sites',code:'SASTI',name:'Sasti OC'},{id:'e9',kind:'employees',code:'CMLL00009',name:'Dup Site Person',site_id:'home2'},{id:'empty',kind:'sites',code:'NEW',name:'New Site'}];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?more:url.includes('transfer-options')?{
  employees:url.includes('fromSiteId=home')?[{value:'e9',label:'CMLL00009 · Dup Site Person'}]:[],
  designations:[],fromManagers:[],toManagers:[]
 }:{rows:[],total:0,page:1,pageSize:50}))));
 render(<Records grant="t" kind="employeeTransfers" module={transferModule} notice={()=>{}} actionLabel="Create transfer"/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Create transfer'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Create transfer'}));
 expect(search('From location','').getAllByRole('option',{name:'Sasti OC'})).toHaveLength(1);
 pick('From location','sasti','Sasti OC');
 await waitFor(()=>expect(screen.getByRole('combobox',{name:'Employee'})).toBeEnabled());
 const staff=search('Employee','dup');
 expect(staff.getByText('CMLL00009 · Dup Site Person')).toBeTruthy();
 expect(staff.queryByText('CMLL00077 · Pauni Person')).toBeNull();
 pick('From location','new','New Site');
 expect(screen.queryByText('CMLL00009 · Dup Site Person')).toBeNull();
 expect(await screen.findByPlaceholderText('No employees with an ID are available at this site')).toBeDisabled();
});
