// Working Hours from the sites' hour-wise Excel (owner, 28 Nov 2026: "from the excel sheet take working hours ...
// update the working hours as per employee id; apart from this don't change anything or remove from the master").
//
// The workbook has one sheet per site and every site lays its sheet out differently, so the columns are found by
// what is in them, not by their headings: the Employee ID column is the one full of CMPL / CMLL numbers, the hours
// column the one full of "8 hrs" / "12 HRS" / "8 Hrs Day & Night". Only the Employee ID, the name and the hours are
// read; nothing else of the sheet leaves the browser.
//
// The update writes Working Hours and nothing else: no line is added, removed or moved, and no other field of a
// line is touched. A row is held (nothing changes for it) when its Employee ID is not in Employee Master, is on two
// lines, or the file gives the same ID two different hours.
// It goes by Employee ID only (owner, 28 Nov 2026: "Yes, go by ID"). The first version also held a row whose name
// was not the name on that ID, and held 141 people whose names the sites merely spell differently (AJAYA SAHU /
// AJAY SAHU, HEERA LAL KOL / HEERALAL KOL). A name that differs is now listed for information and still updated.
import {employeeNumber,samePerson} from './employee-number.mjs';
import {WORKING_HOURS_FIELD,allowedText,loadWorkingHours,normalizeWorkingHours,workingHoursNumber} from './working-hours.mjs';
export {readWorkingHoursSheets} from './working-hours-sheet.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';
import {grantedMenus} from './modules.mjs';
import {siteIds} from './scope.mjs';

export const WORKING_HOURS_IMPORT_LIMIT = 15000;
const LIST_LIMIT = 300;
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const text = value => value === null || value === undefined ? '' : String(value).trim();
function parseRows(rows, allowed) {
  if (!Array.isArray(rows) || !rows.length || rows.length > WORKING_HOURS_IMPORT_LIMIT) throw fail(`Send 1 to ${WORKING_HOURS_IMPORT_LIMIT.toLocaleString('en-IN')} working hours rows at a time.`);
  return rows.map((row,index)=>{
    const employeeId = text(row?.employeeId), number = employeeNumber(employeeId), hours = normalizeWorkingHours(row?.hours, allowed);
    const clean = (value,max) => { const result = text(value); if (result.length>max || result.includes('\0')) throw fail(`Working Hours row ${index+1}: invalid value.`); return result; };
    if (!number) throw fail(`Working Hours row ${index+1}: enter a valid Employee ID.`);
    if (!hours) throw fail(`Working Hours row ${index+1}: hours must be ${allowedText(allowed)} (Working Hour Master).`);
    return {employeeId:clean(employeeId,40),number,hours,name:clean(row?.name,300),sheet:clean(row?.sheet,120),row:Number.isInteger(row?.row)?row.row:index+1};
  });
}

async function access(db, profile) {
  const menus = grantedMenus(profile);
  if (!menus.has('Master Configuration') || !menus.has('Employee Master')) throw fail('Master Configuration and Employee Master access are required.', 403);
  return siteIds(db, profile);
}

