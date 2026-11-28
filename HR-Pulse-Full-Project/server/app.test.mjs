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

test('Aadhaar scan requires authentication before any paid request',async()=>{
 await withApi(()=>{throw Error('must not query');},async url=>{
  assert.equal((await fetch(url+'/api/aadhaar/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 });
});

test('trial employee direct save requires Pulse authentication',async()=>{
 await withApi(()=>{throw Error('must not query');},async url=>{
  assert.equal((await fetch(url+'/api/import/trial-employee',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 });
});

/* Compressed answers and the attendance read times (owner, 28 Nov 2026: a 20-day roster ran out of time on a site's line). */
import {request} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {clearReads,recentReads} from './read-times.mjs';
/** A raw call: fetch would quietly decompress, and the test must see what really travels. */
const raw=(url,headers={})=>new Promise((resolve,reject)=>{
  const call=request(url,{headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});
  call.on('error',reject);call.end();
});
const bigRegister={rows:Array.from({length:400},(_,i)=>({id:'e'+i,code:'CMLL'+(20000+i),name:'EMPLOYEE '+i,days:[{date:'2026-11-01',status:'P',in:'07:41',out:'18:51'}]}))};
async function withSignedInApi(service,check){
  const server=createApi({query:async()=>{},authenticate:async()=>({actor:'vinod'}),service});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  try{await check(`http://127.0.0.1:${server.address().port}`);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
const grant={Authorization:'Bearer '+'a'.repeat(43)};

test('a large answer travels compressed when the caller accepts it, and unchanged when it does not',async()=>{
  await withSignedInApi({attendanceApi:async()=>bigRegister},async url=>{
    const plain=await raw(url+'/api/attendance/manual-biometric?site=Majri+OC&from=2026-11-01&to=2026-11-01',grant);
    assert.equal(plain.status,200);assert.equal(plain.headers['content-encoding'],undefined);
    assert.deepEqual(JSON.parse(plain.body.toString()),bigRegister);
    const zipped=await raw(url+'/api/attendance/manual-biometric?site=Majri+OC&from=2026-11-01&to=2026-11-01',{...grant,'Accept-Encoding':'gzip, deflate, br'});
    assert.equal(zipped.headers['content-encoding'],'gzip');
    assert.equal(Number(zipped.headers['content-length']),zipped.body.length);
    assert.match(zipped.headers.vary,/Accept-Encoding/);
    assert.deepEqual(JSON.parse(gunzipSync(zipped.body).toString()),bigRegister,'the same answer after decompression');
    assert.ok(zipped.body.length*5<plain.body.length,`compressed ${zipped.body.length} bytes against ${plain.body.length}`);
    assert.match(zipped.headers['server-timing'],/^app;dur=\d+$/);
    // What the browser does: the answer arrives as before.
    assert.deepEqual(await (await fetch(url+'/api/attendance/manual-biometric?site=Majri+OC',{headers:grant})).json(),bigRegister);
  });
});

test('a small answer and an error are not compressed',async()=>{
  await withSignedInApi({attendanceApi:async()=>{throw Object.assign(new Error('Choose a site.'),{status:400});}},async url=>{
    const health=await raw(url+'/api/health',{'Accept-Encoding':'gzip'});
    assert.equal(health.headers['content-encoding'],undefined);assert.equal(JSON.parse(health.body.toString()).status,'ok');
    const refused=await raw(url+'/api/attendance/manual-biometric',{...grant,'Accept-Encoding':'gzip'});
    assert.equal(refused.status,400);assert.equal(refused.headers['content-encoding'],undefined);
    assert.deepEqual(JSON.parse(refused.body.toString()),{error:'Choose a site.'});
  });
});

test('attendance requests are timed with their size; bridge PC calls and other pages are not',async()=>{
  clearReads();
  await withSignedInApi({attendanceApi:async()=>bigRegister,attendanceBridge:async()=>({ok:true}),lookups:async()=>[]},async url=>{
    await raw(url+'/api/attendance/manual-biometric?site=Majri+OC&from=2026-11-01&to=2026-11-20',{...grant,'Accept-Encoding':'gzip'});
    await raw(url+'/api/attendance/fetch/0f8fad5b-d9cb-469f-a165-70867728950e',grant);
    await raw(url+'/api/attendance/bridge/jobs',{'x-bridge-key':'k'});
    await raw(url+'/api/lookups',grant);
    await raw(url+'/api/attendance/manual-biometric?site=Majri+OC');
  });
  const {kept,routes,latest}=recentReads();
  assert.equal(kept,3);
  const read=latest.find(r=>r.days===20);
  assert.deepEqual([read.route,read.site,read.from,read.to,read.method,read.status,read.by],['manual-biometric','Majri OC','2026-11-01','2026-11-20','GET',200,'vinod']);
  assert.ok(read.bytes>20000&&read.sent<read.bytes/5&&read.ms>=0,'the size as JSON and as sent');
  assert.ok(latest.some(r=>r.route==='fetch/:id'),'an id in the path is not kept');
  assert.ok(latest.some(r=>r.status===401&&r.by===''),'a refused request is kept too');
  assert.deepEqual(routes.map(r=>r.route).sort(),['fetch/:id','manual-biometric']);
  clearReads();
});
