import type {PaddleOCR} from '@paddleocr/paddleocr-js';
let engine:Promise<Awaited<ReturnType<typeof PaddleOCR.create>>>|undefined;
let queue=Promise.resolve();

// Official worker mode runs inference on the device, with same-origin static
// models and runtime files. No hosted OCR API, account or billing key is used.
async function getEngine(){
 if(!engine)engine=Promise.all([
  import('@paddleocr/paddleocr-js'),
  // Complete the first download outside model startup, then transfer the WASM
  // bytes to the worker. Do not depend on HTTP cache sharing across contexts.
  ...['ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'].map(async file=>{
   const response=await fetch(new URL('/ocr/runtime/'+file,location.origin),{signal:AbortSignal.timeout(300000)});
   if(!response.ok)throw new Error('The on-device reader could not download. Please retry.');
   return response.arrayBuffer();
  }),
 ]).then(([{PaddleOCR},,wasm])=>PaddleOCR.create({
  worker:{createWorker:()=>{
   const worker=new Worker(new URL('/ocr/paddle-worker.mjs',location.origin),{type:'module'});
   const copy=wasm.slice(0);
   worker.postMessage({kind:'ocr-runtime',wasm:copy},[copy]);
   return worker;
  }},
  textDetectionModelName:'PP-OCRv5_mobile_det',
  textRecognitionModelName:'en_PP-OCRv5_mobile_rec',
  textDetectionModelAsset:{url:new URL('/ocr/PP-OCRv5_mobile_det.tar',location.origin).href},
  textRecognitionModelAsset:{url:new URL('/ocr/en_PP-OCRv5_mobile_rec.tar',location.origin).href},
  ortOptions:{backend:'wasm',numThreads:1,wasmPaths:new URL('/ocr/runtime/',location.origin).href},
 })).catch(error=>{engine=undefined;throw error;});
 return engine;
}
export function readPaddleText(image:Blob):Promise<string>{
 const result=queue.then(async()=>{
  const ocr=await getEngine();
  try{
   const [result]=await ocr.predict(image,{textDetLimitSideLen:1600,textDetLimitType:'max',textRecScoreThresh:.5});
   return result.items.map(item=>item.text).join('\n');
  }catch(error){
   // A crashed worker/session must not poison every subsequent pass or retry.
   engine=undefined;
   try{await ocr.dispose();}catch{/* Preserve the original reading error. */}
   throw error;
  }
 });
 queue=result.then(()=>{},()=>{});
 return result;
}

export function ocrErrorMessage(error:unknown){
 const message=error instanceof Error?error.message:String(error);
 if(/download|fetch|network|HTTP|load.*(?:module|script)/i.test(message))return 'The OCR files could not download. Check your connection and retry. (OCR_DOWNLOAD)';
 if(/timeout|timed out|abort/i.test(message))return 'The on-device reader took too long to start or read this image. Retry after the first download completes. (OCR_TIMEOUT)';
 if(/memory|alloc|out of bounds/i.test(message))return 'The browser ran out of memory while reading. Close unused tabs or use a smaller image and retry. (OCR_MEMORY)';
 if(/WebAssembly|wasm|Worker|OffscreenCanvas|not supported/i.test(message))return 'The browser could not run the on-device reader. Update Chrome or Edge and retry. (OCR_BROWSER)';
 return 'The on-device reader could not process this image. Retry with a clear JPG or PNG, or enter the details manually. (OCR_PROCESSING)';
}

export async function readPaddlePasses(sources:Blob[],existingTexts:string[]=[]){
 const texts=existingTexts.filter(text=>text.trim()),failures:unknown[]=[];
 for(const source of sources){
  try{const text=await readPaddleText(source);if(text.trim())texts.push(text);}
  catch(error){failures.push(error);}
 }
 if(!texts.length&&failures.length)throw failures[0];
 return {text:texts.join('\n'),warning:failures.length?`Some reading attempts failed; successful readings were kept. ${ocrErrorMessage(failures[0])}`:''};
}