export function createWorkingHoursImport(pool) {
  return {
    // apply=false only reports what would change. apply=true writes Working Hours of the matched people, all or none.
    async importEmployeeWorkingHours(profile, input) {
      const scope = await access(pool, profile), apply = input?.apply === true, rows = parseRows(input?.rows, await loadWorkingHours(pool));
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const lock = apply ? ' FOR UPDATE' : '';
        const register = (await db.query(`SELECT id,name,site_name AS site,data->>'employeeId' AS employee_id,COALESCE(data->>'workingHours','') AS hours
          FROM hr_employee_master_register WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND ${isEmployeeEntry}${lock}`,[scope])).rows;
        const joined = (await db.query(`SELECT e.id,e.name,e.code AS employee_id,COALESCE(e.data->'officeData'->>$2,'') AS hours
          FROM hr_records e WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED','INACTIVE')
          AND ($1::text[] IS NULL OR e.data->>'siteId'=ANY($1::text[]))${lock}`,[scope?scope.map(String):null,WORKING_HOURS_FIELD])).rows;
        const index = list => { const map = new Map(); for (const line of list) { const number = employeeNumber(line.employee_id); if (number) (map.get(number) || map.set(number,[]).get(number)).push(line); } return map; };
        const registerBy = index(register), joinedBy = index(joined);

        // One answer per person in the file: the same hours twice is one row, two different hours is held.
        const byNumber = new Map();
        for (const row of rows) (byNumber.get(row.number) || byNumber.set(row.number,[]).get(row.number)).push(row);
        const held = {notFound:[],twoLines:[],twoHours:[]};
        const nameDiffers = [];
        const registerWrites = [], joinedWrites = [];
        let people = 0, updated = 0, same = 0;
        const line = (row,detail) => ({employeeId:row.employeeId,name:row.name,sheet:row.sheet,row:row.row,hours:row.hours,detail});
        for (const [number,list] of byNumber) {
          people++;
          const row = list[0];
          if (new Set(list.map(item=>item.hours)).size > 1) { held.twoHours.push(line(row,list.map(item=>`${item.sheet||'row'} ${item.row}: ${item.hours}`).join(' / '))); continue; }
          const inRegister = registerBy.get(number) || [], inJoined = joinedBy.get(number) || [];
          if (!inRegister.length && !inJoined.length) { held.notFound.push(line(row,'')); continue; }
          if (inRegister.length > 1 || inJoined.length > 1) { held.twoLines.push(line(row,[...inRegister,...inJoined].map(item=>`${item.name}${item.site?', '+item.site:''}`).join(' / '))); continue; }
          const targets = [...inRegister,...inJoined];
          const other = row.name && targets.find(target=>text(target.name) && !samePerson(target.name,row.name));
          if (other) nameDiffers.push(line(row,`Employee Master: ${other.name}`));
          let changed = false;
          for (const target of inRegister) if (workingHoursNumber(target.hours) !== workingHoursNumber(row.hours)) { registerWrites.push({id:target.id,hours:row.hours}); changed = true; }
          for (const target of inJoined) if (workingHoursNumber(target.hours) !== workingHoursNumber(row.hours)) { joinedWrites.push({id:target.id,hours:row.hours}); changed = true; }
          if (changed) updated++; else same++;
        }
        if (apply) {
          for (let offset = 0; offset < registerWrites.length; offset += 1000) {
            await db.query(`UPDATE hr_employee_master_register r SET data=r.data||jsonb_build_object('workingHours',e.hours),version=r.version+1
              FROM jsonb_to_recordset($1::jsonb) AS e(id uuid,hours text) WHERE r.id=e.id`,[JSON.stringify(registerWrites.slice(offset,offset+1000))]);
          }
          for (let offset = 0; offset < joinedWrites.length; offset += 1000) {
            await db.query(`UPDATE hr_records r SET data=jsonb_set(
                CASE WHEN jsonb_typeof(r.data->'officeData')='object' THEN r.data ELSE jsonb_set(r.data,'{officeData}','{}'::jsonb) END,
                ARRAY['officeData',$2::text],to_jsonb(e.hours)),version=r.version+1,updated_by=$3,updated_at=now()
              FROM jsonb_to_recordset($1::jsonb) AS e(id uuid,hours text) WHERE r.id=e.id AND r.kind='employees'`,
              [JSON.stringify(joinedWrites.slice(offset,offset+1000)),WORKING_HOURS_FIELD,profile.actor]);
          }
          if (registerWrites.length || joinedWrites.length) {
            await db.query("INSERT INTO hr_audit (actor,action,kind,detail) VALUES ($1,'WORKING_HOURS_IMPORT','employeeMasterRegister',$2)",
              [profile.actor,{fields:['workingHours'],people:updated,registerLines:registerWrites.length,joinedEmployees:joinedWrites.length,
                same,notFound:held.notFound.length,twoLines:held.twoLines.length,twoHours:held.twoHours.length,nameDiffers:nameDiffers.length}]);
          }
          await db.query('COMMIT');
        } else await db.query('ROLLBACK');
        const counts = Object.fromEntries(Object.entries(held).map(([key,list])=>[key,list.length]));
        return {applied:apply,rows:rows.length,people,updated,same,registerLines:registerWrites.length,joinedEmployees:joinedWrites.length,
          held:counts,lists:Object.fromEntries(Object.entries(held).map(([key,list])=>[key,list.slice(0,LIST_LIMIT)])),
          nameDiffers:nameDiffers.length,nameDiffersList:nameDiffers.slice(0,LIST_LIMIT),listLimit:LIST_LIMIT};
      } catch (error) {
        await db.query('ROLLBACK').catch(()=>{});
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
