import {parseCsv} from './api';

export type BiometricImportRow={serial:string;biometricId:string;name:string;punchedAt:string;verify:string;punchType:string};
const key=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,keyof BiometricImportRow>={serial:'serial',machineserial:'serial',deviceserial:'serial',biometricid:'biometricId',machineuserid:'biometricId',userid:'biometricId',employeeid:'biometricId',name:'name',employeename:'name',username:'name',punchedat:'punchedAt',punchtime:'punchedAt',datetime:'punchedAt',dateandtime:'punchedAt',verify:'verify',verifycode:'verify',punchtype:'punchType',punchtypecode:'punchType'};
const stamp=(value:string)=>value.trim().replace('T',' ').replace(/^(\d{2})[-/](\d{2})[-/](\d{4})\s+/,(_,d,m,y)=>`${y}-${m}-${d} `);

function finish(rows:Partial<BiometricImportRow>[],defaultSerial=''){
 if(!rows.length)throw new Error('The import file does not contain any biometric punches.');
 return rows.map((row,index)=>{
  const serial=String(row.serial||defaultSerial).trim(),biometricId=String(row.biometricId||'').trim(),punchedAt=stamp(String(row.punchedAt||''));
  if(!serial)throw new Error(`Row ${index+1}: Machine Serial is required because this site has more than one machine.`);
  if(!biometricId)throw new Error(`Row ${index+1}: Biometric ID is required.`);
  if(!/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/.test(punchedAt))throw new Error(`Row ${index+1}: Punch Time must use YYYY-MM-DD HH:MM:SS.`);
  return {serial,biometricId,name:String(row.name||'').trim(),punchedAt,verify:String(row.verify||'').trim(),punchType:String(row.punchType||'').trim()};
 });
}

export function parseBiometricCsv(source:string,defaultSerial=''){
 const rows=parseCsv(source).map((row,index)=>{const out:Partial<BiometricImportRow>={};for(const [heading,value] of Object.entries(row)){const field=aliases[key(heading)];if(!field)throw new Error(`CSV row ${index+2}: Unknown column ${heading}.`);out[field]=value;}return out;});
 return finish(rows,defaultSerial);
}

export function parseBiometricText(source:string,defaultSerial=''){
 const rows=source.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line,index)=>{const parts=(line.includes('|')?line.split('|'):line.split('\t')).map(value=>value.trim());if(parts.length<3)throw new Error(`Text line ${index+1}: use Machine Serial | Biometric ID | Name | YYYY-MM-DD HH:MM:SS.`);if(parts.length===3&&defaultSerial)return {serial:defaultSerial,biometricId:parts[0],name:parts[1],punchedAt:parts[2]};return {serial:parts[0],biometricId:parts[1],name:parts.slice(2,-1).join(' '),punchedAt:parts.at(-1)};});
 return finish(rows,defaultSerial);
}

// ZKTeco / eSSL attlog .dat: employee no. <TAB> YYYY-MM-DD HH:MM:SS <TAB> verify <TAB> in/out state <TAB> work code <TAB> reserved.
// The file carries no machine serial, so the punches go to the site's only machine (or the machine chosen when it has more).
const ATTLOG=/^\s*([A-Za-z0-9_.-]{1,24})\t+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\t+(\d{0,3}))?(?:\t+(\d{0,3}))?/;
export function looksLikeAttlog(source:string){return source.split(/\r?\n/).filter(line=>line.trim()).slice(0,20).some(line=>ATTLOG.test(line));}

export function parseBiometricDat(source:string,defaultSerial=''){
 const text=source.replace(/^\uFEFF/,'');
 if(!looksLikeAttlog(text))return parseBiometricText(text,defaultSerial);
 if(!defaultSerial)throw new Error('A .dat file does not carry the machine serial. Choose which of this site’s machines the file came from.');
 const rows:BiometricImportRow[]=[];
 text.split(/\r?\n/).forEach((line,index)=>{
  if(!line.trim())return;
  const match=ATTLOG.exec(line);
  if(!match)throw new Error(`Line ${index+1}: not an attlog punch (employee no., then YYYY-MM-DD HH:MM:SS, tab separated).`);
  rows.push({serial:defaultSerial,biometricId:match[1],name:'',punchedAt:match[2],verify:match[3]||'',punchType:match[4]||''});
 });
 return finish(rows,defaultSerial);
}
