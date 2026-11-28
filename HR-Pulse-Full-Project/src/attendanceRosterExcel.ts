import ExcelJS from 'exceljs';
import {downloadBlob} from './api';
import {cardSummary,codeLabel,type RosterGroup} from './rosterModel';
import {DIFF_HEADING,ROSTER_TOTALS,bioTotals,diffText,isManualRosterView,tripTotals,weekday,type RosterView} from './AttendanceRoster';
import {MANUAL_MISMATCH_COLOURS,manualMismatchTone} from './manualMismatchColors';

/* Roster Excel (owner, 22 Nov 2026): the layout of the owner's sample sheet. Title, legend, weekday row, headings, then
   per employee the lines of the tab that was open: Trip card (with the VLB / ELB / LMV days), Biometric, or both with
   the difference count merged over the two lines and a "Differences" sheet listing every day that differs. */
export const CODE_COLOURS:Record<string,[string,string]>={P:['EAF3DE','27500A'],HD:['FAEEDA','633806'],A:['FCEBEB','791F1F'],WO:['F1EFE8','444441'],H:['EEEDFE','3C3489'],
 CO:['E1F5EE','085041'],L:['FBEAF0','72243E'],OD:['E6F1FB','0C447C'],MP:['FAECE7','712B13'],IN:['E1F5EE','085041'],'?':['F1EFE8','5F5E5A']};
const fill=(argb:string):ExcelJS.Fill=>({type:'pattern',pattern:'solid',fgColor:{argb:'FF'+argb}});
const show=(date:string)=>date.split('-').reverse().join('-');
const TITLE:Record<RosterView,string>={trip:'Trip card (VLB · ELB · LMV)',bio:'Biometric',compare:'Trip Card against Bio Matric',manual:'Manual Biometric',manual2:'Other Staff Biometric',manualMismatch:'M.B-Trip card Mismatch'};
type Input={groups:RosterGroup[];dates:string[];tripsLoaded:boolean;monthly:boolean;from:string;to:string;view?:RosterView;showAForm?:boolean};

