import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSiteRegister} from './attendance-register.mjs';

// A stand-in database for the queries loadSiteRegister and loadRegister make.
function fakeDb({machines = [], punches = [], employeeCodes = {}} = {}) {
  const links = {'SST01|1021': 'emp-1', 'SST02|1021': 'emp-1'}, names = {'SST01|1021': 'RAMESH', 'SST02|77': 'RAMU'};
  const place = {SST01: 'Main gate', SST02: 'Workshop'};
  const calls = [],parameters=[];
  return {calls,parameters, async query(sql, params = []) {
    calls.push(sql);
    parameters.push(params);
    if (/FROM hr_attendance_policy/.test(sql)) return {rows: []};
    if (/FROM hr_attendance_devices d LEFT JOIN hr_attendance_bridges/.test(sql)) return {rows: machines};
    if (/GROUP BY 1,2,3,4/.test(sql)) {
      const seen = new Map();
      for (const p of punches) seen.set(p.serial + '|' + p.id, {device_serial: p.serial, biometric_id: p.id, employee_id: links[p.serial + '|' + p.id] || employeeCodes[p.id]?.id || null, machine_name: names[p.serial + '|' + p.id] || '',match_count:links[p.serial + '|' + p.id]||employeeCodes[p.id]?1:0});
      return {rows: [...seen.values()]};
    }
    if (/^\s*SELECT e\.id,[\s\S]*FROM hr_employee_master_register e[\s\S]*WHERE e\.id=ANY/.test(sql)) {
      assert.ok(!sql.includes('$2::uuid[]'));
      return {rows: params[0].map(id=>{const employee=Object.values(employeeCodes).find(e=>e.id===id);return {...employee,a_form_no:employee?.aFormNo||'',site_id:'site-sasti',site_code:'WCL-SASTI',site:'Sasti OC',site_type:'',shift:'',starts:null,ends:null,daily_wage:'0'};})};
    }
    if (/FROM hr_attendance_links l\s+JOIN hr_records e/.test(sql)) {
      return {rows: params[1].map(id=>id==='emp-1'?{id: 'emp-1', code: 'CMLL1021', name: 'Ramesh Kumar', site_id: 'other-site', site: 'Gevra', site_type: 'Site', shift: 'A', starts: '06:00', ends: '14:00', designation: 'Dumper operator', department: 'Operations', daily_wage: '800'}:
       {...Object.values(employeeCodes).find(e=>e.id===id),site_id:'site-sasti',site:'Sasti OC',site_type:'Site',shift:'A',starts:'06:00',ends:'14:00',daily_wage:'800'})};
    }
    if (/SELECT (?:l.employee_id|e.id AS employee_id|a.employee_id),to_char/.test(sql)) {
      assert.deepEqual(params[3], machines.map(machine=>machine.serial));
      return {rows: punches.filter(p => links[p.serial + '|' + p.id]||employeeCodes[p.id]).map(p => ({employee_id: links[p.serial + '|' + p.id]||employeeCodes[p.id].id, at: p.at, place: place[p.serial]}))};
    }
    if (/l.employee_id IS NULL/.test(sql)) return {rows: punches.filter(p => !links[p.serial + '|' + p.id]).map(p => ({device_serial: p.serial, biometric_id: p.id, at: p.at}))};
    return {rows: []};
  }};
}
const site = {id: 'site-sasti', name: 'Sasti OC', siteType: 'Site'};
const machines = [{serial: 'SST01', name: 'ESSL K90', location: 'Main gate', last_contact: null, online: true, last_punch: '2026-11-02 14:08', punches: 3},
  {serial: 'SST02', name: 'ESSL face', location: 'Workshop', last_contact: null, online: false, last_punch: '2026-11-02 21:55', punches: 1}];

test('site roster: everyone who punched on the site machines, In / Out, each punch with its machine, unlinked IDs too', async () => {
  const db = fakeDb({machines, punches: [
    {serial: 'SST01', id: '1021', at: '2026-11-02 05:52'}, {serial: 'SST02', id: '1021', at: '2026-11-02 10:15'}, {serial: 'SST01', id: '1021', at: '2026-11-02 14:08'},
    {serial: 'SST02', id: '77', at: '2026-11-02 21:55'}
  ]});
  const result = await loadSiteRegister(db, site, '2026-11-02', '2026-11-02', '2026-11-22');
  assert.deepEqual(result.machines.map(m => [m.serial, m.location, m.online, m.punches]), [['SST01', 'Main gate', true, 3], ['SST02', 'Workshop', false, 1]]);
  const [ramesh, ramu] = result.rows;
  assert.deepEqual([ramesh.code, ramesh.linked, ramesh.site], ['CMLL1021', true, 'Gevra']);
  assert.deepEqual(ramesh.machinesUsed.sort(), ['Main gate · 1021', 'Workshop · 1021']);
  assert.deepEqual([ramesh.days[0].status, ramesh.days[0].in, ramesh.days[0].out], ['P', '05:52', '14:08']);
  assert.deepEqual(ramesh.days[0].punches, ['05:52 Main gate', '10:15 Workshop', '14:08 Main gate']);
  assert.deepEqual([ramu.code, ramu.name, ramu.linked, ramu.site], ['', 'RAMU', false, 'Sasti OC']);
  assert.deepEqual(ramu.machinesUsed, ['Workshop · 77']);
  assert.equal(ramu.days[0].in, '21:55');
});

