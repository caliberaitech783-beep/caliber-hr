import {read, SSF, utils, writeFile} from 'xlsx';
import type {AadhaarDetails} from '../geminiOcr';
import {licenceDate} from './records';

export const bulkColumns = [
  ['name','Name','text','Full name',['Candidate Name','Name of candidate','Full Name']],
  ['father',"Father's name",'text','',['Father Name','Parent Name','Father / Spouse Name']],
  ['mobile','Mobile','tel','10 digits',['Mobile No','Mobile Number','Phone','Phone Number']],
  ['aadhaar','Aadhaar','text','',['Aadhaar No','Aadhaar Number','Aadhar','Aadhar No','Aadhar Number']],
  ['dl','DL no. & class','text','DL – class',['Driving Licence No','DL Number','DL No']],
  ['dlValid','DL valid','date','',['DL Valid Up To','DL Expiry','DL valid (DD-MM-YYYY)']],
  ['experience','Experience','text','yrs',['Experience (yrs)','Exp (yrs)','Total Experience (Years)']],
  ['referredBy','Referred by','text','',['Referral']],
  ['dob','Date of birth','date','',['DOB']],
  ['address','Address','text','',['Permanent Address']],
] as const;

export const bulkConfirmations = [
  ['dlSeen','DL seen',['Driving Licence Seen']],
  ['aSeen','Aadhaar seen',['Aadhar Seen']],
  ['medSeen','Medical seen',['Medical','Medical Fitness Seen']],
] as const;

export type BulkRow = Record<typeof bulkColumns[number][0],string> & Record<typeof bulkConfirmations[number][0],boolean>;
export const blankBulkRow = (): BulkRow => ({
  name:'', father:'', mobile:'', aadhaar:'', dl:'', dlValid:'', experience:'', referredBy:'', dob:'', address:'',
  dlSeen:false, aSeen:false, medSeen:false,
});
export const hasBulkCandidate = (row: BulkRow) => bulkColumns.some(([key])=>row[key].trim());
const headers = [...bulkColumns.map(([key,label,,,aliases])=>({key,label,aliases})),
  ...bulkConfirmations.map(([key,label,aliases])=>({key,label,aliases}))];
const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const cellText = (value: unknown) => value == null ? '' : String(value).trim();
const aadhaarNumber = (value: string) => value.replace(/[\s-]/g,'');

function excelDate(value: unknown, date1904: boolean) {
  if (typeof value !== 'number') return licenceDate(cellText(value));
  const parsed = SSF.parse_date_code(value,{date1904});
  return parsed ? licenceDate([parsed.y,parsed.m,parsed.d].map(part=>String(part).padStart(2,'0')).join('-')) : '';
}

export async function readBulkWorkbook(file: File) {
  const workbook = read(await file.arrayBuffer(),{type:'array'});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('The first worksheet is empty.');
  const firstRow = utils.decode_range(sheet['!ref']).s.r;
  const rows = utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,blankrows:true});
  const headerRow = rows.findIndex(row=>row.some(cell=>cellText(cell)));
  if (headerRow < 0) throw new Error('The first worksheet is empty.');
  const names = rows[headerRow].map(cell=>headerKey(cellText(cell)));
  const indexes = headers.map(({key,label,aliases})=>{
    const accepted = [label,...aliases].map(headerKey);
    const matches = names.flatMap((name,index)=>accepted.includes(name)?[index]:[]);
    if (matches.length>1) throw new Error(`The worksheet has more than one “${label}” column.`);
    return [key,matches[0]??-1] as const;
  });
  if (!indexes.some(([key,index])=>index>=0&&(key==='name'||key==='aadhaar'))) {
    throw new Error('Include a Name or Aadhaar column in the first worksheet. The Excel template has the supported headers.');
  }
  const candidates = rows.slice(headerRow+1).flatMap((cells,offset)=>{
    const row = blankBulkRow();
    const number = firstRow+headerRow+offset+2;
    for (const [key,index] of indexes) {
      const raw = cells[index];
      const value = cellText(raw);
      if (!value) continue;
      if (key==='dlSeen'||key==='aSeen'||key==='medSeen') {
        if (/^(yes|true|1|y|✓)$/i.test(value)) row[key]=true;
        else if (!/^(no|false|0|n)$/i.test(value)) throw new Error(`Use Yes or No for the document check on Excel row ${number}.`);
      } else if (key==='dob'||key==='dlValid') {
        row[key]=excelDate(raw,Boolean(workbook.Workbook?.WBProps?.date1904));
        if (!row[key]) throw new Error(`Check the date on Excel row ${number}. Use DD-MM-YYYY or an Excel date.`);
      } else if (key==='aadhaar') {
        row.aadhaar=aadhaarNumber(value);
        if (!/^\d{12}$/.test(row.aadhaar)) throw new Error(`Check the Aadhaar number on Excel row ${number}. Enter 12 digits or leave it blank.`);
      } else {
        row[key]=key==='mobile'?value.replace(/[\s-]/g,''):value;
      }
    }
    return hasBulkCandidate(row)?[row]:[];
  });
  if (!candidates.length) throw new Error('The first worksheet has no candidate rows.');
  return candidates;
}

export function downloadBulkWorkbook() {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([headers.map(({label})=>label)]);
  sheet['!cols'] = headers.map(({label})=>({wch:Math.max(16,label.length+2)}));
  utils.book_append_sheet(workbook,sheet,'Candidates');
  writeFile(workbook,'Trial Form - Bulk Candidates.xlsx');
}

export function applyBulkAadhaar(rows: BulkRow[], details: AadhaarDetails) {
  const uid = aadhaarNumber(details.uid);
  if (!/^\d{12}$/.test(uid)) throw new Error('The full Aadhaar number could not be read.');
  const matches = rows.filter(row=>aadhaarNumber(row.aadhaar)===uid);
  if (matches.length>1) throw new Error('This Aadhaar number appears in more than one row.');
  const row = matches[0] ?? blankBulkRow();
  const fields = {aadhaar:uid,name:details.name,father:details.relationName,dob:licenceDate(details.dob),address:details.address};
  for (const [key,value] of Object.entries(fields) as [keyof typeof fields,string][]) {
    if (value.trim()&&!row[key].trim()) row[key]=value.trim();
  }
  if (!matches.length) rows.push(row);
}
