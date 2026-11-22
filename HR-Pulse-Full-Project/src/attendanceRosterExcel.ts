import ExcelJS from 'exceljs';
import {downloadBlob} from './api';
import {codeLabel,type RosterGroup} from './rosterModel';
import {DIFF_HEADING,ROSTER_TOTALS,bioTotals,diffText,tripTotals,weekday} from './AttendanceRoster';

/* Roster Excel (owner, 22 Nov 2026): the layout of the owner's sample sheet. Title, legend, weekday row, headings;
   per employee a Trip Card line and a Bio Matric line with coloured codes and totals, the difference count merged
   over both lines. A second sheet lists every day where the two lines differ. */
export const CODE_COLOURS:Record<string,[string,string]>={P:['EAF3DE','27500A'],HD:['FAEEDA','633806'],A:['FCEBEB','791F1F'],WO:['F1EFE8','444441'],H:['EEEDFE','3C3489'],
 CO:['E1F5EE','085041'],L:['FBEAF0','72243E'],OD:['E6F1FB','0C447C'],MP:['FAECE7','712B13'],IN:['E1F5EE','085041'],'?':['F1EFE8','5F5E5A']};
const fill=(argb:string):ExcelJS.Fill=>({type:'pattern',pattern:'solid',fgColor:{argb:'FF'+argb}});
const show=(date:string)=>date.split('-').reverse().join('-');
const monthName=(date:string)=>new Date(date+'T00:00:00Z').toLocaleString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'});

