import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from './app.mjs';

async function withApi(query, check) {
  const server = createApi({ query });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('readiness checks database and allows only the HR frontend origin', async () => {
  let queries = 0;
  await withApi(async sql => { assert.equal(sql, 'SELECT 1'); queries++; }, async url => {
    const response = await fetch(`${url}/api/ready`, { headers: { Origin: 'https://hrpulse.cmll.in' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://hrpulse.cmll.in');
    assert.equal((await response.json()).database, 'connected');
    assert.equal(queries, 1);
    const blocked = await fetch(`${url}/api/ready`, { headers: { Origin: 'https://untrusted.example' } });
    assert.equal(blocked.status, 403);
    assert.equal(queries, 1);
  });
});
test('database failures produce unavailable status without disclosing credentials', async () => {
  await withApi(async () => { throw new Error('secret-connection-string'); }, async url => {
    const response = await fetch(`${url}/api/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable', database: 'unavailable' });
  });
});
test('liveness does not need the database and API rejects writes', async () => {
  await withApi(() => { throw new Error('must not query'); }, async url => {
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    assert.equal((await fetch(`${url}/api/ready`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${url}/api/employees`)).status, 404);
  });
});

test('all asset import routes exist and require authentication', async () => {
  await withApi(() => { throw new Error('must not query'); }, async url => {
    for (const kind of ['assets','assetCategories','assetEmployees','assetAllocationLog','assetExitClearances']) {
      const response = await fetch(`${url}/api/import/${kind}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:[]})});
      assert.equal(response.status,401,kind);
    }
    assert.equal((await fetch(`${url}/api/import/unknown`,{method:'POST'})).status,404);
  });
});
