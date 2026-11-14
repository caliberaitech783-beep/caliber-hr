import { randomUUID } from 'node:crypto';
import { grantedMenus } from './modules.mjs';
import { siteIds } from './scope.mjs';

const kind = 'employeeMasterRegister';
const pageSize = 50;
// Keep the imported source rows while hiding unused formulas and entries
// sourced solely from workbook tabs excluded from the register.
const isEmployeeEntry = `NOT (
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
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const normalizeEmployeeId = value => value.replace(/^CMPL/i,'CMLL');
const employeeIdLabels = new Set(['EMPLOYEECODE','EMPLOYEEID','EMPID']);

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
    if ((!fields.includes(key) && key!=='siteCode') || typeof value!=='string' || value.length>1000 || value.includes('\0')) {
      throw fail('Invalid employee field or value.');
    }
    changes[key] = key==='employeeId' ? normalizeEmployeeId(value.trim()) : value.trim();
  }
  if (!Object.keys(changes).length) throw fail('Make a change before saving.');
  if (changes.name==='') throw fail('Name is required.');
  if (changes.siteCode!==undefined && !Object.hasOwn(siteNames,changes.siteCode)) throw fail('Select a valid site.');
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

export function createEmployeeMasterRegister(pool) {
  return {
    async employeeMasterRegister(profile, params) {
      const scope = await access(pool, profile);
      const page = Math.max(1, Math.min(10000, parseInt(params.get('page') || '1', 10) || 1));
      const search = (params.get('search') || '').trim().slice(0, 150);
      const site = params.get('site') || '';
      const values = [scope, site, search];
      const filter = `($1::uuid[] IS NULL OR site_id=ANY($1))
        AND ($2='' OR site_code=$2)
        AND ($3='' OR strpos(lower(concat_ws(' ',name,data->>'employeeId',data->>'department',data->>'designation')),lower($3))>0)
        AND ${isEmployeeEntry}`;
      const selectRows = `SELECT id, site_name, site_code, data-'sources' AS data FROM hr_employee_master_register
        WHERE ${filter} ORDER BY lower(name),id`;
      const formatRows = ({rows}) => rows.map(row=>({
        id:row.id,...row.data,site:row.site_name,region:row.site_code.split('-')[0],
      }));
      if (params.get('export') === '1') {
        return {complete:true,rows:formatRows(await pool.query(selectRows,values))};
      }
      const [count, listing, sites] = await Promise.all([
        pool.query(`SELECT count(*) AS total FROM hr_employee_master_register WHERE ${filter}`, values),
        pool.query(`${selectRows} LIMIT ${pageSize} OFFSET $4`, [...values,(page-1)*pageSize]),
        pool.query(`SELECT DISTINCT site_code AS code, site_name AS label FROM hr_employee_master_register
          WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND ${isEmployeeEntry} ORDER BY label`, [scope]),
      ]);
      return {rows:formatRows(listing), total:Number(count.rows[0].total), page, pageSize, sites:sites.rows, canImport:scope===null};
    },
    async employeeMasterRegisterDetails(profile, id, edit=false) {
      const scope = await access(pool, profile);
      const projection = edit ? "name,version,site_code AS \"siteCode\",data-'sources' AS fields" : "name,data->'sources' AS sources, data-'sources' AS fields";
      const result = await pool.query(`SELECT ${projection} FROM hr_employee_master_register
        WHERE id=$1 AND ($2::uuid[] IS NULL OR site_id=ANY($2)) AND ${isEmployeeEntry}`, [id,scope]);
      if (!result.rowCount) throw fail('Employee entry not found.', 404);
      const entry = result.rows[0];
      if (edit) {
        const sites = (await availableSites(pool,scope)).map(({code})=>({code,label:siteNames[code]}));
        return {...entry,sites};
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
        const result = await db.query(`SELECT version,site_id,site_code,site_name FROM hr_employee_master_register
          WHERE id=$1 AND ($2::uuid[] IS NULL OR site_id=ANY($2)) AND ${isEmployeeEntry} FOR UPDATE`, [id,scope]);
        const entry = result.rows[0];
        if (!entry) throw fail('Employee entry not found.',404);
        if (entry.version!==input.version) throw fail('This entry changed while you were editing. Close and reopen it before saving.',409);
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
        let inserted = 0;
        for (let offset = 0; offset < entries.length; offset += 500) {
          const batch = entries.slice(offset, offset+500).map(({key,siteCode,data})=>({
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
        return {inserted,alreadyImported:entries.length-inserted};
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
    },
  };
}
