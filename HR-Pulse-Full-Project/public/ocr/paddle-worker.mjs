// Supply the already-downloaded runtime directly to the official SDK worker.
// HTTP cache sharing between a page and worker is not guaranteed.
const waiting=[];
self.onmessage=event=>waiting.push(event);
async function preload(event){
 if(event.data?.kind!=='ocr-runtime')return;
 self.removeEventListener('message',preload);
 const wasm=event.data.wasm,nativeFetch=self.fetch.bind(self);
 const runtimeUrl=new URL('/ocr/runtime/ort-wasm-simd-threaded.jsep.wasm',self.location.origin).href;
 self.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,self.location.href).href;
  return url===runtimeUrl?Promise.resolve(new Response(wasm,{headers:{'Content-Type':'application/wasm'}})):nativeFetch(input,options);
 };
 try{
  await import('./runtime/paddle-sdk-worker.js?v=20261028-2');
  const handle=self.onmessage;
  for(const message of waiting.splice(0))handle.call(self,message);
 }catch(error){setTimeout(()=>{throw error;});}
}
self.addEventListener('message',preload);
