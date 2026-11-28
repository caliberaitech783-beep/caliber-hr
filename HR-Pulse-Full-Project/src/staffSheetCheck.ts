/* Comparison (owner, 28 Nov 2026): the site's attendance Excel of the other staff (everyone except Drivers and
   Operators) against Other Staff Biometric, the DAT punches imported in Manual Biometric.
   1. Import Excel attendance: one line per employee with EMP. ID, NAME and DESIGNATION, one column per date (P / A …).
   2. Site, From date, To date.
   3. Check final attendance: both ways, day by day: biometric present but the sheet is not P, and the sheet P with no
      biometric punch (half day and miss punch are named apart). Nothing is changed in HR Pulse. */
import type {RosterGroup} from './rosterModel';

export type SheetPerson={row:number;id:string;name:string;designation:string;marks:Record<string,string>};
export type AttendanceSheet={sheetName:string;people:SheetPerson[];dates:string[];filledDates:string[];noId:number[]};

const text=(value:unknown)=>value===null||value===undefined?'':String(value).trim();
const norm=(value:unknown)=>text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const pad=(n:number)=>String(n).padStart(2,'0');
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export const dmy=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)?`${date.slice(8,10)}-${date.slice(5,7)}-${date.slice(0,4)}`:date;
const validDate=(y:number,m:number,d:number)=>{if(y<100)y+=2000;const t=Date.UTC(y,m-1,d),dt=new Date(t);return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d?`${y}-${pad(m)}-${pad(d)}`:'';};
/** A date heading: an Excel date (serial number), or a written date (01-11-2026, 2026-11-01, 1-Nov-2026). */
export function headingDate(cell:unknown):string{
 if(cell instanceof Date)return Number.isNaN(cell.getTime())?'':validDate(cell.getFullYear(),cell.getMonth()+1,cell.getDate());
 if(typeof cell==='number')return Number.isInteger(cell)&&cell>36525&&cell<73051?new Date(Date.UTC(1899,11,30)+cell*86_400_000).toISOString().slice(0,10):'';
 const w=text(cell);let m=w.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
 if(m)return validDate(+m[1],+m[2],+m[3]);
 m=w.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
 if(m)return validDate(+m[3],+m[2],+m[1]);
 m=w.match(/^(\d{1,2})[- ]([a-z]{3,9})[- ,]+(\d{2}|\d{4})$/i);
 if(m){const month=MONTHS.indexOf(m[2].slice(0,3).toLowerCase());return month<0?'':validDate(+m[3],month+1,+m[1]);}
 return '';
}
const HEADINGS:Record<'id'|'name'|'designation',string[]>={
 id:['emp id','employee id','emp code','employee code','emp no','employee no','caliber id','caliber code','cmll id','cmpl id','id no','id','a form no','aform no'],
 name:['name','employee name','emp name','name of the employee','name of employee','employee'],
 designation:['designation','desig','desg','designation name'],
};
function headingOf(row:unknown[]){
 const at:Partial<Record<keyof typeof HEADINGS,number>>={},dates:{index:number;date:string}[]=[];
 row.forEach((cell,index)=>{
  const date=headingDate(cell);
  if(date){if(!dates.some(d=>d.date===date))dates.push({index,date});return;}
  const label=norm(cell);if(!label)return;
  for(const [field,names] of Object.entries(HEADINGS) as [keyof typeof HEADINGS,string[]][])if(at[field]===undefined&&names.includes(label))at[field]=index;
 });
 return at.id!==undefined&&dates.length?{at,dates}:null;
}
export const SHEET_MAX_PEOPLE=3000;
/** rows: the cells of one worksheet, row by row. Throws when it is not an attendance sheet. */
export function parseAttendanceRows(rows:unknown[][],sheetName=''):AttendanceSheet{
 let headerAt=-1,heading:ReturnType<typeof headingOf>=null;
 for(let i=0;i<Math.min(rows.length,25)&&!heading;i++){heading=headingOf(rows[i]||[]);if(heading)headerAt=i;}
 if(!heading){
  const numbered=rows.slice(0,25).some(row=>(row||[]).some(cell=>HEADINGS.id.includes(norm(cell)))&&(row||[]).filter(cell=>typeof cell==='number'&&cell>=1&&cell<=31).length>=10);
  throw new Error(numbered?'The date headings of this sheet are only day numbers (1, 2, 3 …). Write each heading as a full date (01-11-2026) and upload again.':'This sheet has no EMP. ID column with a date column beside it.');
 }
 const {at,dates}=heading,people:SheetPerson[]=[],noId:number[]=[];
 rows.slice(headerAt+1).forEach((row,i)=>{
  if(!row)return;
  const id=text(row[at.id!]),name=at.name===undefined?'':text(row[at.name]).replace(/\s+/g,' ');
  const marks=Object.fromEntries(dates.map(d=>[d.date,text(row[d.index]).toUpperCase()]));
  const anyMark=Object.values(marks).some(Boolean);
  if(!id&&!name&&!anyMark)return;
  if(!id){if(anyMark)noId.push(headerAt+i+2);return;}
  people.push({row:headerAt+i+2,id,name,designation:at.designation===undefined?'':text(row[at.designation]).replace(/\s+/g,' '),marks});
 });
 if(!people.length)throw new Error('No employee line was found under the headings of this sheet.');
 if(people.length>SHEET_MAX_PEOPLE)throw new Error(`This sheet has ${people.length} employee lines. Upload up to ${SHEET_MAX_PEOPLE} at a time.`);
 const all=dates.map(d=>d.date).sort();
 return {sheetName,people,dates:all,filledDates:all.filter(date=>people.some(p=>p.marks[date])),noId};
}
/** Reads the first worksheet that is an attendance sheet. */
export async function readAttendanceExcel(file:File):Promise<AttendanceSheet>{
 const {read,utils}=await import('xlsx');
 let book;try{book=read(await file.arrayBuffer(),{type:'array'});}catch{throw new Error('This file could not be opened as an Excel workbook. Save it as Excel Workbook (.xlsx) and upload again.');}
 const refused:string[]=[];
 for(const name of book.SheetNames){
  const rows=utils.sheet_to_json<unknown[]>(book.Sheets[name],{header:1,raw:true,defval:'',blankrows:true});
  try{return parseAttendanceRows(rows,name);}catch(error){refused.push((error as Error).message);}
 }
 throw new Error(refused.find(message=>/day numbers|employee line/.test(message))||refused[0]||'No worksheet of this file could be read.');
}

