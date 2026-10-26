import type {PaddleOCR} from '@paddleocr/paddleocr-js';
let engine:Promise<Awaited<ReturnType<typeof PaddleOCR.create>>>|undefined;
let queue=Promise.resolve();

// Official worker mode runs inference on the device, with same-origin static
// models and runtime files. No hosted OCR API, account or billing key is used.
async function getEngine(){
 if(!engine)engine=import('@paddleocr/paddleocr-js').then(({PaddleOCR})=>PaddleOCR.create({
  worker:true,
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
  const [result]=await ocr.predict(image,{textDetLimitSideLen:1600,textDetLimitType:'max',textRecScoreThresh:.5});
  return result.items.map(item=>item.text).join('\n');
 });
 queue=result.then(()=>{},()=>{});
 return result;
}
