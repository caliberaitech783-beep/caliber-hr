import {prepareImport,type Field} from './api';
const reportColumns=[{key:'employeeId',label:'Employee'},{key:'name',label:'Name'},{key:'leaveTypeId',label:'Leave type'},{key:'allocated',label:'Allocated'},{key:'periodId',label:'Period'},{key:'used',label:'Used'},{key:'reserved',label:'Pending'},{key:'balance',label:'Balance'}];
export function prepareAllocationImport(source:string,fields:Field[]){
 const calculated=['used','reserved','balance'].filter(key=>!fields.some(field=>field.key===key)).map(key=>({key,label:key,type:'number'}));
 const parsed=prepareImport(source,[...fields,...calculated],reportColumns);
 if(!parsed.length)throw new Error('This file has column headings but no allocation rows. Add data below the headings, or choose a populated CSV or Excel file.');
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
 if(file.size>1_500_000)throw new Error('Choose an allocation file smaller than 1.5 MB.');
 let source:string;
 if(/\.xlsx?$/i.test(file.name)){
  const {read,utils}=await import('xlsx');
  const workbook=read(new Uint8Array(await file.arrayBuffer()),{type:'array'});
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  if(!sheet)throw new Error('The Excel file has no worksheet.');
  source=utils.sheet_to_csv(sheet,{blankrows:false});
 }else if(/\.csv$/i.test(file.name))source=await file.text();
 else throw new Error('Choose a CSV or Excel (.xlsx or .xls) allocation file.');
 return prepareAllocationImport(source,fields);
}
