import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import TrialForm,{emptySelection} from './TrialForm';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn(),savedSession:()=>({grant:'grant'})}));
vi.mock('./EmployeeLocation',()=>({AadhaarUpload:()=>null}));
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.clearAllMocks();vi.useRealTimers();});
async function setup(result:'PASS'|'FAIL'){
 vi.useFakeTimers();vi.mocked(api).mockImplementation(async(_grant,path)=>path==='telegram/trial-history'?{matches:[{formNo:'TF/old',result,site:'Sasti OB',trialDate:'2026-11-01',savedAt:''}]} as any:{} as any);
 const view=render(<TrialForm selection={{...emptySelection,employeeGroup:'OB / COAL',department:'Driver',site:'Sasti OB'}}/>);
 fireEvent.click(screen.getByRole('button',{name:/Trial Joining Form/}));
 const name=view.container.querySelector<HTMLInputElement>('input[name="Name of candidate"]')!;fireEvent.change(name,{target:{value:'Candidate'}});
 fireEvent.input(screen.getByLabelText('Aadhaar no.'),{target:{value:'123456789012'}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(300);});return view;
}
it('makes an already-passed candidate view-only and blocks submit and draft saving',async()=>{
 const view=await setup('PASS');
 expect(screen.getByText(/Details are view-only/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Save Trial Form'}).hasAttribute('disabled')).toBe(true);
 expect(screen.getByRole('button',{name:'Save Draft'}).hasAttribute('disabled')).toBe(true);
 expect(screen.getByRole('button',{name:'Start another trial'}).hasAttribute('disabled')).toBe(false);
 expect((screen.getByLabelText('Aadhaar no.') as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
 fireEvent.submit(view.container.querySelector('form')!);
 expect(vi.mocked(api).mock.calls.some(call=>call[1]==='telegram/trial-forms')).toBe(false);
 expect(localStorage.getItem('hrPulse.trialForm')).toBeNull();
});
it('allows a re-trial for a failed candidate and preserves entered details during checking',async()=>{
 const view=await setup('FAIL');
 expect(screen.getByRole('button',{name:'Save Trial Form'}).hasAttribute('disabled')).toBe(false);
 expect(screen.getByRole('button',{name:'Save Draft'}).hasAttribute('disabled')).toBe(false);
 expect(view.container.querySelector<HTMLInputElement>('input[name="Name of candidate"]')?.value).toBe('Candidate');
 expect((screen.getByLabelText('Aadhaar no.') as HTMLInputElement).closest('fieldset')?.disabled).toBe(false);
 expect(screen.getByRole('button',{name:'New form'})).toBeTruthy();
});
