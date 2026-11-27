import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBiometricDayStore} from './biometric-day-store.mjs';

function fakePool({sites = ['Sasti OC'], manual = false} = {}) {
  const saved = new Map(), audit = [];
  return {saved, audit, async query(sql, params = []) {
    if (/regexp_replace\(btrim\(name\)/.test(sql)) return {rows: sites.includes(params[0]) ? [{id: 'site-1', name: params[0], site_type: 'Site'}] : []};
    if (/FROM hr_records WHERE kind='sites'/.test(sql)) return {rows: sites.map((name,index)=>({id:'site-'+(index+1),name,site_type:'Site'}))};
    if (new RegExp(`INSERT INTO hr_${manual?'manual_':''}biometric_days`).test(sql)) {
      const key=params[0] + '|' + params[1], existing=saved.get(key);
      if(!existing||!manual)saved.set(key, {day: params[1], register: JSON.parse(params[2]), punches: params[3], people: params[4], saved_by: params[5], saved_at: '2026-11-23T08:00:00Z'});
      const row=saved.get(key);return {rows: [{day: row.day, punches: row.punches, people: row.people, saved_by: row.saved_by, saved_at: row.saved_at}]};
    }
    if (/WITH removed_days AS/.test(sql)) {
      let logs=0,punches=0;for(const day of params[1]){const key=params[0]+'|'+day;if(saved.delete(key)){logs++;punches+=8;}}
      return {rows:[{logs,punches}]};
    }
    if (new RegExp(`FROM hr_${manual?'manual_':''}biometric_days`).test(sql)) return {rows: [...saved.entries()].filter(([k]) => k.startsWith(params[0] + '|')).map(([, v]) => v).filter(v => v.day >= params[1] && v.day <= params[2])};
    if (/INSERT INTO hr_audit/.test(sql)) { audit.push(params); return {rows: []}; }
    throw new Error('Unexpected SQL ' + sql);
  }};
}
const hr = {actor: 'vinod', permissions: {}};
const register = day => ({from: day, to: day, policy: {}, rows: [{id: 'e1', name: 'Ram', days: [{date: day, status: 'P'}]}, {id: 'm:77', name: 'RAMU', linked: false, days: []}],
  machines: [{serial: 'JNP1', punches: 5}, {serial: 'JNP2', punches: 3}]});

test('saves a day of biometric logs built by the server and reads saved days back', async () => {
  const pool = fakePool(), loads = [];
  const store = createBiometricDayStore(pool, {load: async (site, from, to) => {loads.push([site.name, from, to]); return register(from);}, today: () => '2026-11-23'});
  const saved = await store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-02', register: {rows: ['forged']}}, null, null);
  assert.deepEqual([saved.day, saved.punches, saved.people, saved.savedBy], ['2026-11-02', 8, 2, 'vinod']);
  assert.deepEqual(loads, [['Sasti OC', '2026-11-02', '2026-11-02']]);
  const read = await store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-11-01', to: '2026-11-23'}), null);
  assert.equal(read.days.length, 1);
  assert.equal(read.days[0].register.rows[0].name, 'Ram', 'the saved copy is the server register, not what the browser sent');
  assert.equal(pool.audit.length, 1);
});

test('brief read lists saved manual days without the saved sheet', async () => {
  const pool=fakePool({manual:true}),queries=[];const query=pool.query.bind(pool);pool.query=async (sql,params)=>{queries.push(sql);return query(sql,params);};
  const store=createBiometricDayStore(pool,{manual:true,today:()=> '2026-11-23',load:async (_site,day)=>register(day)});
  await store(hr,'POST',{site:'Sasti OC',day:'2026-11-02'},null,null);
  const read=await store(hr,'GET',{},new URLSearchParams({site:'Sasti OC',from:'2026-11-01',to:'2026-11-20',brief:'1'}),null);
  assert.deepEqual(read.days,[{day:'2026-11-02',punches:8,people:2,savedBy:'vinod',savedAt:'2026-11-23T08:00:00Z'}]);
  assert.doesNotMatch(queries.at(-1),/register/,'the saved sheet is not read from the database either');
  const full=await store(hr,'GET',{},new URLSearchParams({site:'Sasti OC',from:'2026-11-01',to:'2026-11-20'}),null);
  assert.equal(full.days[0].register.rows[0].name,'Ram','without brief the saved sheet still comes back');
});

test('manual biometric save is immutable for the same site and day', async () => {
  const pool=fakePool({manual:true});let version=0;
  const store=createBiometricDayStore(pool,{manual:true,today:()=> '2026-11-23',load:async (_site,day)=>({...register(day),machines:[{serial:'JNP1',punches:++version}]})});
  const first=await store(hr,'POST',{site:'Sasti OC',day:'2026-11-02'},null,null);
  const second=await store(hr,'POST',{site:'Sasti OC',day:'2026-11-02'},null,null);
  assert.equal(first.punches,1);assert.equal(second.punches,1,'a saved manual day remains frozen');
  assert.equal(pool.audit[1][1],'SAVE_MANUAL_BIOMETRIC_DAY');
});

test('manual biometric saved logs can be deleted individually or together', async () => {
  const pool=fakePool({manual:true});const store=createBiometricDayStore(pool,{manual:true,today:()=> '2026-11-23',load:async (_site,day)=>register(day)});
  await store(hr,'POST',{site:'Sasti OC',day:'2026-11-02'},null,null);
  await store(hr,'POST',{site:'Sasti OC',day:'2026-11-03'},null,null);
  const one=await store(hr,'DELETE',{site:'Sasti OC',days:['2026-11-02']},null,null);
  assert.deepEqual([one.deleted,one.punches],[1,8]);
  const all=await store(hr,'DELETE',{site:'Sasti OC',days:['2026-11-03']},null,null);
  assert.deepEqual([all.deleted,pool.saved.size],[1,0]);
  assert.equal(pool.audit.at(-1)[1],'DELETE_MANUAL_BIOMETRIC_LOGS');
});

test('saved biometric lookup accepts the same site aliases as attendance', async () => {
  const pool=fakePool({sites:['Dhoptala OC'],manual:true});
  const siteKey=value=>String(value).toLowerCase().replace(/[()]/g,' ').replace(/\b(?:ob|oc)\b/g,'oc').replace(/\s+/g,' ').trim().replace(/^dhoptala oc(?: 2nd)?$/,'wcl-dhoptala');
  const store=createBiometricDayStore(pool,{manual:true,siteKey,today:()=> '2026-11-24',load:async (site,day)=>register(day)});
  const saved=await store(hr,'POST',{site:'Dhoptala OB 2nd',day:'2026-11-02'},null,null);
  assert.equal(saved.day,'2026-11-02');
  assert.ok(pool.saved.has('Dhoptala OC|2026-11-02'),'the canonical HR site name is used for the saved lock');
});

test('refuses today, another site, a bad day and too many days', async () => {
  const store = createBiometricDayStore(fakePool(), {load: async (s, d) => register(d), today: () => '2026-11-23'});
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-11-23'}, null, null), /Today is still running/);
  await assert.rejects(store(hr, 'POST', {site: 'Gevra', day: '2026-11-02'}, null, null), e => e.status === 403);
  await assert.rejects(store(hr, 'POST', {site: 'Sasti OC', day: '2026-02-30'}, null, null), /valid day/);
  await assert.rejects(store(hr, 'GET', {}, new URLSearchParams({site: 'Sasti OC', from: '2026-10-01', to: '2026-11-15'}), null), /up to 31 days/);
});
