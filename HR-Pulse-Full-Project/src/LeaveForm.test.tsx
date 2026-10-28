import '@testing-library/jest-dom/vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {Records} from './Modules';
// @ts-expect-error Shared server schema is JavaScript.
import {requestFields} from '../server/leave.mjs';
afterEach(()=>vi.unstubAllGlobals());
it('shows leave fields, calculates days, accepts dictated text reasons and keeps attachments optional',async()=>{
 let saved:any;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:any)=>{
  if(options?.method==='POST'){saved=JSON.parse(options.body);return new Response('{}');}
  return new Response(JSON.stringify(url.endsWith('/lookups')?[{id:'employee',kind:'employees',code:'E-01',name:'Test Employee'},{id:'company',kind:'companies',code:'C-01',name:'Test Company'},{id:'site',kind:'sites',code:'SITE-01',name:'Nagpur CO'}]:{rows:[],total:0,page:1,pageSize:50}));
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
 fireEvent.submit(screen.getByRole('button',{name:'Save to Azure'}).closest('form')!);
 await waitFor(()=>expect(saved?.name).toBe('Medical appointment'));
 expect(saved.siteId).toBe('site');
 expect(saved.approver).toBeUndefined();expect(saved.attachment).toBeUndefined();
});
