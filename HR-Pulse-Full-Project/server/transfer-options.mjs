import {canRead} from './modules.mjs';
import {managerRank} from './reporting-managers.mjs';
import {siteIds} from './scope.mjs';
import {employeeNumber} from './mis-employee-sync.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';

/* Owner, 23 Nov 2026: the employee transfer form picks from lists, not free text.
   - Designations: the Designation master plus every designation used in the Employee Master register.
   - Reporting managers: the Manager-and-above people of the chosen site (From or To), shown with their
     employee ID. Only ID, name and designation leave the server. */
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const leftStatus=/\b(left|inactive|resign|resigned|exit|exited|terminated|absconding|dead|expired)\b/i;
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();

export function siteManagers(rows){
  const seen=new Set();
  return rows
    .filter(row=>!leftStatus.test(String(row.status||'')))
    .map(row=>({employeeId:clean(row.employeeId),name:clean(row.name),designation:clean(row.designation),rank:managerRank(row.designation)}))
    .filter(row=>row.rank&&row.name)
    .sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name))
    .map(row=>{const value=[row.employeeId,row.name].filter(Boolean).join(' · ');return {value,label:`${value} – ${row.designation}`};})
    .filter(row=>!seen.has(row.value.toLowerCase())&&seen.add(row.value.toLowerCase()));
}

/* Employees of the From site (owner, 23 Nov 2026): the Employee Master register (the all-sites workbook) together with
   the employees who joined through HR, one line per employee number; the joined employee wins, as in the Pulse-II sync.
   A register line is chosen as "reg:<id>". People who have left are not listed. */
export function siteEmployees(register,joined){
  const lines=new Map(),out=[];
  for(const row of joined){const n=employeeNumber(row.code)||'hr:'+row.id;if(!lines.has(n)){lines.set(n,true);out.push({value:String(row.id),code:clean(row.code),name:clean(row.name)});}}
  for(const row of register){if(leftStatus.test(String(row.status||'')))continue;const n=employeeNumber(row.code)||'reg:'+row.id;if(lines.has(n))continue;lines.set(n,true);out.push({value:'reg:'+row.id,code:clean(row.code),name:clean(row.name)});}
  return out.filter(x=>x.name).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})||a.name.localeCompare(b.name)).map(x=>({...x,label:[x.code,x.name].filter(Boolean).join(' · ')}));
}

export function designationList(master,register){
  const byKey=new Map();
  for(const name of [...master,...register].map(clean).filter(Boolean))if(!byKey.has(name.toLowerCase()))byKey.set(name.toLowerCase(),name);
  return [...byKey.values()].sort((a,b)=>a.localeCompare(b));
}

/* A site is matched by its ID, code or name (owner, 23 Nov 2026): the register import ties each line to a site by its code,
   and two site masters can share a code or name, so an exact ID match can miss a whole site's staff. */
const norm="regexp_replace(lower(COALESCE(%s,'')),'[^a-z0-9]','','g')";
const n=column=>norm.replace('%s',column);
export const REGISTER_AT_SITE=`(r.site_id::text=$1 OR ($2<>'' AND ${n('r.site_code')}=$2) OR ($3<>'' AND ${n('r.site_name')}=$3))`;
export const JOINED_AT_SITE=`EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites' AND s.id::text=e.data->>'siteId' AND (s.id::text=$1 OR ($2<>'' AND ${n('s.code')}=$2) OR ($3<>'' AND ${n('s.name')}=$3)))`;
const key=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');

export function createTransferOptions(pool){
  return {
    async transferOptions(profile,params){
      if(!canRead(profile,'employeeTransfers'))fail('Your Pulse HR permissions do not allow this operation',403);
      const siteArgs=async siteId=>{const site=(await pool.query("SELECT code,name FROM hr_records WHERE kind='sites' AND id::text=$1",[siteId])).rows[0];return [siteId,key(site?.code),key(site?.name)];};
      const managersOf=async siteId=>uuid(siteId)?siteManagers((await pool.query(`SELECT r.name,r.data->>'employeeId' AS "employeeId",r.data->>'designation' AS designation,r.data->>'status' AS status
        FROM hr_employee_master_register r WHERE ${REGISTER_AT_SITE} AND COALESCE(r.data->>'designation','')<>''`,await siteArgs(siteId))).rows):[];
      const master=(await pool.query("SELECT name FROM hr_records WHERE kind='designations' AND status IN ('ACTIVE','APPROVED')")).rows.map(r=>r.name);
      const register=(await pool.query("SELECT DISTINCT data->>'designation' AS name FROM hr_employee_master_register WHERE COALESCE(data->>'designation','')<>''")).rows.map(r=>r.name);
      const fromSiteId=params.get('fromSiteId')||'',ids=await siteIds(pool,profile);
      let employees=[],staff={register:0,joined:0,inScope:false};
      if(uuid(fromSiteId)&&(ids===null||ids.map(String).includes(fromSiteId))){
        staff.inScope=true;
        const [reg,joined]=await Promise.all([
          siteArgs(fromSiteId).then(args=>pool.query(`SELECT r.id,r.name,r.data->>'employeeId' AS code,r.data->>'status' AS status FROM hr_employee_master_register r WHERE ${REGISTER_AT_SITE} AND ${isEmployeeEntry}`,args)),
          siteArgs(fromSiteId).then(args=>pool.query(`SELECT e.id,e.code,e.name FROM hr_records e WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED') AND ${JOINED_AT_SITE}`,args))]);
        employees=siteEmployees(reg.rows,joined.rows);staff={register:reg.rows.length,joined:joined.rows.length,inScope:true};
      }
      /* staff: how many lines were found for the site, so the form can say why a list is short. */
      return {employees,staff,designations:designationList(master,register),fromManagers:await managersOf(params.get('fromSiteId')),toManagers:await managersOf(params.get('toSiteId'))};
    },
  };
}
