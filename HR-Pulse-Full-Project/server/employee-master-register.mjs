import { randomUUID } from 'node:crypto';
import { grantedMenus } from './modules.mjs';
import { siteIds } from './scope.mjs';
import {employeeNumber,typedIdProblem,numberHolders,holderLine,samePerson} from './employee-number.mjs';
import {normalizeWorkingHours,workingHoursProblem} from './working-hours.mjs';

const kind = 'employeeMasterRegister';
const pageSize = 50;
// Keep the imported source rows while hiding unused formulas and entries
// sourced solely from workbook tabs excluded from the register.
export const isEmployeeEntry = `NOT (
  site_code='NCL-DUDE' AND name='0'
  AND COALESCE(data->>'employeeId','')=''
  AND COALESCE(data->>'department','')='0'
  AND COALESCE(data->>'designation','')='0'
  AND COALESCE(data->>'contact','')='0'
  AND COALESCE(jsonb_array_length(data->'sources'),0)=1
  AND COALESCE(data->'sources'->0->>'label','') ~ '^DUDHICHUA EAST OB / SOFTWARE DATA / row (121[2-9]|12[2-7][0-9]|128[0-2])$'
) AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(data->'sources') AS source
  HAVING bool_and(COALESCE(source->>'label','') ~ '^DUDHICHUA EAST OB / (LEFT EMPLOYEE|NOC DATA|Sheet6 [(]2[)]) / row [0-9]+$')
) AND NOT (
  site_code='WCL-GAURI' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(data->'sources') AS source
    HAVING bool_and(COALESCE(source->>'label','') ~ '^GOURI POUNI OB 2ND / Joining Form / row [0-9]+$')
  )
)`;
const siteNames = {
  'NCL-DUDE': 'Dudhichua OB East',
  'NCL-DUDW': 'Dudhichua OB West',
  'NCL-JAYANT': 'Jayant OB',
  'WCL-DHOPTALA': 'Dhoptala OB 2nd',
  'WCL-GAURI': 'Gauri Pauni OB 2nd',
  'WCL-MAJRI': 'Majri OB',
  'WCL-SASTI': 'Sasti OB',
};
const fields = ['employeeId','name','department','designation','category','reportingTo','contact','email','status'];
// Why a line is removed (owner, 23 Nov 2026: an employee is deleted only in HR Pulse). A person who has left is not
// removed: the status is set to LEFT with the leaving date, so the history stays.
export const REMOVE_REASONS = Object.freeze(['Duplicate line','Wrong entry','Not our employee']);
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const normalizeEmployeeId = value => value.replace(/^CMPL/i,'CMLL');
const employeeIdLabels = new Set(['EMPLOYEECODE','EMPLOYEEID','EMPID']);
const bankField = label => {
  const key=String(label??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (['AFORMNO','AFORMNUMBER','FORMANO','FORMANUMBER'].includes(key)) return 'aFormNo';
  if (['BANKNAME','NAMEOFBANK'].includes(key)) return 'bankName';
  if (['IFSC','IFSCCODE'].includes(key)) return 'ifscCode';
  if (['ACCOUNTNO','ACCOUNTNUMBER','ACNO','ACNUMBER','BANKACNO','BANKACCOUNTNO','BANKACCOUNTNUMBER'].includes(key)) return 'accountNo';
  if (['BRANCH','BRANCHNAME','BANKBRANCH'].includes(key)) return 'branch';
  return '';
};
/** Values used by the separate Bank Details report. */
export function reportBankDetails(data={}) {
  const result={aFormNo:String(data.aFormNo??''),bankName:String(data.bankName??''),ifscCode:String(data.ifscCode??''),accountNo:String(data.accountNo??''),branch:String(data.branch??'')};
  for (const source of Array.isArray(data.sources)?data.sources:[]) for (const pair of Array.isArray(source?.fields)?source.fields:[]) {
    if (!Array.isArray(pair)||pair.length<2) continue;
    const key=bankField(pair[0]),value=String(pair[1]??'').trim();
    if (key&&value&&!result[key]) result[key]=value;
  }
  return result;
}

function parseBankRows(rows) {
  if (!Array.isArray(rows)||!rows.length||rows.length>10000) throw fail('Import 1–10,000 bank detail rows at a time.');
  const seen=new Set();
  return rows.map((row,index)=>{
    const employeeId=String(row?.employeeId??'').trim(),number=employeeNumber(employeeId);
    if (!number) throw fail(`Bank Details row ${index+2}: enter a valid Employee ID.`);
    if (seen.has(number)) throw fail(`Bank Details row ${index+2}: Employee ID ${employeeId} appears more than once.`);
    seen.add(number);
    const clean=(key,max)=>{const value=String(row?.[key]??'').trim();if(value.length>max||value.includes('\0'))throw fail(`Bank Details row ${index+2}: invalid ${key}.`);return value;};
    const aFormNo=clean('aFormNo',100),bankName=clean('bankName',200),ifscCode=clean('ifscCode',11).toUpperCase(),accountNo=clean('accountNo',30),branch=clean('branch',200),name=clean('name',300);
    if(ifscCode&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode))throw fail(`Bank Details row ${index+2}: IFSC Code must contain 11 valid characters.`);
    if(accountNo&&!/^[0-9]{1,30}$/.test(accountNo))throw fail(`Bank Details row ${index+2}: Account No must contain digits only.`);
    return {row:index+2,employeeId,number,aFormNo,name,bankName,ifscCode,accountNo,branch};
  });
}

