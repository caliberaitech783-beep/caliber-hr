import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),predict:vi.fn()}));
vi.mock('@paddleocr/paddleocr-js',()=>({PaddleOCR:{create:mocks.create}}));
afterEach(()=>{vi.resetModules();vi.clearAllMocks();});

it('runs the free worker with same-origin model/runtime assets and reuses it',async()=>{
 mocks.predict.mockResolvedValue([{items:[{text:'Arun Vijay Sharma'},{text:'DOB: 01/02/1990'}]}]);
 mocks.create.mockResolvedValue({predict:mocks.predict});
 const {readPaddleText}=await import('./paddleOcr'),image=new Blob(['sample']);
 expect(await readPaddleText(image)).toBe('Arun Vijay Sharma\nDOB: 01/02/1990');
 await readPaddleText(image);
 expect(mocks.create).toHaveBeenCalledTimes(1);
 const options=mocks.create.mock.calls[0][0];
 expect(options.worker).toBe(true);
 for(const url of [options.textDetectionModelAsset.url,options.textRecognitionModelAsset.url,options.ortOptions.wasmPaths]){
  expect(new URL(url).origin).toBe(location.origin);
  expect(new URL(url).pathname).toMatch(/^\/ocr\//);
 }
 expect(mocks.predict).toHaveBeenCalledWith(image,expect.any(Object));
});

it('allows a retry after model initialization fails without using another service',async()=>{
 mocks.create.mockRejectedValueOnce(new Error('Model unavailable')).mockResolvedValueOnce({predict:mocks.predict});
 mocks.predict.mockResolvedValue([{items:[{text:'Arun Vijay Sharma'}]}]);
 const {readPaddleText}=await import('./paddleOcr');
 await expect(readPaddleText(new Blob())).rejects.toThrow('Model unavailable');
 expect(await readPaddleText(new Blob())).toBe('Arun Vijay Sharma');
 expect(mocks.create).toHaveBeenCalledTimes(2);
});
