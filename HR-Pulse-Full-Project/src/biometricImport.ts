import {parseCsv} from './api';

export type BiometricImportRow={serial:string;biometricId:string;name:string;punchedAt:string;verify:string;punchType:string};
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,keyof BiometricImportRow>={serial:'serial',machineserial:'serial',deviceserial:'serial',biometricid:'biometricId',machineuserid:'biometricId',userid:'biometricId',employeeid:'biometricId',name:'name',employeename:'name',username:'name',punchedat:'punchedAt',punchtime:'punchedAt',datetime:'punchedAt',dateandtime:'punchedAt',verify:'verify',verifycode:'verify',punchtype:'punchType',punchtypecode:'punchType'};
const stamp=(value:string)=>value.trim().replace('T',' ').replace(/^(\d{2})[-/](\d{2})[-/](\d{4})\s+/,(_,d,m,y)=>`${y}-${m}-${d} `);
const STAMP=/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/;
// The same checks the server makes (server/attendance.mjs validateUpload), so one bad line never fails a whole upload.
const ID=/^[A-Za-z0-9_.-]{1,24}$/,CODE=/^\d{0,3}$/;
const realTime=(at:string)=>{if(!STAMP.test(at)||Number(at.slice(11,13))>23)return false;const day=at.slice(0,10),date=new Date(day+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day;};

/** open: a row may leave the machine serial empty; the upload screen fills it with the machine it picks. */
function finish(rows:Partial<BiometricImportRow>[],defaultSerial='',open=false){
 if(!rows.length)throw new Error('The import file does not contain any biometric punches.');
 return rows.map((row,index)=>{
  const serial=String(row.serial||defaultSerial).trim(),biometricId=String(row.biometricId||'').trim(),punchedAt=stamp(String(row.punchedAt||''));
  if(!serial&&!open)throw new Error(`Row ${index+1}: Machine Serial is required because this site has more than one machine.`);
  if(!biometricId)throw new Error(`Row ${index+1}: Biometric ID is required.`);
  if(!STAMP.test(punchedAt))throw new Error(`Row ${index+1}: Punch Time must use YYYY-MM-DD HH:MM:SS.`);
  return {serial,biometricId,name:String(row.name||'').trim(),punchedAt,verify:String(row.verify||'').trim(),punchType:String(row.punchType||'').trim()};
 });
}

function csvRows(source:string){
 return parseCsv(source).map((row,index)=>{const out:Partial<BiometricImportRow>={};for(const [heading,value] of Object.entries(row)){const field=aliases[key(heading)];if(!field)throw new Error(`CSV row ${index+2}: Unknown column ${heading}.`);out[field]=value;}return out;});
}
export function parseBiometricCsv(source:string,defaultSerial=''){return finish(csvRows(source),defaultSerial);}

/** Three columns (ID | Name | time) belong to the given machine; with open=true they wait for the machine the screen picks. */
function textRows(source:string,defaultSerial='',open=false){
 return source.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{const parts=(line.includes('|')?line.split('|'):line.split('\t')).map(value=>value.trim());if(parts.length<3)throw new Error(`Text line ${index+1}: use Machine Serial | Biometric ID | Name | YYYY-MM-DD HH:MM:SS.`);if(parts.length===3&&(defaultSerial||open))return {serial:defaultSerial,biometricId:parts[0],name:parts[1],punchedAt:parts[2]};return {serial:parts[0],biometricId:parts[1],name:parts.slice(2,-1).join(' '),punchedAt:parts.at(-1)};});
}
export function parseBiometricText(source:string,defaultSerial=''){return finish(textRows(source,defaultSerial),defaultSerial);}

// ZKTeco / eSSL attlog .dat (USB download): employee no. <TAB> YYYY-MM-DD HH:MM:SS <TAB> verify <TAB> in/out state <TAB> work code <TAB> reserved.
// The file carries no machine serial: the upload screen finds the machine (file name, then the IDs each machine already knows).
const ATTLOG=/^\s*([A-Za-z0-9_.-]{1,24})[\t ]+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:[\t ]+(\d{0,3}))?(?:[\t ]+(\d{0,3}))?/;
export function looksLikeAttlog(source:string){return source.split(/\r?\n/).filter(line=>line.trim()).slice(0,20).some(line=>ATTLOG.test(line));}