/** What a sheet mark says. */
export type MarkKind='present'|'half'|'absent'|'leave'|'none'|'blank'|'unknown';
const LEAVE=new Set(['PL','CL','SL','EL','ML','L','LWP','WO','W/O','WOF','OFF','H','PH','HO','CO','C/O','OD']);
export function markKind(mark:string):MarkKind{
 const m=text(mark).toUpperCase().replace(/\s+/g,'');
 if(!m)return 'blank';
 if(m==='HD'||m==='HP'||m==='P/2'||m==='½P')return 'half';
 if(/^P\d?$/.test(m)||m==='PP')return 'present';
 if(m==='A'||m==='AB'||m==='ABS')return 'absent';
 if(LEAVE.has(m))return 'leave';
 if(/^[-–—]+$/.test(m)||m==='NA'||m==='N/A')return 'none';
 return 'unknown';
}

export type MismatchKind='bio-not-sheet'|'sheet-no-bio'|'sheet-half'|'sheet-miss'|'half-full'|'half-no-bio'|'not-in-sheet';
export const MISMATCH_LABELS:Record<MismatchKind,string>={
 'bio-not-sheet':'Biometric present, sheet not P',
 'sheet-no-bio':'Sheet P, no biometric punch',
 'sheet-half':'Sheet P, biometric half day',
 'sheet-miss':'Sheet P, biometric miss punch',
 'half-full':'Sheet half day, biometric full day',
 'half-no-bio':'Sheet half day, no biometric punch',
 'not-in-sheet':'Biometric present, not in the sheet',
};
export type Mismatch={kind:MismatchKind;id:string;name:string;designation:string;date:string;sheetSays:string;bioSays:string;inOut:string;row?:number};
/** A day the sheet and biometric agree on (owner, 28 Nov 2026: "OK attendance" tab): sheet P and biometric P, sheet half
    day and biometric HD, or sheet A / leave / WO and no punch. A blank or unreadable mark is neither OK nor a mismatch. */
export type OkDay=Omit<Mismatch,'kind'>&{kind:'ok'};
export const OK_LABEL='OK: sheet and biometric agree';
export type PersonLine={id:string;name:string;designation:string;row?:number;found:boolean;sheetDays:number;bioDays:number;mismatches:number;remark:string};
export type ApartLine={id:string;name:string;designation:string;row?:number;why:string};
export type ComparisonResult={site:string;from:string;to:string;compared:string[];notInSheet:string[];notRead:string[];
 mismatches:Mismatch[];ok:OkDay[];people:PersonLine[];apart:ApartLine[];noId:number[];counts:Record<MismatchKind,number>};

