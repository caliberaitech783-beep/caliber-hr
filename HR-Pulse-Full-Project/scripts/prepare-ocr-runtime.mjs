import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdir,copyFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Copy runtime files from the installed dependency, keeping JS/WASM versions aligned.
const sdk=await realpath(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js')));
const sdkRequire=createRequire(sdk),runtime=dirname(sdkRequire.resolve('onnxruntime-web'));
const target=new URL('../public/ocr/runtime/',import.meta.url);
await mkdir(target,{recursive:true});
for(const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
 await copyFile(join(runtime,file),new URL(file,target));
}
