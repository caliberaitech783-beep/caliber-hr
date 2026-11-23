// What Pulse-II (pulse-ll.cmll.in) copies from HR every hour (owner, 23 Nov 2026): the Employee Master and the
// approved employee transfers. Read only. Pulse-II is not a Pulse user, so it signs in with its own key
// (MIS_SYNC_KEY, the same value as Pulse-II's HR_SYNC_KEY, at least 32 characters) in the X-MIS-Sync-Key header.
//
// Employee Master is the all-sites register (the "ALL SITES MASTER" workbook HR imported) together with the
// employees who joined through HR. One line per employee number (CMPL123 = CMLL123 = 123): where both hold the
// number, the joined employee wins, because a transfer approved in HR moves that record (employee-transfer-flow.mjs).
import {keyMatches} from './attendance.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';
import {employeeNumber} from './employee-number.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
export {employeeNumber};

export const REGISTER_SQL=`SELECT data->>'employeeId' AS "employeeId",name,site_name AS site,split_part(site_code,'-',1) AS region,
 data->>'department' AS department,data->>'designation' AS designation,data->>'category' AS category,data->>'status' AS status
 FROM hr_employee_master_register WHERE ${isEmployeeEntry} ORDER BY site_code,lower(name),id`;
// A transfer sets designationTitle, so it comes before the designation picked at joining.
export const JOINED_SQL=`SELECT e.code AS "employeeId",e.name,s.name AS site,split_part(COALESCE(s.code,''),'-',1) AS region,
 COALESCE(dep.name,e.data->'officeData'->>'Department *',e.data->'officeData'->>'Department','') AS department,
 COALESCE(NULLIF(e.data->>'designationTitle',''),des.name,e.data->'officeData'->>'Designation *','') AS designation,
 COALESCE(NULLIF(e.data->'officeData'->>'Employee Category',''),e.data->>'category','') AS category,
 CASE WHEN e.status='INACTIVE' THEN 'LEFT' ELSE '' END AS status
 FROM hr_records e
 LEFT JOIN hr_records s ON s.kind='sites' AND s.id::text=e.data->>'siteId'
 LEFT JOIN hr_records dep ON dep.kind='departments' AND dep.id::text=e.data->>'departmentId'
 LEFT JOIN hr_records des ON des.kind='designations' AND des.id::text=e.data->>'designationId'
 WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED','INACTIVE') ORDER BY e.code`;
export const TRANSFERS_SQL=`SELECT t.id,t.code,t.data->>'transferDate' AS "transferDate",COALESCE(e.code,t.data->>'empCode') AS "employeeId",COALESCE(e.name,t.data->>'employeeName') AS name,
 fs.name AS "fromSite",ts.name AS "toSite",t.data->>'fromDesignation' AS "fromDesignation",t.data->>'toDesignation' AS "toDesignation",
 t.updated_at AS "approvedAt"
 FROM hr_records t
 LEFT JOIN hr_records e ON e.kind='employees' AND e.id::text=t.data->>'employeeId'
 LEFT JOIN hr_records fs ON fs.kind='sites' AND fs.id::text=t.data->>'fromSiteId'
 LEFT JOIN hr_records ts ON ts.kind='sites' AND ts.id::text=t.data->>'toSiteId'
 WHERE t.kind='employeeTransfers' AND t.status='APPROVED' ORDER BY t.updated_at,t.code`;

const line=(row,source)=>({employeeId:text(row.employeeId),name:text(row.name),region:text(row.region),site:text(row.site),
 department:text(row.department),designation:text(row.designation),category:text(row.category),status:text(row.status).toUpperCase(),source});

// The register's lines, with the line of every number that also joined through HR replaced by the joined employee.
export function mergeEmployees(register,joined){
 const live=new Map();
 for(const row of joined){const number=employeeNumber(row.employeeId);if(number&&!live.has(number))live.set(number,line(row,'HR joining'));}
 const used=new Set(),employees=[];let replaced=0;
 for(const row of register){
  const number=employeeNumber(row.employeeId);
  if(number&&live.has(number)){if(!used.has(number)){used.add(number);employees.push(live.get(number));}replaced++;continue;}
  employees.push(line(row,'HR register'));
 }
 for(const [number,row] of live)if(!used.has(number))employees.push(row);
 return {employees,counts:{register:register.length,joined:joined.length,replaced,lines:employees.length}};
}

export function createMisEmployeeSync(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 return {
  async misEmployeeSync(key,what){
   if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
   if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
   const at=new Date().toISOString();
   if(what==='employees'){
    const [register,joined]=await Promise.all([pool.query(REGISTER_SQL),pool.query(JOINED_SQL)]);
    return {generatedAt:at,...mergeEmployees(register.rows,joined.rows)};
   }
   if(what==='transfers'){
    const {rows}=await pool.query(TRANSFERS_SQL);
    return {generatedAt:at,transfers:rows.map(row=>({id:String(row.id),code:text(row.code),transferDate:text(row.transferDate).slice(0,10),employeeId:text(row.employeeId),name:text(row.name),
     fromSite:text(row.fromSite),toSite:text(row.toSite),fromDesignation:text(row.fromDesignation),toDesignation:text(row.toDesignation),
     approvedAt:row.approvedAt instanceof Date?row.approvedAt.toISOString():text(row.approvedAt)}))};
   }
   fail('Not found',404);
  }
 };
}