/** Drivers and Operators belong to Manual Biometric, not to Other Staff Biometric (same rule as that tab). */
export const isDriverOrOperator=(department:string,designation:string)=>/(driver|operator)/i.test(`${department||''} ${designation||''}`);
const WORKED=new Set(['P','HD','MP','IN']);
const BIO_LABEL:Record<string,string>={P:'P (full day)',HD:'HD (half day)',A:'A (no punch)',MP:'MP (miss punch)',IN:'IN (no Out yet)',WO:'WO (weekly off)',H:'H (holiday)',L:'L (leave)',CO:'CO (comp off)',OD:'OD (on duty)'};
const bioText=(code:string)=>code?BIO_LABEL[code]||code:'No punch';
const upper=(value?:string)=>text(value).toUpperCase();
const numberOf=(value?:string)=>(upper(value).match(/\d+$/)?.[0]||'').replace(/^0+(?=\d)/,'');

/** groups: every person of the imported DAT punches for the site and dates (drivers and operators included, so they can be
    named apart); dates: the From–To dates; read: the dates the punches were read for. */
export function compareAttendance({sheet,groups,site,from,to,read}:{sheet:AttendanceSheet;groups:RosterGroup[];site:string;from:string;to:string;read:Set<string>}):ComparisonResult{
 const inRange=(date:string)=>date>=from&&date<=to;
 const rangeDates:string[]=[];for(let d=from;d<=to;d=new Date(Date.parse(d+'T00:00:00Z')+86_400_000).toISOString().slice(0,10))rangeDates.push(d);
 const compared=sheet.dates.filter(date=>inRange(date)&&read.has(date)),notInSheet=rangeDates.filter(date=>!sheet.dates.includes(date)),notRead=rangeDates.filter(date=>!read.has(date));
 const withBio=groups.filter(g=>g.bio);
 const byCode=new Map<string,RosterGroup>(),byAForm=new Map<string,RosterGroup>(),byNumber=new Map<string,RosterGroup[]>();
 for(const g of withBio){
  if(g.code)byCode.set(upper(g.code),g);
  if(g.aFormNo)byAForm.set(upper(g.aFormNo),g);
  const n=numberOf(g.code);if(n)byNumber.set(n,[...(byNumber.get(n)||[]),g]);
 }
 const find=(id:string)=>{const key=upper(id),n=numberOf(id),same=n?byNumber.get(n)||[]:[];return byCode.get(key)||byAForm.get(key)||(same.length===1?same[0]:undefined);};
 const mismatches:Mismatch[]=[],ok:OkDay[]=[],people:PersonLine[]=[],apart:ApartLine[]=[],seen=new Set<string>();
 const dayOf=(g:RosterGroup|undefined,date:string)=>g?.bio?.days.find(d=>d.date===date);
 const inOut=(g:RosterGroup|undefined,date:string)=>{const d=dayOf(g,date);return d&&(d.in||d.out)?`${d.in||'—'} / ${(d.out||'—').replace(' (+1)',' +1')}`:'';};
 const credit=(kind:MarkKind)=>kind==='present'?1:kind==='half'?0.5:0;
 const bioCredit=(code:string)=>code==='P'?1:code==='HD'?0.5:0;
 for(const p of sheet.people){
  const g=find(p.id);
  if(g)seen.add(g.key);
  const designation=p.designation||g?.designation||'';
  if(isDriverOrOperator(g?.department||'',designation)||(g&&isDriverOrOperator(g.department,g.designation))){
   apart.push({id:p.id,name:p.name||g?.name||'',designation,row:p.row,why:'Driver / Operator: compared in Manual Biometric, not here.'});continue;
  }
  let sheetDays=0,bioDays=0,count=0;
  for(const date of compared){
   const mark=p.marks[date]||'',kind=markKind(mark),code=g?.bioCodes[date]||'';
   sheetDays+=credit(kind);bioDays+=bioCredit(code);
   const add=(k:MismatchKind)=>{count++;mismatches.push({kind:k,id:p.id,name:p.name||g?.name||'',designation,date,sheetSays:mark||'(blank)',bioSays:bioText(code),inOut:inOut(g,date),row:p.row});};
   const agree=()=>ok.push({kind:'ok',id:p.id,name:p.name||g?.name||'',designation,date,sheetSays:mark,bioSays:bioText(code),inOut:inOut(g,date),row:p.row});
   if(kind==='present'){if(code==='P')agree();else if(code==='HD')add('sheet-half');else if(code==='MP'||code==='IN')add('sheet-miss');else add('sheet-no-bio');}
   else if(kind==='half'){if(code==='HD')agree();else if(code==='P')add('half-full');else if(!WORKED.has(code))add('half-no-bio');}
   else if(WORKED.has(code))add('bio-not-sheet');
   else if(kind==='absent'||kind==='leave'||kind==='none')agree();
  }
  people.push({id:p.id,name:p.name||g?.name||'',designation,row:p.row,found:Boolean(g),sheetDays,bioDays,mismatches:count,
   remark:g?'':'No punch of this EMP. ID in the imported DAT log for these dates.'});
 }
 for(const g of withBio){
  if(seen.has(g.key)||isDriverOrOperator(g.department,g.designation))continue;
  const days=compared.filter(date=>WORKED.has(g.bioCodes[date]||''));
  if(!days.length)continue;
  for(const date of days)mismatches.push({kind:'not-in-sheet',id:g.code,name:g.name,designation:g.designation,date,sheetSays:'Not in the sheet',bioSays:bioText(g.bioCodes[date]),inOut:inOut(g,date)});
  people.push({id:g.code,name:g.name,designation:g.designation,found:true,sheetDays:0,bioDays:days.reduce((s,d)=>s+bioCredit(g.bioCodes[d]),0),mismatches:days.length,remark:'Has biometric punches but no line in the sheet.'});
 }
 mismatches.sort((a,b)=>(a.row??1e9)-(b.row??1e9)||a.id.localeCompare(b.id,undefined,{numeric:true})||a.date.localeCompare(b.date));
 ok.sort((a,b)=>(a.row??1e9)-(b.row??1e9)||a.date.localeCompare(b.date));
 const counts=Object.fromEntries(Object.keys(MISMATCH_LABELS).map(k=>[k,mismatches.filter(m=>m.kind===k).length])) as Record<MismatchKind,number>;
 return {site,from,to,compared,notInSheet,notRead,mismatches,ok,people,apart,noId:sheet.noId,counts};
}

