import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {mkdir,copyFile,realpath,readdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Copy runtime files from the installed dependency, keeping JS/WASM versions aligned.
const sdk=await realpath(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js')));
const sdkRequire=createRequire(sdk),runtime=dirname(sdkRequire.resolve('onnxruntime-web'));
const target=new URL('../public/ocr/runtime/',import.meta.url);
await mkdir(target,{recursive:true});
for(const file of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
 await copyFile(join(runtime,file),new URL(file,target));
}
const assets=join(dirname(sdk),'assets');
const workers=(await readdir(assets)).filter(file=>/^worker-entry-.*\.js$/.test(file));
if(workers.length!==1)throw new Error('Expected one official PaddleOCR worker');
// SDK 0.4.2 hard-codes 60s for each session. Allow slower client devices 180s.
// Apply only these two initialization deadlines; fail on upstream changes.
let worker=await readFile(join(assets,workers[0]),'utf8'),deadlines=0;
worker=worker.replace(/(createSession\(ort, modelBytes, providerCandidates\),\s*)6e4(,\s*"(?:Detection|Recognition) model")/g,(_match,before,after)=>{deadlines++;return before+'18e4'+after;});
if(deadlines!==2)throw new Error('PaddleOCR session deadlines changed; review the worker adapter');
await writeFile(new URL('paddle-sdk-worker.js',target),'// Locally adapted: session startup deadlines are 180 seconds.\n'+worker);
