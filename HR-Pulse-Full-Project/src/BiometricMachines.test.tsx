import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {api} from './api';
import BiometricMachines,{machineStatus,machinesForSite,siteOptions,type Machine} from './BiometricMachines';

vi.mock('./api',async()=>({...await vi.importActual('./api'),api:vi.fn()}));
beforeEach(()=>{vi.mocked(api).mockResolvedValue({} as never);});
afterEach(()=>{cleanup();vi.clearAllMocks();});

const base={name:'',location:'',siteId:null,siteName:'',online:false,lastContact:null,lastSeen:null,logsToday:0,lastPunch:null};
const machines:Machine[]=[
 {...base,serial:'JNP2260900233',name:'ESSL K90',location:'Main gate',siteId:'s1',siteName:'Amlohri',online:true,lastContact:'2026-11-20T05:00:00Z',logsToday:14,lastPunch:'2026-11-20 10:31'},
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
 for(const text of ['Amlohri','Main gate','ESSL K90','JNP2260900233','Online','14'])expect(within(first).getByText(text)).toBeTruthy();
 expect(within(first).getByText('Last punch 20-11-2026 10:31')).toBeTruthy();
 expect(screen.getByText('3 machines · 1 online · 2 not online')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Site'),{target:{value:'s2'}});
 expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByText('Offline')).toBeTruthy();
});

it('adds a machine to a site with its location, name and serial',async()=>{
 render(<BiometricMachines {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add machine'}));
 const form=screen.getByRole('form',{name:'Add biometric machine'});
 fireEvent.change(within(form).getByLabelText('Site'),{target:{value:'s2'}});
 fireEvent.change(within(form).getByLabelText('Machine location'),{target:{value:'Office'}});
 fireEvent.change(within(form).getByLabelText('Machine name'),{target:{value:'ESSL F22'}});
 fireEvent.change(within(form).getByLabelText('Serial no.'),{target:{value:'CKJ1234'}});
 fireEvent.submit(form);
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','attendance/devices/register','POST',{serial:'CKJ1234',siteId:'s2',name:'ESSL F22',location:'Office',ipAddress:''}));
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
