import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApi} from './app.mjs';
import {createAttendance,keyMatches,validateUpload,validateRange,validateDevice,cleanText,MAX_PUNCHES_PER_UPLOAD} from './attendance.mjs';

const KEY='k'.repeat(40);
const device={serial:'JNP2260900233'};
const punch={biometricId:'12',punchedAt:'2026-11-12 09:01:05',verify:'1',punchType:'0'};
const hr={actor:'hr',permissions:{application:'HR',hrDesktopAccess:['Attendance Management']}};

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

test('attendance pages need the exact Attendance Management menu',async()=>{
 const pool={query(){throw new Error('must not query');},connect(){throw new Error('must not connect');}};
 const service=createAttendance(pool,{bridgeKey:KEY});
 await assert.rejects(service.attendanceApi({actor:'x',permissions:{application:'HR',hrDesktopAccess:['Calendar']}},'punches','GET',{},new URLSearchParams()),e=>e.status===403);
 await assert.rejects(service.attendanceApi({actor:'x',permissions:{application:'HR'}},'fetch','POST',{},new URLSearchParams()),e=>e.status===403);
 await assert.rejects(service.attendanceApi({actor:'x',permissions:{application:'HR',hrDesktopAccess:['Employee Master']}},'punches','GET',{},new URLSearchParams()),e=>e.status===403);
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
  const remove=await fetch(url+'manual-biometric-days/delete',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(43),'Content-Type':'application/json'},body:JSON.stringify({site:'Sasti OC',days:['2026-11-02']})});
  assert.equal(remove.status,200);
  assert.deepEqual(calls.at(-1),['api','hr','manual-biometric-days/delete','POST']);
  assert.equal(calls.filter(c=>c[0]==='api').length,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

const SITE='22222222-2222-4222-8222-222222222222';
test('a biometric machine is added to a site with its location, name and serial',()=>{
 assert.deepEqual(validateDevice({serial:' JNP2260900233 ',siteId:SITE,name:' ESSL\u0000K90 ',location:'Main  gate',ipAddress:'192.168.1.201'},true),{serial:'JNP2260900233',siteId:SITE,name:'ESSL K90',location:'Main gate',ipAddress:'192.168.1.201',machineNo:null,make:null,model:null});
 assert.equal(validateDevice({serial:'JNP1',siteId:SITE,ipAddress:''},true).ipAddress,'');
 assert.throws(()=>validateDevice({serial:'JNP1',siteId:SITE,ipAddress:'300.1.1.1'},true),/IP address/);
 assert.equal(cleanText('x'.repeat(200)).length,80);
 assert.throws(()=>validateDevice({serial:'JNP1'},true),/Choose a site/);
 assert.throws(()=>validateDevice({serial:"x';--",siteId:SITE},true),/serial/);
 assert.throws(()=>validateDevice({serial:'JNP1',siteId:'site-1'},true),/Choose a site/);
 // An update that leaves out the location keeps the saved one (null = unchanged).
 assert.equal(validateDevice({serial:'JNP1',siteId:SITE},false).location,null);
 assert.equal(validateDevice({serial:'JNP1',siteId:SITE},false).ipAddress,null);
 assert.equal(validateDevice({serial:'JNP1',siteId:'',location:''},false).location,'');
});

function fakePool(handler){
 const calls=[];
 const query=async(sql,params)=>{calls.push([sql,params]);return handler(sql,params)||{rows:[],rowCount:0};};
 return {calls,query,connect:async()=>({query,release(){}})};
}
const admin={actor:'hr',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master']}};

test('machine status lists every site with location, contact and today\'s logs',async()=>{
 const pool=fakePool(sql=>{
  if(sql.includes('FROM hr_attendance_bridges b'))return {rows:[]};
  if(sql.includes('FROM hr_attendance_bridge'))return {rows:[{last_seen:'2026-11-20T05:00:00Z',online:true}]};
  if(sql.includes('FROM hr_attendance_devices d'))return {rows:[{serial:'JNP1',name:'K90',location:'Main gate',ip_address:'192.168.1.201',site_id:SITE,site_name:'Amlohri',last_seen:null,last_contact:'2026-11-20T05:00:00Z',online:true,logs_today:12,last_punch:'2026-11-20 10:31'}]};
 });
 const status=await createAttendance(pool,{bridgeKey:KEY}).attendanceApi(admin,'status','GET',{},new URLSearchParams());
 assert.deepEqual(status.devices[0],{serial:'JNP1',name:'K90',location:'Main gate',ipAddress:'192.168.1.201',machineNo:'',make:'',model:'',siteId:SITE,siteName:'Amlohri',lastContact:'2026-11-20T05:00:00Z',online:true,lastSeen:null,logsToday:12,lastPunch:'2026-11-20 10:31',bridgeId:null,direct:false,bridgeName:'Main bridge PC'});
 assert.deepEqual(status.bridges.map(b=>[b.name,b.main,b.machines]),[['Main bridge PC',true,['JNP1']]]);
 assert.equal(status.canManageDevices,true);
 const [sql,params]=pool.calls.find(([q])=>q.includes('FROM hr_attendance_devices d'));
 assert.match(sql,/count\(\*\) FILTER \(WHERE punched_at>=\$2::date\)/);
 assert.equal(params[0],null);assert.match(params[1],/^\d{4}-\d{2}-\d{2}$/);
});

test('adding and editing a machine saves its location; site HR users cannot',async()=>{
 const pool=fakePool(sql=>{
  if(sql.includes("kind='sites'"))return {rows:[{}],rowCount:1};
  if(sql.includes('INSERT INTO hr_attendance_devices'))return {rows:[{serial:'JNP1',location:'Main gate',ip_address:'192.168.1.201'}]};
  if(sql.includes('UPDATE hr_attendance_devices'))return {rows:[{serial:'JNP1',location:'Workshop',ip_address:'192.168.1.201'}]};
 });
 const service=createAttendance(pool,{bridgeKey:KEY});
 assert.deepEqual(await service.attendanceApi(admin,'devices/register','POST',{serial:'JNP1',siteId:SITE,name:'K90',location:'Main gate',ipAddress:' 192.168.1.201 '}),{serial:'JNP1',siteId:SITE,name:'K90',location:'Main gate',ipAddress:'192.168.1.201',machineNo:'',make:'',model:''});
 assert.deepEqual(pool.calls.find(([q])=>q.includes('INSERT INTO hr_attendance_devices'))[1],['JNP1',SITE,'K90','Main gate','192.168.1.201',null,null,null]);
 for(const ipAddress of ['192.168.1.256','10.0.0','01.2.3.4','1.2.3.4.5','abc'])
  await assert.rejects(service.attendanceApi(admin,'devices/register','POST',{serial:'JNP3',siteId:SITE,ipAddress}),e=>e.status===400&&/IP address/.test(e.message));
 await service.attendanceApi(admin,'devices','POST',{serial:'JNP1',siteId:SITE,name:'K90'});
 const update=pool.calls.find(([q])=>q.includes('UPDATE hr_attendance_devices'));
 assert.match(update[0],/location=coalesce\(\$4,location\),ip_address=coalesce\(\$5,ip_address\)/);assert.equal(update[1][3],null);assert.equal(update[1][4],null);
 const siteHr={actor:'site',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master'],site:'Amlohri'}};
 await assert.rejects(service.attendanceApi(siteHr,'devices/register','POST',{serial:'JNP2',siteId:SITE}),e=>e.status===403);
});

test('biometric text or CSV imports add only registered machines from the selected site',async()=>{
 const pool=fakePool((sql,params)=>{
  if(sql.includes("kind='sites'"))return {rows:[{id:SITE}],rowCount:1};
  if(sql.startsWith('SELECT serial FROM hr_attendance_devices'))return {rows:[{serial:'JNP1'}]};
  if(sql.startsWith('INSERT INTO hr_attendance_punches'))return {rows:[],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const result=await createAttendance(pool,{bridgeKey:KEY}).attendanceApi(admin,'punches/import','POST',{site:'Amlohri',rows:[{serial:'JNP1',biometricId:'12',name:'Ravi',punchedAt:'2026-11-23 09:01:05',verify:'1',punchType:'0'}]},new URLSearchParams());
 assert.deepEqual(result,{received:1,added:1});
 assert.ok(pool.calls.some(([sql])=>sql.startsWith('INSERT INTO hr_attendance_device_users')));
 assert.ok(pool.calls.some(([sql,params])=>sql.includes('INSERT INTO hr_audit')&&params[0]==='hr'&&params[1]==='IMPORT_BIOMETRIC_PUNCHES'));
 await assert.rejects(createAttendance(fakePool(sql=>sql.includes("kind='sites'")?{rows:[{id:SITE}]}:sql.startsWith('SELECT serial FROM hr_attendance_devices')?{rows:[]}:undefined),{bridgeKey:KEY}).attendanceApi(admin,'punches/import','POST',{site:'Amlohri',rows:[{serial:'OTHER',biometricId:'12',punchedAt:'2026-11-23 09:01:05'}]},new URLSearchParams()),/not registered/);
});

test('machine master: machine no., make and model are checked, kept when left out, and one machine no. per site',async()=>{
 assert.deepEqual(validateDevice({serial:'JNP1',siteId:SITE,machineNo:' 007 ',make:' eSSL ',model:'K90'},true),{serial:'JNP1',siteId:SITE,name:'',location:null,ipAddress:null,machineNo:'7',make:'eSSL',model:'K90'});
 assert.equal(validateDevice({serial:'JNP1'},false).machineNo,null);
 assert.throws(()=>validateDevice({serial:'JNP1',machineNo:'A1'},false),/Device ID/);
 assert.throws(()=>validateDevice({serial:'JNP1',machineNo:'1000'},false),/1 to 999/);
 const pool=fakePool(sql=>{
  if(sql.includes("kind='sites'"))return {rows:[{}],rowCount:1};
  if(sql.includes('machine_no=$2 AND serial<>$3'))return {rows:[{serial:'JNP9',name:'STAFF 1'}]};
  return {rows:[],rowCount:0};
 });
 await assert.rejects(createAttendance(pool,{bridgeKey:KEY}).attendanceApi(admin,'devices','POST',{serial:'JNP1',siteId:SITE,machineNo:'1'}),e=>e.status===409&&/already given to STAFF 1/.test(e.message));
});

test('a machine log check lists the site machines and which file IDs each already knows',async()=>{
 const pool=fakePool(sql=>{
  if(sql.includes("kind='sites'"))return {rows:[{id:SITE}],rowCount:1};
  if(sql.startsWith('SELECT serial,name,location,machine_no FROM hr_attendance_devices'))return {rows:[{serial:'JNP1',name:'STAFF 1',location:'Gate',machine_no:'2'},{serial:'JNP2',name:'',location:'',machine_no:''}]};
  if(sql.includes('CROSS JOIN unnest'))return {rows:[{serial:'JNP1',biometric_id:'12',employee_code:'E12',employee_name:'Ravi',machine_name:'RAVI'},{serial:'JNP1',biometric_id:'13',employee_code:null,employee_name:null,machine_name:null}]};
  return {rows:[],rowCount:0};
 });
 const result=await createAttendance(pool,{bridgeKey:KEY}).attendanceApi(admin,'punches/import/check','POST',{site:'Amlohri',ids:['12','13','12',' 99 ','bad id!']},new URLSearchParams());
 assert.deepEqual(result.machines,[
  {serial:'JNP1',name:'STAFF 1',location:'Gate',machineNo:'2',ids:[{biometricId:'12',employeeCode:'E12',employeeName:'Ravi',machineName:'RAVI'},{biometricId:'13',employeeCode:'',employeeName:'',machineName:''}]},
  {serial:'JNP2',name:'',location:'',machineNo:'',ids:[]}]);
 const lookup=pool.calls.find(([sql])=>sql.includes('CROSS JOIN unnest'));
 assert.deepEqual(lookup[1],[SITE,['12','13','99']]);
 await assert.rejects(createAttendance(pool,{bridgeKey:KEY}).attendanceApi(admin,'punches/import/check','POST',{site:'',ids:[]},new URLSearchParams()),/Choose a site/);
});

test('each site bridge PC signs in with its own key and picks up only its own fetch requests',async()=>{
 const {keyFingerprint}=await import('./attendance-bridges.mjs');
 const siteKey='hrb_'+'s'.repeat(43);
 const pool=fakePool((sql,params)=>{
  if(sql.includes('FROM hr_attendance_bridges WHERE key_hash'))return params[0]===keyFingerprint(siteKey)?{rows:[{id:'bridge-sasti',name:'Sasti PC',site_id:SITE}]}:{rows:[]};
  if(sql.includes("SET state='RUNNING'"))return {rows:[{id:'req-1',device_serial:null}]};
 });
 const service=createAttendance(pool,{bridgeKey:KEY});
 assert.deepEqual(await service.attendanceBridge(siteKey,'next','POST',{contacts:[{serial:'SST01',age:5}]}),{request:{id:'req-1',deviceSerial:null}});
 assert.ok(pool.calls.some(([q,p])=>q.includes('UPDATE hr_attendance_bridges SET last_seen')&&p[0]==='bridge-sasti'));
 const contact=pool.calls.find(([q])=>q.includes('INSERT INTO hr_attendance_devices(serial,last_contact,bridge_id)'));
 assert.deepEqual(contact[1],['SST01',5,'bridge-sasti']);
 const pick=pool.calls.find(([q])=>q.includes("SET state='RUNNING'"));
 assert.match(pick[0],/bridge_id IS NOT DISTINCT FROM \$1/);assert.deepEqual(pick[1],['bridge-sasti']);
 // The main bridge PC keeps working with ATTENDANCE_BRIDGE_KEY and picks up only main requests.
 pool.calls.length=0;
 await service.attendanceBridge(KEY,'next','GET',{});
 assert.deepEqual(pool.calls.find(([q])=>q.includes("SET state='RUNNING'"))[1],[null]);
 assert.ok(!pool.calls.some(([q])=>q.includes('hr_attendance_bridges WHERE key_hash')));
 // A removed or unknown site key is refused.
 await assert.rejects(service.attendanceBridge('hrb_'+'x'.repeat(43),'next','GET',{}),e=>e.status===401);
});

test('a fetch for a machine goes to its bridge PC; Fetch attendance asks every bridge PC',async()=>{
 const inserts=[];
 const pool=fakePool((sql,params)=>{
  if(sql.includes('SELECT bridge_id'))return {rows:[{bridge_id:'bridge-sasti'}]};
  if(sql.includes('SELECT id FROM hr_attendance_bridges'))return {rows:[{id:'bridge-sasti'},{id:'bridge-dhuptala'}]};
  if(sql.includes('INSERT INTO hr_attendance_fetch_requests')){inserts.push(params[3]);return {rows:[{id:params[0],state:'PENDING',punches_received:0,new_punches:0}]};}
 });
 const service=createAttendance(pool,{bridgeKey:KEY});
 await service.attendanceApi(admin,'fetch','POST',{deviceSerial:'SST01'},new URLSearchParams());
 assert.deepEqual(inserts,['bridge-sasti']);
 inserts.length=0;
 const first=await service.attendanceApi(admin,'fetch','POST',{},new URLSearchParams());
 assert.deepEqual(inserts,[null,'bridge-sasti','bridge-dhuptala']);
 assert.equal(first.state,'PENDING');
});

test('bridge PCs: add shows the key once, new key replaces it, remove stops it; site HR cannot',async()=>{
 const pool=fakePool(sql=>{
  if(sql.includes("kind='sites'"))return {rows:[{}],rowCount:1};
  if(sql.includes('UPDATE hr_attendance_bridges SET key_hash'))return {rows:[{id:'11111111-1111-4111-8111-111111111111',name:'Sasti PC',site_id:SITE}]};
  if(sql.includes('UPDATE hr_attendance_bridges SET removed_at'))return {rows:[{id:'11111111-1111-4111-8111-111111111111',name:'Sasti PC'}]};
 });
 const service=createAttendance(pool,{bridgeKey:KEY});
 const made=await service.attendanceApi(admin,'bridges','POST',{siteId:SITE,name:' Sasti PC '},new URLSearchParams());
 assert.match(made.key,/^hrb_[A-Za-z0-9_-]{43}$/);assert.equal(made.bridge.name,'Sasti PC');assert.equal(made.bridge.keyHint,made.key.slice(-4));
 const insert=pool.calls.find(([q])=>q.includes('INSERT INTO hr_attendance_bridges'));
 assert.ok(!insert[1].includes(made.key));assert.equal(insert[1][3].length,64);
 const again=await service.attendanceApi(admin,'bridges/11111111-1111-4111-8111-111111111111/key','POST',{},new URLSearchParams());
 assert.notEqual(again.key,made.key);
 assert.deepEqual(await service.attendanceApi(admin,'bridges/11111111-1111-4111-8111-111111111111/remove','POST',{},new URLSearchParams()),{removed:true});
 assert.ok(pool.calls.some(([q])=>q.includes('UPDATE hr_attendance_devices SET bridge_id=NULL')));
 await assert.rejects(service.attendanceApi(admin,'bridges','POST',{siteId:SITE,name:''},new URLSearchParams()),/name/);
 const siteHr={actor:'site',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master'],site:'Amlohri'}};
 await assert.rejects(service.attendanceApi(siteHr,'bridges','POST',{siteId:SITE,name:'X'},new URLSearchParams()),e=>e.status===403);
});
