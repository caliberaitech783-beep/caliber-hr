import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApi} from './app.mjs';
import {createAttendance,keyMatches,validateUpload,validateRange,MAX_PUNCHES_PER_UPLOAD} from './attendance.mjs';

const KEY='k'.repeat(40);
const device={serial:'JNP2260900233'};
const punch={biometricId:'12',punchedAt:'2026-11-12 09:01:05',verify:'1',punchType:'0'};
const hr={actor:'hr',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}};

test('bridge key must be long and match exactly',()=>{
 assert.equal(keyMatches(KEY,KEY),true);
 assert.equal(keyMatches(KEY,KEY+'x'),false);
 assert.equal(keyMatches(KEY,undefined),false);
 assert.equal(keyMatches('short','short'),false);
 assert.equal(keyMatches(undefined,undefined),false);
});

test('uploads are validated before anything reaches the database',()=>{
 const ok=validateUpload({device,punches:[punch],users:[{biometricId:'12',name:' Ravi\u0000 '}],final:true});
 assert.deepEqual(ok.punches,[punch]);assert.equal(ok.users[0].name,'Ravi');assert.equal(ok.final,true);assert.equal(ok.requestId,null);
 assert.throws(()=>validateUpload({device:{serial:"x';--"},punches:[]}),/serial/);
 assert.throws(()=>validateUpload({device,punches:[{...punch,punchedAt:'2026-02-30 09:00:00'}]}),/invalid time/);
 assert.throws(()=>validateUpload({device,punches:[{...punch,punchedAt:'12/11/2026 9:00'}]}),/invalid time/);
 assert.throws(()=>validateUpload({device,punches:[{...punch,biometricId:''}]}),/user ID/);
 assert.throws(()=>validateUpload({device,punches:[{...punch,verify:'face'}]}),/code/);
 assert.throws(()=>validateUpload({device,punches:'all'}),/lists/);
 assert.equal(validateUpload({requestId:'11111111-1111-4111-8111-111111111111',error:'No machine has connected'}).serial,null);
 assert.throws(()=>validateUpload({error:'x',punches:[punch]}),/serial/);
 assert.throws(()=>validateUpload({punches:[]}),/serial/);
 assert.throws(()=>validateUpload({device,requestId:'1',punches:[]}),/fetch request/);
 assert.throws(()=>validateUpload({device,punches:Array(MAX_PUNCHES_PER_UPLOAD+1).fill(punch)}),e=>e.status===413);
});

test('date ranges default to one day and are bounded',()=>{
 assert.deepEqual(validateRange(new URLSearchParams('from=2026-11-01&to=2026-11-12')),{from:'2026-11-01',to:'2026-11-12'});
 assert.deepEqual(validateRange(new URLSearchParams('from=2026-11-12')),{from:'2026-11-12',to:'2026-11-12'});
 assert.match(validateRange(new URLSearchParams()).from,/^\d{4}-\d{2}-\d{2}$/);
 assert.throws(()=>validateRange(new URLSearchParams('from=2026-11-12&to=2026-11-01')),/on or after/);
 assert.throws(()=>validateRange(new URLSearchParams('from=2026-01-01&to=2026-11-12')),/days or fewer/);
 assert.throws(()=>validateRange(new URLSearchParams('from=yesterday')),/YYYY-MM-DD/);
});

test('bridge routes fail closed without a configured key and never touch the database with a wrong one',async()=>{
 const pool={query(){throw new Error('must not query');},connect(){throw new Error('must not connect');}};
 await assert.rejects(createAttendance(pool,{bridgeKey:undefined}).attendanceBridge(KEY,'next','GET',{}),e=>e.status===503);
 await assert.rejects(createAttendance(pool,{bridgeKey:'short'}).attendanceBridge('short','next','GET',{}),e=>e.status===503);
 await assert.rejects(createAttendance(pool,{bridgeKey:KEY}).attendanceBridge('wrong','next','GET',{}),e=>e.status===401);
 await assert.rejects(createAttendance(pool,{bridgeKey:KEY}).attendanceBridge(undefined,'punches','POST',{device,punches:[punch]}),e=>e.status===401);
});

test('attendance pages need the Employee Master menu',async()=>{
 const pool={query(){throw new Error('must not query');},connect(){throw new Error('must not connect');}};
 const service=createAttendance(pool,{bridgeKey:KEY});
 await assert.rejects(service.attendanceApi({actor:'x',permissions:{application:'HR',hrDesktopAccess:['Calendar']}},'punches','GET',{},new URLSearchParams()),e=>e.status===403);
 await assert.rejects(service.attendanceApi({actor:'x',permissions:{application:'HR'}},'fetch','POST',{},new URLSearchParams()),e=>e.status===403);
});

test('API routes bridge calls by key and user calls by Pulse sign-in',async()=>{
 const calls=[];
 const service={
  async attendanceBridge(key,route,method,input){calls.push(['bridge',key,route,method,input]);if(key!==KEY)throw Object.assign(new Error('Invalid bridge key'),{status:401});return {request:null};},
  async attendanceApi(profile,route,method){calls.push(['api',profile.actor,route,method]);return {ok:true};},
 };
 const server=createApi({query:async()=>{},service,authenticate:async token=>token==='a'.repeat(43)?hr:null});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/api/attendance/`;
 try{
  assert.equal((await fetch(url+'bridge/next')).status,401);
  assert.equal((await fetch(url+'bridge/next',{headers:{'X-Bridge-Key':KEY}})).status,200);
  assert.equal((await fetch(url+'bridge/next',{method:'DELETE',headers:{'X-Bridge-Key':KEY}})).status,405);
  // A bridge key is not a sign-in: user routes still require Pulse.
  assert.equal((await fetch(url+'punches',{headers:{'X-Bridge-Key':KEY}})).status,401);
  const response=await fetch(url+'fetch',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(43),'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,200);
  assert.deepEqual(calls.at(-1),['api','hr','fetch','POST']);
  assert.equal(calls.filter(c=>c[0]==='api').length,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
