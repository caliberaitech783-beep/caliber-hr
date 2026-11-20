import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import LeaveMaster from './LeaveMaster';
import {api,csv,parseCsv,type Module} from './api';
import {downloadExcel} from './excelFiles';
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),api:vi.fn()}));
vi.mock('./excelFiles',async original=>({...await original<typeof import('./excelFiles')>(),downloadExcel:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const fields=[['code','text'],['name','text'],['employeeId','reference'],['leaveTypeId','reference'],['periodId','reference'],['allocated','number']].map(([key,type])=>({key,label:key,type}));
const module:Module={title:'Leave Allocation',menu:'Master Configuration',canWrite:true,fields};
const headers=['Employee','Name','Leave type','Allocated','Used','Pending','Balance','Period','Status','Last updated'];
it.each([0,2])('exports the visible allocation columns with %i records',async count=>{
 const refs=[{id:'employee',kind:'employees',code:'E001',name:'Sample Employee'},{id:'type',kind:'leaveTypes',code:'SL',name:'Sick Leave'},{id:'period',kind:'leavePeriods',code:'2026',name:'LEAVE YEAR 2026'}];
 vi.mocked(api).mockImplementation(async(_grant,path)=>{
  if(path==='lookups')return refs as never;
  if(!path.startsWith('records/leaveAllocations'))return {rows:[],total:0,page:1,pageSize:1} as never;
  const page=Number(new URLSearchParams(path.split('?')[1]).get('page')||1);
  return {rows:count?[{id:String(page),code:'ALLOC-'+page,name:'Allocation '+page,status:'ACTIVE',updated_at:'2026-11-20T10:00:00Z',version:1,data:{code:'ALLOC-'+page,name:'Allocation '+page,employeeId:'employee',leaveTypeId:'type',periodId:'period',allocated:10,used:2,reserved:0,balance:8}}]:[],total:count,page,pageSize:1} as never;
 });
 render(<LeaveMaster grant="test" config={{leaveAllocations:module}} actor="hr" canApprove={false} notice={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Leave Allocation'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Export Excel'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Export Excel'}));
 await waitFor(()=>expect(downloadExcel).toHaveBeenCalledTimes(1));
 const [filename,exportHeaders,exportRows]=vi.mocked(downloadExcel).mock.calls[0];
 const contents=csv(exportHeaders,exportRows);
 expect(filename).toMatch(/^leaveAllocations-.*\.xlsx$/);
 expect(contents.replace(/^\uFEFF/,'').split('\r\n')[0]).toBe(headers.map(header=>'"'+header+'"').join(','));
 const rows=parseCsv(contents);
 expect(rows).toHaveLength(count);
 if(count){
  expect(rows[0]).toMatchObject({Employee:'Sample Employee',Name:'Allocation 1','Leave type':'Sick Leave',Allocated:'10',Used:'2',Pending:'0',Balance:'8',Period:'LEAVE YEAR 2026',Status:'ACTIVE'});
  expect(rows[1].Name).toBe('Allocation 2');
  expect(rows[0]['Last updated']).toBe(new Date('2026-11-20T10:00:00Z').toLocaleString('en-IN'));
 }
 fireEvent.click(screen.getByRole('button',{name:'Import Excel'}));
 fireEvent.click(screen.getByRole('button',{name:'Download template'}));
 expect(vi.mocked(downloadExcel).mock.calls[1]).toEqual(['leaveAllocations-template.xlsx',headers,[]]);
});
