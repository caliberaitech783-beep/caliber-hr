import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {companyDisplayName} from './companyNames';
import {Records} from './Modules';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('uses the current labels for legacy company names and preserves unfamiliar companies',()=>{
 expect(companyDisplayName('Caliber Mining & Logistics')).toBe('CALIBER MINING AND LOGISTICS LIMITED');
 expect(companyDisplayName('Caliber Mining And Logistics Ltd')).toBe('CALIBER MINING AND LOGISTICS LIMITED');
 expect(companyDisplayName('CMPL SCR JV')).toBe('CMPL SCR JOINT VENTURE');
 expect(companyDisplayName('CHADDA TRADING COMPANY')).toBe('CHADDA TRADING CO.');
 expect(companyDisplayName('KSR Freight Carriers')).toBe('KSR FREIGHT CARRIERS');
 expect(companyDisplayName('Test Company','C-01')).toBe('Test Company');
});
for(const kind of ['leaveRequests','outDutyRequests'])it(`${kind}: shows new company labels while saving the original company ID`,async()=>{
 const lookups=[{id:'caliber-id',kind:'companies',code:'CMLL',name:'Caliber Mining & Logistics'},{id:'jv-id',kind:'companies',code:'CMPL-SCR-JV',name:'CMPL SCR JV'},{id:'chadda-id',kind:'companies',code:'CHADDA',name:'CHADDA TRADING COMPANY'},{id:'ksr-id',kind:'companies',code:'KSR',name:'KSR Freight Carriers'}];
 let saved:any;
 vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{if(init?.method==='POST'){saved=JSON.parse(String(init.body));return new Response('{}');}return new Response(JSON.stringify(url.endsWith('/lookups')?lookups:{rows:[],total:0,page:1,pageSize:50}));});
 render(<Records grant="test" kind={kind} module={{title:'Request',menu:'Employee Master',canWrite:true,fields:[{key:'companyId',label:'Company',type:'reference',reference:'companies'}]}} notice={()=>{}}/>);
 await screen.findByText('No records found');
 fireEvent.click(screen.getByRole('button',{name:'Add record'}));
 const company=screen.getByLabelText('Company');
 const labels=within(company).getAllByRole('option').map(option=>option.textContent);
 expect(labels.some(label=>label?.includes('CALIBER MINING AND LOGISTICS LIMITED'))).toBe(true);
 expect(labels.some(label=>label?.includes('CMPL SCR JOINT VENTURE'))).toBe(true);
 expect(labels.some(label=>label?.includes('CHADDA TRADING CO.'))).toBe(true);
 expect(labels.some(label=>label?.includes('KSR FREIGHT CARRIERS'))).toBe(true);
 expect(labels.some(label=>label?.includes('Caliber Mining & Logistics'))).toBe(false);
 fireEvent.change(company,{target:{value:'caliber-id'}});
 fireEvent.click(screen.getByRole('button',{name:'Save'}));
 await screen.findByText('No records found');
 expect(saved.companyId).toBe('caliber-id');
});
