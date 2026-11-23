// What Pulse-II (pulse-ll.cmll.in) copies from HR (owner, 23 Nov 2026): the Employee Master, what changed in it,
// and the approved employee transfers. Read only. Pulse-II is not a Pulse user, so it signs in with its own key
// (MIS_SYNC_KEY, the same value as Pulse-II's HR_SYNC_KEY, at least 32 characters) in the X-MIS-Sync-Key header.
//
// Employee Master is the all-sites register (the "ALL SITES MASTER" workbook HR imported) together with the
// employees who joined through HR. One line per employee number (CMPL123 = CMLL123 = 123): where both hold the
// number and it is the same person, the joined employee wins, because a transfer approved in HR moves that record
// (employee-transfer-flow.mjs). A joining form that holds another person's number is sent beside the register line:
// Pulse-II then sees the number on two lines and changes nobody until HR corrects it.
//
// HR Pulse is the final authority for Employee Master, and Pulse-II copies every change within a minute:
// /employee-changes?after=N gives the numbers that changed after N (employee-changes-schema.sql writes the list)
// with every line each of those people has now. No line left for a number means the person was removed.
import {keyMatches} from './attendance.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';
import {employeeNumber,samePerson} from './employee-number.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
export {employeeNumber};

const REGISTER_COLUMNS=`data->>'employeeId' AS "employeeId",name,site_name AS site,split_part(site_code,'-',1) AS region,
 data->>'department' AS department,data->>'designation' AS designation,data->>'category' AS category,data->>'status' AS status,
 data->>'reportingTo' AS "reportingTo",data->>'contact' AS contact,data->>'leavingDate' AS "leavingDate"`;
// A transfer sets designationTitle, so it comes before the designation picked at joining.
const JOINED_COLUMNS=`e.code AS "employeeId",e.name,s.name AS site,split_part(COALESCE(s.code,''),'-',1) AS region,
 COALESCE(dep.name,e.data->'officeData'->>'Department *',e.data->'officeData'->>'Department','') AS department,
 COALESCE(NULLIF(e.data->>'designationTitle',''),des.name,e.data->'officeData'->>'Designation *','') AS designation,
 COALESCE(NULLIF(e.data->'officeData'->>'Employee Category',''),e.data->>'category','') AS category,
 CASE WHEN e.status='INACTIVE' THEN 'LEFT' ELSE '' END AS status,
 COALESCE(NULLIF(e.data->>'reportingManagerName',''),e.data->'officeData'->>'Reporting To','') AS "reportingTo",
 COALESCE(e.data->'officeData'->>'Mobile *',e.data->'officeData'->>'Mobile','') AS contact,
 COALESCE(e.data->>'leavingDate','') AS "leavingDate"`;
const JOINED_FROM=`FROM hr_records e
 LEFT JOIN hr_records s ON s.kind='sites' AND s.id::text=e.data->>'siteId'
 LEFT JOIN hr_records dep ON dep.kind='departments' AND dep.id::text=e.data->>'departmentId'
 LEFT JOIN hr_records des ON des.kind='designations' AND des.id::text=e.data->>'designationId'
 WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED','INACTIVE')`;
export const REGISTER_SQL=`SELECT ${REGISTER_COLUMNS} FROM hr_employee_master_register WHERE ${isEmployeeEntry} ORDER BY site_code,lower(name),id`;
export const JOINED_SQL=`SELECT ${JOINED_COLUMNS} ${JOINED_FROM} ORDER BY e.code`;
// The same two reads for some people only. hr_employee_number is the database's reading of a number (employee-changes-schema.sql).
export const REGISTER_FOR_SQL=`SELECT ${REGISTER_COLUMNS} FROM hr_employee_master_register WHERE ${isEmployeeEntry} AND hr_employee_number(data->>'employeeId')=ANY($1::text[]) ORDER BY site_code,lower(name),id`;
export const JOINED_FOR_SQL=`SELECT ${JOINED_COLUMNS} ${JOINED_FROM} AND hr_employee_number(e.code)=ANY($1::text[]) ORDER BY e.code`;
export const CHANGE_BATCH=5000;
export const CHANGES_SQL=`SELECT seq::text AS seq,old_number,new_number FROM hr_employee_changes WHERE seq>$1::bigint ORDER BY seq LIMIT ${CHANGE_BATCH}`;
// A change made in a transaction that is still open is not visible yet although later numbers already are. So the
// people changed in the last ten minutes are given again, whatever N says. Pulse-II reads a person's lines as they
// are now, so reading one twice changes nothing. After a large import (more people than RECENT_LIMIT) this second
// look is left out; the nightly match of both lists covers it.
export const CHANGE_AGAIN_MINUTES=10;
export const RECENT_LIMIT=2000;
export const RECENT_SQL=`SELECT DISTINCT number FROM (
  SELECT old_number AS number FROM hr_employee_changes WHERE seq<=$1::bigint AND at>now()-interval '${CHANGE_AGAIN_MINUTES} minutes'
  UNION ALL SELECT new_number FROM hr_employee_changes WHERE seq<=$1::bigint AND at>now()-interval '${CHANGE_AGAIN_MINUTES} minutes'
 ) recent WHERE number<>'' LIMIT ${RECENT_LIMIT+1}`;
