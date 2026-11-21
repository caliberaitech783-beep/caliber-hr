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

it('scans a complete licence once and clears readiness when removed',async()=>{
  const ready=vi.fn(),file=photo('complete.jpg');
  render(<DrivingLicenceUploader allowComplete onBusy={vi.fn()} onReady={ready} onDetails={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Choose complete driving licence image'),{target:{files:[file]}});
  await screen.findByAltText('Uploaded complete driving licence preview');
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(readGeminiDrivingLicence).toHaveBeenCalledWith([file],'test');
  expect(ready).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button',{name:'Remove'}));
  await waitFor(()=>expect(ready).toHaveBeenLastCalledWith(false));
});
