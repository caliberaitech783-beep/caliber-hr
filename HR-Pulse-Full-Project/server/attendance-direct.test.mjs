import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApi} from './app.mjs';
import {createDirectMachines,parseAttlog,parseUsers,handshake} from './attendance-direct.mjs';
import {createAttendance} from './attendance.mjs';

function fakePool(handler){
 const calls=[];
 const query=async(sql,params)=>{calls.push([sql,params]);return handler(sql,params)||{rows:[],rowCount:0};};
 return {calls,query,connect:async()=>({query,release(){}})};
}
const registered=sql=>{
 if(sql.includes('UPDATE hr_attendance_devices SET last_contact=now(),direct_contact=now()'))return {rows:[{serial:'CEXJ232460322'}],rowCount:1};
};

test('ATTLOG lines become punches; unreadable lines are skipped, not fatal',()=>{
 const out=parseAttlog('12\t2026-11-22 09:01:05\t0\t1\t0\t0\r\n\nbad line\n13\t2026-02-30 09:00:00\t0\t1\n14\t2026-11-22 18:00:00\tx\tface\n');
 assert.deepEqual(out.punches,[{biometricId:'12',punchedAt:'2026-11-22 09:01:05',punchType:'0',verify:'1'},{biometricId:'14',punchedAt:'2026-11-22 18:00:00',punchType:'',verify:''}]);
 assert.equal(out.skipped,2);assert.equal(out.lines,4);
});

test('user names come from OPERLOG and USERINFO lines',()=>{
 assert.deepEqual(parseUsers('USER PIN=1\tName=Ravi\tPri=0\nOPLOG 4\t0\nPIN=2\tName=Sita\u0000\n'),[{biometricId:'1',name:'Ravi'},{biometricId:'2',name:'Sita'}]);
});

test('a registered machine is marked in touch straight to the cloud and its punches are saved',async()=>{
 const pool=fakePool(registered);
 const machine=createDirectMachines(pool);
 const hello=await machine('GET','/iclock/cdata',new URLSearchParams('SN=CEXJ232460322&options=all'));
 assert.equal(hello.text,handshake('CEXJ232460322'));
 assert.match(hello.text,/ATTLOGStamp=0/);
 const saved=await machine('POST','/iclock/cdata',new URLSearchParams('SN=CEXJ232460322&table=ATTLOG&Stamp=9999'),'7\t2026-11-22 09:00:00\t0\t1\n');
 assert.equal(saved.text,'OK: 1');
 const insert=pool.calls.find(([sql])=>sql.includes('INSERT INTO hr_attendance_punches'));
 assert.deepEqual(insert[1],['CEXJ232460322',['7'],['2026-11-22 09:00:00'],['1'],['0']]);
 assert.equal((await machine('GET','/iclock/getrequest.aspx',new URLSearchParams('SN=CEXJ232460322'))).text,'OK');
});

test('a serial not added to a site is ignored and nothing is stored',async()=>{
 const pool=fakePool(()=>null);
 const machine=createDirectMachines(pool);
 assert.equal((await machine('POST','/iclock/cdata',new URLSearchParams('SN=UNKNOWN1&table=ATTLOG'),'7\t2026-11-22 09:00:00\t0\t1\n')).text,'OK');
 assert.ok(!pool.calls.some(([sql])=>sql.includes('INSERT')));
 // Junk serials never reach the database.
 const none=fakePool(()=>{throw new Error('must not query');});
 assert.equal((await createDirectMachines(none)('GET','/iclock/cdata',new URLSearchParams("SN=x';--"))).text,'OK');
});

test('machine status shows a direct machine online with no bridge PC; its Fetch log finishes at once',async()=>{
 const SITE='22222222-2222-4222-8222-222222222222';
 const admin={actor:'hr',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master']}};
 const pool=fakePool(sql=>{
  if(sql.includes('FROM hr_attendance_bridges b'))return {rows:[]};
  if(sql.includes('FROM hr_attendance_bridge'))return {rows:[]};
  if(sql.includes('FROM hr_attendance_devices d'))return {rows:[{serial:'CEXJ232460322',name:'OFFICE STAFF 2',location:'OFFICE',site_id:SITE,site_name:'Sasti OC',last_contact:'2026-11-22T12:00:00Z',online:true,direct:true,logs_today:3}]};
  if(sql.includes('SELECT bridge_id,'))return {rows:[{bridge_id:null,direct:true}]};
  if(sql.includes("'DONE',now()"))return {rows:[{id:'r1',state:'DONE',punches_received:0,new_punches:0}]};
 });
 const service=createAttendance(pool,{bridgeKey:undefined});
 const status=await service.attendanceApi(admin,'status','GET',{},new URLSearchParams());
 assert.equal(status.configured,true);assert.equal(status.directMachines,1);
 assert.equal(status.devices[0].direct,true);assert.equal(status.devices[0].bridgeName,'Direct to HR Pulse');assert.equal(status.devices[0].online,true);
 assert.deepEqual(status.bridges,[]);
 const fetched=await service.attendanceApi(admin,'fetch','POST',{deviceSerial:'CEXJ232460322'},new URLSearchParams());
 assert.equal(fetched.state,'DONE');
 assert.ok(!pool.calls.some(([sql])=>sql.includes("INSERT INTO hr_attendance_fetch_requests(id,requested_by,device_serial,bridge_id) VALUES")));
});

test('the API answers machines in plain text over HTTP and sends every other plain-HTTP call to HTTPS',async()=>{
 const seen=[];
 const service={async attendanceMachine(method,path,params,body){seen.push([method,path,params.get('SN'),body]);return {text:'OK: 1'};}};
 const server=createApi({query:async()=>{},service});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const r=await fetch(base+'/iclock/cdata?SN=CEXJ1&table=ATTLOG',{method:'POST',headers:{'Content-Type':'text/plain','X-Forwarded-Proto':'http'},body:'7\t2026-11-22 09:00:00\t0\t1\n'});
  assert.equal(r.status,200);assert.equal(await r.text(),'OK: 1');assert.match(r.headers.get('content-type'),/text\/plain/);
  assert.deepEqual(seen[0],['POST','/iclock/cdata','CEXJ1','7\t2026-11-22 09:00:00\t0\t1\n']);
  const redirected=await fetch(base+'/api/health',{headers:{'X-Forwarded-Proto':'http'},redirect:'manual'});
  assert.equal(redirected.status,301);assert.match(redirected.headers.get('location'),/^https:\/\/127\.0\.0\.1:\d+\/api\/health$/);
  assert.equal((await fetch(base+'/api/health',{headers:{'X-Forwarded-Proto':'https'}})).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
