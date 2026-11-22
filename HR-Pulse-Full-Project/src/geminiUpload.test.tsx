import {afterEach,expect,it,vi} from 'vitest';
import {useRef} from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AadhaarUpload} from './EmployeeLocation';
import {readGeminiAadhaar} from './geminiOcr';
vi.mock('./geminiOcr',()=>({readGeminiAadhaar:vi.fn()}));
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();});
function Form(){const ref=useRef<HTMLFormElement>(null);return <form ref={ref}><input aria-label="Employee name" name="Full Name"/><input aria-label="Parent" name="Father / Spouse Name"/><AadhaarUpload form={ref}/></form>;}
it('keeps successful fields when scanning a replacement upload fails',async()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'test-grant'}));
 vi.mocked(readGeminiAadhaar).mockResolvedValueOnce({name:'Example Person',relationName:'Example Parent',dob:'2000-01-01',gender:'Male',address:'',uid:''}).mockRejectedValueOnce(new Error('Gemini quota unavailable'));
 render(<Form/>);
 fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[new File(['%PDF-1.7'],'front.pdf',{type:'application/pdf'})]}});
 await waitFor(()=>expect(screen.getByLabelText('Employee name')).toHaveValue('Example Person'));
 fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[new File(['test'],'back.jpg',{type:'image/jpeg'})]}});
 await screen.findByText(/Gemini quota unavailable/);
 expect(screen.getByLabelText('Employee name')).toHaveValue('Example Person');expect(screen.getByLabelText('Parent')).toHaveValue('Example Parent');
 expect(readGeminiAadhaar).toHaveBeenCalledTimes(2);
});
it('keeps separate Aadhaar sides until a complete card replaces them',async()=>{
 vi.spyOn(URL,'createObjectURL').mockImplementation(file=>'blob:'+(file as File).name);
 vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 render(<Form/>);
 function upload(label:string,name:string){
  fireEvent.change(screen.getByLabelText(label),{target:{files:[new File(['test'],name,{type:'image/jpeg'})]}});
 }
 upload('Choose second Aadhaar image','back.jpg');
 upload('Choose Aadhaar front image','front.jpg');
 expect(screen.getByAltText('Uploaded Aadhaar image 1 preview')).toHaveAttribute('src','blob:front.jpg');
 expect(screen.getByAltText('Uploaded Aadhaar image 2 preview')).toHaveAttribute('src','blob:back.jpg');
 upload('Choose Aadhaar card from gallery','card.jpg');
 expect(screen.getByAltText('Uploaded Aadhaar image 1 preview')).toHaveAttribute('src','blob:card.jpg');
 expect(screen.queryByAltText('Uploaded Aadhaar image 2 preview')).toBeNull();
});

it('offers camera and document choices for each side before opening a picker',()=>{
 render(<Form/>);
 const camera=vi.spyOn(screen.getByLabelText('Capture Aadhaar card'),'click');
 for(const [button,input] of [
  ['Upload Aadhaar Front Image','Choose Aadhaar front image'],
  ['Upload Aadhaar Back Image','Choose second Aadhaar image'],
 ]){
  const gallery=vi.spyOn(screen.getByLabelText(input),'click');
  fireEvent.click(screen.getByRole('button',{name:button}));
  expect(gallery).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Camera'}));
  expect(camera).toHaveBeenCalledTimes(1);
  camera.mockClear();
  fireEvent.click(screen.getByRole('button',{name:'Gallery / Document'}));
  expect(gallery).toHaveBeenCalledTimes(1);
 }
});
