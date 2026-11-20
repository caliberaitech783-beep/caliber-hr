import {prepareImport,type Field} from './api';
import {excelImportSource} from './excelFiles';
const reportColumns=[{key:'employeeId',label:'Employee'},{key:'name',label:'Name'},{key:'leaveTypeId',label:'Leave type'},{key:'allocated',label:'Allocated'},{key:'periodId',label:'Period'},{key:'used',label:'Used'},{key:'reserved',label:'Pending'},{key:'balance',label:'Balance'}];
export function prepareAllocationImport(source:string,fields:Field[]){
 const calculated=['used','reserved','balance'].filter(key=>!fields.some(field=>field.key===key)).map(key=>({key,label:key,type:'number'}));
 const parsed=prepareImport(source,[...fields,...calculated],reportColumns);
 if(!parsed.length)throw new Error('This file has column headings but no allocation rows. Add data below the headings, or choose a populated Excel file.');
 if(parsed.length>500)throw new Error(`This file has ${parsed.length} allocation rows. Import up to 500 rows at a time.`);
 const allowed=new Set(fields.map(field=>field.key));
 return parsed.map((row,index)=>{
  const values=Object.fromEntries(Object.entries(row).filter(([key])=>allowed.has(key)));
  for(const key of ['employeeId','leaveTypeId','periodId','allocated'])if(!String(values[key]||'').trim())throw new Error(`Row ${index+2}: ${reportColumns.find(column=>column.key===key)?.label||key} is required.`);
  if(!Number.isFinite(Number(values.allocated))||Number(values.allocated)<0)throw new Error(`Row ${index+2}: Allocated must be a non-negative number.`);
  return values;
 });
}
export async function readAllocationImport(file:File,fields:Field[]){
 try{return prepareAllocationImport(await excelImportSource(file),fields);}
 catch(error){throw new Error((error instanceof Error?error.message:String(error)).replace(/CSV/g,'Excel'));}
}
