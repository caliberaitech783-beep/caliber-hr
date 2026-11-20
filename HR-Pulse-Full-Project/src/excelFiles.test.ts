import {expect,it} from 'vitest';
import {read,utils} from 'xlsx';
import {excelBuffer,readExcelImport} from './excelFiles';
it('creates genuine Excel workbooks with typed numbers, text identifiers and matching headings',async()=>{
 const columns=['Employee','Allocated','Remarks'];
 const bytes=await excelBuffer(columns,[{Employee:'00123',Allocated:0,Remarks:'Comma, quote " and\nnewline'},{Employee:'=1+1',Allocated:15,Remarks:'Test'}]);
 expect(Array.from(new Uint8Array(bytes).slice(0,2))).toEqual([80,75]);
 const workbook=read(new Uint8Array(bytes),{type:'array'}),sheet=workbook.Sheets[workbook.SheetNames[0]];
 expect(utils.sheet_to_json(sheet,{header:1})).toEqual([columns,['00123',0,'Comma, quote " and\nnewline'],['=1+1',15,'Test']]);
 expect(sheet.A3.f).toBeUndefined();
});
it('reads real Excel rows through the existing field validation and normalizes date cells',async()=>{
 const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Code','Name','Date'],['001','Sample',new Date('2026-11-20T00:00:00Z')]]),'Data');
 const bytes=(await import('xlsx')).write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
 const file=new File([bytes],'template.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
 const fields=[{key:'code',label:'Code',type:'text'},{key:'name',label:'Name',type:'text'},{key:'date',label:'Date',type:'date'}];
 expect(await readExcelImport(file,fields)).toEqual([{code:'001',name:'Sample',date:'2026-11-20'}]);
 await expect(readExcelImport(new File(['code,name'],'old.csv'),fields)).rejects.toThrow('Choose an Excel file');
});
