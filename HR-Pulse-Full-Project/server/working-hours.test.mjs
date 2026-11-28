import test from 'node:test';
import assert from 'node:assert/strict';
import {WORKING_HOURS_FIELD,WORKING_HOURS_OPTIONS,normalizeWorkingHours,sheetWorkingHours,workingHoursNumber,workingHoursProblem} from './working-hours.mjs';
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
  assert.equal(workingHoursNumber('7'),null);
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
