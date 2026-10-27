import {randomUUID} from 'node:crypto';
import {canRead,canWrite} from './modules.mjs';
import {siteIds} from './scope.mjs';
import {validateDocument} from './holiday-documents.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function createEmployeeDocuments(pool){
 async function employee(profile,code,write){
  if(!(write?canWrite:canRead)(profile,'employees'))fail('Employee access is required',403);
  const row=(await pool.query("SELECT * FROM hr_records WHERE kind='employees' AND code=$1 AND status<>'INACTIVE' ORDER BY updated_at DESC LIMIT 1",[code])).rows[0];
  if(!row)fail('Employee not found',404);
  const ids=await siteIds(pool,profile);if(ids!==null&&!ids.includes(row.data.siteId))fail('This employee is outside your assigned Pulse site',403);
  return row;
 }
 return {async employeeDocuments(profile,params,input){
  const code=String(input?.employeeCode||params.get('employeeCode')||'').trim(),documentType=String(input?.documentType||params.get('documentType')||'').trim();
  if(!code||!documentType||documentType.length>100)fail('Employee code and document type are required');
  const row=await employee(profile,code,!!input);
  if(input){const document=validateDocument(input),id=randomUUID(),data={...document,employeeId:row.id,employeeCode:code,documentType};await pool.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'employeeDocuments',$2,$3,$4,'ACTIVE',$5,$5)",[id,id,document.name,data,profile.actor]);await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'UPLOAD','employeeDocuments',$2,$3)",[profile.actor,id,{employeeCode:code,documentType}]);return {id};}
  const found=(await pool.query("SELECT data FROM hr_records WHERE kind='employeeDocuments' AND data->>'employeeId'=$1 AND data->>'documentType'=$2 AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1",[row.id,documentType])).rows[0];
  if(!found)fail('Document not found',404);return found.data;
 }};
}
