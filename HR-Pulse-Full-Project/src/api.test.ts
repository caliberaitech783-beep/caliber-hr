import {describe,it,expect} from 'vitest';
import {csv,parseCsv} from './api';
describe('employee CSV',()=>{
  it('round trips commas, quotes, multiline addresses and empty fields',()=>{const rows=[{code:'E001',name:'A, "B"',address:'First line\nSecond line',mobile:''}];expect(parseCsv(csv(Object.keys(rows[0]),rows))).toEqual(rows);});
  it('rejects malformed rows and duplicate headings',()=>{expect(()=>parseCsv('code,name\nE1')).toThrow();expect(()=>parseCsv('code,code\na,b')).toThrow();expect(()=>parseCsv('code,name\na,"b')).toThrow();});
  it('neutralizes spreadsheet formulas in exported values',()=>{expect(csv(['name'],[{name:'=1+1'}])).toContain("'=1+1");});
});
