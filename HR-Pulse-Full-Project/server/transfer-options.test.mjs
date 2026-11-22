import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {siteManagers,designationList,createTransferOptions} from './transfer-options.mjs';

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
