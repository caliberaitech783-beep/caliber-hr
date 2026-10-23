import {canWrite} from './modules.mjs';
import {assignedSites,siteIds,scopeSql} from './scope.mjs';
import {balance} from './leave.mjs';
export const deletableKinds=['holidays','leaveTypes','leavePolicies','leavePeriods','leaveAllocations','leaveRequests','leaveEncashments','leaveBlocks'];
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
function authorize(profile,kind){if(!deletableKinds.includes(kind))fail('Deletion is not supported for this module',400);if(!canWrite(profile,kind))fail('Your permissions do not allow deletion',403);if(assignedSites(profile)!==null&&!['holidays','leaveBlocks','leaveAllocations','leaveRequests','leaveEncashments'].includes(kind))fail('Global masters require access to all sites',403);}
export function createDeletion(pool){return {
 async deletePreview(profile,kind){authorize(profile,kind);const rows=(await pool.query('SELECT r.id,r.version FROM hr_records r WHERE r.kind=$1 AND '+scopeSql('r','$2')+' ORDER BY r.id LIMIT 10001',[kind,await siteIds(pool,profile)])).rows;if(rows.length>10000)fail('Delete individual records first; bulk deletion supports 10,000 records');return {records:rows};},
 async deleteRecords(profile,kind,input){authorize(profile,kind);const targets=input.records;if(!Array.isArray(targets)||!targets.length||targets.length>10000||targets.some(r=>!r||!/^[0-9a-f-]{36}$/i.test(r.id)||!Number.isInteger(r.version))||new Set(targets.map(r=>r.id)).size!==targets.length)fail('Invalid deletion selection',400);
 const db=await pool.connect();try{await db.query('BEGIN');await db.query('LOCK TABLE hr_records IN SHARE ROW EXCLUSIVE MODE');const ids=targets.map(r=>r.id);const rows=(await db.query('SELECT r.* FROM hr_records r WHERE r.kind=$1 AND r.id=ANY($2::uuid[]) AND '+scopeSql('r','$3')+' FOR UPDATE',[kind,ids,await siteIds(db,profile)])).rows;if(rows.length!==targets.length)fail('Records changed or are outside your site access. Reload before deleting.');
 for(const row of rows){if(row.version!==targets.find(t=>t.id===row.id).version)fail('A record changed. Reload before deleting.');if(['PENDING','APPROVED'].includes(row.status))fail('Pending or approved records cannot be deleted. Resolve the request first.');if(assignedSites(profile)!==null&&['holidays','leaveBlocks'].includes(kind)&&!row.data.siteId)fail('Global records require access to all sites',403);if(['leaveRequests','leaveEncashments'].includes(kind)&&row.created_by!==profile.actor)fail('Only the requester can delete this request',403);if(kind==='leaveAllocations'){const b=await balance(db,row.data.employeeId,row.data.leaveTypeId,row.data.periodId);if(b.used+b.reserved>0)fail('Allocation has used or reserved days');}}
 const refs=await db.query("SELECT r.code FROM hr_records r WHERE NOT(r.id=ANY($1::uuid[])) AND EXISTS (SELECT 1 FROM jsonb_each_text(r.data) f WHERE f.value=ANY($2::text[])) LIMIT 1",[ids,ids]);if(refs.rowCount)fail('Records are still referenced by '+refs.rows[0].code+'. Nothing was deleted.');
 if((await db.query('SELECT 1 FROM hr_approvals WHERE record_id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount)fail('Records with approval history cannot be deleted');
 for(const r of rows)await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'DELETE',$2,$3,$4)",[profile.actor,kind,r.id,{code:r.code,name:r.name}]);
 await db.query('DELETE FROM hr_records WHERE kind=$1 AND id=ANY($2::uuid[])',[kind,ids]);await db.query('COMMIT');return {deleted:rows.length};
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
};}
