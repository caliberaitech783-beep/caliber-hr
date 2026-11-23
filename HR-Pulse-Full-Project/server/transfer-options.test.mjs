import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {siteEmployees,siteManagers,designationList,createTransferOptions} from './transfer-options.mjs';

test('employees include IDs from both sources and prefer the joined record for duplicates', () => {
  const employees = siteEmployees([
    {id: 'r1', code: 'CMLL00440', name: 'Register duplicate'},
    {id: 'r2', code: 'CMLL00441', name: 'Register employee'},
    {id: 'r3', code: '', name: 'Missing ID'},
  ], [
    {id: 'h1', code: 'CMLL00440', name: 'Joined employee'},
  ]);
  assert.deepEqual(employees.map(({value,label}) => [value,label]), [
    ['h1','CMLL00440 · Joined employee'],
    ['reg:r2','CMLL00441 · Register employee'],
  ]);
});

// Owner, 23 Nov 2026: transfer form dropdowns.
test('managers list only Manager-and-above people still working, with employee ID', () => {
  const list = siteManagers([
    {employeeId: 'CMLL00099', name: 'P. Rao', designation: 'Project Manager', status: 'Active'},
    {employeeId: 'CMLL00100', name: 'A. Shah', designation: 'Assistant Manager', status: 'Active'},
    {employeeId: 'CMLL00101', name: 'K. Gone', designation: 'Manager', status: 'Left'},
    {employeeId: 'CMLL00102', name: 'D. Singh', designation: 'Director', status: ''},
    {employeeId: 'CMLL00103', name: 'M. Operator', designation: 'Operator', status: 'Active'},
  ]);
  assert.deepEqual(list.map(x => x.value), ['CMLL00102 · D. Singh', 'CMLL00099 · P. Rao']);
  assert.equal(list[1].label, 'CMLL00099 · P. Rao – Project Manager');
});

test('designations join the master and the register once each, sorted', () => {
  assert.deepEqual(designationList(['Supervisor', 'Operator'], ['operator', 'Dumper  Operator', '']), ['Dumper Operator', 'Operator', 'Supervisor']);
});

test('transfer options need Employee transfer access and only read the asked sites', async () => {
  const site = '00000000-0000-4000-8000-0000000000a1', seen = [];
  const pool = {async query(sql, args) {
    seen.push(args?.[0]);
    if (sql.includes('FROM hr_records')) return {rows: [{name: 'Supervisor'}]};
    if (sql.includes('DISTINCT')) return {rows: [{name: 'Operator'}]};
    return {rows: [{name: 'P. Rao', employeeId: 'CMLL00099', designation: 'Project Manager', status: 'Active'}]};
  }};
  const service = createTransferOptions(pool);
  await assert.rejects(service.transferOptions({permissions: {hrDesktopAccess: []}}, new URLSearchParams()), e => e.status === 403);
  const result = await service.transferOptions({permissions: {hrDesktopAccess: ['Employee Master']}}, new URLSearchParams({fromSiteId: site, toSiteId: 'not-a-uuid'}));
  assert.deepEqual(result.designations, ['Operator', 'Supervisor']);
  assert.equal(result.fromManagers[0].value, 'CMLL00099 · P. Rao');
  assert.deepEqual(result.toManagers, []);
  assert.ok(seen.includes(site));
});

test('the API serves the request preview and transfer options addresses', () => {
  const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
  assert.match(app, /'\/api\/request-preview':'requestPreview'/);
  assert.match(app, /'\/api\/transfer-options':'transferOptions'/);
});

// Owner, 23 Nov 2026: Jayant OB showed one employee: staff saved under another copy of the site (same code / name) must still be listed.
test('site staff are matched by site ID, code or name', async () => {
  const site = '00000000-0000-4000-8000-0000000000a1', calls = [];
  const pool = {async query(sql, args) {
    calls.push([sql, args]);
    if (sql.startsWith("SELECT code,name FROM hr_records WHERE kind='sites'")) return {rows: [{code: 'NCL-JAYANT', name: 'Jayant OB'}]};
    if (sql.includes('FROM hr_employee_master_register r WHERE') && sql.includes('r.id,r.name')) return {rows: [{id: 'r1', name: 'Staff One', code: 'CMLL00440', status: ''}, {id: 'r2', name: 'Staff Two', code: 'CMLL00441', status: ''}]};
    if (sql.includes('FROM hr_records e WHERE')) return {rows: [{id: 'h1', code: 'CMLL21124', name: 'Avinash Thakur'}]};
    return {rows: []};
  }};
  const result = await createTransferOptions(pool).transferOptions({permissions: {hrDesktopAccess: ['Employee Master']}}, new URLSearchParams({fromSiteId: site}));
  assert.equal(result.employees.length, 3);
  assert.deepEqual(result.staff, {register: 2, joined: 1, inScope: true});
  const staffQuery = calls.find(([sql]) => sql.includes('r.id,r.name'));
  assert.match(staffQuery[0], /r\.site_id::text=\$1 OR/);
  assert.deepEqual(staffQuery[1], [site, 'ncljayant', 'jayantob']);
});
