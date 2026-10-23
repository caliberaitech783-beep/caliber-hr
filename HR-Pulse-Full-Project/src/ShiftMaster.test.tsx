import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import ShiftMaster from './ShiftMaster';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it('saves site-qualified shift settings and reloads persisted rows',async()=>{
 let saved:any;
 vi.mocked(api).mockImplementation(async(_grant,path,method,body)=>{if(path==='lookups')return [{id:'site1',kind:'sites',code:'JAY',name:'Jayant'}] as any;if(method==='POST'){saved=body;return {} as any;}return {rows:saved?[{id:'one',code:saved.code,name:saved.name,data:saved,version:1}]:[],total:saved?1:0} as any;});
 render(<ShiftMaster grant="grant" module={{title:'Shifts',menu:'Shift Management',fields:[],canWrite:true}}/>);
 await screen.findByRole('option',{name:'Jayant'});await waitFor(()=>expect((screen.getByRole('button',{name:'Add shift'}) as HTMLButtonElement).matches(':disabled')).toBe(false));
 fireEvent.change(screen.getByLabelText('Code'),{target:{value:'A'}});fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Morning'}});fireEvent.click(screen.getByRole('button',{name:'Add shift'}));
 await screen.findByText('Morning');expect(saved).toMatchObject({code:'JAY:A',siteId:'site1',graceMinutes:'30',halfDayHours:'4',fullDayHours:'8',overtimeAfterHours:'8',nightShift:'No'});
 fireEvent.click(screen.getByRole('button',{name:'Remove'}));expect(screen.getByRole('button',{name:'Confirm removal'})).not.toBeNull();
});
it('does not seed reference data or enable writes without configured sites',async()=>{vi.mocked(api).mockImplementation(async(_g,path)=>path==='lookups'?[] as any:{rows:[],total:0} as any);render(<ShiftMaster grant="grant" module={{title:'Shifts',menu:'Shift Management',fields:[],canWrite:true}}/>);await screen.findByText(/No active sites are available/);expect((screen.getByRole('button',{name:'Add shift'}) as HTMLButtonElement).matches(':disabled')).toBe(true);expect(vi.mocked(api).mock.calls.every(c=>c[2]!=='POST')).toBe(true);});