export async function rosterWorkbook({groups,dates,tripsLoaded,monthly,from,to}:{groups:RosterGroup[];dates:string[];tripsLoaded:boolean;monthly:boolean;from:string;to:string}){
 const wb=new ExcelJS.Workbook();
 const ws=wb.addWorksheet('Roster',{views:[{state:'frozen',xSplit:4,ySplit:4}]});
 const fixed=['Source','Sr. No.','Employee ID','Name','Site','Department','Designation'];
 const heads=[...fixed,...dates.map(d=>Number(d.slice(8))),...ROSTER_TOTALS.map(([,l])=>l),...(monthly?['Gate pass deduction']:[]),DIFF_HEADING];
 const last=heads.length,first=fixed.length+1,totalsAt=first+dates.length,diffAt=last;
 ws.mergeCells(1,1,1,last);
 ws.getCell(1,1).value=`Attendance roster · ${monthly?monthName(from):show(from)+' to '+show(to)} · Trip Card against Bio Matric`;
 ws.getCell(1,1).font={bold:true,size:13,color:{argb:'FF3C2A55'}};
 ws.mergeCells(2,1,2,last);
 ws.getCell(2,1).value=Object.keys(CODE_COLOURS).map(k=>`${k} ${codeLabel(k)}`).join('   ·   ')+'   ·   Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + comp off + leave + on duty';
 ws.getCell(2,1).font={size:10,color:{argb:'FF5C4D6E'}};
 const sub=ws.getRow(3),head=ws.getRow(4);
 heads.forEach((h,i)=>{const c=head.getCell(i+1);c.value=h;c.font={bold:true,color:{argb:'FF5C4D6E'}};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};c.fill=fill(i+1===diffAt?'FCEBEB':'F3F0F7');});
 dates.forEach((d,i)=>{const c=sub.getCell(first+i);c.value=weekday(d);c.alignment={horizontal:'center'};const sun=weekday(d)==='Su';c.font={size:9,color:{argb:sun?'FFA12626':'FF7A698B'}};if(sun)head.getCell(first+i).font={bold:true,color:{argb:'FFA12626'}};});
 head.height=34;
 let r=5;
 groups.forEach((g,n)=>{
  const lines:[string,Record<string,string>,ReturnType<typeof tripTotals>|null][]=[['Trip Card',g.tripCodes,tripTotals(g,dates)],['Bio Matric',g.bioCodes,g.bio?bioTotals(g,dates):null]];
  const miss=new Set(g.mismatches.map(m=>m.date));
  lines.forEach(([source,codes,totals],j)=>{
   const row=ws.getRow(r+j);
   [source,n+1,g.code,g.name,g.site,g.department,g.designation].forEach((v,i)=>{const c=row.getCell(i+1);c.value=v||(i>3?'—':'');c.alignment={vertical:'middle',horizontal:i<3?'center':'left'};});
   row.getCell(1).font={bold:true,color:{argb:j?'FF0C447C':'FF633806'}};row.getCell(4).font={bold:true};
   if(!g.bio&&j===1){ws.mergeCells(r+1,first,r+1,diffAt-1);const c=row.getCell(first);c.value='Biometric ID not linked in Biometric integration';c.font={italic:true,color:{argb:'FF7A698B'}};}
   else dates.forEach((d,i)=>{const code=codes[d]||'',c=row.getCell(first+i);c.value=code;c.alignment={horizontal:'center',vertical:'middle'};
    if(CODE_COLOURS[code]){c.fill=fill(CODE_COLOURS[code][0]);c.font={bold:true,size:10,color:{argb:'FF'+CODE_COLOURS[code][1]}};}
    const edge={style:(miss.has(d)?'medium':'thin') as ExcelJS.BorderStyle,color:{argb:miss.has(d)?'FFA12626':'FFFFFFFF'}};c.border={top:edge,bottom:edge,left:edge,right:edge};});
   if(totals)ROSTER_TOTALS.forEach(([key],i)=>{const c=row.getCell(totalsAt+i);c.value=totals[key];c.alignment={horizontal:'center',vertical:'middle'};c.fill=fill(key==='paidDays'?'F1ECF8':'FAF8FC');if(key==='paidDays'||key==='totalDays')c.font={bold:true};});
   if(monthly&&totals)row.getCell(totalsAt+ROSTER_TOTALS.length).value=j&&g.bio?g.bio.summary.gatePassDeduction||0:'—';
   row.height=20;
  });
  for(let c=2;c<=fixed.length;c++)ws.mergeCells(r,c,r+1,c);
  ws.mergeCells(r,diffAt,r+1,diffAt);
  const d=ws.getCell(r,diffAt),text=diffText(g,tripsLoaded);
  d.value=/^\d+$/.test(text)?Number(text):text;d.alignment={horizontal:'center',vertical:'middle'};
  d.font={bold:true,color:{argb:text==='0'?'FF27500A':/^\d+$/.test(text)?'FFA12626':'FF7A698B'}};d.fill=fill(text==='0'?'EAF3DE':/^\d+$/.test(text)?'FCEBEB':'F3F0F7');
  if(g.mismatches.length)d.note=`${g.mismatches.length} day(s) differ: see the "Differences" sheet`;
  for(let c=1;c<=last;c++)ws.getCell(r+1,c).border={...ws.getCell(r+1,c).border,bottom:{style:'thin',color:{argb:'FFD8CDE6'}}};
  r+=2;
 });
 ws.getColumn(1).width=11;ws.getColumn(2).width=7;ws.getColumn(3).width=13;ws.getColumn(4).width=20;ws.getColumn(5).width=11;ws.getColumn(6).width=14;ws.getColumn(7).width=17;
 dates.forEach((_,i)=>{ws.getColumn(first+i).width=4.6;});
 for(let c=totalsAt;c<diffAt;c++)ws.getColumn(c).width=9;
 ws.getColumn(diffAt).width=16;
 ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};

 const ds=wb.addWorksheet('Differences',{views:[{state:'frozen',ySplit:1}]});
 const dh=['Employee ID','Name','Site','Date','Day','Trip Card','Trip card details','Bio Matric','Biometric details','Difference'];
 ds.addRow(dh).eachCell(c=>{c.font={bold:true,color:{argb:'FF5C4D6E'}};c.fill=fill('F3F0F7');});
 for(const g of groups)for(const m of g.mismatches){
  const row=ds.addRow([g.code,g.name,g.site,show(m.date),weekday(m.date),m.trip||'—',m.tripDetail,m.bio||'—',m.bioDetail,m.reason]);
  for(const [col,code] of [[6,m.trip],[8,m.bio]] as [number,string][])if(CODE_COLOURS[code]){const c=row.getCell(col);c.fill=fill(CODE_COLOURS[code][0]);c.font={bold:true,color:{argb:'FF'+CODE_COLOURS[code][1]}};c.alignment={horizontal:'center'};}
  row.getCell(10).font={color:{argb:'FFA12626'}};
 }
 [13,20,12,12,6,10,48,10,36,40].forEach((w,i)=>{ds.getColumn(i+1).width=w;});
 if(ds.rowCount>1)ds.autoFilter={from:{row:1,column:1},to:{row:ds.rowCount,column:dh.length}};
 return wb;
}

export async function downloadRosterExcel(input:Parameters<typeof rosterWorkbook>[0]){
 const wb=await rosterWorkbook(input);
 downloadBlob(`attendance-roster-${input.from}-to-${input.to}.xlsx`,new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
