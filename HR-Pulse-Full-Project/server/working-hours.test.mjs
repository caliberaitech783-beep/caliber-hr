import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKING_HOURS_FIELD,WORKING_HOURS_OPTIONS,DEFAULT_WORKING_HOURS,allowedText,loadWorkingHours,masterLine,normalizeWorkingHours,setWorkingHours,sheetWorkingHours,workingHoursNumber,workingHoursOptions,workingHoursProblem} from './working-hours.mjs';
import {validate,modules,canWrite} from './modules.mjs';
import {readFileSync} from 'node:fs';
import './working-hours-import.test.mjs';
import {missingJoiningField} from './joining-required.mjs';
import {mergeEmployees,JOINED_SQL,REGISTER_SQL} from './mis-employee-sync.mjs';

test('Working Hours takes 8, 9, 10, 11 or 12 hours in any usual spelling', () => {
  for (const [value,hours] of [['08 HRS','8 hours'],['12 HRS.','12 hours'],['11 hrs','11 hours'],['9 HRS','9 hours']]) assert.equal(normalizeWorkingHours(value),hours);
  // The sites' sheets add words after the hours; only the Excel update reads those.
  assert.equal(normalizeWorkingHours('8 Hrs Day & Night'),null);
  for (const [value,hours] of [['8 Hrs Day & Night','8 hours'],['11 Hrs Day','11 hours'],['12 hrs','12 hours'],['',''],['LOCAL',null],['12',  '12 hours'],['7 hrs',null]]) assert.equal(sheetWorkingHours(value),hours,value);
  assert.deepEqual(WORKING_HOURS_OPTIONS,['8 hours','9 hours','10 hours','11 hours','12 hours']);
  for (const value of ['12','12 hrs','12 Hours','12h','12.0',12,' 12 hours ']) assert.equal(normalizeWorkingHours(value),'12 hours');
  assert.equal(normalizeWorkingHours('8 HRS'),'8 hours');
  assert.equal(normalizeWorkingHours(''),'');
  assert.equal(normalizeWorkingHours(undefined),'');
  for (const value of ['7','13 hours','24','twelve','12:00','8-12']) {
    assert.equal(normalizeWorkingHours(value),null,value);
    assert.match(workingHoursProblem(value),/8, 9, 10, 11 or 12 hours/);
  }
  assert.equal(workingHoursProblem('9 hours'),'');
  assert.equal(workingHoursNumber('10 hours'),10);
  assert.equal(workingHoursNumber(''),null);
  // A saved value whose line was switched off in the master still reaches Pulse-II.
  assert.equal(workingHoursNumber('7 hours'),7);
  assert.equal(workingHoursNumber('30'),null);
});

test('a new joining needs Working Hours; the dashboard check of older employees does not', () => {
  const office = {'Marital Status':'Single'};
  for (const key of ['Joining Category *','Employee Code','Full Name as per Aadhar','Full Name *','Father / Spouse Name *','Mobile *','Aadhaar No. *','PAN No.','Present Address','Reference Type','Reference Name','Emergency Contact Name','Emergency Contact Number','Department *','Sub-department *','Designation *','Employee Category','Reporting To','Joining Date *','Shift *','Employment Type','Salary Type','Site / Project','PT State','Candidate photo','Aadhaar (masked display)','Monthly Gross Salary']) office[key] = 'x';
  office['Joining Category *'] = 'CORPORATE'; office['Salary Type'] = 'STD';
  assert.equal(missingJoiningField(office),WORKING_HOURS_FIELD);
  assert.equal(missingJoiningField(office,{workingHours:false}),undefined);
  assert.equal(missingJoiningField({...office,[WORKING_HOURS_FIELD]:'12 hours'}),undefined);
});

