import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {Records} from './Modules';
const companyModule={title:'Companies',menu:'Master Configuration',canWrite:true,fields:[{key:'code',label:'Company code',type:'text',required:true},{key:'name',label:'Company name',type:'text',required:true}]};
afterEach(()=>vi.unstubAllGlobals());
describe('database-backed record forms',()=>{
 it('sends the grant and saved values, then reloads the database list',async()=>{
  let saved=false;const fetchMock=vi.fn(async(url:string,options?:RequestInit)=>{
   expect((options?.headers as Record<string,string>).Authorization).toBe('Bearer '+ 'a'.repeat(43));
   if(options?.method==='POST'){expect(JSON.parse(String(options.body))).toMatchObject({code:'C001',name:'Example company'});saved=true;return new Response(JSON.stringify({id:'one'}));}
   return new Response(JSON.stringify(url.endsWith('/lookups')?[]:{rows:saved?[{id:'one',code:'C001',name:'Example company',status:'ACTIVE',version:1,data:{code:'C001',name:'Example company'},updated_at:'2026-10-22T00:00:00Z'}]:[],total:saved?1:0,page:1,pageSize:50}));
  });vi.stubGlobal('fetch',fetchMock);
  render(<Records grant={'a'.repeat(43)} kind="companies" module={companyModule} notice={()=>{}}/>);
  await screen.findByText('No records found');fireEvent.click(screen.getByRole('button',{name:'Add record'}));
  fireEvent.change(screen.getByLabelText(/Company code/),{target:{value:'C001'}});fireEvent.change(screen.getByLabelText(/Company name/),{target:{value:'Example company'}});fireEvent.click(screen.getByRole('button',{name:'Save to Azure'}));
  await screen.findByText('Example company');expect(saved).toBe(true);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 });
 it('directory mode exposes no add, import, submit or deactivate controls',async()=>{
  vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?[]:{rows:[{id:'one',code:'E001',name:'Example employee',status:'DRAFT',version:1,data:{},updated_at:'2026-10-22T00:00:00Z'}],total:1,page:1,pageSize:50})));
  render(<Records grant={'a'.repeat(43)} kind="employees" module={companyModule} readOnly notice={()=>{}}/>);await screen.findByText('Example employee');
  for(const name of ['Add record','Import CSV','Submit','Deactivate'])expect(screen.queryByRole('button',{name})).toBeNull();
 });
});
it('requires typed confirmation and deletes the preview snapshot across pages',async()=>{
 const targets=[{id:'one',version:1},{id:'two',version:2}];let deleted=false;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.endsWith('/holiday-groups'))return new Response('[]');
  if(url.endsWith('/preview'))return new Response(JSON.stringify({records:targets}));
  if(url.endsWith('/confirm')){expect(JSON.parse(String(options?.body))).toEqual({records:targets});deleted=true;return new Response(JSON.stringify({deleted:2}));}
  return new Response(JSON.stringify(url.endsWith('/lookups')?[]:{rows:[],total:2,page:1,pageSize:50}));
 }));
 render(<Records grant={'a'.repeat(43)} kind="holidays" module={{...companyModule,title:'Holidays'}} notice={()=>{}}/>);
 await waitFor(()=>expect((screen.getByRole('button',{name:'Delete all'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Delete all'}));await screen.findByRole('heading',{name:'Delete 2 records?'});expect(deleted).toBe(false);expect((screen.getByRole('button',{name:'Delete permanently'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.change(screen.getByLabelText('Type DELETE to confirm'),{target:{value:'DELETE'}});fireEvent.click(screen.getByRole('button',{name:'Delete permanently'}));await waitFor(()=>expect(deleted).toBe(true));
});
it('filters holidays through group and site selection and offers site documents',async()=>{
 const urls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string)=>{urls.push(url);return new Response(JSON.stringify(url.endsWith('/holiday-groups')?[{name:'CO/HO',sites:[{name:'NGP',aliases:['NGP']}]}]:url.includes('/holiday-documents')||url.endsWith('/lookups')?[]:{rows:[],total:0,page:1,pageSize:50}));}));
 render(<Records grant={'a'.repeat(43)} kind="holidays" module={{...companyModule,title:'Holidays'}} notice={()=>{}}/>);
 await screen.findByRole('option',{name:'CO/HO'});fireEvent.change(screen.getByLabelText('Holiday group'),{target:{value:'CO/HO'}});fireEvent.change(screen.getByLabelText('Holiday site'),{target:{value:'NGP'}});
 await waitFor(()=>expect(urls.some(url=>url.includes('page=1')&&url.includes('holidaySite=NGP'))).toBe(true));expect(screen.getByLabelText('Upload holiday document')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Holiday group'),{target:{value:''}});expect(screen.queryByLabelText('Upload holiday document')).toBeNull();
});
