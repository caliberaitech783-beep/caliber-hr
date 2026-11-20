import {downloadBlob,prepareImport,type Field} from './api';
export const excelAccept='.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
export async function excelBuffer(columns:string[],rows:Record<string,unknown>[]):Promise<ArrayBuffer>{
 const {utils,write}=await import('xlsx');
 const sheet=utils.aoa_to_sheet([columns,...rows.map(row=>columns.map(column=>row[column]??''))]);
 sheet['!cols']=columns.map(column=>({wch:Math.min(42,Math.max(16,column.length+3))}));
 if(columns.length)sheet['!autofilter']={ref:utils.encode_range({r:0,c:0},{r:rows.length,c:columns.length-1})};
 const workbook=utils.book_new();utils.book_append_sheet(workbook,sheet,'Data');
 return write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
}
export async function downloadExcel(name:string,columns:string[],rows:Record<string,unknown>[]){
 const data=await excelBuffer(columns,rows);
 downloadBlob(name.replace(/\.(csv|xlsx?)$/i,'')+'.xlsx',new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
}
export async function excelImportSource(file:File){
 if(!/\.xlsx?$/i.test(file.name))throw new Error('Choose an Excel file (.xlsx or .xls).');
 if(file.size>1_500_000)throw new Error('Choose an Excel file smaller than 1.5 MB.');
 const {read,utils}=await import('xlsx');
 const workbook=read(new Uint8Array(await file.arrayBuffer()),{type:'array',cellDates:true});
 const sheet=workbook.Sheets[workbook.SheetNames[0]];
 if(!sheet)throw new Error('The Excel file has no worksheet.');
 for(const cell of Object.values(sheet))if(cell&&typeof cell==='object'&&'t' in cell&&cell.t==='d'&&'v' in cell){
  cell.w=new Date(cell.v as string|number|Date).toISOString().slice(0,10);
 }
 return utils.sheet_to_csv(sheet,{blankrows:false});
}
export async function readExcelImport(file:File,fields:Field[],columns?:{key:string;label:string}[]){
 try{return prepareImport(await excelImportSource(file),fields,columns);}
 catch(error){throw new Error((error instanceof Error?error.message:String(error)).replace(/CSV/g,'Excel'));}
}
