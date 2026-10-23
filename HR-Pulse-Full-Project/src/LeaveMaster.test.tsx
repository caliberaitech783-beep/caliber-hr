import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import LeaveMaster from './LeaveMaster';
import {api} from './api';
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),api:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it('saves a leave type and reloads its persisted fields',async()=>{
 let saved:any;vi.mocked(api).mockImplementation(async(_g,path,method,body)=>{if(path==='lookups')return [] as any;if(method==='POST'){saved=body;return {} as any;}return {rows:path.startsWith('records/leaveTypes')&&saved?[{id:'type',code:saved.code,name:saved.name,data:saved,status:'ACTIVE',version:1,updated_at:'2026-10-23'}]:[],total:saved?1:0,page:1,pageSize:50} as any;});
 render(<LeaveMaster grant="grant" config={{leaveTypes:{title:'Leave Types',menu:'Holiday & Leave',canWrite:true,fields:[{key:'code',label:'Code',type:'text',required:true},{key:'name',label:'Name',type:'text',required:true}]}}} actor="hr" canApprove={false} notice={()=>{}}/>);
 await screen.findByText('Balance summary');fireEvent.click(screen.getByRole('button',{name:'Leave Types'}));fireEvent.click(await screen.findByRole('button',{name:'Add record'}));fireEvent.change(screen.getByLabelText(/Code/),{target:{value:'CL'}});fireEvent.change(screen.getByLabelText(/Name/),{target:{value:'Casual leave'}});fireEvent.click(screen.getByRole('button',{name:'Save to Azure'}));await screen.findByText('Casual leave');expect(saved).toMatchObject({code:'CL',name:'Casual leave'});
});
it('shows dashboard failures rather than false zero balances',async()=>{vi.mocked(api).mockRejectedValue(new Error('Service unavailable'));render(<LeaveMaster grant="grant" config={{}} actor="hr" canApprove={false} notice={()=>{}}/>);expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable');expect(screen.queryByText('Balance summary')).toBeNull();});
