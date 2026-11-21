/* Smart Print for one vehicle trial form (owner, 21 Nov 2026: "every feature as on Pulse").
 * Same steps as Pulse's Smart Print: tick what to print (here the form's sections instead of columns),
 * save / print / delete named layouts, a live preview, Print/Export as PDF or Excel, then
 * Print → page size → printer, pages, sides and copies → Print now. */
import {savedSession} from '../api';
import {DOCS, equipment, status, type Trial} from './records';
import {approvalNotes, approvalSigns, candidateDetails, esc, resultDetails, validPhoto} from './views';

export type SectionId = 'details'|'photo'|'documents'|'result'|'approvals'|'notes';
export const FORM_SECTIONS: readonly {id: SectionId; label: string}[] = [
  {id:'details',label:'Part 1 – Candidate details'},
  {id:'photo',label:'Candidate photo'},
  {id:'documents',label:'Document check'},
  {id:'result',label:'Part 2 – Trial result'},
  {id:'approvals',label:'Approvals'},
  {id:'notes',label:'Approval notes'},
];
/** The sections this form has: approval notes only when someone wrote one. */
export const availableSections = (row: Trial) => FORM_SECTIONS.filter(section=>section.id!=='notes'||approvalNotes(row).length>0);
export const normalizeSections = (available: readonly {id: SectionId}[], ids: readonly string[]) =>
  available.map(section=>section.id).filter(id=>ids.includes(id));

/* ---------- page sizes and print options (as on Pulse) ---------- */
export type PageSize = {name: string; detail: string; widthMm: number; heightMm: number};
export const FORM_PAGE_SIZES: readonly PageSize[] = [
  {name:'A4',detail:'210 × 297 mm portrait',widthMm:210,heightMm:297},
  {name:'A4 landscape',detail:'297 × 210 mm landscape',widthMm:297,heightMm:210},
  {name:'A3',detail:'297 × 420 mm portrait',widthMm:297,heightMm:420},
  {name:'A3 landscape',detail:'420 × 297 mm landscape',widthMm:420,heightMm:297},
];
export const formPageSize = (name: string) => FORM_PAGE_SIZES.find(page=>page.name===name)||FORM_PAGE_SIZES[0];
export const PRINT_DUPLEX_OPTIONS = [
  {value:'one-sided',label:'Single-sided'},
  {value:'long-edge',label:'Double-sided · flip on the long edge (book)'},
  {value:'short-edge',label:'Double-sided · flip on the short edge (notepad)'},
] as const;
export type Duplex = typeof PRINT_DUPLEX_OPTIONS[number]['value'];
export type PrintOptions = {pages: string; duplex: Duplex; copies: number};
export const PRINT_OPTIONS_STORAGE_KEY = 'hr:smart-print:options';

/** "1-3, 5 ,8" -> "1-3,5,8"; blank means all pages. Throws on anything else. */
export function normalizePageRanges(text: unknown) {
  const value=String(text??'').replace(/\s+/g,'');
  if(!value)return '';
  if(!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value))throw new Error('Enter the pages to print like 1-3,5 or leave it blank for all pages.');
  const parts=value.split(',').map(part=>part.split('-').map(Number));
  if(parts.some(([from,to])=>from<1||(to!==undefined&&to<from)))throw new Error('Page numbers start at 1 and each range must go from a lower page to a higher one.');
  return parts.map(([from,to])=>to===undefined||to===from?String(from):`${from}-${to}`).join(',');
}
export function normalizePrintOptions(options: {pages?: unknown; duplex?: unknown; copies?: unknown} = {}): PrintOptions {
  const duplex=(PRINT_DUPLEX_OPTIONS.find(option=>option.value===options.duplex)?.value||'one-sided') as Duplex;
  const copies=Math.min(99,Math.max(1,Math.trunc(Number(options.copies))||1));
  return {pages:normalizePageRanges(options.pages),duplex,copies};
}
/** The page numbers a selection keeps out of `total` pages, in page order. Blank keeps every page. */
export function selectedPages(ranges: string, total: number) {
  const all=Array.from({length:total},(_,index)=>index+1);
  if(!ranges)return all;
  const wanted=new Set<number>();
  for(const part of ranges.split(',')){
    const [from,to=from]=part.split('-').map(Number);
    for(let page=from;page<=Math.min(to,total);page++)wanted.add(page);
  }
  return all.filter(page=>wanted.has(page));
}
/** Sides and copies are remembered on this PC; the page selection is always asked fresh (as on Pulse). */
export function loadPrintOptions(storage: Storage|undefined = globalThis.localStorage): PrintOptions {
  try{const saved=JSON.parse(storage?.getItem(PRINT_OPTIONS_STORAGE_KEY)||'{}');return normalizePrintOptions({...saved,pages:''});}
  catch{return {pages:'',duplex:'one-sided',copies:1};}
}
export function savePrintOptions(options: PrintOptions, storage: Storage|undefined = globalThis.localStorage) {
  try{storage?.setItem(PRINT_OPTIONS_STORAGE_KEY,JSON.stringify({duplex:options.duplex,copies:options.copies}));}catch{/* private mode */}
}

