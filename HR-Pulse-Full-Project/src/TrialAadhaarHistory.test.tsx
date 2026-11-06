import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useRef} from 'react';
import TrialAadhaarHistory from './TrialAadhaarHistory';
import FormInput from './BirthDateInput';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn(),savedSession:()=>({grant:'test-grant'})}));
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers();});
function Harness(){const form=useRef<HTMLFormElement>(null);return <form ref={form}><FormInput name="Aadhaar no." aria-label="Aadhaar no."/><TrialAadhaarHistory form={form} currentFormNo="TF/current"/></form>;}
async function enter(value:string){fireEvent.input(screen.getByLabelText('Aadhaar no.'),{target:{value}});await act(async()=>{await vi.advanceTimersByTimeAsync(300);});}
it('checks only complete Aadhaar numbers and displays the earlier PASS/FAIL, form and site',async()=>{
 vi.useFakeTimers();vi.mocked(api).mockResolvedValue({matches:[{formNo:'TF/1',result:'PASS',site:'Jayant OB East',trialDate:'2026-11-01T12:30',savedAt:''},{formNo:'TF/2',result:'FAIL',site:'Sasti OB',trialDate:'',savedAt:'2026-10-31T10:00Z'}]});
 render(<Harness/>);await enter('123');expect(api).not.toHaveBeenCalled();
 await enter('123456789012');expect(screen.getByText(/Already exists/)).toBeTruthy();
 expect(screen.getByText('PASS').closest('li')?.classList.contains('pass')).toBe(true);expect(screen.getByText('FAIL').closest('li')?.classList.contains('fail')).toBe(true);expect(screen.getByText('Passed on 01 Nov 2026')).toBeTruthy();expect(screen.getByText('FAIL recorded on 31 Oct 2026 (trial date unavailable)')).toBeTruthy();expect(screen.getByText('Reason for failure: Not recorded')).toBeTruthy();expect(screen.getByText(/TF\/1/).textContent).toContain('Jayant OB East');
 expect(api).toHaveBeenCalledWith('test-grant','telegram/trial-history','POST',{aadhaar:'123456789012',excludeFormNo:'TF/current'});
 await enter('123');expect(screen.queryByText(/Already exists/)).toBeNull();
});
it('ignores a stale search after a different Aadhaar is entered',async()=>{
 vi.useFakeTimers();let resolve:(value:unknown)=>void=()=>{};
 vi.mocked(api).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}) as any).mockResolvedValueOnce({matches:[]});
 render(<Harness/>);await enter('123456789012');await enter('234567890123');
 await act(async()=>{resolve({matches:[{formNo:'OLD',result:'PASS',site:'Old site'}]});});
 expect(screen.queryByText(/Already exists/)).toBeNull();expect(screen.getByText(/No previous trial found/)).toBeTruthy();
});
it('offers retry after lookup failure instead of claiming the Aadhaar is new',async()=>{
 vi.useFakeTimers();vi.mocked(api).mockRejectedValueOnce(Error('network')).mockResolvedValueOnce({matches:[]});
 render(<Harness/>);await enter('123456789012');expect(screen.getByRole('alert').textContent).toContain('Unable to check');expect(screen.queryByText(/No previous trial found/)).toBeNull();
 fireEvent.click(screen.getByText('Retry check'));await act(async()=>{await vi.advanceTimersByTimeAsync(300);});expect(screen.getByText(/No previous trial found/)).toBeTruthy();
});

it('labels the failure date and colours a single failure message red',async()=>{
 vi.useFakeTimers();vi.mocked(api).mockResolvedValue({matches:[{formNo:'TF/fail',result:'FAIL',site:'Sasti OB',trialDate:'2026-10-30T12:30',savedAt:'2026-11-01',post:'Driver',failureReason:'Unsafe reversing'}]});
 render(<Harness/>);await enter('123456789012');expect(screen.getByText('Failed on 30 Oct 2026')).toBeTruthy();expect(screen.getByText('Position applied for: Driver')).toBeTruthy();expect(screen.getByText('Reason for failure: Unsafe reversing')).toBeTruthy();expect(screen.getByText(/Already exists/).parentElement?.classList.contains('fail')).toBe(true);
});
