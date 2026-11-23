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

export function createTransferOptions(pool){
  return {
    async transferOptions(profile,params){
      if(!canRead(profile,'employeeTransfers'))fail('Your Pulse HR permissions do not allow this operation',403);
      const managersOf=async siteId=>uuid(siteId)?siteManagers((await pool.query(`SELECT name,data->>'employeeId' AS "employeeId",data->>'designation' AS designation,data->>'status' AS status
        FROM hr_employee_master_register WHERE site_id=$1 AND COALESCE(data->>'designation','')<>''`,[siteId])).rows):[];
      const master=(await pool.query("SELECT name FROM hr_records WHERE kind='designations' AND status IN ('ACTIVE','APPROVED')")).rows.map(r=>r.name);
      const register=(await pool.query("SELECT DISTINCT data->>'designation' AS name FROM hr_employee_master_register WHERE COALESCE(data->>'designation','')<>''")).rows.map(r=>r.name);
      const fromSiteId=params.get('fromSiteId')||'',ids=await siteIds(pool,profile);
      let employees=[];
      if(uuid(fromSiteId)&&(ids===null||ids.map(String).includes(fromSiteId))){
        const [reg,joined]=await Promise.all([
          pool.query(`SELECT id,name,data->>'employeeId' AS code,data->>'status' AS status FROM hr_employee_master_register WHERE site_id=$1 AND ${isEmployeeEntry}`,[fromSiteId]),
          pool.query("SELECT id,code,name FROM hr_records WHERE kind='employees' AND status IN ('ACTIVE','APPROVED') AND data->>'siteId'=$1",[fromSiteId])]);
        employees=siteEmployees(reg.rows,joined.rows);
      }
      return {employees,designations:designationList(master,register),fromManagers:await managersOf(params.get('fromSiteId')),toManagers:await managersOf(params.get('toSiteId'))};
    },
  };
}
