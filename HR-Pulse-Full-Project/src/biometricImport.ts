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
