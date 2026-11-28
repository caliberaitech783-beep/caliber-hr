import {describe,expect,it} from 'vitest';
import {read,utils} from 'xlsx';
import type {RosterGroup} from './rosterModel';
import {compareAttendance,comparisonWorkbook,headingDate,markKind,parseAttendanceRows} from './staffSheetCheck';

const group=(code:string,name:string,designation:string,bioCodes:Record<string,string>,department='Office'):RosterGroup=>({
 key:code,code,aFormNo:'',name,site:'Sasti',department,designation,shift:'',exempt:false,
 bio:{days:Object.keys(bioCodes).map(date=>({date,status:bioCodes[date],in:'09:00',out:'18:00'}))} as never,
 bioCodes,tripCodes:{},tripDays:{},hasTripCards:false,mismatches:[],pending:0,machines:[],linked:true});
const rows=[
 ['Attendance sheet · Sasti'],
 ['SR NO','EMP. ID','NAME','DESIGNATION','01-11-2026','02-11-2026','03-11-2026'],
 [1,'CMLL101','Asha','Clerk','P','P','A'],
 [2,'CMPL0102','Ravi','Supervisor','P','HD','P'],
 [3,'CMLL103','Mohan','Tipper Driver','P','P','P'],
 [4,'CMLL104','Sita','Clerk','P','',''],
 [5,'','Nobody','Clerk','P','',''],
];
const sheet=parseAttendanceRows(rows,'Sheet1');

describe('Other Staff Biometric comparison',()=>{
 it('reads EMP. ID, name, designation and the date columns',()=>{
  expect(sheet.dates).toEqual(['2026-11-01','2026-11-02','2026-11-03']);
  expect(sheet.people.map(p=>p.id)).toEqual(['CMLL101','CMPL0102','CMLL103','CMLL104']);
  expect(sheet.people[0].marks['2026-11-03']).toBe('A');
  expect(sheet.noId).toEqual([7]);
  expect(headingDate(46327)).toBe('2026-11-01');
  expect(headingDate('1-Nov-2026')).toBe('2026-11-01');
  expect(markKind('p')).toBe('present');expect(markKind('HD')).toBe('half');expect(markKind('WO')).toBe('leave');
 });
 it('asks for full dates when the headings are day numbers',()=>{
  expect(()=>parseAttendanceRows([['EMP ID','NAME',...Array.from({length:12},(_,i)=>i+1)],['CMLL1','A','P']])).toThrow(/day numbers/);
 });
 it('compares both ways and keeps drivers and operators apart',()=>{
  const groups=[
   group('CMLL101','Asha','Clerk',{'2026-11-01':'P','2026-11-02':'A','2026-11-03':'P'}),
   group('CMLL102','Ravi','Supervisor',{'2026-11-01':'MP','2026-11-02':'HD','2026-11-03':'HD'}),
   group('CMLL103','Mohan','Tipper Driver',{'2026-11-01':'P'}),
   group('CMLL200','Gita','Accountant',{'2026-11-02':'P'}),
   group('CMLL201','Vijay','Fitter',{'2026-11-02':'P'},'OPERATORS'),
  ];
  const result=compareAttendance({sheet,groups,site:'Sasti',from:'2026-11-01',to:'2026-11-03',read:new Set(['2026-11-01','2026-11-02','2026-11-03'])});
  const got=result.mismatches.map(m=>`${m.id} ${m.date.slice(8)} ${m.kind}`);
  expect(got).toEqual([
   'CMLL101 02 sheet-no-bio','CMLL101 03 bio-not-sheet',
   'CMPL0102 01 sheet-miss','CMPL0102 03 sheet-half',
   'CMLL104 01 sheet-no-bio',
   'CMLL200 02 not-in-sheet',
  ]);
  // OK: sheet P with biometric P, sheet HD with biometric HD; blank marks are neither OK nor a mismatch.
  expect(result.ok.map(m=>`${m.id} ${m.date.slice(8)}`)).toEqual(['CMLL101 01','CMPL0102 02']);
  expect(result.apart.map(a=>a.id)).toEqual(['CMLL103']);
  expect(result.people.find(p=>p.id==='CMLL104')?.found).toBe(false);
  expect(result.counts['sheet-no-bio']).toBe(2);
 });
 it('skips dates whose punches were not read and lists them',()=>{
  const result=compareAttendance({sheet,groups:[group('CMLL101','Asha','Clerk',{'2026-11-01':'P'})],site:'Sasti',from:'2026-11-01',to:'2026-11-04',read:new Set(['2026-11-01'])});
  expect(result.compared).toEqual(['2026-11-01']);
  expect(result.notRead).toEqual(['2026-11-02','2026-11-03','2026-11-04']);
  expect(result.notInSheet).toEqual(['2026-11-04']);
 });
 it('writes Mismatches, OK attendance, Employee summary and Not compared sheets',async()=>{
  const result=compareAttendance({sheet,groups:[group('CMLL101','Asha','Clerk',{'2026-11-01':'A'})],site:'Sasti',from:'2026-11-01',to:'2026-11-01',read:new Set(['2026-11-01'])});
  const book=read(await comparisonWorkbook(result,'sasti.xlsx'),{type:'array'});
  expect(book.SheetNames).toEqual(['Mismatches','OK attendance','Employee summary','Not compared']);
  const lines=utils.sheet_to_json<unknown[]>(book.Sheets.Mismatches,{header:1});
  expect(lines[3]).toEqual([3,'CMLL101','Asha','Clerk','01-11-2026','Sheet P, no biometric punch','P','A (no punch)','09:00 / 18:00']);
  const agreed=compareAttendance({sheet,groups:[group('CMLL101','Asha','Clerk',{'2026-11-01':'P','2026-11-03':'A'})],site:'Sasti',from:'2026-11-01',to:'2026-11-03',read:new Set(['2026-11-01','2026-11-03'])});
  const okBook=read(await comparisonWorkbook(agreed,''),{type:'array'});
  const okLines=utils.sheet_to_json<unknown[]>(okBook.Sheets['OK attendance'],{header:1});
  expect(okLines.slice(3).map(line=>[line[1],line[4],line[5],line[6]])).toEqual([['CMLL101','01-11-2026','OK','P'],['CMLL101','03-11-2026','OK','A']]);
 });
});