test('site roster with no machine returns the empty list without reading punches', async () => {
  const db = fakeDb();
  const result = await loadSiteRegister(db, site, '2026-11-01', '2026-11-22', '2026-11-22');
  assert.deepEqual([result.machines, result.rows, result.site], [[], [], 'Sasti OC']);
  assert.ok(!db.calls.some(sql => /GROUP BY 1,2,3,4/.test(sql)));
});

test('manual biometric treats the imported value as employee code and shows the imported machine serial',async()=>{
 const importedMachine={...machines[0],serial:'JNP2242101100'};
 const db=fakeDb({machines:[importedMachine],employeeCodes:{'17416':{id:'emp-17416',code:'CMLL17416',name:'Anil Kumar',department:'Operations',designation:'Driver'}},punches:[
  {serial:'JNP2242101100',id:'17416',at:'2026-11-02 04:42'},{serial:'JNP2242101100',id:'17416',at:'2026-11-02 20:37'}
 ]});
 const result=await loadSiteRegister(db,site,'2026-11-02','2026-11-02','2026-11-22',{manual:true});
 const employee=result.rows[0];
 assert.deepEqual([employee.code,employee.name,employee.department,employee.designation,employee.site,employee.linked],['CMLL17416','Anil Kumar','Operations','Driver','Sasti OC',true]);
 assert.deepEqual(employee.machinesUsed,['JNP2242101100']);
 assert.ok(db.calls.some(sql=>/WITH punch_ids AS/.test(sql)&&/p\.punched_at>=\$2::date AND p\.punched_at<\$3::date\+1/.test(sql)&&/hr_employee_number\(e\.data->>'employeeId'\)=hr_employee_number\(p\.biometric_id\)/.test(sql)));
 const mappedRead=db.calls.findIndex(sql=>/WITH identity_map AS/.test(sql));
 assert.notEqual(mappedRead,-1,'linked manual punches use the already-resolved identity map');
 assert.doesNotMatch(db.calls[mappedRead],/JOIN hr_employee_master_register/);
 assert.deepEqual([...db.calls[mappedRead].matchAll(/\$(\d+)/g)].map(match=>Number(match[1])).sort((a,b)=>a-b),[1,2,3,4,5],
  'prepared statement parameters are sequential, so PostgreSQL can infer every type');
 assert.deepEqual(db.parameters[mappedRead],["2026-11-02","2026-11-02",['JNP2242101100'],['17416'],['emp-17416']]);
});

test('WCL manual biometric reads only unmatched IDs when loading a large imported log',async()=>{
 const importedMachine={...machines[0],serial:'MAJRI-01'};
 const db=fakeDb({machines:[importedMachine],punches:[
  {serial:'MAJRI-01',id:'17416',at:'2026-11-02 04:42'},
  {serial:'MAJRI-01',id:'UNKNOWN-7',at:'2026-11-02 20:37'}
 ],employeeCodes:{'17416':{id:'emp-17416',code:'CMLL17416',name:'Anil Kumar',department:'Operations',designation:'Driver'}}});
 await loadSiteRegister(db,{id:'site-majri',name:'Majri OB',siteType:'Site'},'2026-11-01','2026-11-27','2026-11-27',{manual:true});
 const index=db.calls.findIndex(sql=>/p\.biometric_id=ANY\(\$4::text\[\]\)/.test(sql));
 assert.notEqual(index,-1,'manual unmatched-punch query is restricted in SQL');
 assert.doesNotMatch(db.calls[index],/hr_attendance_links/);
 assert.deepEqual(db.parameters[index][3],['UNKNOWN-7']);
});

