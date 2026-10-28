import {afterEach,expect,it,vi} from 'vitest';
import {readGeminiAadhaar} from './geminiOcr';
afterEach(()=>vi.unstubAllGlobals());
it('sends PDFs directly with the PDF MIME type even when the browser omits it',async()=>{
 const details={name:'Example Person',dob:'',gender:'',uid:'',address:'',relationName:''};
 const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({details})});vi.stubGlobal('fetch',fetchMock);
 vi.stubGlobal('createImageBitmap',vi.fn(()=>{throw Error('must not decode PDF as an image');}));
 expect(await readGeminiAadhaar(new File(['%PDF-1.7\nexample'],'card.PDF'),'grant')).toEqual(details);
 const input=JSON.parse(fetchMock.mock.calls[0][1].body);expect(input.mime).toBe('application/pdf');expect(atob(input.content)).toBe('%PDF-1.7\nexample');
});
it('rejects oversized PDFs before making a paid request',async()=>{
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 await expect(readGeminiAadhaar(new File([new Uint8Array(1_300_001)],'card.pdf'),'grant')).rejects.toThrow('1.3 MB');expect(fetchMock).not.toHaveBeenCalled();
});