function readAttlog(text:string,serial:string){
 const rows:BiometricImportRow[]=[],skipped:number[]=[];
 text.split(/\r?\n/).forEach((line,index)=>{
  if(!line.trim())return;
  const match=ATTLOG.exec(line);
  if(!match||!realTime(match[2])){skipped.push(index+1);return;}
  rows.push({serial,biometricId:match[1],name:'',punchedAt:match[2],verify:match[3]||'',punchType:match[4]||''});
 });
 return {rows,skipped};
}

export function parseBiometricDat(source:string,defaultSerial=''){
 const text=source.replace(/^﻿/,'');
 if(!looksLikeAttlog(text))return parseBiometricText(text,defaultSerial);
 if(!defaultSerial)throw new Error('A .dat file does not carry the machine serial. Choose which of this site’s machines the file came from.');
 const {rows,skipped}=readAttlog(text,defaultSerial);
 if(skipped.length)throw new Error(`Line ${skipped[0]}: not an attlog punch (employee no., then YYYY-MM-DD HH:MM:SS, tab separated).`);
 return finish(rows,defaultSerial);
}

/** One uploaded machine log, read in the browser before anything is sent. Rows with no serial wait for the machine the screen picks. */
export type MachineLog={fileName:string;rows:BiometricImportRow[];skipped:number[];ids:string[];from:string;to:string;needsMachine:boolean};
export function readMachineLog(fileName:string,source:string):MachineLog{
 const text=source.replace(/^﻿/,''),csv=/\.csv$/i.test(fileName);
 const none=`${fileName}: no biometric punch found. A machine log line is the employee no., then YYYY-MM-DD HH:MM:SS, tab separated.`;
 let read:{rows:BiometricImportRow[];skipped:number[]};
 if(!csv&&looksLikeAttlog(text))read=readAttlog(text,'');
 else try{read={rows:finish(csv?csvRows(text):textRows(text,'',true),'',true),skipped:[]};}
 catch(e){throw new Error(/\.dat$/i.test(fileName)?none:`${fileName}: ${(e as Error).message}`);}
 const skipped=[...read.skipped];
 // A punch the server would refuse (bad ID, impossible date or code) is left out and counted, not sent.
 const rows=read.rows.filter((row,index)=>{const ok=ID.test(row.biometricId)&&realTime(row.punchedAt)&&CODE.test(row.verify)&&CODE.test(row.punchType);if(!ok)skipped.push(index+1);return ok;});
 if(!rows.length)throw new Error(none);
 const times=rows.map(row=>row.punchedAt).sort();
 return {fileName,rows,skipped,ids:[...new Set(rows.map(row=>row.biometricId))],from:times[0].slice(0,10),to:times[times.length-1].slice(0,10),needsMachine:rows.some(row=>!row.serial)};
}

export type CheckedMachine={serial:string;name:string;location:string;machineNo?:string;ids:{biometricId:string;employeeCode:string;employeeName:string;machineName:string}[]};
export type MachinePick={serial:string;reason:'file-name'|'machine-no'|'only'|'ids'|'none';matched:number};
/** The machine no. a USB download carries in its name: 1_attlog.dat, 12_attlog (2).dat. */
export const machineNoInFileName=(fileName:string)=>/^0*([1-9]\d{0,2})_attlog/i.exec(fileName.trim())?.[1]||'';
/** Which machine a log came from: its serial or machine no. (machine master) in the file name, the site's only machine,
    or the machine that already knows most of the file's IDs. */
export function pickMachine(log:Pick<MachineLog,'fileName'|'ids'>,machines:CheckedMachine[]):MachinePick{
 const lower=log.fileName.toLowerCase(),no=machineNoInFileName(log.fileName);
 const named=machines.filter(m=>m.serial&&lower.includes(m.serial.toLowerCase()));
 const numbered=no?machines.filter(m=>m.machineNo===no):[];
 const count=(m:CheckedMachine)=>{const known=new Set(m.ids.map(i=>i.biometricId));return log.ids.filter(id=>known.has(id)).length;};
 if(named.length===1)return {serial:named[0].serial,reason:'file-name',matched:count(named[0])};
 if(numbered.length===1)return {serial:numbered[0].serial,reason:'machine-no',matched:count(numbered[0])};
 if(machines.length===1)return {serial:machines[0].serial,reason:'only',matched:count(machines[0])};
 const ranked=machines.map(m=>({m,n:count(m)})).sort((a,b)=>b.n-a.n);
 if(ranked[0]&&ranked[0].n>0&&ranked[0].n>(ranked[1]?.n??0))return {serial:ranked[0].m.serial,reason:'ids',matched:ranked[0].n};
 return {serial:'',reason:'none',matched:0};
}