async function access(db, profile) {
  const menus = grantedMenus(profile);
  if (!menus.has('Master Configuration') || !menus.has('Employee Master')) {
    throw fail('Master Configuration and Employee Master access are required.', 403);
  }
  return siteIds(db, profile);
}

async function availableSites(db, scope) {
  const result = await db.query(`SELECT id,code FROM hr_records WHERE kind='sites' AND status='ACTIVE'
    AND code=ANY($1) AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY code`, [Object.keys(siteNames),scope]);
  return result.rows;
}

function parseChanges(input) {
  if (!Number.isInteger(input.version) || input.version < 1 || !input.changes ||
      typeof input.changes !== 'object' || Array.isArray(input.changes)) throw fail('Invalid employee changes.');
  const changes = {};
  for (const [key,value] of Object.entries(input.changes)) {
    if ((!fields.includes(key) && key!=='siteCode' && key!=='leavingDate' && key!=='workingHours') || typeof value!=='string' || value.length>1000 || value.includes('\0')) {
      throw fail('Invalid employee field or value.');
    }
    changes[key] = key==='employeeId' ? normalizeEmployeeId(value.trim()) : value.trim();
  }
  if (!Object.keys(changes).length) throw fail('Make a change before saving.');
  if (changes.name==='') throw fail('Name is required.');
  if (changes.siteCode!==undefined && !Object.hasOwn(siteNames,changes.siteCode)) throw fail('Select a valid site.');
  if (changes.leavingDate && !isDate(changes.leavingDate)) throw fail('Leaving date must be a date.');
  // Working Hours of a register line (owner, 28 Nov 2026): 8, 9, 10, 11 or 12 hours, or blank.
  if (changes.workingHours!==undefined) { if (workingHoursProblem(changes.workingHours)) throw fail(workingHoursProblem(changes.workingHours)); changes.workingHours = normalizeWorkingHours(changes.workingHours); }
  return changes;
}

function parseRow(row, index) {
  const invalid = () => fail(`Invalid employee import data at row ${index + 1}.`);
  if (!row || typeof row !== 'object' || !/^[a-f0-9]{64}$/.test(row.key) ||
      !Object.hasOwn(siteNames, row.siteCode) || typeof row.name !== 'string' || !row.name.trim()) {
    throw invalid();
  }
  const data = {};
  for (const field of fields) {
    if (typeof row[field] !== 'string' || row[field].length > 1000) throw invalid();
    data[field] = field==='employeeId' ? normalizeEmployeeId(row[field]) : row[field];
  }
  if (!Array.isArray(row.sources) || !row.sources.length || row.sources.length > 30) throw invalid();
  data.sources = row.sources.map(source => {
    if (!source || typeof source.label !== 'string' || source.label.length > 300 ||
        !Array.isArray(source.fields) || source.fields.length > 140) throw invalid();
    if (source.fields.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
        typeof pair[0] !== 'string' || pair[0].length > 200 ||
        typeof pair[1] !== 'string' || pair[1].length > 6000)) throw invalid();
    return {label:source.label, fields:source.fields};
  });
  return {key:row.key, siteCode:row.siteCode, data};
}

