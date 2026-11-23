import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAttendance} from './attendance.mjs';
import {decideMachineDelete,machineDeleteApprovers,machineDeleteMarkup,machineDeleteMessage,otpHash,parseMachineDeleteCallback,MACHINE_DELETE_KIND} from './machine-delete.mjs';

/* Owner, 23 Nov 2026: a biometric machine is deleted only after an approver taps Approve on Telegram or gives the OTP. */
const admin={actor:'hradmin',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master']}};
const env={MACHINE_DELETE_APPROVERS:'Owner, @hradmin'};

/** A small in-memory stand-in for the tables the delete touches. */
function fakePool(){
 const state={devices:new Map([['CEXJ230861482',{serial:'CEXJ230861482',name:'STAFF 2',location:'OFFICE',ip_address:'192.168.16.22',site_name:'Dhoptala OB 2nd',bridge_name:null,punches:0,last_punch:null,site_id:null}]]),records:new Map(),audit:[],queued:[]};
 const query=async(sql,params=[])=>{
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.includes('FROM hr_attendance_devices d LEFT JOIN hr_records s')&&sql.includes('FOR UPDATE OF d'))return {rows:state.devices.has(params[0])?[state.devices.get(params[0])]:[]};
  if(sql.startsWith('DELETE FROM hr_attendance_devices')){const row=state.devices.get(params[0]);state.devices.delete(params[0]);return {rows:row?[row]:[]};}
  if(sql.includes('UPDATE hr_attendance_fetch_requests'))return {rows:[],rowCount:0};
  if(sql.includes('INSERT INTO hr_audit')){state.audit.push(sql.match(/'([A-Z_]+)'/)[1]);return {rows:[]};}
  if(sql.includes("kind='employees'"))return {rows:[{login:'owner',name:'Mr Anoop'}]};
  if(sql.startsWith("UPDATE hr_records SET status='CANCELLED'"))return {rows:[]};
  if(sql.startsWith('INSERT INTO hr_records')){state.records.set(params[1],{data:structuredClone(params[3]),status:'PENDING'});return {rows:[]};}
  if(sql.startsWith('SELECT data FROM hr_records')){const r=state.records.get(params[1]);return {rows:r?[{data:structuredClone(r.data)}]:[]};}
  if(sql.startsWith('UPDATE hr_records SET data=$3')){const r=state.records.get(params[1]);r.data=structuredClone(params[2]);if(params[3])r.status=params[3];return {rows:[]};}
  if(sql.startsWith("UPDATE hr_records SET data=$3,status='CANCELLED'")){const r=state.records.get(params[1]);r.data=structuredClone(params[2]);r.status='CANCELLED';return {rows:[]};}
  throw new Error('Unexpected SQL: '+sql.slice(0,80));
 };
 return {state,query,connect:async()=>({query,release(){}})};
}
const setup=()=>{const pool=fakePool();const queue=async(db,key,actors,message,markup)=>{pool.state.queued.push({key,actors,message,markup});};
 return {pool,api:createAttendance(pool,{bridgeKey:undefined,env,queue}).attendanceApi};};
const otpOf=message=>message.match(/OTP: (\d{6})/)[1];

test('approvers come from MACHINE_DELETE_APPROVERS, and the requester is never sent the message',async()=>{
 assert.deepEqual(machineDeleteApprovers(env),['owner','hradmin']);
 const {pool,api}=setup();
 const request=await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 assert.equal(request.status,'PENDING');assert.match(request.code,/^MD-[0-9A-F]{12}$/);
 assert.deepEqual(pool.state.queued[0].actors,['owner']);
 assert.deepEqual(request.approvers,['Mr Anoop']);
 const text=pool.state.queued[0].message;
 for(const part of ['DELETE BIOMETRIC MACHINE','Dhoptala OB 2nd','CEXJ230861482','192.168.16.22','STAFF 2','hradmin','valid for 15 minutes'])assert.ok(text.includes(part),part);
 assert.deepEqual(pool.state.queued[0].markup,machineDeleteMarkup(request.code));
 assert.ok(pool.state.devices.has('CEXJ230861482'),'nothing is deleted before approval');
 await assert.rejects(createAttendance(fakePool(),{env:{MACHINE_DELETE_APPROVERS:'hradmin'},queue:async()=>{}}).attendanceApi(admin,'devices/delete','POST',{serial:'CEXJ230861482'}),e=>e.status===409&&/own delete request/.test(e.message));
 await assert.rejects(createAttendance(fakePool(),{env:{},queue:async()=>{}}).attendanceApi(admin,'devices/delete','POST',{serial:'CEXJ230861482'}),e=>e.status===409&&/MACHINE_DELETE_APPROVERS/.test(e.message));
});

test('only an HR administrator without a site restriction can ask to delete a machine',async()=>{
 const {api}=setup();
 await assert.rejects(api({...admin,permissions:{application:'HR',hrDesktopAccess:['Attendance Management']}},'devices/delete','POST',{serial:'CEXJ230861482'}),e=>e.status===403);
 await assert.rejects(api(admin,'devices/delete','POST',{serial:'x;drop'}),/Choose a machine/);
 await assert.rejects(api(admin,'devices/delete','POST',{serial:'UNKNOWN1'}),e=>e.status===404);
});