/** The result as a workbook: Mismatches, OK attendance, Employee summary and Not compared. */
export async function comparisonWorkbook(result:ComparisonResult,fileName:string):Promise<ArrayBuffer>{
 const {utils,write}=await import('xlsx');
 const book=utils.book_new();
 const title=`Other Staff Biometric comparison · ${result.site} · ${dmy(result.from)} to ${dmy(result.to)}${fileName?' · file: '+fileName:''}`;
 const sheet=(rows:unknown[][],widths:number[])=>{const ws=utils.aoa_to_sheet(rows);ws['!cols']=widths.map(wch=>({wch}));return ws;};
 utils.book_append_sheet(book,sheet([[title],[],['Row in sheet','EMP. ID','Name','Designation','Date','Mismatch','Sheet says','Biometric says','In / Out'],
  ...result.mismatches.map(m=>[m.row??'',m.id,m.name,m.designation,dmy(m.date),MISMATCH_LABELS[m.kind],m.sheetSays,m.bioSays,m.inOut])],[12,14,28,22,12,36,16,18,16]),'Mismatches');
 utils.book_append_sheet(book,sheet([[title],[],['Row in sheet','EMP. ID','Name','Designation','Date','Result','Sheet says','Biometric says','In / Out'],
  ...result.ok.map(m=>[m.row??'',m.id,m.name,m.designation,dmy(m.date),'OK',m.sheetSays,m.bioSays,m.inOut])],[12,14,28,22,12,10,16,18,16]),'OK attendance');
 utils.book_append_sheet(book,sheet([[title],[],['Row in sheet','EMP. ID','Name','Designation','P days in sheet','P days in biometric','Difference','Mismatches','Remark'],
  ...result.people.map(p=>[p.row??'',p.id,p.name,p.designation,p.sheetDays,p.bioDays,p.sheetDays-p.bioDays,p.mismatches,p.remark])],[12,14,28,22,14,18,12,12,50]),'Employee summary');
 const notes:unknown[][]=[
  ...result.apart.map(a=>[a.row??'',a.id,a.name,a.designation,a.why]),
  ...result.noId.map(row=>[row,'','','','No EMP. ID on this line: not compared.']),
  ...(result.notInSheet.length?[['','','','','Dates with no column in the sheet: '+result.notInSheet.map(dmy).join(', ')]]:[]),
  ...(result.notRead.length?[['','','','','Dates whose biometric punches could not be read: '+result.notRead.map(dmy).join(', ')]]:[]),
 ];
 utils.book_append_sheet(book,sheet([[title],[],['Row in sheet','EMP. ID','Name','Designation','Why not compared'],...notes],[12,14,28,22,70]),'Not compared');
 return write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
}
