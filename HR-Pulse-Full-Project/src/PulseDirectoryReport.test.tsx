import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import Report from './PulseDirectoryReport';
afterEach(()=>vi.unstubAllGlobals());
const sites=[{id:'co',label:'Corporate Office, Nagpur',region:'CO'},{id:'sasti',label:'Sasti OB',region:'WCL'},{id:'jayant',label:'Jayant OB',region:'NCL'}];
const rows=sites.map((site,index)=>({employeeId:`E${index}`,name:`Person ${index}`,siteId:site.id,site:site.label,region:site.region,department:'HR',designation:'Executive',category:'B',reportingTo:'Manager',contact:'**********',email:'',status:'ACTIVE'}));
it('fetches live Pulse data with the HR grant and filters offices, region, site and search',async()=>{
 const fetcher=vi.fn(async(_url:string,_options?:unknown)=>new Response(JSON.stringify({source:'Pulse',fetchedAt:'2026-10-26T10:00:00Z',sites,rows})));
 vi.stubGlobal('fetch',fetcher);
 const view=render(<Report grant="test-grant" employeeGroup="Corporate / HO"/>);
 await screen.findByText('Person 0');expect(screen.queryByText('Person 1')).toBeNull();
 expect(fetcher.mock.calls[0][0]).toBe('https://pulse.cmll.in/api/integrations/hr/directory');
 view.rerender(<Report grant="test-grant" employeeGroup="OB / COAL"/>);
 await screen.findByText('Person 1');expect(screen.queryByText('Person 0')).toBeNull();
 fireEvent.change(screen.getByLabelText('Report region'),{target:{value:'WCL'}});
 expect(screen.queryByText('Person 2')).toBeNull();
 fireEvent.change(screen.getByLabelText('Search Pulse employees'),{target:{value:'missing'}});
 expect(screen.getByText('No employees match the selected filters.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Refresh directory'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
});
it('shows fetch errors and supports retry without stale data',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Sign-in expired.'}),{status:401})));
 render(<Report grant="expired" employeeGroup="Corporate / HO"/>);
 expect(await screen.findByRole('alert')).toHaveProperty('textContent','Sign-in expired.');
 expect(screen.queryByText('Person 0')).toBeNull();
});