// Employee Master lists every employee (owner, 28 Nov 2026: a new employee went to "existing employee", not to
// Employee Master). The imported lines stay as they are; an employee who joined through HR Pulse (the joining form:
// Active, Approved or Inactive) is listed with them, read from the joining record, never copied. One line per
// employee number: a joined employee whose number an imported line already holds is that line.
// The number is read as employeeNumber() does (CMPL123 = CMLL123 = 123), written out here so that the page does not
// depend on the database function of the change list.
const numberSql = value => `(CASE WHEN regexp_replace(upper(coalesce(${value},'')),'[[:space:]/-]','','g') ~ '^(CMPL|CMLL)?[0-9]{1,9}$'
  THEN ltrim(regexp_replace(regexp_replace(upper(coalesce(${value},'')),'[[:space:]/-]','','g'),'^(CMPL|CMLL)',''),'0') ELSE '' END)`;
const office = key => `e.data->'officeData'->>'${key}'`;
const joinedData = `jsonb_build_object(
  'employeeId',e.code,'name',e.name,
  'department',COALESCE(dep.name,${office('Department *')},${office('Department')},''),
  'designation',COALESCE(NULLIF(e.data->>'designationTitle',''),des.name,${office('Designation *')},''),
  'category',COALESCE(NULLIF(${office('Employee Category')},''),e.data->>'category',''),
  'reportingTo',COALESCE(NULLIF(e.data->>'reportingManagerName',''),${office('Reporting To')},''),
  'contact',COALESCE(NULLIF(${office('Mobile *')},''),e.data->>'mobile',''),
  'email',COALESCE(NULLIF(${office('Candidate E-mail *')},''),e.data->>'email',''),
  'status',CASE WHEN e.status='INACTIVE' THEN 'LEFT' ELSE 'ACTIVE' END,
  'leavingDate',COALESCE(e.data->>'leavingDate',''),
  'workingHours',COALESCE(${office('Working Hours *')},''),
  'aFormNo',COALESCE(${office('A-Form No.')},''),'bankName',COALESCE(${office('Bank Name')},''),'ifscCode',COALESCE(${office('IFSC Code')},''),
  'accountNo',COALESCE(NULLIF(${office('New Account No')},''),${office('Bank Account No')},''),'branch',COALESCE(${office('Branch Name')},''))`;
const joinedFrom = `FROM hr_records e
  LEFT JOIN hr_records s ON s.kind='sites' AND s.id::text=e.data->>'siteId'
  LEFT JOIN hr_records dep ON dep.kind='departments' AND dep.id::text=e.data->>'departmentId'
  LEFT JOIN hr_records des ON des.kind='designations' AND des.id::text=e.data->>'designationId'
  WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED','INACTIVE')`;
// The numbers the imported lines hold, read once, so that the joined employees are set against them in one pass.
const heldNumbers = `held AS MATERIALIZED (SELECT DISTINCT n FROM (
    SELECT ${numberSql("data->>'employeeId'")} AS n FROM hr_employee_master_register WHERE ${isEmployeeEntry}) numbers WHERE n<>'')`;
const notOnRegister = `NOT EXISTS (SELECT 1 FROM held WHERE held.n=${numberSql('e.code')})`;
export const registerLines = withJoined => `WITH ${withJoined?heldNumbers+', ':''}lines AS (
  SELECT id,site_id,site_name,site_code,name,data,'register' AS source FROM hr_employee_master_register WHERE ${isEmployeeEntry}${withJoined?`
  UNION ALL
  SELECT e.id,s.id,COALESCE(s.name,''),COALESCE(s.code,''),e.name,${joinedData},'joining' ${joinedFrom} AND ${notOnRegister}`:''})`;