export const TRANSFERS_SQL=`SELECT t.id,t.code,t.data->>'transferDate' AS "transferDate",COALESCE(e.code,t.data->>'empCode') AS "employeeId",COALESCE(e.name,t.data->>'employeeName') AS name,
 fs.name AS "fromSite",ts.name AS "toSite",t.data->>'fromDesignation' AS "fromDesignation",t.data->>'toDesignation' AS "toDesignation",
 t.updated_at AS "approvedAt"
 FROM hr_records t
 LEFT JOIN hr_records e ON e.kind='employees' AND e.id::text=t.data->>'employeeId'
 LEFT JOIN hr_records fs ON fs.kind='sites' AND fs.id::text=t.data->>'fromSiteId'
 LEFT JOIN hr_records ts ON ts.kind='sites' AND ts.id::text=t.data->>'toSiteId'
 WHERE t.kind='employeeTransfers' AND t.status='APPROVED' ORDER BY t.updated_at,t.code`;

const line=(row,source)=>({employeeId:text(row.employeeId),name:text(row.name),region:text(row.region),site:text(row.site),
 department:text(row.department),designation:text(row.designation),category:text(row.category),status:text(row.status).toUpperCase(),
 reportingTo:text(row.reportingTo),contact:text(row.contact),leavingDate:text(row.leavingDate).slice(0,10),source});

// The register's lines, with the line of every number that the same person also holds as a joined employee replaced
// by that employee. A joining form on somebody else's number stays beside the register line (two lines, one number).
export function mergeEmployees(register,joined){
 const live=new Map();
 for(const row of joined){const number=employeeNumber(row.employeeId);if(number&&!live.has(number))live.set(number,line(row,'HR joining'));}
 const used=new Set(),clashing=new Set(),employees=[];let replaced=0;
 for(const row of register){
  const number=employeeNumber(row.employeeId),form=number&&live.get(number);
  if(form&&samePerson(form.name,row.name)){if(!used.has(number)){used.add(number);employees.push(form);}replaced++;continue;}
  if(form)clashing.add(number);
  employees.push(line(row,'HR register'));
 }
 for(const [number,row] of live)if(!used.has(number))employees.push(row);
 return {employees,counts:{register:register.length,joined:joined.length,replaced,clashes:clashing.size,lines:employees.length}};
}

// Who changed after `after`: the numbers, the highest change number read, and every line those people have now.
export async function employeeChanges(pool,after){
 const from=/^\d{1,18}$/.test(text(after))?text(after):'0';
 let rows;
 try{rows=(await pool.query(CHANGES_SQL,[from])).rows;}
 // The change list is made at start-up; until it exists Pulse-II is told so and reads the whole list instead.
 catch(error){if(error?.code==='42P01'||error?.code==='42883')return {ready:false,after:from,latest:from,more:false,numbers:[],employees:[]};throw error;}
 const more=rows.length===CHANGE_BATCH;
 const latest=rows.reduce((highest,row)=>BigInt(row.seq)>BigInt(highest)?String(row.seq):highest,from);
 const changed=new Set(rows.flatMap(row=>[text(row.old_number),text(row.new_number)]).filter(Boolean));
 if(!more){
  const recent=(await pool.query(RECENT_SQL,[from])).rows.map(row=>text(row.number)).filter(Boolean);
  if(recent.length<=RECENT_LIMIT)for(const number of recent)changed.add(number);
 }
 const numbers=[...changed];
 if(!numbers.length)return {ready:true,after:from,latest,more,numbers,employees:[]};
 const [register,joined]=await Promise.all([pool.query(REGISTER_FOR_SQL,[numbers]),pool.query(JOINED_FOR_SQL,[numbers])]);
 return {ready:true,after:from,latest,more,numbers,...mergeEmployees(register.rows,joined.rows)};
}

export function createMisEmployeeSync(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 return {
  async misEmployeeSync(key,what,{after}={}){
   if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
   if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
   const at=new Date().toISOString();
   if(what==='employees'){
    const [register,joined]=await Promise.all([pool.query(REGISTER_SQL),pool.query(JOINED_SQL)]);
    return {generatedAt:at,...mergeEmployees(register.rows,joined.rows)};
   }
   if(what==='employee-changes')return {generatedAt:at,...await employeeChanges(pool,after)};
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
