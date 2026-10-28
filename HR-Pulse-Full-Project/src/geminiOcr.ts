import {API,clearSession} from './api';
export type AadhaarDetails={name:string;dob:string;gender:string;uid:string;address:string;relationName:string};
async function prepareImage(file:File):Promise<Blob>{
 if(file.size>20_000_000)throw new Error('Use an Aadhaar image smaller than 20 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  if(!context)throw new Error('Could not prepare this image. Please use a JPG or PNG.');
  for(const maxSide of [2200,1800,1400]){
   const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not prepare image')),'image/jpeg',.9));
   if(blob.size<=1_300_000)return blob;
  }
  throw new Error('This image is too large to scan. Please crop to the Aadhaar card and retry.');
 }finally{bitmap.close();}
}
export async function readGeminiAadhaar(file:File,grant:string):Promise<AadhaarDetails>{
 const image=await prepareImage(file),content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read image'));reader.readAsDataURL(image);});
 let response:Response;
 try{response=await fetch(API+'/api/aadhaar/scan',{method:'POST',headers:{Authorization:'Bearer '+grant,'Content-Type':'application/json'},body:JSON.stringify({mime:image.type,content}),signal:AbortSignal.timeout(60000)});}catch{throw new Error('The scan could not finish. Check your connection and retry. (GEMINI_CONNECTION)');}
 const result=await response.json();
 if(!response.ok){if(response.status===401){clearSession();window.dispatchEvent(new Event('hr-session-expired'));}throw new Error(result.error||'The Aadhaar scan failed. Please retry.');}
 if(!result.details||['name','dob','gender','uid','address','relationName'].some(key=>typeof result.details[key]!=='string'))throw new Error('The reader returned an invalid result. Please retry.');
 return result.details;
}
