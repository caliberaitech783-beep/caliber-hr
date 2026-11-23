import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import MachineLogUpload from './MachineLogUpload';
import MachineMaster from './MachineMaster';
import type {Machine} from './BiometricMachines';

afterEach(()=>{vi.unstubAllGlobals();});
const known=(...ids:string[])=>ids.map(biometricId=>({biometricId,employeeCode:'E'+biometricId,employeeName:'Person '+biometricId,machineName:''}));
const MACHINES=[{serial:'JNP2242100339',name:'STAFF 1',location:'Office',machineNo:'1',ids:known('101')},{serial:'JNP2242700221',name:'GENERAL STAFF 1',location:'Gate',machineNo:'2',ids:known('101','2045')}];
const dat=(name:string,text:string)=>new File([text],name,{type:'application/octet-stream'});

it('Upload machine log: a .dat with no serial picks the machine by its IDs, previews, and imports on one press',async()=>{
 const posts:{url:string;body:any}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  const body=init?.body?JSON.parse(String(init.body)):null;posts.push({url,body});
  if(url.includes('punches/import/check'))return Response.json({machines:MACHINES});
  if(url.includes('punches/import'))return Response.json({received:body.rows.length,added:body.rows.length-1});
  return Response.json({});
 }));
 const onImported=vi.fn(),onClose=vi.fn();
 render(<MachineLogUpload grant={'a'.repeat(43)} site="Sasti OC" onClose={onClose} onImported={onImported}/>);
 const dialog=screen.getByRole('dialog',{name:'Upload machine log · Sasti OC'});
 fireEvent.change(within(dialog).getByLabelText('Machine log files'),{target:{files:[dat('attlog.dat',' 101\t2026-11-01 07:58:12\t1\t0\t0\t0\n 2045\t2026-11-01 08:02:00\t15\t0\t0\t0\n 999\t2026-11-02 17:00:00\t1\t1\t0\t0\n')]}});
 await within(dialog).findByText(/Best match by employee IDs · 2 of 3/);
 expect(within(dialog).getByRole('combobox')).toHaveValue('JNP2242700221');
 expect(posts[0].body).toEqual({site:'Sasti OC',ids:['101','2045','999']});
 expect(within(dialog).getByText('E101 · Person 101')).toBeTruthy();
 expect(within(dialog).getByText(/1 machine ID \(999\) is not linked/)).toBeTruthy();
 fireEvent.click(within(dialog).getByRole('button',{name:'Import 3 punches'}));
 await waitFor(()=>expect(onImported).toHaveBeenCalled());
 const sent=posts.find(p=>p.url.endsWith('attendance/punches/import'))!.body;
 expect(sent.rows.map((r:any)=>r.serial)).toEqual(['JNP2242700221','JNP2242700221','JNP2242700221']);
 expect(onImported.mock.calls[0][0]).toBe('2 new biometric punches imported from attlog.dat · 1 already in HR Pulse.');
 expect(onImported.mock.calls[0][1]).toEqual({from:'2026-11-01',to:'2026-11-02'});
 expect(onClose).toHaveBeenCalled();
});

it('Upload machine log: 1_attlog.dat goes to machine no. 1; a file no machine matches waits for a choice',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({machines:MACHINES})));
 render(<MachineLogUpload grant={'a'.repeat(43)} site="Sasti OC" onClose={()=>{}} onImported={()=>{}}/>);
 const input=screen.getByLabelText('Machine log files');
 fireEvent.change(input,{target:{files:[dat('1_attlog.dat','2045\t2026-11-01 07:58:12\t1\t0'),dat('USB.dat','555\t2026-11-01 07:58:12\t1\t0')]}});
 await screen.findByText('Machine no. in the file name');
 const [first,second]=screen.getAllByRole('combobox');
 expect(first).toHaveValue('JNP2242100339');expect(second).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'Import 2 punches'}));
 expect(await screen.findByText('Choose the machine for USB.dat.')).toBeTruthy();
 fireEvent.change(second,{target:{value:'JNP2242700221'}});
 expect(screen.queryByText('Choose the machine for USB.dat.')).toBeNull();
});

it('Machine master: lists machine no., make and model, and saves a new machine with them',async()=>{
 const posts:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{posts.push(JSON.parse(String(init?.body||'{}')));return Response.json({});}));
 const machines:Machine[]=[{serial:'JNP2242100339',name:'STAFF 1',location:'Office',siteId:'s1',siteName:'Sasti OC',online:true,lastContact:null,lastSeen:null,logsToday:0,lastPunch:null,ipAddress:'192.168.16.11',machineNo:'1',make:'eSSL',model:'ZMM220'}];
 const onSaved=vi.fn();
 render(<MachineMaster grant={'a'.repeat(43)} machines={machines} sites={[{id:'s1',kind:'sites',code:'SO',name:'Sasti OC'}]} canManage onSaved={onSaved} onError={()=>{}}/>);
 const table=screen.getByRole('table',{name:'Machine master'});
 expect(within(table).getByText('ZMM220')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Add machine'}));
 const form=screen.getByRole('form',{name:'Add machine'});
 fireEvent.change(within(form).getByLabelText('Site'),{target:{value:'s1'}});
 fireEvent.change(within(form).getByLabelText('Machine no.'),{target:{value:'3'}});
 fireEvent.change(within(form).getByLabelText('Serial no.'),{target:{value:'CEXJ232460322'}});
 fireEvent.change(within(form).getByLabelText('Make'),{target:{value:'eSSL'}});
 fireEvent.submit(form);
 await waitFor(()=>expect(onSaved).toHaveBeenCalledWith('Machine CEXJ232460322 added to Machine master.'));
 expect(posts[0]).toMatchObject({siteId:'s1',machineNo:'3',serial:'CEXJ232460322',make:'eSSL',model:''});
});
