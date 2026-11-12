/* Minimal dependency-free PDF writer (Helvetica, A4 landscape) for the vehicle-trial batch sheet.
   Enough for headings, text lines and a simple ruled table with automatic page breaks. */
const W=841.89,H=595.28,M=36;
const esc=s=>String(s??'').replace(/[^\x20-\x7e]/g,c=>({'–':'-','—':'-','’':"'",'‘':"'",'“':'"','”':'"','₹':'Rs.','·':'-'}[c]||'?')).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const width=(s,size)=>String(s??'').length*size*0.52;   /* average Helvetica glyph width */
function fit(s,size,max){s=String(s??'');if(width(s,size)<=max)return s;while(s.length>1&&width(s+'…',size)>max)s=s.slice(0,-1);return s+'…';}
export function buildPdf({title='',subtitle=[],columns=[],rows=[],footer=''}){
 const pages=[];let ops=[],y=H-M;
 const text=(x,yy,s,size=9,bold=false)=>{ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${esc(s)}) Tj ET`);};
 const line=(x1,y1,x2,y2)=>{ops.push(`${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`);};
 const total=columns.reduce((a,c)=>a+c.width,0),scale=(W-2*M)/total,cols=columns.map(c=>({...c,width:c.width*scale}));
 const rowH=16;
 const header=()=>{text(M,y-14,title,14,true);y-=22;for(const s of subtitle){text(M,y-10,s,9);y-=13;}y-=6;
  let x=M;line(M,y,W-M,y);for(const c of cols){text(x+3,y-11,c.label,8,true);x+=c.width;}y-=rowH;line(M,y,W-M,y);};
 const flush=()=>{if(footer)text(M,M-14,footer,7);text(W-M-60,M-14,`Page ${pages.length+1}`,7);pages.push(ops.join('\n'));ops=[];y=H-M;};
 header();
 for(const r of rows){if(y-rowH<M+10){flush();header();}let x=M;for(let i=0;i<cols.length;i++){text(x+3,y-11,fit(r[i],8,cols[i].width-6),8);x+=cols[i].width;}y-=rowH;line(M,y,W-M,y);}
 if(!rows.length){text(M,y-12,'No rows',9);}
 flush();
 const objects=[];const add=s=>{objects.push(s);return objects.length;};
 const f1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),f2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
 const pagesId=objects.length+1+pages.length*2;const pageIds=[];
 for(const content of pages){const stream=Buffer.from(content,'latin1');const c=add(`<< /Length ${stream.length} >>\nstream\n${content}\nendstream`);const p=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${c} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`);pageIds.push(p);}
 const pg=add(`<< /Type /Pages /Kids [${pageIds.map(i=>i+' 0 R').join(' ')}] /Count ${pageIds.length} >>`);if(pg!==pagesId)throw new Error('pdf object numbering');
 const cat=add(`<< /Type /Catalog /Pages ${pg} 0 R >>`);
 let out='%PDF-1.4\n';const offsets=[];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out,'latin1'));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(out,'latin1');
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out,'latin1');
}
