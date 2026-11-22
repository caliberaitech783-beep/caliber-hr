import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import BiometricMachines,{bridgeOnlineFor,machineStatus,type Machine} from './BiometricMachines';
import {programWithKey,type BridgePc} from './BridgePcs';
import type {Lookup} from './api';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const SITE='22222222-2222-4222-8222-222222222222';
const sites=[{id:SITE,kind:'sites',code:'SO',name:'Sasti OC'}] as Lookup[];
const bridges:BridgePc[]=[
 {id:'main',name:'Main bridge PC',siteId:null,siteName:'',keyHint:'',lastSeen:'2026-11-19T14:00:00Z',online:false,machines:['JNP1'],main:true},
 {id:'b-sasti',name:'Sasti weighbridge PC',siteId:SITE,siteName:'Sasti OC',keyHint:'7Qx2',lastSeen:'2026-11-22T12:00:00Z',online:true,machines:['SST01'],main:false}];
const machine=(m:Partial<Machine>):Machine=>({serial:'SST01',name:'ESSL K90',location:'Main gate',siteId:SITE,siteName:'Sasti OC',online:true,lastContact:'2026-11-22T12:00:00Z',lastSeen:null,logsToday:4,lastPunch:null,ipAddress:'192.168.1.201',bridgeId:'b-sasti',bridgeName:'Sasti weighbridge PC',...m});

it('a machine is online only while its own bridge PC is online',()=>{
 expect(machineStatus(machine({}),bridgeOnlineFor(machine({}),bridges,false))).toBe('Online');
 const nagpur=machine({serial:'JNP1',bridgeId:null,bridgeName:'Main bridge PC'});
 expect(machineStatus(nagpur,bridgeOnlineFor(nagpur,bridges,true))).toBe('Offline');
 expect(bridgeOnlineFor(nagpur,undefined,true)).toBe(true);
});

it('the bridge program download carries the new key',()=>{
 const text=programWithKey('hrb_'+'a'.repeat(43));
 expect(text).toMatch(/^BRIDGE_KEY = "hrb_a{43}"/m);
 expect(text).not.toContain('PASTE-THE-BRIDGE-KEY-HERE');
});

it('lists bridge PCs and machines with IP address and bridge PC; adds a bridge PC and shows its key once',async()=>{
 const posts:{url:string;body:Record<string,string>}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const body=JSON.parse(String(init?.body||'{}'));posts.push({url,body});
  return Response.json(url.includes('bridges')?{bridge:{id:'b-new',name:body.name,siteId:SITE,keyHint:'Zz99'},key:'hrb_'+'Z'.repeat(39)+'Zz99'}:{serial:body.serial,siteId:body.siteId,name:body.name,location:body.location,ipAddress:body.ipAddress});}));
 const saved=vi.fn();
 render(<BiometricMachines grant={'a'.repeat(43)} machines={[machine({}),machine({serial:'JNP1',siteId:null,siteName:'',ipAddress:'',bridgeId:null,bridgeName:'Main bridge PC',online:true})]} sites={sites} bridges={bridges}
  bridgeOnline={false} configured canManage fetching={false} onFetch={()=>{}} onSaved={saved} onError={()=>{}}/>);
 const list=screen.getByRole('table',{name:'Bridge PCs'});
 expect(within(list).getByText('Sasti weighbridge PC')).toBeTruthy();
 expect(within(list).getByText('•••• 7Qx2')).toBeTruthy();
 expect(within(list).getByText('Azure setting (existing)')).toBeTruthy();
 const tables=screen.getAllByRole('table'),machines=tables[tables.length-1];
 expect(within(machines).getByRole('columnheader',{name:'IP address'})).toBeTruthy();
 expect(within(machines).getByText('192.168.1.201')).toBeTruthy();
 // Sasti's machine is online through its own bridge PC; the Nagpur machine follows the offline main bridge PC.
 expect(within(machines).getAllByText('Online').length).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'Add bridge PC'}));
 const form=screen.getByRole('form',{name:'Add bridge PC'});
 fireEvent.change(within(form).getByLabelText('Site'),{target:{value:SITE}});
 fireEvent.change(within(form).getByLabelText('Bridge PC name'),{target:{value:'Sasti office PC'}});
 fireEvent.submit(form);
 expect(await screen.findByText('hrb_'+'Z'.repeat(39)+'Zz99')).toBeTruthy();
 expect(posts[0]).toMatchObject({body:{siteId:SITE,name:'Sasti office PC'}});
 expect(screen.getByRole('button',{name:'Download bridge program with this key'})).toBeTruthy();
 await waitFor(()=>expect(saved).toHaveBeenCalled());
 fireEvent.click(screen.getByRole('button',{name:'I have saved the key'}));
 expect(screen.queryByText('hrb_'+'Z'.repeat(39)+'Zz99')).toBeNull();
});

it('saves a machine with its IP address',async()=>{
 const posts:Record<string,string>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{const body=JSON.parse(String(init?.body||'{}'));posts.push(body);return Response.json(body);}));
 render(<BiometricMachines grant={'a'.repeat(43)} machines={[]} sites={sites} bridges={bridges} bridgeOnline configured canManage fetching={false} onFetch={()=>{}} onSaved={()=>{}} onError={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Add machine'}));
 const form=screen.getByRole('form',{name:'Add biometric machine'});
 fireEvent.change(within(form).getByLabelText('Site'),{target:{value:SITE}});
 fireEvent.change(within(form).getByLabelText('Serial no.'),{target:{value:'SST09'}});
 fireEvent.change(within(form).getByLabelText('IP address'),{target:{value:' 192.168.1.209 '}});
 fireEvent.submit(form);
 await waitFor(()=>expect(posts[0]).toMatchObject({serial:'SST09',siteId:SITE,ipAddress:'192.168.1.209'}));
});
