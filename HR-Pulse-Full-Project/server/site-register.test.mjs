import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSiteRegister} from './attendance-register.mjs';

// A stand-in database for the queries loadSiteRegister and loadRegister make.
function fakeDb({machines = [], punches = [], employeeCodes = {}} = {}) {
  const links = {'SST01|1021': 'emp-1', 'SST02|1021': 'emp-1'}, names = {'SST01|1021': 'RAMESH', 'SST02|77': 'RAMU'};
  const place = {SST01: 'Main gate', SST02: 'Workshop'};
  const calls = [];
  return {calls, async query(sql, params = []) {
    calls.push(sql);
    if (/FROM hr_attendance_policy/.test(sql)) return {rows: []};
    if (/FROM hr_attendance_devices d LEFT JOIN hr_attendance_bridges/.test(sql)) return {rows: machines};
    if (/GROUP BY 1,2,3,4/.test(sql)) {
      const seen = new Map();
      for (const p of punches) seen.set(p.serial + '|' + p.id, {device_serial: p.serial, biometric_id: p.id, employee_id: links[p.serial + '|' + p.id] || employeeCodes[p.id]?.id || null, machine_name: names[p.serial + '|' + p.id] || ''});
      return {rows: [...seen.values()]};
    }
    if (/FROM hr_employee_master_register e\s+WHERE e.id=ANY/.test(sql)) {
      assert.ok(!sql.includes('$2::uuid[]'));
      return {rows: params[0].map(id=>({...Object.values(employeeCodes).find(e=>e.id===id),site_id:'site-sasti',site_code:'WCL-SASTI',site:'Sasti OC',site_type:'',shift:'',starts:null,ends:null,daily_wage:'0'}))};
    }
    if (/FROM hr_attendance_links l\s+JOIN hr_records e/.test(sql)) {
      return {rows: params[1].map(id=>id==='emp-1'?{id: 'emp-1', code: 'CMLL1021', name: 'Ramesh Kumar', site_id: 'other-site', site: 'Gevra', site_type: 'Site', shift: 'A', starts: '06:00', ends: '14:00', designation: 'Dumper operator', department: 'Operations', daily_wage: '800'}:
       {...Object.values(employeeCodes).find(e=>e.id===id),site_id:'site-sasti',site:'Sasti OC',site_type:'Site',shift:'A',starts:'06:00',ends:'14:00',daily_wage:'800'})};
    }
    if (/SELECT (?:l.employee_id|e.id AS employee_id),to_char/.test(sql)) {
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
 assert.deepEqual([employee.code,employee.name,employee.department,employee.designation,employee.linked],['CMLL17416','Anil Kumar','Operations','Driver',true]);
 assert.deepEqual(employee.machinesUsed,['JNP2242101100']);
 assert.ok(db.calls.some(sql=>/WITH punch_ids AS/.test(sql)&&/hr_employee_number\(e\.data->>'employeeId'\)=hr_employee_number\(p\.biometric_id\)/.test(sql)));
});
