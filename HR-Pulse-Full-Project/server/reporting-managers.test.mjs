import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReportingManagers, managerRank, reportingManagers, sameDepartment} from './reporting-managers.mjs';

test('Manager and above: Manager, Sr Manager, AGM, DGM, GM, VP, PM, Directors; not Assistant / Deputy Manager or staff', () => {
  for (const designation of ['Manager', 'Sr. Manager', 'MECH. MANAGER', 'AGM', 'Deputy General Manager', 'G.M.', 'GM', 'VP (Mining)', 'Project Manager', 'Site In-Charge', 'Director', 'CMD', 'HOD'])
    assert.ok(managerRank(designation) > 0, designation);
  for (const designation of ['Assistant Manager', 'Asst. Manager', 'Dy. Manager', 'Supervisor', 'Engineer', 'Head Mechanic', 'Shift In-charge', 'Driver', ''])
    assert.equal(managerRank(designation), 0, designation);
  assert.ok(managerRank('Director') < managerRank('General Manager'));
  assert.ok(managerRank('General Manager') < managerRank('Manager'));
});

test('department matches the register by word, with common short names', () => {
  assert.ok(sameDepartment('Maintenance', 'MAINTENANCE'));
  assert.ok(sameDepartment('Maintenance', 'Maint.'));
  assert.ok(sameDepartment('Human Resources', 'HR'));
  assert.ok(sameDepartment('Information Technology', 'IT'));
  assert.ok(sameDepartment('Mining (Coal)', 'MINING'));
  assert.ok(!sameDepartment('Information Technology', 'Security'));
  assert.ok(!sameDepartment('Maintenance', 'Production'));
  assert.ok(!sameDepartment('Maintenance', ''));
});

test('lists only active managers of the department, form site first, then by rank', () => {
  const rows = [
    {name: 'Ravi', designation: 'Manager', department: 'Maintenance', site: 'Sasti OB', status: 'Active'},
    {name: 'Amit', designation: 'General Manager', department: 'MAINTENANCE', site: 'Sasti OB', status: ''},
    {name: 'Sunil', designation: 'Manager', department: 'Maintenance', site: 'Majri OB', status: 'Active'},
    {name: 'Old', designation: 'Manager', department: 'Maintenance', site: 'Majri OB', status: 'LEFT'},
    {name: 'Sup', designation: 'Supervisor', department: 'Maintenance', site: 'Majri OB', status: 'Active'},
    {name: 'Prod', designation: 'Manager', department: 'Production', site: 'Majri OB', status: 'Active'},
  ];
  const list = reportingManagers(rows, 'Maintenance', 'Majri OB');
  assert.deepEqual(list.map(row => row.name), ['Sunil', 'Amit', 'Ravi']);
  assert.equal(list[0].value, 'Sunil – Manager');
  assert.equal(list[0].label, 'Sunil – Manager (Majri OB)');
});

test('service returns nothing without a department and reads the register otherwise', async () => {
  let queries = 0;
  const service = createReportingManagers({query: async sql => {
    queries++;
    assert.match(sql, /hr_employee_master_register/);
    return {rows: [{name: 'Ravi', designation: 'Manager', department: 'Maintenance', site: 'Sasti OB', status: ''}]};
  }});
  assert.deepEqual(await service.reportingManagers({}, new URLSearchParams()), {managers: []});
  assert.equal(queries, 0);
  const {managers} = await service.reportingManagers({}, new URLSearchParams('department=Maintenance'));
  assert.equal(managers[0].value, 'Ravi – Manager');
});