test('NCL manual biometric matches A-Form No. while WCL continues to match Employee ID',async()=>{
 const importedMachine={...machines[0],serial:'JNP-NCL'};
 const employee={id:'emp-aform',code:'CMLL9999',aFormNo:'AF009',name:'NCL Employee',department:'Production',designation:'Operator'};
 const db=fakeDb({machines:[importedMachine],employeeCodes:{'AF009':employee},punches:[{serial:'JNP-NCL',id:'AF009',at:'2026-11-02 06:00'}]});
 const result=await loadSiteRegister(db,{id:'site-ncl',name:'Dudhichua OB East',siteType:'Site'},'2026-11-02','2026-11-02','2026-11-26',{manual:true});
 assert.equal(result.rows[0].name,'NCL Employee');
 assert.equal(result.rows[0].aFormNo,'AF009');
 const reads=db.calls.filter(sql=>/hr_manual_biometric_punches/.test(sql));
 assert.ok(reads.some(sql=>/data->>'aFormNo'/.test(sql)&&/\[\^A-Z0-9\]/.test(sql)),'NCL uses normalized A-Form No.');
 assert.ok(reads.some(sql=>/WITH employee_aforms AS/.test(sql)&&/data->'sources'/.test(sql)&&/source->'fields'/.test(sql)&&/AFORMNUMBER/.test(sql)),'NCL builds one map from legacy imported A-Form fields');
 assert.ok(reads.some(sql=>/e\.site_id=\$4/.test(sql)),'NCL A-Form matching is limited to the selected site');
 assert.ok(reads.every(sql=>!/hr_employee_number\(e\.data->>'employeeId'\)=hr_employee_number\(p\.biometric_id\)/.test(sql)),'NCL never falls back to Employee ID');

 const wcl=fakeDb({machines:[importedMachine],employeeCodes:{'17416':{...employee,id:'emp-wcl'}},punches:[{serial:'JNP-NCL',id:'17416',at:'2026-11-02 06:00'}]});
 await loadSiteRegister(wcl,site,'2026-11-02','2026-11-02','2026-11-26',{manual:true});
 assert.ok(wcl.calls.some(sql=>/hr_employee_number\(e\.data->>'employeeId'\)=hr_employee_number\(p\.biometric_id\)/.test(sql)),'WCL keeps Employee ID matching');
});

test('manual biometric excludes people whose only punches are outside the selected dates',async()=>{
 const importedMachine={...machines[0],serial:'JNP2254200050'};
 const db=fakeDb({machines:[importedMachine],employeeCodes:{'1160':{id:'emp-1160',code:'CMLL1160',name:'Abbas Alam',department:'Maintenance',designation:'Dozer mechanic'}},punches:[
  {serial:'JNP2254200050',id:'1160',at:'2026-10-31 20:00'}
 ]});
 await loadSiteRegister(db,{id:'site-dudhichua',name:'Dudhichua OB East',siteType:'Site'},'2026-11-01','2026-11-20','2026-11-26',{manual:true});
 const idRead=db.calls.find(sql=>/punch_ids AS/.test(sql));
 assert.match(idRead,/p\.punched_at>=\$2::date AND p\.punched_at<\$3::date\+1/);
 assert.doesNotMatch(idRead,/\$2::date-1|\$3::date\+2/);
});

test('one day of a site roster never holds more than two database connections, and reads the policy and holidays once (28 Nov 2026)', async () => {
  const inner = fakeDb({machines, punches: [{serial: 'SST01', id: '1021', at: '2026-11-02 06:02'}, {serial: 'SST01', id: '1021', at: '2026-11-02 14:08'}, {serial: 'SST02', id: '77', at: '2026-11-02 09:00'}]});
  let running = 0, most = 0;
  const db = {async query(sql, params) { running++; most = Math.max(most, running); await new Promise(resolve => setTimeout(resolve, 5)); try { return await inner.query(sql, params); } finally { running--; } }};
  const register = await loadSiteRegister(db, site, '2026-11-02', '2026-11-02', '2026-11-23');
  assert.deepEqual(register.rows.map(r => [r.name, r.linked]), [['Ramesh Kumar', true], ['RAMU', false]], 'the same roster as before');
  assert.ok(most <= 2, `at most two lookups at a time, saw ${most}`);
  assert.equal(inner.calls.filter(sql => /FROM hr_attendance_policy/.test(sql)).length, 1, 'the policy is read once');
  assert.equal(inner.calls.filter(sql => /kind='holidays'/.test(sql)).length, 1, 'the holidays are read once');
});

test('lookups in turns keep their order and stop at the first failure', async () => {
  const {inTurns} = await import('./attendance-register.mjs');
  const order = [];
  const results = await inTurns([20, 5, 1, 10].map((ms, i) => async () => { await new Promise(resolve => setTimeout(resolve, ms)); order.push(i); return 'r' + i; }));
  assert.deepEqual(results, ['r0', 'r1', 'r2', 'r3']);
  assert.notDeepEqual(order, [0, 1, 2, 3], 'two run side by side');
  let started = 0;
  await assert.rejects(inTurns([async () => { started++; throw new Error('database busy'); }, async () => { started++; }, async () => { started++; }, async () => { started++; }], 1), /database busy/);
  assert.equal(started, 1);
});
