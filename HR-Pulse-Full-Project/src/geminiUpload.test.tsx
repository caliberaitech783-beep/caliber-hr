import {afterEach,expect,it,vi} from 'vitest';
import {useRef} from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AadhaarUpload} from './EmployeeLocation';
import {readGeminiAadhaar} from './geminiOcr';
vi.mock('./geminiOcr',()=>({readGeminiAadhaar:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();});
function Form(){const ref=useRef<HTMLFormElement>(null);return <form ref={ref}><input aria-label="Employee name" name="Full Name"/><input aria-label="Parent" name="Father / Spouse Name"/><AadhaarUpload form={ref}/></form>;}
it('keeps successful fields when the second Gemini scan fails',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'test-grant'}));
 vi.mocked(readGeminiAadhaar).mockResolvedValueOnce({name:'Example Person',relationName:'Example Parent',dob:'2000-01-01',gender:'Male',address:'',uid:''}).mockRejectedValueOnce(new Error('Gemini quota unavailable'));
 render(<Form/>);
 fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[new File(['%PDF-1.7'],'front.pdf',{type:'application/pdf'})]}});
 await waitFor(()=>expect(screen.getByLabelText('Employee name')).toHaveValue('Example Person'));
 fireEvent.change(screen.getByLabelText('Choose second Aadhaar image'),{target:{files:[new File(['test'],'back.jpg',{type:'image/jpeg'})]}});
 await screen.findByText(/Gemini quota unavailable/);
 expect(screen.getByLabelText('Employee name')).toHaveValue('Example Person');expect(screen.getByLabelText('Parent')).toHaveValue('Example Parent');
 expect(readGeminiAadhaar).toHaveBeenCalledTimes(2);
});