export function createEmployeeMasterRegister(pool) {
  return {
    async employeeMasterRegister(profile, params) {
      const scope = await access(pool, profile);
      const page = Math.max(1, Math.min(10000, parseInt(params.get('page') || '1', 10) || 1));
      const search = (params.get('search') || '').trim().slice(0, 150);
      const site = params.get('site') || '';
      const values = [scope, site, search];
      // joined=0: the imported lines only. The register's own Excel import asks this way, to see what it already holds.
      const lines = registerLines(params.get('joined') !== '0');
      const filter = `($1::uuid[] IS NULL OR site_id=ANY($1))
        AND ($2='' OR site_code=$2)
        AND ($3='' OR strpos(lower(concat_ws(' ',name,data->>'employeeId',data->>'department',data->>'designation')),lower($3))>0)`;
      const selectRows = `${lines} SELECT id, site_name, site_code, data, source FROM lines
        WHERE ${filter} ORDER BY lower(name),id`;
      const siteLabel = row => row.source==='joining' ? siteNames[row.site_code] || row.site_name : row.site_name;
      const formatRows = ({rows}) => rows.map(row=>{
        const {sources:_,...data}=row.data||{};
        return {id:row.id,...data,...reportBankDetails(row.data),site:siteLabel(row),region:String(row.site_code||'').split('-')[0],
          ...(row.source==='joining'?{source:'joining'}:{})};
      });
      if (params.get('export') === '1') {
        return {complete:true,rows:formatRows(await pool.query(selectRows,values))};
      }
      const [count, listing, sites] = await Promise.all([
        pool.query(`${lines} SELECT count(*) AS total FROM lines WHERE ${filter}`, values),
        pool.query(`${selectRows} LIMIT ${pageSize} OFFSET $4`, [...values,(page-1)*pageSize]),
        pool.query(`${lines} SELECT DISTINCT site_code, site_name, source FROM lines
          WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND site_code<>''`, [scope]),
      ]);
      // One entry per site: the register's own name of a site first, then a site only joined employees are at.
      const siteList = new Map();
      for (const row of [...sites.rows].sort((a,b)=>String(b.source).localeCompare(String(a.source)))) {
        if (!siteList.has(row.site_code)) siteList.set(row.site_code,{code:row.site_code,label:siteLabel(row)});
      }
      return {rows:formatRows(listing), total:Number(count.rows[0].total), page, pageSize,
        sites:[...siteList.values()].sort((a,b)=>String(a.label).localeCompare(String(b.label))), canImport:scope===null};
    },
    async employeeMasterRegisterDetails(profile, id, edit=false) {
      const scope = await access(pool, profile);
      const projection = edit ? "name,version,site_code AS \"siteCode\",data-'sources' AS fields" : "name,data->'sources' AS sources, data-'sources' AS fields";
      const result = await pool.query(`SELECT ${projection} FROM hr_employee_master_register
        WHERE id=$1 AND ($2::uuid[] IS NULL OR site_id=ANY($2)) AND ${isEmployeeEntry}`, [id,scope]);
      if (!result.rowCount) {
        // An employee who joined through HR Pulse is listed here from the joining record: the work details are shown,
        // and the record is edited where it is kept (Corporate / HO or OB / COAL › Update Existing Employee).
        const joined = await pool.query(`SELECT e.name,${joinedData} AS fields ${joinedFrom} AND e.id=$1
          AND ($2::uuid[] IS NULL OR s.id=ANY($2))`, [id,scope]);
        if (!joined.rowCount) throw fail('Employee entry not found.', 404);
        if (edit) throw fail('This employee joined through HR Pulse. Edit the details under Corporate / HO or OB / COAL › Update Existing Employee.', 409);
        const {aFormNo:_a,bankName:_b,ifscCode:_i,accountNo:_n,branch:_r,...fields} = joined.rows[0].fields;
        return {name:joined.rows[0].name,fields,sources:[],source:'joining'};
      }
      const entry = result.rows[0];
      if (edit) {
        const sites = (await availableSites(pool,scope)).map(({code})=>({code,label:siteNames[code]}));
        // Removing a line is for a login with every HR site (head office), like the Excel import.
        return {...entry,sites,canRemove:scope===null};
      }
      return {name:entry.name,fields:entry.fields,sources:entry.sources.map(source=>({
        ...source,
        fields:source.fields.map(([label,value])=>[
          label,employeeIdLabels.has(label.toUpperCase().replace(/[^A-Z]/g,'')) ? normalizeEmployeeId(value) : value,
        ]),
      }))};
    },
    async updateEmployeeMasterRegister(profile, id, input) {
      const scope = await access(pool, profile);
      const {siteCode,...changes} = parseChanges(input);
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const result = await db.query(`SELECT version,site_id,site_code,site_name,name,data->>'employeeId' AS employee_id FROM hr_employee_master_register
          WHERE id=$1 AND ($2::uuid[] IS NULL OR site_id=ANY($2)) AND ${isEmployeeEntry} FOR UPDATE`, [id,scope]);
        const entry = result.rows[0];
        if (!entry) throw fail('Employee entry not found.',404);
        if (entry.version!==input.version) throw fail('This entry changed while you were editing. Close and reopen it before saving.',409);
        // One number on one line (employee-number.mjs). Only a changed ID is checked, so a line that already shares its
        // number can still be opened and corrected.
        if (changes.employeeId!==undefined && changes.employeeId!==(entry.employee_id||'')) {
          const typed = typedIdProblem(changes.employeeId);
          if (typed) throw fail(typed);
          const number = employeeNumber(changes.employeeId);
          const holders = number ? await numberHolders(db,number,{registerFilter:isEmployeeEntry,exceptRegisterId:id}) : [];
          const other = holders.find(holder=>holder.where==='Employee Master') || holders.find(holder=>!samePerson(holder.name,changes.name ?? entry.name));
          if (other) throw fail(changes.employeeId+' is already held by '+holderLine(other)+'. One number can be on one line only.',409);
        }
        const moving = siteCode!==undefined && siteCode!==entry.site_code;
        if (!moving && !Object.keys(changes).length) throw fail('Make a change before saving.');
        const destination = moving ? (await availableSites(db,scope)).find(site=>site.code===siteCode) : undefined;
        if (moving && !destination) throw fail('The selected site is outside your access or is inactive.',403);
        const site = destination ? {id:destination.id,code:destination.code,name:siteNames[destination.code]} :
          {id:entry.site_id,code:entry.site_code,name:entry.site_name};
        await db.query(`UPDATE hr_employee_master_register
          SET data=data || $2::jsonb, name=COALESCE($2::jsonb->>'name',name),
            site_id=$3,site_code=$4,site_name=$5,version=version+1 WHERE id=$1`,
          [id,JSON.stringify(changes),site.id,site.code,site.name]);
        const editedFields = Object.keys(changes);
        if (moving) editedFields.push('siteCode');
        await db.query("INSERT INTO hr_audit (actor,action,kind,record_id,detail) VALUES ($1,'UPDATE',$2,$3,$4)",
          [profile.actor,kind,id,{fields:editedFields}]);
        await db.query('COMMIT');
        return {saved:true};
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
    // Removes a line that should not be in Employee Master. The whole line is kept in the audit, so it can be put
    // back by hand. Pulse-II sees the removal within a minute: the person is no longer matched on new cards there.
    async removeEmployeeMasterRegister(profile, id, input) {
      if (await access(pool, profile) !== null) throw fail('Removing a line requires access to all HR sites.', 403);
      if (!input || !Number.isInteger(input.version) || input.version < 1) throw fail('Invalid request.');
      if (!REMOVE_REASONS.includes(input.reason)) throw fail('Choose why this line is removed.');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const entry = (await db.query(`SELECT version,name,site_code,site_name,data-'sources' AS data FROM hr_employee_master_register
          WHERE id=$1 AND ${isEmployeeEntry} FOR UPDATE`, [id])).rows[0];
        if (!entry) throw fail('Employee entry not found.',404);
        if (entry.version!==input.version) throw fail('This entry changed while you were looking at it. Close and reopen it.',409);
        const moving = await db.query("SELECT 1 FROM hr_records WHERE kind='employeeTransfers' AND data->>'registerId'=$1 AND status IN ('DRAFT','PENDING') LIMIT 1", [id]);
        if (moving.rowCount) throw fail('A transfer of this employee is in progress. Finish or cancel it first.',409);
        await db.query('DELETE FROM hr_employee_master_register WHERE id=$1', [id]);
        await db.query("INSERT INTO hr_audit (actor,action,kind,record_id,detail) VALUES ($1,'REMOVE',$2,$3,$4)",
          [profile.actor,kind,id,{reason:input.reason,name:entry.name,site:entry.site_name,siteCode:entry.site_code,line:entry.data}]);
        await db.query('COMMIT');
        return {removed:true};
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
    async deleteAllEmployeeMasterBankDetails(profile,input) {
      if (await access(pool,profile)!==null) throw fail('Deleting all employees requires access to all HR sites.',403);
      if (input?.confirmation!=='DELETE ALL') throw fail('Type DELETE ALL to confirm permanent deletion.');
      const db=await pool.connect();
      try{
        await db.query('BEGIN');
        const removed=await db.query(`DELETE FROM hr_employee_master_register WHERE ${isEmployeeEntry}`);
        await db.query("INSERT INTO hr_audit (actor,action,kind,detail) VALUES ($1,'REMOVE_ALL',$2,$3)",[profile.actor,kind,{removed:removed.rowCount,source:'Bank Details'}]);
        await db.query('COMMIT');
        return {removed:removed.rowCount};
      }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
    },
    async importEmployeeMasterRegister(profile, rows) {
      if (await access(pool, profile) !== null) throw fail('Import requires access to all HR sites.', 403);
      if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw fail('Import 1–10,000 employee entries at a time.');
      const entries = rows.map(parseRow);
      if (new Set(entries.map(row=>row.key)).size !== entries.length) throw fail('The import file contains duplicate entry keys.');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const codes = [...new Set(entries.map(row=>row.siteCode))];
        const sites = new Map((await db.query("SELECT id, code FROM hr_records WHERE kind='sites' AND code=ANY($1) AND status='ACTIVE'", [codes])).rows.map(site=>[site.code,site.id]));
        if (sites.size !== codes.length) throw fail('One or more import sites are missing from the HR site master.');
        // One number on one line (employee-number.mjs): a line whose number another line already holds, in the register
        // or earlier in this file, is not added. The same line imported again is simply "already imported".
        const present = new Map();
        for (const row of (await db.query("SELECT import_key,data->>'employeeId' AS id FROM hr_employee_master_register WHERE "+isEmployeeEntry)).rows || []) {
          const number = employeeNumber(row.id);
          if (number) (present.get(number) || present.set(number,new Set()).get(number)).add(row.import_key);
        }
        const kept = [], notAdded = [], inFile = new Set();
        for (const entry of entries) {
          const number = employeeNumber(entry.data.employeeId), keys = number && present.get(number);
          if (number && ((keys && !keys.has(entry.key)) || inFile.has(number))) {
            notAdded.push({employeeId:entry.data.employeeId,name:entry.data.name,site:siteNames[entry.siteCode]});
            continue;
          }
          if (number) inFile.add(number);
          kept.push(entry);
        }
        let inserted = 0;
        for (let offset = 0; offset < kept.length; offset += 500) {
          const batch = kept.slice(offset, offset+500).map(({key,siteCode,data})=>({
            id:randomUUID(),import_key:key,name:data.name,site_id:sites.get(siteCode),site_code:siteCode,site_name:siteNames[siteCode],data,
          }));
          const result = await db.query(`
            INSERT INTO hr_employee_master_register (id,import_key,site_id,site_code,site_name,name,data,created_by)
            SELECT entry.id,entry.import_key,entry.site_id,entry.site_code,entry.site_name,entry.name,entry.data,$1
            FROM jsonb_to_recordset($2::jsonb) AS entry(id uuid,import_key text,site_id uuid,site_code text,site_name text,name text,data jsonb)
            ON CONFLICT (import_key) DO NOTHING`, [profile.actor,JSON.stringify(batch)]);
          inserted += result.rowCount;
        }
        if (inserted) {
          await db.query("INSERT INTO hr_audit (actor,action,kind,detail) VALUES ($1,'IMPORT',$2,$3)", [profile.actor,kind,{inserted}]);
        }
        await db.query('COMMIT');
        return {inserted,alreadyImported:kept.length-inserted,numberOnAnotherLine:notAdded.length,notAdded:notAdded.slice(0,200)};
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
    async importEmployeeBankDetails(profile, rows) {
      const scope=await access(pool,profile),entries=parseBankRows(rows),db=await pool.connect();
      try{
        await db.query('BEGIN');
        const available=(await db.query(`SELECT id,name,data->>'employeeId' AS employee_id FROM hr_employee_master_register
          WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND ${isEmployeeEntry} FOR UPDATE`,[scope])).rows;
        const byNumber=new Map();
        for(const employee of available){const number=employeeNumber(employee.employee_id);if(number){const list=byNumber.get(number)||[];list.push(employee);byNumber.set(number,list);}}
        for(const entry of entries){
          const matches=byNumber.get(entry.number)||[];
          if(!matches.length)throw fail(`Bank Details row ${entry.row}: Employee ID ${entry.employeeId} was not found in Employee Master.`,409);
          if(matches.length>1)throw fail(`Bank Details row ${entry.row}: Employee ID ${entry.employeeId} matches more than one Employee Master line.`,409);
          const employee=matches[0];
          if(entry.name&&!samePerson(employee.name,entry.name))throw fail(`Bank Details row ${entry.row}: Name does not match Employee ID ${entry.employeeId}.`,409);
          const bank={aFormNo:entry.aFormNo,bankName:entry.bankName,ifscCode:entry.ifscCode,accountNo:entry.accountNo,branch:entry.branch};
          await db.query('UPDATE hr_employee_master_register SET data=data||$2::jsonb,version=version+1 WHERE id=$1',[employee.id,JSON.stringify(bank)]);
          await db.query("INSERT INTO hr_audit (actor,action,kind,record_id,detail) VALUES ($1,'BANK_IMPORT',$2,$3,$4)",[profile.actor,kind,employee.id,{fields:Object.keys(bank)}]);
        }
        await db.query('COMMIT');return {updated:entries.length};
      }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
    },
  };
}
