import {randomUUID} from 'node:crypto';
import {modules} from './modules.mjs';
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'');
export async function resolveImportReferences(db,kind,record){const input={...record};for(const f of modules[kind].fields.filter(f=>f.type==='reference'))if(input[f.key]&&!uuid(input[f.key])){const ref=await db.query("SELECT id FROM hr_records WHERE kind=$1 AND code=$2 AND status IN ('ACTIVE','APPROVED')",[f.reference,String(input[f.key]).trim()]);if(!ref.rowCount)throw Object.assign(new Error(f.label+': no active record matches '+input[f.key]),{status:400});input[f.key]=ref.rows[0].id;}return input;}
export async function importWithDrafts(db,profile,kind,records,save){let drafts=0;for(const [index,record] of records.entries()){
 if(!record||typeof record!=='object'||Array.isArray(record))throw Object.assign(new Error('Invalid CSV row '+(index+2)),{status:400});
 const raw={};for(const f of modules[kind].fields){if(record[f.key]!==undefined){if(!['string','number','boolean'].includes(typeof record[f.key])||String(record[f.key]).length>2000||f.type==='attachment'&&record[f.key])throw Object.assign(new Error('Invalid import value for '+f.label),{status:400});raw[f.key]=record[f.key];}}
 const code=String(raw.code||'IMPORT-'+randomUUID()).trim();if(code.length>300)throw Object.assign(new Error('Import code is too long'),{status:400});raw.code=code;
 await db.query('SAVEPOINT import_row');try{await save(await resolveImportReferences(db,kind,raw));await db.query('RELEASE SAVEPOINT import_row');}
 catch(e){await db.query('ROLLBACK TO SAVEPOINT import_row');await db.query('RELEASE SAVEPOINT import_row');if(![400,403,409].includes(e.status))throw e;
 const id=randomUUID();const name=String(raw.name||code);const data={...raw,__importDraft:'true',__importIssue:e.message};
 await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$6)",[id,kind,code,name,data,profile.actor]);
 await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'IMPORT_DRAFT',$2,$3,$4)",[profile.actor,kind,id,{code,row:index+2,reason:e.message}]);drafts++;}
 }return {imported:records.length,drafts,ready:records.length-drafts};}