/* ---------- saved layouts ---------- */
export type FormLayout = {number: number; name: string; sections: SectionId[]};
export const layoutStorageKey = (account: string) => `hr:trial-form-smart-print:layouts:${account.toLowerCase()}`;
export function validLayouts(value: unknown): FormLayout[] {
  return Array.isArray(value) ? value
    .filter(item=>Number.isInteger(item?.number)&&item.number>0&&Array.isArray(item.sections))
    .map(item=>({number:item.number,name:String(item.name||`Layout ${item.number}`).trim()||`Layout ${item.number}`,
      sections:item.sections.filter((id: unknown)=>FORM_SECTIONS.some(section=>section.id===id))})) : [];
}
export function nextLayout(layouts: FormLayout[], sections: SectionId[], name: string): FormLayout {
  const cleaned=String(name||'').replace(/\s+/g,' ').trim().slice(0,80);
  if(!cleaned)throw new Error('Enter a name for the layout.');
  if(!sections.length)throw new Error('Select at least one section before saving a layout.');
  if(layouts.some(layout=>layout.name.toLowerCase()===cleaned.toLowerCase()))throw new Error(`A layout named “${cleaned}” already exists. Choose another name.`);
  return {number:Math.max(0,...layouts.map(layout=>layout.number))+1,name:cleaned,sections:[...sections]};
}

