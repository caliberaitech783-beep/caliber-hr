import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAttendance} from './attendance.mjs';

/* Owner, 23 Nov 2026: a biometric machine is deleted after one confirmation, with no Telegram approval or OTP. */
const admin={actor:'hradmin',permissions:{application:'HR',hrDesktopAccess:['Attendance Management','Employee Master']}};

function fakePool(){
 const state={devices:new Set(['CEXJ230861482']),audit:[],fetchesFailed:0,other:[]};
 const query=async(sql,params=[])=>{
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.startsWith('DELETE FROM hr_attendance_devices')){const had=state.devices.delete(params[0]);return {rows:had?[{serial:params[0],name:'STAFF 2',location:'OFFICE',site_id:null,ip_address:'192.168.16.22'}]:[]};}
  if(sql.includes('UPDATE hr_attendance_fetch_requests')){state.fetchesFailed++;return {rows:[]};}
  if(sql.includes('INSERT INTO hr_audit')){state.audit.push(sql.match(/'([A-Z_]+)'/)[1]);return {rows:[]};}
  state.other.push(sql);
  throw new Error('Unexpected SQL: '+sql.slice(0,80));
 };
 return {state,query,connect:async()=>({query,release(){}})};
}

test('Delete removes the machine at once, cancels its fetches and writes the audit log; nothing goes to Telegram',async()=>{
 const pool=fakePool();
 const api=createAttendance(pool,{bridgeKey:undefined}).attendanceApi;
 assert.deepEqual(await api(admin,'devices/delete','POST',{serial:'CEXJ230861482'}),{deleted:true,serial:'CEXJ230861482'});
 assert.equal(pool.state.devices.has('CEXJ230861482'),false);
 assert.equal(pool.state.fetchesFailed,1);
 assert.deepEqual(pool.state.audit,['DELETE_ATTENDANCE_DEVICE']);
 assert.equal(pool.state.other.length,0,'no punches, links or Telegram messages are touched');
 await assert.rejects(api(admin,'devices/delete','POST',{serial:'CEXJ230861482'}),e=>e.status===404);
});

test('only an HR administrator without a site restriction can delete, and the serial is checked',async()=>{
 const pool=fakePool();
 const api=createAttendance(pool,{bridgeKey:undefined}).attendanceApi;
 await assert.rejects(api({...admin,permissions:{application:'HR',hrDesktopAccess:['Attendance Management']}},'devices/delete','POST',{serial:'CEXJ230861482'}),e=>e.status===403);
 await assert.rejects(api(admin,'devices/delete','POST',{serial:"x';drop"}),/Choose a machine/);
 assert.ok(pool.state.devices.has('CEXJ230861482'));
});
