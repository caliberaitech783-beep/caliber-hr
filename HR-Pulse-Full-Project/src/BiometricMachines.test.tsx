import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {api} from './api';
import BiometricMachines,{bridgeOnlineFor,DIRECT_SERVER,machineStatus,machinesForSite,siteOptions,type Machine} from './BiometricMachines';

vi.mock('./api',async()=>({...await vi.importActual('./api'),api:vi.fn()}));
beforeEach(()=>{vi.mocked(api).mockResolvedValue({} as never);});
afterEach(()=>{cleanup();vi.clearAllMocks();});

const base={name:'',location:'',siteId:null,siteName:'',online:false,lastContact:null,lastSeen:null,logsToday:0,lastPunch:null};
const machines:Machine[]=[
 {...base,serial:'JNP2260900233',name:'ESSL K90',location:'Main gate',ipAddress:'192.168.1.201',siteId:'s1',siteName:'Amlohri',online:true,lastContact:'2026-11-20T05:00:00Z',logsToday:14,lastPunch:'2026-11-20 10:31'},
 {...base,serial:'JNP2260900400',location:'Workshop',siteId:'s2',siteName:'Nigahi',lastContact:'2026-11-19T13:59:00Z'},
 {...base,serial:'NEW1'},
];
const sites=[{id:'s1',kind:'sites',code:'AML',name:'Amlohri'},{id:'s2',kind:'sites',code:'NGH',name:'Nigahi'}];
const props={grant:'g',machines,sites,bridgeOnline:true,configured:true,canManage:true,fetching:false,onFetch:vi.fn(),onSaved:vi.fn(),onError:vi.fn()};

it('rates a machine online only while it and the bridge PC are in touch',()=>{
 expect(machineStatus(machines[0],true)).toBe('Online');
 expect(machineStatus(machines[0],false)).toBe('Offline');
 expect(machineStatus(machines[2],true)).toBe('Awaiting contact');
 expect(machinesForSite(machines,'').length).toBe(3);
 expect(machinesForSite(machines,'unassigned').map(m=>m.serial)).toEqual(['NEW1']);
 expect(siteOptions([],machines).map(s=>s.name)).toEqual(['Amlohri','Nigahi']);
});

it('lists the machines of every site with location, name, serial, status, last contact and active logs',()=>{
 render(<BiometricMachines {...props}/>);
 const table=screen.getByRole('table');
 expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Site','Machine location','Machine name','Serial no.','IP address','Bridge PC','Status','Last contact','Active logs','Action']);
 const first=within(table).getAllByRole('row')[1];
 for(const text of ['Amlohri','Main gate','ESSL K90','JNP2260900233','192.168.1.201','Online','14'])expect(within(first).getByText(text)).toBeTruthy();
 expect(within(first).getByText('Last punch 20-11-2026 10:31')).toBeTruthy();
 expect(screen.getByText('3 machines · 1 online · 2 not online')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Site'),{target:{value:'s2'}});
 expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByText('Offline')).toBeTruthy();
});

