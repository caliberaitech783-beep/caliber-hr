import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,within,fireEvent} from '@testing-library/react';
import {api} from './api';
import {displaySiteRecords,siteDisplayName,siteFieldValue} from './siteNames';
import {calendarSite} from './calendarSites';
import HierarchyMaster from './HierarchyMaster';
import {Records} from './Modules';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const sites=[{id:'d',kind:'sites',code:'WCL-DHOPTALA',name:'Dhoptala OB'},{id:'g',kind:'sites',code:'WCL-GAURI',name:'Gauri Pauni OB'},{id:'l',kind:'sites',code:'WCL-LALPETH',name:'Hindustan Lalpeth OC'}];
const labels=['Dhoptala OB 2nd','Gauri Pauni OB 2nd','Lalpeth OB'];
it('uses canonical names for old names, aliases and calendar labels',()=>{
 sites.forEach((site,i)=>{expect(siteDisplayName(site.name,site.code)).toBe(labels[i]);expect(calendarSite(site.id,sites)).toBe(labels[i]);});
 expect(siteDisplayName('Dhoptala OC (2nd)')).toBe(labels[0]);
 expect(siteDisplayName('Gouri Pauni OB')).toBe(labels[1]);
 expect(siteDisplayName('Lalpeth OC')).toBe(labels[2]);
 expect(siteDisplayName('Majri OB')).toBe('Majri OB');
 expect(siteDisplayName('Custom site')).toBe('Custom site');
});
it('preserves IDs, codes, approvers, unrelated names and source records',()=>{
 const source={rows:[{...sites[0],data:{name:'Dhoptala OB'},steps:[{name:'Dhoptala OB',approvers:['manager']}]},{id:'employee',kind:'employees',name:'Dhoptala OB'}]};
 const result=displaySiteRecords(source);
 expect(result.rows[0]).toMatchObject({id:'d',code:'WCL-DHOPTALA',name:labels[0],data:{name:labels[0]},steps:[{name:'Dhoptala OB',approvers:['manager']}]});
 expect(result.rows[1].name).toBe('Dhoptala OB');expect(source.rows[0].name).toBe('Dhoptala OB');
});
it('shows the updated WCL names in Hierarchy using legacy responses',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({canWrite:true,rows:sites.map(site=>({...site,kind:undefined,group:'WCL',enabled:false,version:3,steps:[]}))})));
 render(<HierarchyMaster grant="test"/>);
 await screen.findByText('Saved hierarchy is not enabled');
 expect(within(screen.getByLabelText('Hierarchy site')).getAllByRole('option').map(option=>option.textContent)).toEqual(labels);
});
it('shows the new names in site master records and edit forms',async()=>{
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('/lookups')?sites:{rows:sites.map(site=>({...site,data:{code:site.code,name:site.name},status:'ACTIVE',version:1,updated_at:'2026-11-06'})),total:3,page:1,pageSize:50})));
 render(<Records grant="test" kind="sites" module={{title:'Sites',menu:'Master Configuration',canWrite:true,fields:[{key:'name',label:'Name',type:'text'}]}} notice={()=>{}}/>);
 for(const name of labels)await screen.findByText(name);
 expect(screen.queryByText('Hindustan Lalpeth OC')).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'View / edit'})[0]);
 expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(labels[0]);
});
it('normalizes site lists without kind while leaving outgoing IDs and approval settings unchanged',async()=>{
 const fetcher=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(JSON.stringify({rows:[{id:'d',code:'WCL-DHOPTALA',name:'Dhoptala OB',data:{name:'Dhoptala OB'}}]})));
 vi.stubGlobal('fetch',fetcher);
 const result=await api<any>('test','records/sites?page=1');expect(result.rows[0].name).toBe(labels[0]);expect(result.rows[0].data.name).toBe(labels[0]);
 const payload={code:'WCL-DHOPTALA',steps:[{approvers:['manager']}],version:3};
 await api('test','hierarchies','POST',payload);
 expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(payload);
});

it('updates saved form display labels without rewriting other fields',()=>{
 expect(siteFieldValue('Site *','Dhoptala OB')).toBe('Dhoptala OB 2nd');
 expect(siteFieldValue('Site / Project','Gouri Pauni OB')).toBe('Gauri Pauni OB 2nd');
 expect(siteFieldValue('Full Name *','Dhoptala OB')).toBe('Dhoptala OB');
});
