import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import AadhaarUploader from '../AadhaarUploader';
import DrivingLicenceUploader from '../DrivingLicenceUploader';
import {readGeminiDrivingLicence} from '../geminiOcr';

vi.mock('../geminiOcr',()=>({readGeminiAadhaar:vi.fn(),readGeminiDrivingLicence:vi.fn()}));
const photo=(name:string)=>new File(['photo'],name,{type:'image/jpeg'});
beforeEach(()=>{
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'test'}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});

it('stacks both Aadhaar photos into the single file shown in the preview',async()=>{
  const front={width:300,height:180,close:vi.fn()},back={width:200,height:140,close:vi.fn()};
  vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValueOnce(front).mockResolvedValueOnce(back));
  const drawImage=vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage,fillRect:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this:HTMLCanvasElement,callback){
    expect([this.width,this.height]).toEqual([300,320]);
    callback(new Blob(['combined'],{type:'image/jpeg'}));
  });
  render(<AadhaarUploader combineSides hideSecond fillDetails={()=>'Read'}/>);
  fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[photo('front.jpg'),photo('back.jpg')]}});
  await screen.findByAltText('Aadhaar front and back');
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(drawImage.mock.calls).toEqual([[front,0,0,300,180],[back,50,180,200,140]]);
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({name:'aadhaar-front-and-back.jpg'}));
});

it.each(['jpg','pdf'])('scans a complete %s licence once and clears readiness when removed',async format=>{
  const ready=vi.fn(),file=format==='pdf'?new File(['pdf'],'complete.pdf',{type:'application/pdf'}):photo('complete.jpg');
  render(<DrivingLicenceUploader allowComplete onBusy={vi.fn()} onReady={ready} onDetails={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Choose complete driving licence image or PDF'),{target:{files:[file]}});
  if(format==='pdf') await screen.findByLabelText('Uploaded complete driving licence PDF preview');
  else await screen.findByAltText('Uploaded complete driving licence preview');
  expect(readGeminiDrivingLicence).toHaveBeenCalledWith([file],'test');
  expect(ready).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button',{name:'Remove'}));
  await waitFor(()=>expect(ready).toHaveBeenLastCalledWith(false));
});
it.each(['jpg','jpeg','png','pdf'])('opens and closes the enlarged Aadhaar %s preview',async format=>{
  render(<AadhaarUploader photo={new File(['preview'],'front.'+format,{type:format==='pdf'?'application/pdf':format==='png'?'image/png':'image/jpeg'})} fillDetails={()=>'Read'}/>);
  const dialog=document.querySelector('dialog')!;
  // jsdom does not implement the native dialog methods.
  dialog.showModal=()=>{dialog.open=true;};
  dialog.close=()=>{dialog.open=false;};
  fireEvent.click(await screen.findByRole('button',{name:format==='pdf'?'Enlarge Uploaded Aadhaar image 1 PDF preview':'Enlarge Uploaded Aadhaar image 1 preview'}));
  expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true);
  if(format==='pdf')expect(screen.getByLabelText('Enlarged PDF document').getAttribute('data')).toBe('blob:test');
  fireEvent.click(screen.getByRole('button',{name:'Close enlarged image'}));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('accepts one complete Aadhaar PDF on the trial form',async()=>{
  const file=new File(['pdf'],'aadhaar.pdf',{type:'application/pdf'});
  render(<AadhaarUploader combineSides hideSecond fillDetails={()=>'Read'}/>);
  const input=screen.getByLabelText('Choose Aadhaar card from gallery');
  expect(input.getAttribute('accept')).toContain('application/pdf');
  fireEvent.change(input,{target:{files:[file]}});
  await screen.findByLabelText('Uploaded Aadhaar image 1 PDF preview');
  expect(URL.createObjectURL).toHaveBeenCalledWith(file);
});
