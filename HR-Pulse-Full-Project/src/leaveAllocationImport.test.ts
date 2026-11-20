import {expect,it} from 'vitest';
import {utils,write} from 'xlsx';
import {prepareAllocationImport,readAllocationImport} from './leaveAllocationImport';
const fields=[{key:'code',label:'Allocation ID',type:'text'},{key:'name',label:'Description',type:'text'},{key:'employeeId',label:'Employee',type:'reference'},{key:'leaveTypeId',label:'Leave type',type:'reference'},{key:'periodId',label:'Period',type:'reference'},{key:'allocated',label:'Allocated days',type:'number'}];
const headings=['Employee','Name','Leave type','Allocated','Used','Pending','Balance','Period','Status','Last updated'];
it('accepts exported headings but imports allocation amounts only',()=>{
 expect(prepareAllocationImport(headings.join(',')+'\nEMP001,Sample employee,Earned Leave (EL),15,10,0,5,Mar-25 to Dec-25,Closed,2026-11-20',fields)).toEqual([{employeeId:'EMP001',name:'Sample employee',leaveTypeId:'Earned Leave (EL)',allocated:'15',periodId:'Mar-25 to Dec-25'}]);
 expect(prepareAllocationImport('code,name,employeeId,leaveTypeId,periodId,allocated\nALLOC1,Allocation,EMP001,EL,2025,0',fields)[0].allocated).toBe('0');
});
it('explains empty exports and validates the rows before import',()=>{
 expect(()=>prepareAllocationImport(headings.join(','),fields)).toThrow('column headings but no allocation rows');
 expect(()=>prepareAllocationImport('Employee,Leave type,Period,Allocated\nEMP001,EL,2025,-1',fields)).toThrow('non-negative');
 expect(()=>prepareAllocationImport('Employee,Leave type,Period,Allocated\nEMP001,EL,,15',fields)).toThrow('Period is required');
});
it('reads an Excel workbook with the supplied workbook column layout',async()=>{
 const workbook=utils.book_new();
 utils.book_append_sheet(workbook,utils.aoa_to_sheet([headings,...Array.from({length:47},(_,index)=>['EMP'+index,'Sample employee '+index,'Earned Leave (EL)',15,10,0,5,'Mar-25 to Dec-25','Closed',46346])]),'Sheet1');
 const bytes=write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
 const file=new File([bytes],'2025 EL.xlsx');
 Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
 const rows=await readAllocationImport(file,fields);
 expect(rows).toHaveLength(47);expect(rows[0].allocated).toBe('15');
 expect(rows[0]).not.toHaveProperty('used');expect(rows[0]).not.toHaveProperty('balance');expect(rows[0]).not.toHaveProperty('status');
});