/* ---------- the printed sheet ---------- */
export const SHEET_CSS = `
.tfsp-sheet{background:#fff;color:#28143f;font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:12px;line-height:1.35;display:grid;gap:7px;padding:0}
.tfsp-sheet *{box-sizing:border-box}
.tfsp-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:2px solid #6a2db8;padding-bottom:8px}
.tfsp-head h1{margin:0;font-size:17px}
.tfsp-head .co{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6a2db8;font-weight:700}
.tfsp-head .meta{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#6e6279}
.tfsp-head .st{text-align:right;font-size:11px;color:#6e6279}
.tfsp-head .st b{display:inline-block;padding:2px 8px;border-radius:10px;background:#efe7ff;color:#28143f;font-size:11px}
.tfsp-bar{background:#efe7ff;border-left:3px solid #6a2db8;padding:5px 9px;font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase;display:flex;justify-content:space-between}
.tfsp-bar em{font-style:normal;font-weight:500;text-transform:none;letter-spacing:0;color:#6e6279}
.tfsp-grid{display:grid;grid-template-columns:minmax(0,1fr) 140px;border:1px solid #b7a5ca}
.tfsp-grid.solo{grid-template-columns:minmax(0,1fr)}
.tfsp-rows{display:grid;min-width:0}
.tfsp-rows.boxed{border:1px solid #b7a5ca}
.tfsp-row{display:grid;grid-template-columns:180px minmax(0,1fr);border-bottom:1px solid #e3d8ef}
.tfsp-row:last-child{border-bottom:0}
.tfsp-row .k{padding:3px 9px;font-weight:500;background:#faf7ff;border-right:1px solid #e3d8ef}
.tfsp-row .v{padding:3px 9px;word-break:break-word}
.tfsp-photo{border-left:1px solid #b7a5ca;display:grid;place-items:center;padding:8px;color:#6e6279;font-size:11px}
.tfsp-photo.alone{border:1px solid #b7a5ca;justify-items:start;padding:10px}
.tfsp-photo img{width:120px;height:150px;object-fit:cover;border-radius:6px}
.tfsp-t{width:100%;border-collapse:collapse;border:1px solid #b7a5ca}
.tfsp-t th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6e6279;font-weight:600;padding:6px 8px;border-bottom:1px solid #b7a5ca;background:#faf7ff}
.tfsp-t td{padding:3px 8px;border-bottom:1px solid #e3d8ef}
.tfsp-pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600}
.tfsp-pill.pass{background:#e2f4ea;color:#17824a}.tfsp-pill.fail{background:#fbe7e5;color:#c2352b}.tfsp-pill.wait{background:#fdf1d8;color:#a76a00}
.tfsp-sigs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px 10px;padding-top:4px}
.tfsp-sig{border-top:1.5px solid #28143f;padding-top:5px;text-align:center;display:grid;gap:1px;font-size:11.5px}
.tfsp-sig b{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.tfsp-sig .st{font-weight:600}.tfsp-sig.ok .st{color:#17824a}.tfsp-sig.no .st{color:#c2352b}.tfsp-sig.wait .st{color:#6e6279}
.tfsp-sig .m{color:#6e6279}
.tfsp-note{margin:0;padding:6px 9px;border:1px solid #e3d8ef;border-radius:4px}
.tfsp-foot{display:flex;justify-content:space-between;font-size:10.5px;color:#6e6279;border-top:1px solid #e3d8ef;padding-top:6px}
`;
const dash = (value: string) => value ? esc(value) : '<span style="color:#6e6279">–</span>';
const rowHtml = ([label,value]: [string,string]) => `<div class="tfsp-row" data-keep><div class="k">${esc(label)}</div><div class="v">${dash(value)}</div></div>`;
const bar = (title: string, who = '') => `<div class="tfsp-bar" data-keep="bar">${esc(title)}${who?`<em>${esc(who)}</em>`:''}</div>`;
const resultText = (row: Trial) => row.result==='PASS'?'PASS':row.result==='FAIL'?'FAIL':'Trial pending';
const photoHtml = (row: Trial) => validPhoto(row) ? `<img src="${esc(row.photo)}" alt="Photo of ${esc(row.name)}">` : 'No photo';
export const printedStamp = (at = new Date()) => at.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).replace(/\//g,'-');

/** The printed form: a title block, then each chosen section in the form's own order. */
export function printSheetHtml(row: Trial, sections: readonly SectionId[], printedBy = '', printedAt = printedStamp()) {
  const on = (id: SectionId) => sections.includes(id);
  const parts: string[] = [];
  if(on('details')){
    parts.push(bar('Part 1 – Candidate details','Site HR'));
    parts.push(`<div class="tfsp-grid${on('photo')?'':' solo'}"><div class="tfsp-rows">${candidateDetails(row).map(rowHtml).join('')}</div>${on('photo')?`<div class="tfsp-photo">${photoHtml(row)}</div>`:''}</div>`);
  }else if(on('photo')){
    parts.push(bar('Candidate photo'),`<div class="tfsp-photo alone" data-keep>${photoHtml(row)}</div>`);
  }
  if(on('documents')){
    parts.push(bar('Document check'),`<table class="tfsp-t"><thead><tr data-keep><th>Document</th><th>Seen</th><th>Remarks</th></tr></thead><tbody>${DOCS.map(([key,label])=>
      `<tr data-keep><td>${esc(label)}</td><td>${dash(row.docs[key]?.seen||'')}</td><td>${esc(row.docs[key]?.remarks)}</td></tr>`).join('')}</tbody></table>`);
  }
  if(on('result')){
    const pill=row.result==='PASS'?'pass':row.result==='FAIL'?'fail':'wait';
    parts.push(bar('Part 2 – Trial result','Driver Trainer'),`<div class="tfsp-rows boxed"><div class="tfsp-row" data-keep><div class="k">Result</div><div class="v"><span class="tfsp-pill ${pill}">${resultText(row)}</span></div></div>${resultDetails(row).map(rowHtml).join('')}</div>`);
  }
  if(on('approvals')){
    parts.push(bar('Approvals'),`<div class="tfsp-sigs" data-keep>${approvalSigns(row).map(sign=>`<div class="tfsp-sig ${sign.cls}"><b>${esc(sign.label)}</b><span class="st">${esc(sign.action)}</span><span>${esc(sign.by)||'&nbsp;'}</span><span class="m">${esc(sign.on)||'&nbsp;'}</span></div>`).join('')}</div>`);
  }
  if(on('notes')&&approvalNotes(row).length){
    parts.push(bar('Approval notes'),...approvalNotes(row).map(([who,note])=>`<p class="tfsp-note" data-keep><b>${esc(who)}:</b> ${esc(note)}</p>`));
  }
  return `<div class="tfsp-sheet">
    <div class="tfsp-head" data-keep><div><div class="co">Caliber Mining and Logistics Ltd · Vehicle trial form</div><h1>${esc(row.name)}</h1>
      <div class="meta">${esc(row.formNo)}${row.batch?' · Batch '+esc(row.batch):''} · ${esc(row.site)} · ${esc(row.post)} · ${esc(equipment(row))}</div></div>
      <div class="st"><b>${esc(status(row))}</b></div></div>
    ${parts.join('\n')}
    <div class="tfsp-foot" data-keep><span>Printed ${esc(printedAt)}${printedBy?' by '+esc(printedBy):''}</span><span>HRMS · Trial Status</span></div>
  </div>`;
}

/* ---------- Excel ---------- */
export async function formWorkbook(row: Trial, sections: readonly SectionId[], printedBy = '') {
  const {default:ExcelJS}=await import('exceljs');
  const book=new ExcelJS.Workbook();
  book.creator='HRMS';
  const sheet=book.addWorksheet('Trial form',{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  sheet.columns=[{width:30},{width:46},{width:30},{width:22}];
  const purple='FF6A2DB8',soft='FFEFE7FF';
  const title=sheet.addRow([`Vehicle trial form · ${row.name}`]);title.font={bold:true,size:14};sheet.mergeCells(title.number,1,title.number,3);
  sheet.addRow([`${row.formNo}${row.batch?' · Batch '+row.batch:''} · ${row.site} · ${status(row)}`]).font={color:{argb:'FF6E6279'}};
  sheet.addRow([`Printed ${printedStamp()}${printedBy?' by '+printedBy:''}`]).font={italic:true,color:{argb:'FF6E6279'},size:9};
  const heading=(text: string, who = '')=>{
    sheet.addRow([]);
    const line=sheet.addRow([text.toUpperCase(),who]);
    line.font={bold:true,color:{argb:purple}};
    for(let column=1;column<=3;column++)line.getCell(column).fill={type:'pattern',pattern:'solid',fgColor:{argb:soft}};
  };
  const pairs=(data: [string,string][])=>{for(const [label,value] of data){const line=sheet.addRow([label,value||'–']);line.getCell(1).font={bold:true};line.getCell(2).alignment={wrapText:true,vertical:'top'};}};
  const on=(id: SectionId)=>sections.includes(id);
  if(on('details')){
    heading('Part 1 – Candidate details','Site HR');
    const first=sheet.rowCount+1;
    pairs(candidateDetails(row));
    if(on('photo')&&validPhoto(row)){
      const image=book.addImage({base64:row.photo,extension:'jpeg'});
      sheet.addImage(image,{tl:{col:2.2,row:first-1},ext:{width:120,height:150}});
    }
  }else if(on('photo')){
    heading('Candidate photo');
    if(validPhoto(row)){
      const at=sheet.rowCount;
      for(let index=0;index<8;index++)sheet.addRow([]);
      sheet.addImage(book.addImage({base64:row.photo,extension:'jpeg'}),{tl:{col:0,row:at},ext:{width:120,height:150}});
    }else sheet.addRow(['No photo']);
  }
  if(on('documents')){
    heading('Document check');
    sheet.addRow(['Document','Seen','Remarks']).font={bold:true};
    for(const [key,label] of DOCS)sheet.addRow([label,row.docs[key]?.seen||'–',row.docs[key]?.remarks||'']);
  }
  if(on('result')){
    heading('Part 2 – Trial result','Driver Trainer');
    pairs([['Result',resultText(row)],...resultDetails(row)]);
  }
  if(on('approvals')){
    heading('Approvals');
    sheet.addRow(['Step','Status','By','Date']).font={bold:true};
    for(const sign of approvalSigns(row))sheet.addRow([sign.label,sign.action,sign.by,sign.on]);
  }
  if(on('notes')&&approvalNotes(row).length){
    heading('Approval notes');
    pairs(approvalNotes(row));
  }
  const buffer=await book.xlsx.writeBuffer();
  return new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

/* ---------- PDF (pages drawn from the sheet, never cutting a line in half) ---------- */
const MARGIN_MM = 12;
const PX_PER_MM = 96/25.4;
export const sheetWidthPx = (page: PageSize) => Math.round((page.widthMm-2*MARGIN_MM)*PX_PER_MM);
/** Page breaks: each page ends before the first line that would not fit; a section bar always moves with the line under it. */
export function pageBreaks(blocks: {top: number; bottom: number; bar?: boolean}[], total: number, pageHeight: number) {
  const pages: [number,number][] = [];
  let start=0;
  while(start<total-0.5){
    let end=Math.min(total,start+pageHeight);
    if(end<total){
      const index=blocks.findIndex(block=>block.top>=start+1&&block.bottom>end);
      if(index>=0){
        let cut=blocks[index].top;
        for(let back=index-1;back>=0&&blocks[back].bar&&blocks[back].top>start+1;back--)cut=blocks[back].top;
        if(cut>start+1)end=cut;
      }
    }
    pages.push([start,end]);start=end;
  }
  return pages.length?pages:[[0,Math.max(1,total)] as [number,number]];
}
type PageImage = {bytes: Uint8Array; width: number; height: number; heightPx: number};
async function renderPages(row: Trial, sections: readonly SectionId[], page: PageSize, printedBy: string): Promise<PageImage[]> {
  const width=sheetWidthPx(page),pageHeight=Math.floor((page.heightMm-2*MARGIN_MM)*PX_PER_MM);
  const host=document.createElement('div');
  host.setAttribute('aria-hidden','true');
  host.style.cssText=`position:fixed;left:-20000px;top:0;width:${width}px;background:#fff;z-index:-1`;
  host.innerHTML=`<style>${SHEET_CSS}</style>${printSheetHtml(row,sections,printedBy)}`;
  document.body.append(host);
  try{
    const sheet=host.querySelector<HTMLElement>('.tfsp-sheet')!;
    await Promise.all([...sheet.querySelectorAll('img')].map(image=>image.decode?.().catch(()=>undefined)));
    await document.fonts?.ready;
    const origin=sheet.getBoundingClientRect().top;
    const blocks=[...sheet.querySelectorAll<HTMLElement>('[data-keep]')].map(node=>{const box=node.getBoundingClientRect();return {top:box.top-origin,bottom:box.bottom-origin,bar:node.dataset.keep==='bar'};});
    const total=sheet.scrollHeight;
    const scale=2.5;
    const {default:html2canvas}=await import('html2canvas');
    const canvas=await html2canvas(sheet,{backgroundColor:'#ffffff',scale,useCORS:true,logging:false,width,height:total,windowWidth:width});
    return pageBreaks(blocks,total,pageHeight).map(([from,to])=>{
      const slice=document.createElement('canvas');
      slice.width=canvas.width;slice.height=Math.max(1,Math.round((to-from)*scale));
      const context=slice.getContext('2d')!;
      context.fillStyle='#ffffff';context.fillRect(0,0,slice.width,slice.height);
      context.drawImage(canvas,0,Math.round(from*scale),canvas.width,slice.height,0,0,canvas.width,slice.height);
      const data=slice.toDataURL('image/jpeg',.95).split(',')[1]||'';
      const binary=atob(data),bytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
      return {bytes,width:slice.width,height:slice.height,heightPx:to-from};
    });
  }finally{host.remove();}
}
/** A plain PDF with one JPEG per page, placed at the top-left margin at true size. */
export function pdfFromPages(images: PageImage[], page: PageSize) {
  const pt=72/25.4,pageW=page.widthMm*pt,pageH=page.heightMm*pt,margin=MARGIN_MM*pt;
  const contentW=pageW-2*margin,ptPerPx=contentW/sheetWidthPx(page);
  const encoder=new TextEncoder(),chunks: Uint8Array[]=[],offsets: number[]=[];
  let length=0;
  const push=(part: Uint8Array|string)=>{const bytes=typeof part==='string'?encoder.encode(part):part;chunks.push(bytes);length+=bytes.length;};
  const object=(number: number, ...parts: (Uint8Array|string)[])=>{offsets[number]=length;push(`${number} 0 obj\n`);parts.forEach(push);push('\nendobj\n');};
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids=images.map((_,index)=>`${3+index*3} 0 R`).join(' ');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`);
  images.forEach((image,index)=>{
    const pageObject=3+index*3,imageObject=pageObject+1,contentObject=pageObject+2;
    const drawH=image.heightPx*ptPerPx,y=pageH-margin-drawH;
    const content=`q\n${contentW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${margin.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    object(pageObject,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    object(imageObject,`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,image.bytes,'\nendstream');
    object(contentObject,`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  });
  const count=3+images.length*3,xref=length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for(let number=1;number<count;number++)push(`${String(offsets[number]).padStart(10,'0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks as BlobPart[],{type:'application/pdf'});
}
const fileBase = (row: Trial) => `${row.formNo||'trial-form'}-${row.name||'candidate'}`.replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,'-');
function download(blob: Blob, name: string) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.style.display='none';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
/** Sends the PDF to the browser's print window from a hidden frame; opens it in a new tab if the frame cannot print. */
function printPdf(blob: Blob) {
  const url=URL.createObjectURL(blob),frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');frame.title='Smart Print';
  frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  frame.onload=()=>{
    setTimeout(()=>{
      try{frame.contentWindow?.focus();frame.contentWindow?.print();}
      catch{window.open(url,'_blank','noopener');}
    },300);
  };
  frame.src=url;document.body.append(frame);
  setTimeout(()=>{frame.remove();URL.revokeObjectURL(url);},10*60_000);
}

/* ---------- the dialog ---------- */
const DIALOG_CSS = `
.smart-print-dialog{width:min(980px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:0;border:1px solid var(--line,#e3d8ef);border-radius:10px;background:var(--surface,#fff);color:var(--fg,#28143f);font-family:var(--font,system-ui);display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden}
.smart-print-dialog:not([open]){display:none}
.smart-print-dialog::backdrop{background:rgba(15,12,30,.55)}
.smart-print-dialog>header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line,#e3d8ef)}
.smart-print-dialog>header>div{flex:1;min-width:0}
.smart-print-dialog h2{margin:0;font-size:17px}.smart-print-dialog header p{margin:2px 0 0;color:var(--muted,#6e6279);font-size:12.5px}
.smart-print-dialog button{font:inherit;border:1px solid var(--line-strong,#b7a5ca);background:var(--surface,#fff);color:inherit;border-radius:7px;padding:7px 12px;cursor:pointer}
.smart-print-dialog button.primary{background:var(--accent,#6a2db8);border-color:var(--accent,#6a2db8);color:#fff}
.smart-print-dialog button:disabled{opacity:.5;cursor:not-allowed}
.smart-print-body{overflow:auto;padding:12px 14px;display:grid;gap:10px;align-content:start}
.smart-print-body>p{margin:0;font-size:12.5px;color:var(--muted,#6e6279)}
.smart-print-fit-policy{background:var(--accent-soft,#efe7ff);border-radius:6px;padding:6px 9px;color:var(--fg,#28143f)!important}
.smart-print-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
.smart-print-controls label{display:grid;gap:3px;font-size:12px;color:var(--muted,#6e6279)}
.smart-print-controls select{padding:7px 9px;border:1px solid var(--line-strong,#b7a5ca);border-radius:6px;min-width:200px;background:var(--surface,#fff);color:inherit}
.smart-print-sections{display:flex;flex-wrap:wrap;gap:6px 14px;border:1px solid var(--line,#e3d8ef);border-radius:6px;padding:8px 10px}
.smart-print-sections label{display:inline-flex;gap:6px;align-items:center;font-size:13px}
.smart-print-notice{min-height:1em;color:var(--warn,#a76a00)!important}
.smart-print-preview{border:1px solid var(--line,#e3d8ef);border-radius:6px;padding:10px;background:#f4f1f8;display:grid;gap:8px}
.smart-print-preview h3{margin:0;font-size:13px}
.smart-print-paper{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15);padding:18px;max-width:760px;width:100%;justify-self:center}
.smart-print-dialog>footer{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--line,#e3d8ef);position:relative}
.smart-print-dialog>footer>span{margin-right:auto;font-size:12.5px;color:var(--muted,#6e6279)}
.smart-print-page-prompt:empty{display:none}
.smart-print-page-prompt{position:absolute;inset:0;background:rgba(255,255,255,.96);display:grid;place-items:center;padding:16px;overflow:auto}
.smart-print-page-size{width:min(520px,100%);display:grid;gap:10px;border:1px solid var(--line,#e3d8ef);border-radius:10px;padding:16px;background:var(--surface,#fff)}
.smart-print-page-size h3{margin:0}.smart-print-page-size p{margin:0;font-size:12.5px;color:var(--muted,#6e6279)}
.smart-print-page-size>div{display:flex;flex-wrap:wrap;gap:8px}
.smart-print-page-size fieldset{border:1px solid var(--line,#e3d8ef);border-radius:6px;display:grid;gap:4px;padding:6px 10px}
.smart-print-page-size legend{font-size:12px;font-weight:600}
.smart-print-radio{display:flex;gap:6px;align-items:center;font-size:13px}
.smart-print-page-size input[type=text],.smart-print-page-size input[type=number]{padding:6px 8px;border:1px solid var(--line-strong,#b7a5ca);border-radius:6px;max-width:200px}
.smart-print-options-error{color:var(--fail,#c2352b)!important;min-height:1em}
.smart-print-export-toast{position:absolute;left:14px;bottom:calc(100% + 8px);display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:7px;font-size:12.5px;box-shadow:0 2px 8px rgba(0,0,0,.15);background:#fff;border:1px solid var(--line,#e3d8ef)}
.smart-print-export-toast.success{border-color:var(--pass,#17824a)}.smart-print-export-toast.error{border-color:var(--fail,#c2352b)}
.smart-print-export-toast button{padding:0 6px;border:0}
@media (max-width:640px){.smart-print-paper{padding:8px}.smart-print-dialog>footer>span{flex-basis:100%}}
`;

export type FormSmartPrintDeps = {
  exportPdf?: (row: Trial, sections: SectionId[], page: PageSize, printedBy: string) => Promise<void>;
  exportExcel?: (row: Trial, sections: SectionId[], printedBy: string) => Promise<void>;
  print?: (row: Trial, sections: SectionId[], page: PageSize, options: PrintOptions, printedBy: string) => Promise<void>;
};
export const defaultDeps: Required<FormSmartPrintDeps> = {
  async exportPdf(row,sections,page,printedBy){download(pdfFromPages(await renderPages(row,sections,page,printedBy),page),`${fileBase(row)}.pdf`);},
  async exportExcel(row,sections,printedBy){download(await formWorkbook(row,sections,printedBy),`${fileBase(row)}.xlsx`);},
  async print(row,sections,page,options,printedBy){
    const pages=await renderPages(row,sections,page,printedBy);
    const keep=selectedPages(options.pages,pages.length);
    if(!keep.length)throw new Error(`This form has ${pages.length} page${pages.length===1?'':'s'}. Choose pages from 1 to ${pages.length}.`);
    const chosen=keep.map(number=>pages[number-1]);
    // Copies are laid out one after another (collated); the print window still offers its own copies box.
    printPdf(pdfFromPages(Array.from({length:options.copies},()=>chosen).flat(),page));
  },
};

export function openFormSmartPrint(parent: ShadowRoot|HTMLElement, row: Trial, deps: FormSmartPrintDeps = {}) {
  const run={...defaultDeps,...deps};
  const session=savedSession() as {profile?: {name?: string; login?: string; username?: string}}|null;
  const printedBy=session?.profile?.name||session?.profile?.login||'';
  const account=session?.profile?.login||session?.profile?.username||session?.profile?.name||'';
  const sections=availableSections(row);
  let selected: SectionId[]=sections.map(section=>section.id),layouts: FormLayout[]=[],storageError='';
  const key=layoutStorageKey(account);
  try{
    if(!account)throw new Error('Sign in again to save print layouts.');
    layouts=validLayouts(JSON.parse(localStorage.getItem(key)||'[]'));
  }catch{storageError='Layouts cannot be saved in this browser right now. You can still customize and print.';}
  const title=`${row.name} · ${row.formNo}`;
  const previousFocus=(parent instanceof ShadowRoot?parent.activeElement:document.activeElement) as HTMLElement|null;
  const make=<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const button=(text: string, action: ()=>void, into: HTMLElement, className?: string)=>{const node=make('button',text,className);node.type='button';node.onclick=action;into.append(node);return node;};
  const dialog=make('dialog',undefined,'smart-print-dialog');dialog.setAttribute('aria-label','Smart Print');
  const style=make('style');style.textContent=DIALOG_CSS+SHEET_CSS;dialog.append(style);
  let closed=false,busy=false,toastTimer: ReturnType<typeof setTimeout>|undefined;
  const close=()=>{closed=true;clearTimeout(toastTimer);if(dialog.open&&typeof dialog.close==='function')dialog.close();dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();};
  const header=make('header');
  button('←',close,header).setAttribute('aria-label','Back');
  const heading=make('div');heading.append(make('h2','Smart Print'),make('p',title));header.append(heading);
  button('×',close,header).setAttribute('aria-label','Close Smart Print');
  dialog.append(header);
  const body=make('div',undefined,'smart-print-body');dialog.append(body);
  body.append(make('p','Print properties: Fit the form to the page width · Long forms continue on additional pages without cutting a line · Applied automatically to printing, PDF and Excel.','smart-print-fit-policy'));
  body.append(make('p','Tick the sections to print. All sections are selected by default and the same selection is used for Smart Print, PDF and Excel.'));
  const controls=make('div',undefined,'smart-print-controls');body.append(controls);
  const layoutLabel=make('label','Saved form layouts'),layoutSelect=make('select');layoutLabel.append(layoutSelect);controls.append(layoutLabel);
  const ticks=make('div',undefined,'smart-print-sections');ticks.setAttribute('role','group');ticks.setAttribute('aria-label','Sections to print');body.append(ticks);
  const notice=make('p',storageError,'smart-print-notice');notice.setAttribute('role','status');body.append(notice);
  const preview=make('div',undefined,'smart-print-preview');body.append(preview);
  const footer=make('footer');dialog.append(footer);
  const toast=make('div',undefined,'smart-print-export-toast');toast.hidden=true;toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');
  const toastText=make('span');toast.append(toastText);
  button('×',()=>{toast.hidden=true;clearTimeout(toastTimer);},toast).setAttribute('aria-label','Dismiss notification');
  footer.append(toast);
  const notify=(message: string, state: 'pending'|'success'|'error')=>{
    if(closed)return;
    clearTimeout(toastTimer);toastText.textContent=message;toast.hidden=false;toast.className=`smart-print-export-toast ${state}`;
    if(state==='success')toastTimer=setTimeout(()=>{toast.hidden=true;},10000);
  };
  const count=make('span');footer.append(count);
  button('Cancel',close,footer);
  const prompt=make('div',undefined,'smart-print-page-prompt');dialog.append(prompt);
  const dismissPrompt=()=>prompt.replaceChildren();
  const askChoice=(title: string, hint: string, label: string, options: {label: string; value: string}[], pick: (value: string)=>void)=>{
    const panel=make('div',undefined,'smart-print-page-size');panel.setAttribute('role','group');panel.setAttribute('aria-label',label);
    panel.append(make('h3',title),make('p',hint));
    const choices=make('div');panel.append(choices);
    const first=options.map(option=>button(option.label,()=>{dismissPrompt();pick(option.value);},choices,'primary'))[0];
    button('Back',dismissPrompt,choices);
    prompt.replaceChildren(panel);first?.focus();
  };
  const currentLayout=()=>layouts.find(layout=>String(layout.number)===layoutSelect.value);
  const current=()=>{const layout=currentLayout();return normalizeSections(sections,layout?layout.sections:selected);};
  const work=async(label: string, job: ()=>Promise<void>, done: string)=>{
    if(busy)return;busy=true;render();notify(`Preparing ${label}… It will be ready shortly.`,'pending');
    try{await new Promise(resolve=>setTimeout(resolve,30));await job();notify(done,'success');}
    catch(error){notify((error as Error)?.message||`Could not prepare the ${label}.`,'error');}
    finally{busy=false;if(!closed)render();}
  };
  const askPrintOptions=(page: PageSize)=>{
    const remembered=loadPrintOptions();
    const state={pagesMode:'all',pages:'',duplex:remembered.duplex as string,copies:String(remembered.copies)};
    const panel=make('div',undefined,'smart-print-page-size smart-print-options');panel.setAttribute('role','group');panel.setAttribute('aria-label','Print options');
    panel.append(make('h3',`Print options · ${page.name}`),make('p','Choose the pages, the sides and the number of copies.'));
    const field=(legend: string)=>{const box=make('fieldset');box.append(make('legend',legend));panel.append(box);return box;};
    const radio=(into: HTMLElement, name: string, value: string, label: string, checked: boolean, pick: ()=>void)=>{
      const wrap=make('label',undefined,'smart-print-radio'),input=make('input');input.type='radio';input.name=name;input.value=value;input.checked=checked;input.onchange=pick;
      wrap.append(input,make('span',label));into.append(wrap);return input;
    };
    field('Printer').append(make('p','The printer is chosen in the print window.','smart-print-printer-note'));
    const pagesBox=field('Pages');
    radio(pagesBox,'tfsp-pages','all','All pages',true,()=>{state.pagesMode='all';});
    const custom=radio(pagesBox,'tfsp-pages','custom','Only these pages',false,()=>{state.pagesMode='custom';pagesInput.focus();});
    const pagesInput=make('input');pagesInput.type='text';pagesInput.placeholder='e.g. 1-3,5';pagesInput.setAttribute('aria-label','Pages to print');
    pagesInput.oninput=()=>{state.pages=pagesInput.value;state.pagesMode='custom';custom.checked=true;};
    pagesBox.append(pagesInput);
    const sidesBox=field('Sides');
    PRINT_DUPLEX_OPTIONS.forEach(option=>radio(sidesBox,'tfsp-duplex',option.value,option.label,option.value===state.duplex,()=>{state.duplex=option.value;}));
    const copiesBox=field('Copies');
    const copiesInput=make('input');copiesInput.type='number';copiesInput.min='1';copiesInput.max='99';copiesInput.step='1';copiesInput.value=state.copies;copiesInput.setAttribute('aria-label','Copies');
    copiesInput.oninput=()=>{state.copies=copiesInput.value;};copiesBox.append(copiesInput);
    const error=make('p',undefined,'smart-print-options-error');error.setAttribute('role','alert');panel.append(error);
    const actions=make('div');panel.append(actions);
    button('Print now',()=>{
      let options: PrintOptions;
      try{options=normalizePrintOptions({pages:state.pagesMode==='custom'?state.pages:'',duplex:state.duplex,copies:state.copies});}
      catch(problem){error.textContent=(problem as Error).message;return;}
      if(state.pagesMode==='custom'&&!options.pages){error.textContent='Enter the pages to print, or choose All pages.';return;}
      savePrintOptions(options);dismissPrompt();
      const chosen=current();
      const sides=options.duplex==='one-sided'?'':' In the print window set Two-sided printing to match.';
      void work('print',()=>run.print(row,chosen,page,options,printedBy),`Sent to the print window: ${page.name}, ${options.pages?`pages ${options.pages}`:'all pages'}, ${options.copies} cop${options.copies===1?'y':'ies'}.${sides}`);
    },actions,'primary');
    button('Back',dismissPrompt,actions);
    prompt.replaceChildren(panel);
  };
  const printSelection=()=>{
    if(!current().length)return;
    askChoice('Select page size to print','The form is drawn to the selected page so nothing is cut off. In the print window keep Paper size set to the same size.','Select page size',
      FORM_PAGE_SIZES.map(page=>({label:`${page.name} · ${page.detail}`,value:page.name})),name=>askPrintOptions(formPageSize(name)));
  };
  const exportAs=(format: string)=>{
    const chosen=current();if(!chosen.length)return;
    if(format==='xlsx')return void work('Excel',()=>run.exportExcel(row,chosen,printedBy),'Excel download started. Check your browser downloads.');
    askChoice('Select page size for the PDF','The PDF pages use this paper size.','Select PDF page size',FORM_PAGE_SIZES.map(page=>({label:`${page.name} · ${page.detail}`,value:page.name})),
      name=>void work('PDF',()=>run.exportPdf(row,chosen,formPageSize(name),printedBy),'PDF download started. Check your browser downloads.'));
  };
  const exportButton=button('Print/Export',()=>{if(current().length)askChoice('Print/Export as PDF or Excel','The export uses the selected sections, in the same order as the preview.','Select export format',[{label:'PDF',value:'pdf'},{label:'Excel (.xlsx)',value:'xlsx'}],exportAs);},footer,'smart-print-export');
  const printButton=button('Print current selection',printSelection,footer,'primary');
  const printSaved=button('Print saved layout',printSelection,controls,'smart-print-saved-print');
  const deleteSaved=button('Delete saved layout',()=>{
    try{
      const layout=currentLayout();
      if(!layout)throw new Error('Select a saved form layout to delete.');
      if(!window.confirm(`Delete the saved form layout “${layout.name}”?`))return;
      layouts=validLayouts(JSON.parse(localStorage.getItem(key)||'[]')).filter(item=>item.number!==layout.number);
      localStorage.setItem(key,JSON.stringify(layouts));
      fillLayouts();notice.textContent=`Deleted “${layout.name}”. Your current selection is still available to print or save again.`;render();
    }catch(error){notice.textContent=(error as Error)?.message||'Could not delete the saved form layout.';}
  },controls,'smart-print-saved-delete');
  const fillLayouts=(number='')=>{
    layoutSelect.replaceChildren();
    const custom=make('option','Custom selection');custom.value='';layoutSelect.append(custom);
    for(const layout of layouts){const option=make('option',layout.name);option.value=String(layout.number);layoutSelect.append(option);}
    layoutSelect.value=String(number);
  };
  const render=()=>{
    const chosen=current(),saved=Boolean(currentLayout());
    ticks.replaceChildren(...sections.map(section=>{
      const label=make('label'),input=make('input');input.type='checkbox';input.checked=chosen.includes(section.id);input.dataset.section=section.id;
      input.onchange=()=>{selected=normalizeSections(sections,input.checked?[...chosen,section.id]:chosen.filter(id=>id!==section.id));layoutSelect.value='';render();};
      label.append(input,make('span',section.label));return label;
    }));
    printButton.hidden=saved;printButton.disabled=!chosen.length||busy;
    printSaved.disabled=!saved||busy;deleteSaved.disabled=!saved||Boolean(storageError);
    exportButton.disabled=!chosen.length||busy;
    count.textContent=`${chosen.length} of ${sections.length} sections`;
    const paper=make('div',undefined,'smart-print-paper');
    if(chosen.length)paper.innerHTML=printSheetHtml(row,chosen,printedBy);
    else paper.append(make('p','Select at least one section.'));
    preview.replaceChildren(make('h3','Print preview'),paper);
  };
  button('Select all',()=>{selected=sections.map(section=>section.id);layoutSelect.value='';render();},controls);
  button('Clear selection',()=>{selected=[];layoutSelect.value='';render();},controls);
  const save=button('Save as new layout',()=>{
    try{
      const name=window.prompt('Enter a name for this form layout:',`Trial form layout ${Math.max(0,...layouts.map(layout=>layout.number))+1}`);
      if(name===null)return;
      const latest=validLayouts(JSON.parse(localStorage.getItem(key)||'[]'));
      const layout=nextLayout(latest,current(),name);
      layouts=[...latest,layout];localStorage.setItem(key,JSON.stringify(layouts));fillLayouts(String(layout.number));
      notice.textContent=`Saved as “${layout.name}”. Use Print saved layout to print it now.`;render();
    }catch(error){notice.textContent=(error as Error)?.message||'Could not save the layout. Browser storage may be unavailable.';}
  },controls);
  save.disabled=Boolean(storageError);
  layoutSelect.onchange=()=>{const layout=currentLayout();if(layout)selected=normalizeSections(sections,layout.sections);render();};
  // Keep keys inside this dialog even though the form window traps focus at document level.
  dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'&&typeof dialog.showModal!=='function'){event.preventDefault();if(prompt.childElementCount)dismissPrompt();else close();}});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(prompt.childElementCount)dismissPrompt();else close();});
  fillLayouts();render();
  parent.append(dialog);
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  return {dialog,close};
}
