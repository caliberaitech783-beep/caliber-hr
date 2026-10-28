import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),predict:vi.fn()}));
vi.mock('@paddleocr/paddleocr-js',()=>({PaddleOCR:{create:mocks.create}}));
beforeEach(()=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)})));
afterEach(()=>{vi.resetModules();vi.clearAllMocks();vi.unstubAllGlobals();});

it('runs the free worker with same-origin model/runtime assets and reuses it',async()=>{
 mocks.predict.mockResolvedValue([{items:[{text:'Arun Vijay Sharma'},{text:'DOB: 01/02/1990'}]}]);
 mocks.create.mockResolvedValue({predict:mocks.predict});
 const {readPaddleText}=await import('./paddleOcr'),image=new Blob(['sample']);
 expect(await readPaddleText(image)).toBe('Arun Vijay Sharma\nDOB: 01/02/1990');
 await readPaddleText(image);
 expect(mocks.create).toHaveBeenCalledTimes(1);
 const options=mocks.create.mock.calls[0][0];
 expect(options.worker.createWorker).toBeTypeOf('function');
 for(const url of [options.textDetectionModelAsset.url,options.textRecognitionModelAsset.url,options.ortOptions.wasmPaths]){
  expect(new URL(url).origin).toBe(location.origin);
  expect(new URL(url).pathname).toMatch(/^\/ocr\//);
 }
 expect(mocks.predict).toHaveBeenCalledWith(image,expect.any(Object));
 for(const [url] of vi.mocked(fetch).mock.calls)expect(new URL(String(url)).origin).toBe(location.origin);
});

it('transfers the downloaded runtime to the worker instead of relying on shared HTTP cache',async()=>{
 const wasm=new Uint8Array([0,97,115,109]).buffer,postMessage=vi.fn();
 vi.stubGlobal('Worker',vi.fn(function(){return {postMessage};}));
 vi.mocked(fetch).mockImplementation(async input=>({ok:true,arrayBuffer:async()=>String(input).endsWith('.wasm')?wasm:new ArrayBuffer(0)} as Response));
 mocks.create.mockResolvedValue({predict:mocks.predict});
 mocks.predict.mockResolvedValue([{items:[]}]);
 const {readPaddleText}=await import('./paddleOcr');await readPaddleText(new Blob());
 mocks.create.mock.calls[0][0].worker.createWorker();
 expect(Worker).toHaveBeenCalledWith(new URL('/ocr/paddle-worker.mjs',location.origin),{type:'module'});
 const [message,transfers]=postMessage.mock.calls[0];
 expect(message.kind).toBe('ocr-runtime');
 expect([...new Uint8Array(message.wasm)]).toEqual([0,97,115,109]);
 expect(message.wasm).not.toBe(wasm);
 expect(transfers).toEqual([message.wasm]);
});

it('allows a retry after model initialization fails without using another service',async()=>{
 mocks.create.mockRejectedValueOnce(new Error('Model unavailable')).mockResolvedValueOnce({predict:mocks.predict});
 mocks.predict.mockResolvedValue([{items:[{text:'Arun Vijay Sharma'}]}]);
 const {readPaddleText}=await import('./paddleOcr');
 await expect(readPaddleText(new Blob())).rejects.toThrow('Model unavailable');
 expect(await readPaddleText(new Blob())).toBe('Arun Vijay Sharma');
 expect(mocks.create).toHaveBeenCalledTimes(2);
});

it('does not start inference or contact a fallback when runtime download fails',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:false} as Response);
 const {readPaddleText}=await import('./paddleOcr');
 await expect(readPaddleText(new Blob())).rejects.toThrow('could not download');
 expect(mocks.create).not.toHaveBeenCalled();
});

it('keeps a successful reading when a later pass fails and continues after it',async()=>{
 const dispose=vi.fn().mockResolvedValue(undefined);
 mocks.create.mockResolvedValue({predict:mocks.predict,dispose});
 mocks.predict.mockResolvedValueOnce([{items:[{text:'Arun Vijay Sharma'}]}])
  .mockRejectedValueOnce(new Error('memory allocation failed'))
  .mockResolvedValueOnce([{items:[{text:'S/O: Vijay Sharma'}]}]);
 const {readPaddlePasses}=await import('./paddleOcr');
 const reading=await readPaddlePasses([new Blob(),new Blob(),new Blob()]);
 expect(reading.text).toBe('Arun Vijay Sharma\nS/O: Vijay Sharma');
 expect(reading.warning).toContain('successful readings were kept');
 expect(reading.warning).toContain('OCR_MEMORY');
 expect(dispose).toHaveBeenCalledOnce();
 expect(mocks.create).toHaveBeenCalledTimes(2);
});

it('recovers from a failed initial pass and keeps a later successful pass',async()=>{
 mocks.create.mockRejectedValueOnce(new Error('Detection model timed out after 60s'))
  .mockResolvedValue({predict:mocks.predict});
 mocks.predict.mockResolvedValue([{items:[{text:'DOB: 01/02/1990'}]}]);
 const {readPaddlePasses}=await import('./paddleOcr');
 expect(await readPaddlePasses([new Blob(),new Blob()])).toMatchObject({text:'DOB: 01/02/1990',warning:expect.stringContaining('OCR_TIMEOUT')});
});

it('keeps native readings even when every OCR pass fails',async()=>{
 mocks.create.mockRejectedValue(new Error('Failed to fetch'));
 const {readPaddlePasses}=await import('./paddleOcr');
 expect(await readPaddlePasses([new Blob()],['Arun Vijay Sharma'])).toMatchObject({text:'Arun Vijay Sharma',warning:expect.stringContaining('OCR_DOWNLOAD')});
});

it('reports complete failures and permits a later upload to retry',async()=>{
 mocks.create.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({predict:mocks.predict});
 mocks.predict.mockResolvedValue([{items:[{text:'Arun Vijay Sharma'}]}]);
 const {readPaddlePasses,ocrErrorMessage}=await import('./paddleOcr');
 await expect(readPaddlePasses([new Blob()])).rejects.toThrow('Failed to fetch');
 expect((await readPaddlePasses([new Blob()])).text).toBe('Arun Vijay Sharma');
 expect(ocrErrorMessage(new Error('Failed to fetch'))).toContain('OCR_DOWNLOAD');
 expect(ocrErrorMessage(new Error('Worker not supported'))).toContain('OCR_BROWSER');
 expect(ocrErrorMessage(new Error('private image text'))).not.toContain('private image text');
});