it('adds a machine to a site with its location, name, serial and IP address',async()=>{
 render(<BiometricMachines {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add machine'}));
 const form=screen.getByRole('form',{name:'Add biometric machine'});
 fireEvent.change(within(form).getByLabelText('Site'),{target:{value:'s2'}});
 fireEvent.change(within(form).getByLabelText('Machine location'),{target:{value:'Office'}});
 fireEvent.change(within(form).getByLabelText('Machine name'),{target:{value:'ESSL F22'}});
 fireEvent.change(within(form).getByLabelText('Serial no.'),{target:{value:'CKJ1234'}});
 const ip=within(form).getByLabelText('IP address') as HTMLInputElement;
 expect(new RegExp(`^(?:${ip.pattern})$`).test('192.168.1.256')).toBe(false);
 fireEvent.change(ip,{target:{value:'192.168.1.205'}});
 fireEvent.submit(form);
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','attendance/devices/register','POST',{serial:'CKJ1234',siteId:'s2',name:'ESSL F22',location:'Office',ipAddress:'192.168.1.205'}));
 await waitFor(()=>expect(props.onSaved).toHaveBeenCalled());
});

it('edits a machine site, location and name; site users get no add or edit',async()=>{
 const {unmount}=render(<BiometricMachines {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit machine JNP2260900400'}));
 const form=screen.getByRole('form',{name:'Edit machine JNP2260900400'});
 fireEvent.change(within(form).getByLabelText('Machine location'),{target:{value:'Weighbridge'}});
 fireEvent.submit(form);
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','attendance/devices','POST',{serial:'JNP2260900400',siteId:'s2',name:'',location:'Weighbridge',ipAddress:''}));
 unmount();
 render(<BiometricMachines {...props} canManage={false}/>);
 expect(screen.queryByRole('button',{name:'Add machine'})).toBeNull();
 expect(screen.queryByRole('button',{name:/Edit machine/})).toBeNull();
});

it('a machine pushing straight to HR Pulse is online with no bridge PC, and Fetch log works for it',()=>{
 const direct:Machine={serial:'CEXJ232460322',name:'OFFICE STAFF 2',location:'OFFICE',siteId:'s1',siteName:'Sasti OC',online:true,lastContact:'2026-11-22T12:00:00Z',lastSeen:null,logsToday:0,lastPunch:null,bridgeId:null,bridgeName:'Direct to HR Pulse',direct:true};
 expect(bridgeOnlineFor(direct,[],false)).toBe(true);
 expect(machineStatus(direct,bridgeOnlineFor(direct,[],false))).toBe('Online');
 render(<BiometricMachines grant="g" machines={[direct]} sites={[]} bridgeOnline={false} configured={false} canManage fetching={false} onFetch={vi.fn()} onSaved={vi.fn()} onError={vi.fn()}/>);
 const row=screen.getByText('CEXJ232460322').closest('tr')!;
 expect(within(row).getByText('Online')).toBeTruthy();
 expect(within(row).getByText('Direct to HR Pulse')).toBeTruthy();
 expect((within(row).getByRole('button',{name:/Fetch log/}) as HTMLButtonElement).disabled).toBe(false);
 expect(screen.getByText('Connect a machine without a bridge PC')).toBeTruthy();
 expect(screen.getByText(DIRECT_SERVER)).toBeTruthy();
});

/* Owner, 23 Nov 2026: every saved machine has Delete; it deletes only after approval on Telegram or the OTP. */
it('deletes a machine only after the approver approves on Telegram',async()=>{
 vi.useFakeTimers({shouldAdvanceTime:true});
 const pending={code:'MD-0123456789AB',serial:'JNP2260900400',status:'PENDING',expires:new Date(Date.now()+15*60000).toISOString(),approvers:['Mr Anoop'],attemptsLeft:5,decidedBy:'',decidedAt:null,via:''};
 vi.mocked(api).mockImplementation(async(_g,path,method)=>(path==='attendance/devices/delete'&&method==='POST'?pending
  :path===`attendance/devices/delete/${pending.code}`?{...pending,status:'APPROVED',decidedBy:'Mr Anoop',via:'telegram'}:{}) as never);
 render(<BiometricMachines {...props}/>);
 for(const m of machines)expect(screen.getByRole('button',{name:`Delete machine ${m.serial}`})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Delete machine JNP2260900400'}));
 const dialog=screen.getByRole('dialog',{name:'Delete machine JNP2260900400?'});
 expect(within(dialog).getByText('Nigahi')).toBeTruthy();
 expect(api).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:/Send for approval on Telegram/}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','attendance/devices/delete','POST',{serial:'JNP2260900400'}));
 expect(await within(dialog).findByText(/Waiting for/)).toBeTruthy();
 expect(props.onSaved).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(3100);
 await waitFor(()=>expect(props.onSaved).toHaveBeenCalledWith('Machine JNP2260900400 deleted — approved by Mr Anoop on Telegram.'));
 vi.useRealTimers();
});

it('deletes with the OTP the approver gives, and shows a wrong OTP',async()=>{
 const pending={code:'MD-0123456789AB',serial:'JNP2260900233',status:'PENDING',expires:new Date(Date.now()+15*60000).toISOString(),approvers:['Mr Anoop'],attemptsLeft:5,decidedBy:'',decidedAt:null,via:''};
 vi.mocked(api).mockImplementation(async(_g,path,method,body)=>{
  if(path==='attendance/devices/delete')return pending as never;
  if(method==='POST'&&(body as {otp?:string})?.otp==='111111')throw new Error('Wrong OTP (4 attempts left).');
  if(method==='POST')return {...pending,status:'APPROVED',decidedBy:'OTP entered by hr',via:'otp'} as never;
  return pending as never;
 });
 render(<BiometricMachines {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete machine JNP2260900233'}));
 const dialog=screen.getByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:/Send for approval/}));
 const otp=await within(dialog).findByPlaceholderText('6-digit OTP');
 fireEvent.change(otp,{target:{value:'111111'}});
 fireEvent.submit(within(dialog).getByRole('form',{name:'Delete with OTP'}));
 expect(await within(dialog).findByText('Wrong OTP (4 attempts left).')).toBeTruthy();
 fireEvent.change(otp,{target:{value:'482913'}});
 fireEvent.submit(within(dialog).getByRole('form',{name:'Delete with OTP'}));
 await waitFor(()=>expect(props.onSaved).toHaveBeenCalledWith('Machine JNP2260900233 deleted — approved by OTP.'));
 expect(within(dialog).getByText('Deleted — approved by OTP.')).toBeTruthy();
});

it('site users get no Delete button',()=>{
 render(<BiometricMachines {...props} canManage={false}/>);
 expect(screen.queryByRole('button',{name:/Delete machine/})).toBeNull();
});