test('Approve on Telegram deletes the machine; only a listed approver can tap it',async()=>{
 const {pool,api}=setup();
 const {code}=await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 assert.deepEqual(parseMachineDeleteCallback(`md:${code}:a`),{code,approve:true});
 assert.equal(parseMachineDeleteCallback('md:MD-1:a'),null);
 const stranger=await decideMachineDelete(pool,code,{actor:'someone',name:'X',approve:true,via:'telegram'});
 assert.equal(stranger.ok,false);assert.ok(pool.state.devices.has('CEXJ230861482'));
 const ok=await decideMachineDelete(pool,code,{actor:'owner',name:'Mr Anoop',approve:true,via:'telegram'});
 assert.equal(ok.status,'APPROVED');assert.equal(pool.state.devices.has('CEXJ230861482'),false);
 assert.ok(pool.state.audit.includes('DELETE_ATTENDANCE_DEVICE'));
 const view=await api(admin,`devices/delete/${code}`,'GET');
 assert.equal(view.status,'APPROVED');assert.equal(view.decidedBy,'Mr Anoop');assert.equal(view.via,'telegram');
 assert.match((await decideMachineDelete(pool,code,{actor:'owner',approve:true,via:'telegram'})).text,/Already approved/);
});

test('Reject on Telegram keeps the machine',async()=>{
 const {pool,api}=setup();
 const {code}=await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 await decideMachineDelete(pool,code,{actor:'owner',name:'Mr Anoop',approve:false,via:'telegram'});
 assert.ok(pool.state.devices.has('CEXJ230861482'));
 assert.equal((await api(admin,`devices/delete/${code}`,'GET')).status,'REJECTED');
 const after=await api(admin,`devices/delete/${code}`,'POST',{otp:'123456'});
 assert.equal(after.status,'REJECTED','an OTP after a Reject deletes nothing');
 assert.ok(pool.state.devices.has('CEXJ230861482'));
});

test('the OTP deletes the machine; wrong OTPs are counted and stop after five',async()=>{
 const {pool,api}=setup();
 const {code}=await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 const otp=otpOf(pool.state.queued[0].message);
 assert.equal(pool.state.records.get(code).data.otpHash,otpHash(code,otp));
 const wrong=otp==='111111'?'222222':'111111';
 await assert.rejects(api(admin,`devices/delete/${code}`,'POST',{otp:wrong}),/Wrong OTP \(4 attempts left\)/);
 assert.ok(pool.state.devices.has('CEXJ230861482'));
 const done=await api(admin,`devices/delete/${code}`,'POST',{otp});
 assert.equal(done.status,'APPROVED');assert.equal(done.via,'otp');
 assert.equal(pool.state.devices.has('CEXJ230861482'),false);
 assert.equal(pool.state.records.get(code).data.otpHash,null,'single use');

 const second=setup();
 const r2=await second.api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 const good=otpOf(second.pool.state.queued[0].message),bad=good==='111111'?'222222':'111111';
 for(let i=0;i<5;i++)await assert.rejects(second.api(admin,`devices/delete/${r2.code}`,'POST',{otp:bad}));
 await assert.rejects(second.api(admin,`devices/delete/${r2.code}`,'POST',{otp:good}),e=>e.status===429);
 assert.ok(second.pool.state.devices.has('CEXJ230861482'));
});

test('an expired request deletes nothing, and Cancel withdraws it',async()=>{
 const {pool,api}=setup();
 const {code}=await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 const otp=otpOf(pool.state.queued[0].message);
 pool.state.records.get(code).data.expires=new Date(Date.now()-1000).toISOString();
 assert.equal((await api(admin,`devices/delete/${code}`,'GET')).status,'EXPIRED');
 await assert.rejects(api(admin,`devices/delete/${code}`,'POST',{otp}),e=>e.status===410);
 assert.match((await decideMachineDelete(pool,code,{actor:'owner',approve:true,via:'telegram'})).text,/expired/);
 assert.ok(pool.state.devices.has('CEXJ230861482'));

 const other=setup();
 const r=await other.api(admin,'devices/delete','POST',{serial:'CEXJ230861482'});
 assert.equal((await other.api(admin,`devices/delete/${r.code}`,'POST',{cancel:true})).status,'CANCELLED');
 assert.match((await decideMachineDelete(other.pool,r.code,{actor:'owner',approve:true,via:'telegram'})).text,/Already cancelled/);
 assert.ok(other.pool.state.devices.has('CEXJ230861482'));
});

test('the message reads like the release approval and the record kind is private',()=>{
 const text=machineDeleteMessage({machine:{serial:'S1',siteName:'Sasti OC',punches:150,lastPunch:'23-11-2026 12:23'},requestedBy:'hradmin',requestedByName:'HR Admin',requestedAt:'2026-11-23T07:00:00Z'},'123456');
 assert.match(text,/OTP: 123456/);assert.match(text,/Punches saved: 150 · last 23-11-2026 12:23/);assert.match(text,/23 Nov 2026, 12:30 pm IST/);
 assert.equal(MACHINE_DELETE_KIND,'machineDeletions');
});
