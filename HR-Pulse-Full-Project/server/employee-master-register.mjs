import { randomUUID } from 'node:crypto';
import { grantedMenus } from './modules.mjs';
import { siteIds } from './scope.mjs';

const kind = 'employeeMasterRegister';
const pageSize = 50;
// The Dudhichua East workbook's SOFTWARE DATA sheet contains unused formula
// rows with zeroes in the employee fields. Keep the source rows for traceability.
const isEmployeeEntry = `NOT (
  site_code='NCL-DUDE' AND name='0'
  AND COALESCE(data->>'employeeId','')=''
  AND COALESCE(data->>'department','')='0'
  AND COALESCE(data->>'designation','')='0'
  AND COALESCE(data->>'contact','')='0'
  AND COALESCE(jsonb_array_length(data->'sources'),0)=1
  AND COALESCE(data->'sources'->0->>'label','') ~ '^DUDHICHUA EAST OB / SOFTWARE DATA / row (121[2-9]|12[2-7][0-9]|128[0-2])$'
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
      const [count, listing, sites] = await Promise.all([
        pool.query(`SELECT count(*) AS total FROM hr_employee_master_register WHERE ${filter}`, values),
        pool.query(`SELECT id, site_name, site_code, data-'sources' AS data FROM hr_employee_master_register
          WHERE ${filter} ORDER BY lower(name),id LIMIT ${pageSize} OFFSET $4`, [...values,(page-1)*pageSize]),
        pool.query(`SELECT DISTINCT site_code AS code, site_name AS label FROM hr_employee_master_register
          WHERE ($1::uuid[] IS NULL OR site_id=ANY($1)) AND ${isEmployeeEntry} ORDER BY label`, [scope]),
      ]);
      const rows = listing.rows.map(row=>({id:row.id,...row.data,site:row.site_name,region:row.site_code.split('-')[0]}));
      return {rows, total:Number(count.rows[0].total), page, pageSize, sites:sites.rows, canImport:scope===null};
    },
    async employeeMasterRegisterDetails(profile, id) {
      const scope = await access(pool, profile);
      const result = await pool.query(`SELECT name,data->'sources' AS sources FROM hr_employee_master_register
        WHERE id=$1 AND ($2::uuid[] IS NULL OR site_id=ANY($2)) AND ${isEmployeeEntry}`, [id,scope]);
      if (!result.rowCount) throw fail('Employee entry not found.', 404);
      const entry = result.rows[0];
      return {...entry,sources:entry.sources.map(source=>({
        ...source,
        fields:source.fields.map(([label,value])=>[
          label,employeeIdLabels.has(label.toUpperCase().replace(/[^A-Z]/g,'')) ? normalizeEmployeeId(value) : value,
        ]),
      }))};
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
