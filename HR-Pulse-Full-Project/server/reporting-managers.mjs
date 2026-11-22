// Owner, 21 Nov 2026: the joining form's "Reporting To" is a dropdown of the
// Manager-and-above people (from the Employee Master register) in the
// department chosen on the form.

const words = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Form department -> extra words the imported register uses for it.
const departmentAliases = {
  'human resources': ['hr', 'h r', 'personnel'],
  'information technology': ['it', 'i t', 'software'],
  ehs: ['safety', 'environment', 'health safety'],
  'mining coal': ['mining', 'mines', 'coal'],
  maintenance: ['maint', 'mech maint', 'workshop'],
  mechanical: ['mech', 'workshop'],
  accounts: ['account', 'accounting'],
  hsd: ['diesel', 'fuel'],
  store: ['stores'],
  'rto insurance': ['rto', 'insurance'],
  administration: ['admin'],
  procurement: ['purchase'],
  management: ['management', 'directors'],
};

export function sameDepartment(formDepartment, registerDepartment) {
  const target = words(formDepartment), found = words(registerDepartment);
  if (!target || !found) return false;
  if (found === target || ` ${found} `.includes(` ${target} `) || ` ${target} `.includes(` ${found} `)) return true;
  return (departmentAliases[target] || []).some(alias => ` ${found} `.includes(` ${alias} `));
}

// Most specific first (DGM / AGM before GM); a designation is "Manager and above" when it matches one of these.
const ranks = [
  [/\b(chairman|cmd|md|managing director|director|ceo|coo|cfo|president)\b/, 1],
  [/\b(vp|vice president)\b/, 2],
  [/\b(deputy general manager|dy general manager|dgm)\b/, 4],
  [/\b(assistant general manager|asst general manager|agm)\b/, 5],
  [/\b(general manager|gm|sr gm)\b/, 3],
  [/\b(project manager|pm|(site|project|plant|mine) (in charge|incharge)|hod|head of department|department head)\b/, 6],
  [/\b(senior manager|sr manager|sr mgr)\b/, 7],
  [/\b(manager|mgr)\b/, 8],
];
// Assistant / Deputy Manager are below Manager.
const belowManager = /\b(assistant|asst|asstt|deputy|dy|junior|jr|trainee)\s+(manager|mgr)\b/;

export function managerRank(designation) {
  const text = words(String(designation || '').replace(/\./g, ''));
  if (!text) return 0;
  const rank = ranks.find(([pattern]) => pattern.test(text))?.[1] || 0;
  if (rank >= 7 && belowManager.test(text)) return 0;
  return rank;
}

const leftStatus = /\b(left|inactive|resign|resigned|exit|exited|terminated|absconding|dead|expired)\b/;

// Owner, 22 Nov 2026: once a site is chosen on the form, only that site's
// managers are listed (no other site's Site In-Charges, PMs or Managers).
export function sameSite(formSite, registerSite) {
  const target = words(formSite), found = words(registerSite);
  if (!target || !found) return false;
  return found === target || ` ${found} `.includes(` ${target} `) || ` ${target} `.includes(` ${found} `);
}

export function reportingManagers(rows, department, site = '') {
  const siteKey = words(site), seen = new Set();
  return rows
    .map(row => ({...row, rank: managerRank(row.designation)}))
    .filter(row => row.rank && row.name && sameDepartment(department, row.department) && !leftStatus.test(words(row.status)))
    .filter(row => !siteKey || sameSite(site, row.site))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(row => ({
      name: row.name.trim(), employeeId: row.employeeId || '', designation: (row.designation || '').trim(), site: row.site || '',
      label: `${row.name.trim()} – ${(row.designation || '').trim()}${row.site ? ` (${row.site})` : ''}`,
      value: `${row.name.trim()} – ${(row.designation || '').trim()}`,
    }))
    .filter(row => !seen.has(row.value.toLowerCase()) && seen.add(row.value.toLowerCase()));
}

export function createReportingManagers(pool) {
  return {
    async reportingManagers(profile, params) {
      const department = String(params.get('department') || '').trim().slice(0, 100);
      const site = String(params.get('site') || '').trim().slice(0, 100);
      if (!department) return {managers: []};
      // Names and designations of managers only, limited to the form's site once one is chosen.
      const result = await pool.query(`SELECT name, site_name AS site, data->>'employeeId' AS "employeeId",
        data->>'department' AS department, data->>'designation' AS designation, data->>'status' AS status
        FROM hr_employee_master_register
        WHERE COALESCE(data->>'designation','') <> '' AND COALESCE(data->>'department','') <> ''`);
      return {managers: reportingManagers(result.rows, department, site)};
    },
  };
}