test('the Pulse-II feed carries working hours as a number', () => {
  assert.match(JOINED_SQL,/'Working Hours \*'/);
  assert.match(REGISTER_SQL,/"workingHours"/);
  const {employees} = mergeEmployees(
    [{employeeId:'CMLL7740',name:'Ravi Patil',site:'Sasti OB',workingHours:''}],
    [{employeeId:'CMLL8812',name:'Ramesh Kumar',site:'Majri OB',workingHours:'12 hours'}],
  );
  assert.equal(employees.find(row=>row.employeeId==='CMLL8812').workingHours,12);
  assert.equal(employees.find(row=>row.employeeId==='CMLL7740').workingHours,null);
});

// Working Hour Master (owner, 28 Nov 2026): one list for Corporate / HO and OB / COAL.
test('Working Hour Master: its active hours are the only ones offered and accepted, the same for Corporate and Coal', async () => {
  const pool = rows => ({query:async(sql,params)=>{ assert.match(sql,/FROM hr_records WHERE kind=\$1/); assert.deepEqual(params,['workingHours']); return {rows}; }});
  // No line yet: the five starting hours.
  assert.deepEqual(await loadWorkingHours(pool([])),DEFAULT_WORKING_HOURS);
  // A fake database that answers every query with other rows is not taken for the master.
  assert.deepEqual(await loadWorkingHours(pool([{id:'x',name:'Someone'}])),DEFAULT_WORKING_HOURS);
  const allowed = await loadWorkingHours(pool([
    {kind:'workingHours',code:'12',status:'ACTIVE'},{kind:'workingHours',code:'7',status:'ACTIVE'},
    {kind:'workingHours',code:'8',status:'ACTIVE'},{kind:'workingHours',code:'10',status:'INACTIVE'}]));
  assert.deepEqual(allowed,[7,8,12]);
  assert.equal(normalizeWorkingHours('7 hrs',allowed),'7 hours');
  assert.equal(normalizeWorkingHours('10',allowed),null);
  assert.equal(workingHoursProblem('10',allowed),'Working Hours must be 7, 8 or 12 hours');
  assert.equal(sheetWorkingHours('7 Hrs Day & Night',allowed),'7 hours');
  assert.equal(allowedText([]),'one of the hours in Working Hour Master (none is active)');
  // The browser's list: set once from the master, read by every form.
  try {
    setWorkingHours([12,7,7,8,99]);
    assert.deepEqual(workingHoursOptions(),['7 hours','8 hours','12 hours']);
    assert.equal(normalizeWorkingHours('7'),'7 hours');
    assert.equal(normalizeWorkingHours('9'),null);
  } finally { setWorkingHours(undefined); }
  assert.deepEqual(workingHoursOptions(),WORKING_HOURS_OPTIONS);
});

test('Working Hour Master lines: whole hours 1 to 24, named by themselves, changed only by a head office login', () => {
  assert.equal(modules.workingHours.menu,'Master Configuration');
  assert.deepEqual(validate('workingHours',{code:' 07 ',name:'anything',remarks:'Office drivers'}),{code:'7',name:'7 hours',remarks:'Office drivers'});
  assert.deepEqual(masterLine({code:'12 hours'}),{code:'12',name:'12 hours'});
  for (const code of ['0','25','7.5','seven']) assert.throws(()=>validate('workingHours',{code}),error=>error.status===400,code);
  assert.equal(canWrite({permissions:{hrDesktopAccess:['Master Configuration']}},'workingHours'),true);
  assert.equal(canWrite({permissions:{hrDesktopAccess:['Employee Master']}},'workingHours'),false);
  // A site login is refused for a global master (locationAccess), and the five starting hours are seeded once.
  const service = readFileSync(new URL('./service.mjs',import.meta.url),'utf8');
  assert.match(service,/'Global master changes require an account without a si/);
  assert.doesNotMatch(service.match(/!\[\.\.\.complianceKinds,[^\]]*\]/)[0],/workingHours/);
  const schema = readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
  for (const hours of DEFAULT_WORKING_HOURS) assert.match(schema,new RegExp("'workingHours','"+hours+"','"+hours+" hours'"));
  assert.match(schema,/'workingHours','12','12 hours'[^;]*ON CONFLICT DO NOTHING;/);
});