export async function rosterWorkbook({groups,dates,tripsLoaded,monthly,from,to,view='compare',showAForm=true}:Input){
 if(view==='manualMismatch')return manualMismatchWorkbook(groups,dates,from,to);
 const compare=view==='compare',manual=isManualRosterView(view),aFormColumn=manual&&showAForm;
 const wb=new ExcelJS.Workbook();
 const fixed=[...(compare?['Source']:[]),'Sr. No.','Employee ID',...(aFormColumn?['A-Form No.']:[]),'Name','Site','Department','Designation'];
 const ws=wb.addWorksheet('Roster',{views:[{state:'frozen',xSplit:compare?4:3,ySplit:4}]});
 const extra=[...(monthly?['Gate pass deduction']:[]),...(view==='trip'?['Cards (days)']:[]),...(compare?[DIFF_HEADING]:[])];
 const heads=[...fixed,...dates.map(d=>Number(d.slice(8))),...ROSTER_TOTALS.map(([,l])=>l),...extra];
 const last=heads.length,first=fixed.length+1,totalsAt=first+dates.length,afterTotals=totalsAt+ROSTER_TOTALS.length;
 ws.mergeCells(1,1,1,last);
 ws.getCell(1,1).value=`Attendance roster · ${show(from)} to ${show(to)} · ${TITLE[view]}`;
 ws.getCell(1,1).font={bold:true,size:13,color:{argb:'FF3C2A55'}};
 ws.mergeCells(2,1,2,last);
 ws.getCell(2,1).value=Object.keys(CODE_COLOURS).map(k=>`${k} ${codeLabel(k)}`).join('   ·   ')+'   ·   Paid days = present + half day ÷ 2 − half duty cuts ÷ 2 + weekly off + holiday + PH worked + comp off + leave + on duty (drivers and operators only: PH worked = paid twice; PH with A the day before and after = A)';
 ws.getCell(2,1).font={size:10,color:{argb:'FF5C4D6E'}};
 const sub=ws.getRow(3),head=ws.getRow(4);
 heads.forEach((h,i)=>{const c=head.getCell(i+1);c.value=h;c.font={bold:true,color:{argb:'FF5C4D6E'}};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};c.fill=fill(compare&&i+1===last?'FCEBEB':'F3F0F7');});
 dates.forEach((d,i)=>{const c=sub.getCell(first+i);c.value=weekday(d);c.alignment={horizontal:'center'};const sun=weekday(d)==='Su';c.font={size:9,color:{argb:sun?'FFA12626':'FF7A698B'}};if(sun)head.getCell(first+i).font={bold:true,color:{argb:'FFA12626'}};});
 head.height=34;
 let r=5;
 groups.forEach((g,n)=>{
  const all:[string,Record<string,string>,ReturnType<typeof tripTotals>|null,boolean][]=[['Trip Card',g.tripCodes,g.hasTripCards?tripTotals(g,dates):null,true],['Bio Matric',g.bioCodes,g.bio?bioTotals(g,dates):null,false]];
  const lines=all.filter(([,, ,isTrip])=>compare||(view==='trip')===isTrip);
  const miss=new Set(compare?g.mismatches.map(m=>m.date):[]);
  lines.forEach(([source,codes,totals,isTrip],j)=>{
   const row=ws.getRow(r+j);
   [...(compare?[source]:[]),n+1,g.code,...(aFormColumn?[g.aFormNo]:[]),g.name,g.site,g.department,g.designation].forEach((v,i)=>{const c=row.getCell(i+1);c.value=v||(i>=fixed.length-3?'—':'');c.alignment={vertical:'middle',horizontal:i<fixed.length-4?'center':'left'};});
   if(compare)row.getCell(1).font={bold:true,color:{argb:j?'FF0C447C':'FF633806'}};
   row.getCell(fixed.length-3).font={bold:true};
   if(!totals){ws.mergeCells(r+j,first,r+j,afterTotals-1);const c=row.getCell(first);c.value=isTrip?'No trip card or log book in these dates':'Biometric ID not linked in Biometric integration';c.font={italic:true,color:{argb:'FF7A698B'}};}
   else{
    dates.forEach((d,i)=>{const code=codes[d]||'',c=row.getCell(first+i);c.value=code;c.alignment={horizontal:'center',vertical:'middle'};
     if(CODE_COLOURS[code]){c.fill=fill(CODE_COLOURS[code][0]);c.font={bold:true,size:10,color:{argb:'FF'+CODE_COLOURS[code][1]}};}
     const edge={style:(miss.has(d)?'medium':'thin') as ExcelJS.BorderStyle,color:{argb:miss.has(d)?'FFA12626':'FFFFFFFF'}};c.border={top:edge,bottom:edge,left:edge,right:edge};});
    ROSTER_TOTALS.forEach(([key],i)=>{const c=row.getCell(totalsAt+i);c.value=totals[key];c.alignment={horizontal:'center',vertical:'middle'};c.fill=fill(key==='paidDays'?'F1ECF8':'FAF8FC');if(key==='paidDays'||key==='totalDays')c.font={bold:true};});
   }
   let col=afterTotals;
   if(monthly){row.getCell(col).value=!isTrip&&g.bio?g.bio.summary.gatePassDeduction||0:'—';col++;}
   if(view==='trip'){row.getCell(col).value=cardSummary(g,dates)||'—';col++;}
   row.height=20;
  });
  if(lines.length>1){for(let c=2;c<=fixed.length;c++)ws.mergeCells(r,c,r+1,c);}
  if(compare){
   if(lines.length>1)ws.mergeCells(r,last,r+1,last);
   const d=ws.getCell(r,last),text=diffText(g,tripsLoaded);
   d.value=/^\d+$/.test(text)?Number(text):text;d.alignment={horizontal:'center',vertical:'middle'};
   d.font={bold:true,color:{argb:text==='0'?'FF27500A':/^\d+$/.test(text)?'FFA12626':'FF7A698B'}};d.fill=fill(text==='0'?'EAF3DE':/^\d+$/.test(text)?'FCEBEB':'F3F0F7');
   if(g.mismatches.length)d.note=`${g.mismatches.length} day(s) differ: see the "Differences" sheet`;
  }
  const lastRow=r+lines.length-1;
  for(let c=1;c<=last;c++)ws.getCell(lastRow,c).border={...ws.getCell(lastRow,c).border,bottom:{style:'thin',color:{argb:'FFD8CDE6'}}};
  r+=lines.length;
 });
 const widths=[...(compare?[11]:[]),7,13,...(aFormColumn?[14]:[]),20,11,14,17];
 widths.forEach((w,i)=>{ws.getColumn(i+1).width=w;});
 dates.forEach((_,i)=>{ws.getColumn(first+i).width=4.6;});
 for(let c=totalsAt;c<=last;c++)ws.getColumn(c).width=9;
 if(view==='trip')ws.getColumn(last).width=22;
 if(compare)ws.getColumn(last).width=16;
 ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};

 // Biometric and comparison: every employee's In, Out, worked hours and punches for each date (owner, 22 Nov 2026).
 if(view!=='trip'){
  const io=wb.addWorksheet('In - Out',{views:[{state:'frozen',ySplit:1}]});
  const ih=['Employee ID',...(aFormColumn?['A-Form No.']:[]),'Name','Machine · ID','Date','Day','Code','In','Out','Worked hours','Late come','Early going','Every punch (machine)'];
  io.addRow(ih).eachCell(c=>{c.font={bold:true,color:{argb:'FF5C4D6E'}};c.fill=fill('F3F0F7');});
  const hm=(m:number|null)=>m==null?'':`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;
  for(const g of groups)for(const d of g.bio?.days||[]){
   if(!dates.includes(d.date))continue;
   const row=io.addRow([g.linked?g.code:'Not linked',...(aFormColumn?[g.aFormNo]:[]),g.name,g.machines.join(', '),show(d.date),weekday(d.date),d.status,d.in||'',(d.out||'').replace(' (+1)',' +1'),hm(d.workedMinutes),d.late?'Yes':'',d.early?'Yes':'',(d.punches||[]).join(' · ')]),offset=aFormColumn?1:0;
   const c=row.getCell(6+offset);if(CODE_COLOURS[d.status]){c.fill=fill(CODE_COLOURS[d.status][0]);c.font={bold:true,color:{argb:'FF'+CODE_COLOURS[d.status][1]}};c.alignment={horizontal:'center'};}
   if(d.late)row.getCell(7+offset).font={bold:true,color:{argb:'FFB45309'}};
   if(d.early)row.getCell(8+offset).font={bold:true,color:{argb:'FFA12626'}};
  }
  [13,...(aFormColumn?[14]:[]),24,24,12,6,7,9,10,12,10,11,60].forEach((w,i)=>{io.getColumn(i+1).width=w;});
  if(io.rowCount>1)io.autoFilter={from:{row:1,column:1},to:{row:io.rowCount,column:ih.length}};
 }
 if(compare){
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
 }
 return wb;
}

export async function downloadRosterExcel(input:Input){
 const wb=await rosterWorkbook(input);
 const name=input.view==='trip'?'trip-card':input.view==='bio'?'biometric':input.view==='manual2'?'manual-biometric-ii':input.view==='manualMismatch'?'manual-biometric-vs-trip-card':'trip-vs-biometric';
 downloadBlob(`attendance-roster-${name}-${input.from}-to-${input.to}.xlsx`,new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}

function manualMismatchWorkbook(groups:RosterGroup[],dates:string[],from:string,to:string){
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('MB - Trip Card',{views:[{state:'frozen',xSplit:5,ySplit:4}]});
 const fixed=['Sr. No.','Employee ID','Name','Department','Designation'],heads=[...fixed,...dates.map(d=>Number(d.slice(8)))],first=fixed.length+1;
 ws.mergeCells(1,1,1,heads.length);ws.getCell(1,1).value=`M.B-Trip card Mismatch · ${show(from)} to ${show(to)}`;ws.getCell(1,1).font={bold:true,size:13,color:{argb:'FF3C2A55'}};
 ws.mergeCells(2,1,2,heads.length);ws.getCell(2,1).value='Manual Biometric / Trip Card: P/P and A/A green · A/P orange · P/A red · MP/P purple · HD/P yellow · MP/A magenta · HD/A blue · blank/blank grey.';ws.getCell(2,1).font={size:10,color:{argb:'FF5C4D6E'}};
 dates.forEach((d,i)=>{const c=ws.getRow(3).getCell(first+i);c.value=weekday(d);c.alignment={horizontal:'center'};});
 heads.forEach((h,i)=>{const c=ws.getRow(4).getCell(i+1);c.value=h;c.font={bold:true,color:{argb:'FF5C4D6E'}};c.fill=fill('F3F0F7');c.alignment={horizontal:i<5?'left':'center'};});
 groups.forEach((g,n)=>{const row=ws.getRow(5+n);[n+1,g.code,g.name,g.department||'—',g.designation||'—'].forEach((v,i)=>row.getCell(i+1).value=v);const mismatches=new Map(g.mismatches.map(m=>[m.date,m]));
  dates.forEach((d,i)=>{const bio=g.bioCodes[d]||'',trip=g.tripCodes[d]||'',m=mismatches.get(d),tone=manualMismatchTone(bio,trip),colour=MANUAL_MISMATCH_COLOURS[tone],c=row.getCell(first+i);c.value=`${bio||'—'} / ${trip||'—'}`;c.alignment={horizontal:'center'};c.fill=fill(colour.fill);c.font={bold:true,color:{argb:'FF'+colour.text}};c.note=bio&&trip?`Manual Biometric ${bio} · Trip Card ${trip}${m?' · '+m.reason:''}`:trip?`Trip Card ${trip} present · Manual Biometric missing`:bio?`Manual Biometric ${bio} present · Trip Card missing`:'No record in either source';});});
 [9,14,24,16,19].forEach((w,i)=>ws.getColumn(i+1).width=w);dates.forEach((_,i)=>ws.getColumn(first+i).width=9);ws.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};
 const ds=wb.addWorksheet('Mismatches');ds.addRow(['Sr. No.','Employee ID','Name','Department','Designation','Date','Manual Biometric','Trip Card','Reason']).eachCell(c=>{c.font={bold:true};c.fill=fill('F3F0F7');});
 let mismatchSerial=0;for(const g of groups)for(const m of g.mismatches)ds.addRow([++mismatchSerial,g.code,g.name,g.department,g.designation,show(m.date),m.bio||'—',m.trip||'—',m.reason]);[9,14,24,16,19,13,18,12,42].forEach((w,i)=>ds.getColumn(i+1).width=w);
 return wb;
}
