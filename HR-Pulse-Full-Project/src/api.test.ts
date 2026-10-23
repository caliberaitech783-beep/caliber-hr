import {describe,it,expect} from 'vitest';
import {csv,parseCsv,prepareImport} from './api';
describe('employee CSV',()=>{
  it('round trips commas, quotes, multiline addresses and empty fields',()=>{const rows=[{code:'E001',name:'A, "B"',address:'First line\nSecond line',mobile:''}];expect(parseCsv(csv(Object.keys(rows[0]),rows))).toEqual(rows);});
  it('rejects malformed rows and duplicate headings',()=>{expect(()=>parseCsv('code,name\nE1')).toThrow();expect(()=>parseCsv('code,code\na,b')).toThrow();expect(()=>parseCsv('code,name\na,"b')).toThrow();});
  it('neutralizes spreadsheet formulas in exported values',()=>{expect(csv(['name'],[{name:'=1+1'}])).toContain("'=1+1");});
});
it('accepts exported metadata without restoring status or timestamps and normalizes Indian dates',()=>{
 const fields=[{key:'code',label:'Code',type:'text'},{key:'date',label:'Date',type:'date'}];
 expect(prepareImport('code,date,status,updatedAt\nH1,26-01-2026,APPROVED,old',fields)).toEqual([{code:'H1',date:'2026-01-26'}]);
 expect(()=>prepareImport('code,date\nH1,31-02-2026',fields)).toThrow('invalid date');
 expect(()=>prepareImport('code,unexpected\nH1,x',fields)).toThrow('Unknown CSV columns');
});
