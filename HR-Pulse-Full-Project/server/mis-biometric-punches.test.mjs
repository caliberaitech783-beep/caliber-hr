// Pulse-II reads the site machines' punches for its Attendance Sheet Mismatch. The people and numbers are made up.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMisBiometricPunches,readPunchRange,packPunches,MIS_PUNCHES_SQL} from './mis-biometric-punches.mjs';

const KEY='k'.repeat(40);

test('the date range is checked: valid dates, from before to, up to 31 days',()=>{
 assert.deepEqual(readPunchRange({from:'2026-11-01',to:'2026-11-30'}),{from:'2026-11-01',to:'2026-11-30'});
 for(const bad of [{},{from:'2026-11-05',to:'2026-11-01'},{from:'2026-11-01',to:'2026-12-02'},{from:'01-11-2026',to:'2026-11-02'},{from:'2026-02-30',to:'2026-03-01'}])
  assert.throws(()=>readPunchRange(bad),/date|days/);
});

test('the punches are sent compact, one site list',()=>{
 assert.deepEqual(packPunches([
  {code:'CMLL17817',biometric_id:'17817',at:'2026-11-03 06:02',site:'Sasti OC',punch_type:'0'},
  {code:'',biometric_id:'90121',at:'2026-11-03 06:05',site:'Sasti OC',punch_type:'255'},
  {code:'CMLL16502',biometric_id:'16502',at:'2026-11-03 21:58',site:'Ballarpur OC',punch_type:null},
 ]),{sites:['Sasti OC','Ballarpur OC'],punches:[['CMLL17817','17817','2026-11-03 06:02',0,'0'],['','90121','2026-11-03 06:05',0,'255'],['CMLL16502','16502','2026-11-03 21:58',1,'']]});
});

test('only Pulse-II\'s key reads, and the morning after the last date is included',async()=>{
 const asked=[];
 const pool={query:async(sql,params)=>{asked.push({sql,params});return {rows:[{code:'CMLL1',biometric_id:'1',at:'2026-11-02 06:00',site:'Sasti OC',punch_type:'0'}]};}};
 const api=createMisBiometricPunches(pool,{syncKey:KEY});
 await assert.rejects(api.misBiometricPunches('wrong',{from:'2026-11-01',to:'2026-11-02'}),e=>e.status===401);
 await assert.rejects(createMisBiometricPunches(pool,{syncKey:''}).misBiometricPunches(KEY,{from:'2026-11-01',to:'2026-11-02'}),e=>e.status===503);
 const answer=await api.misBiometricPunches(KEY,{from:'2026-11-01',to:'2026-11-02'});
 assert.deepEqual(asked[0].params,['2026-11-01','2026-11-02']);
 assert.match(MIS_PUNCHES_SQL,/punched_at<\$2::date\+2/);
 // The Manual Biometric logs HR imports go to Pulse-II too (owner, 24 Nov 2026), for the same dates.
 assert.match(MIS_PUNCHES_SQL,/FROM hr_attendance_punches p/);
 assert.match(MIS_PUNCHES_SQL,/UNION ALL[\s\S]*FROM hr_manual_biometric_punches m[\s\S]*m\.punched_at>=\$1::date AND m\.punched_at<\$2::date\+2/);
 assert.deepEqual(answer.punches,[['CMLL1','1','2026-11-02 06:00',0,'0']]);
 assert.deepEqual(answer.sites,['Sasti OC']);
});
