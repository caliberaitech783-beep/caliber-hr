import {readPaddleText} from './paddleOcr';

// Bulk uploads often combine several documents in one PDF. Each page is read on
// the device and filed under the checklist document its text identifies.
// PAN, PF, ESIC and bank documents often print the linked Aadhaar number, so
// they are checked before Aadhaar.
const textRules:[string,RegExp][]=[
 ['PAN',/income\s*tax|permanent\s*account|\b[A-Z]{5}\d{4}[A-Z]\b/i],
 ['Driving licence',/driving\s*licen[cs]e|\bDL\s*No\b/i],
 ['UAN / PF details',/\bUAN\b|provident\s*fund|\bEPFO?\b/i],
 ['ESIC details',/\bESIC?\b|state\s*insurance/i],
 ['Bank proof / cancelled cheque',/\bIFSC|cheque|passbook|savings\s*(?:bank|fund|account)|\bA\/C\s*No/i],
 ['Aadhaar (masked display)',/aadhaar|aadhar|unique\s*identification|\b(?:\d{4}|X{4})\s\d{4}\s\d{4}\b|government\s*of\s*india/i],
 ['VTC certificate',/vocational\s*training|\bVTC\b/i],
 ['Medical fitness certificate',/medical|fitness/i],
 ['Education certificates',/mark\s*sheet|marksheet|statement\s*of\s*marks|board\s*of\s*(?:secondary|higher)|university|certificate\s*of\s*passing/i],
 ['Previous employment / experience proof',/experience\s*(?:letter|certificate)|relieving|pay\s*slip|salary\s*slip/i],
 ['Address proof',/electricity|ration\s*card|election\s*commission|voter/i],
];
export function classifyDocumentText(text:string,names:string[]){return textRules.find(([name,rule])=>names.includes(name)&&rule.test(text))?.[0];}

const maxPages=20,maxBytes=950_000;
function toJpeg(canvas:HTMLCanvasElement,quality:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare the page image')),'image/jpeg',quality));}
async function pdfPages(file:File){
 const pdfjs=await import('pdfjs-dist');
 pdfjs.GlobalWorkerOptions.workerSrc=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
 const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise,pages:{image:Blob;text:string}[]=[];
 try{
  for(let number=1;number<=Math.min(pdf.numPages,maxPages);number++){
   const page=await pdf.getPage(number),size=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(3,1800/Math.max(size.width,size.height))}),canvas=document.createElement('canvas');
   // Digital PDFs (e-Aadhaar, e-PAN, bank statements) carry their own text, which is read without OCR.
   let text='';try{text=(await page.getTextContent()).items.map(item=>'str' in item?item.str:'').join(' ');}catch{/* Scanned page: OCR reads it. */}
   canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
   // Print intent renders without animation frames, which pause while the tab is in the background.
   await page.render({canvas,viewport,intent:'print'}).promise;pages.push({image:await toJpeg(canvas,.85),text});
  }
 }finally{await pdf.destroy();}
 return pages;
}
// Pages of one document are stacked into a single JPEG that stays under the 1 MB upload limit.
async function jpegFile(blobs:Blob[],name:string){
 const images=await Promise.all(blobs.map(blob=>createImageBitmap(blob))),width=Math.max(...images.map(image=>image.width)),height=images.reduce((total,image)=>total+image.height,0);
 try{
  for(let scale=Math.min(1,1800/width);;scale*=.75){
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('Could not prepare the page image');
   canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
   let top=0;for(const image of images){context.drawImage(image,0,top,image.width*scale,image.height*scale);top+=image.height*scale;}
   for(const quality of [.85,.7,.55]){const blob=await toJpeg(canvas,quality);if(blob.size<=maxBytes||scale<.3)return new File([blob],name,{type:'image/jpeg'});}
  }
 }finally{images.forEach(image=>image.close());}
}

export async function sortBulkDocument(file:File,names:string[]){
 const pdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name),base=file.name.replace(/\.[^.]+$/,'');
 const read=pdf?await pdfPages(file):[{image:file as Blob,text:''}],pages=read.map(page=>page.image),groups=new Map<string,Blob[]>(),unknown:number[]=[],failures:unknown[]=[];
 for(const [index,page] of read.entries()){
  let name=classifyDocumentText(page.text,names);
  // One page the on-device reader cannot read stays in bulk documents; the other pages are still sorted.
  if(!name)try{name=classifyDocumentText(await readPaddleText(page.image),names);}catch(error){failures.push(error);}
  if(name)groups.set(name,[...(groups.get(name)||[]),page.image]);else unknown.push(index);
 }
 if(!groups.size){if(failures.length)throw failures[0];return {found:[] as [string,File][],rest:[file]};}
 // A file that is one document whole is filed as it was uploaded.
 if(!pdf||groups.size===1&&!unknown.length)return {found:[[[...groups.keys()][0],file]] as [string,File][],rest:[]};
 const found:[string,File][]=[];
 for(const [name,blobs] of groups)found.push([name,await jpegFile(blobs,`${base} - ${name.replace(/[^A-Za-z0-9]+/g,' ').trim()}.jpg`)]);
 const rest=await Promise.all(unknown.map(index=>jpegFile([pages[index]],`${base} - page ${index+1}.jpg`)));
 return {found,rest};
}
