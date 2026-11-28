import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkingHoursImport,readWorkingHoursSheets} from './working-hours-import.mjs';
import {createEmployeeMasterRegister} from './employee-master-register.mjs';

const menus = ['Master Configuration','Employee Master'];
const admin = {actor:'hr-test',permissions:{hrDesktopAccess:menus}};

test('the hour-wise workbook: every site lays its sheet out differently, the columns are found by what is in them', () => {
  const {entries,problems,sheets} = readWorkingHoursSheets([
    {name:'DHOPTALA OB ',rows:[['SL. No','Emp Id','Id','AADHAR NO',"EMPLOYEE'S NAME",'DESIGNATION','Hours'],
      [1,'CMPL18952',18952,617500000000,'FIRST MAN','TIPPER DRIVER','8 hrs'],[2,'CMPL20143',20143,520800000000,'SECOND MAN','TIPPER DRIVER','12 Hrs']]},
    {name:'DUDHICHUA EAST OB',rows:[['SL. No','EMPLOYEE ID',"EMPLOYEE'S NAME",'RESIDENT','Remarks'],
      [1,'CMPL17863','THIRD MAN','CAMP','12 hrs'],[2,'LEFT','GONE MAN','CAMP','8 Hrs'],[3,'CMPL13410','FOURTH MAN','SELF','']]},
    {name:'GOURI POUNI OB',rows:[['SL.NO','EMO ID','CMLL ID','NAME','SHIFT TIME','Shift Hours'],
      [1,20287,'CMLL20287','FIFTH MAN','5AM TO 1PM','8 Hrs Day & Night'],[2,20819,'CMLL20819','SIXTH MAN','5AM TO 1PM','11 Hrs Day']]},
    {name:'JAYANT OB ',rows:[['SR.NO','CMPL EMPL ID','W.HRS','NAME OF EMPLOYEES',"FATHER'S NAME"],[1,'CMPL12093','08 HRS','SEVENTH MAN','A FATHER'],[2,'cmpl 5334','12 HRS.','EIGHTH MAN','B FATHER']]},
    {name:'NOTES',rows:[['Remark'],['Prepared by HR']]},
  ]);
  assert.deepEqual(entries.map(entry=>[entry.sheet,entry.row,entry.employeeId,entry.name,entry.hours]),[
    ['DHOPTALA OB',2,'CMPL18952','FIRST MAN','8 hours'],['DHOPTALA OB',3,'CMPL20143','SECOND MAN','12 hours'],
    ['DUDHICHUA EAST OB',2,'CMPL17863','THIRD MAN','12 hours'],
    ['GOURI POUNI OB',2,'CMLL20287','FIFTH MAN','8 hours'],['GOURI POUNI OB',3,'CMLL20819','SIXTH MAN','11 hours'],
    ['JAYANT OB',2,'CMPL12093','SEVENTH MAN','8 hours'],['JAYANT OB',3,'CMPL5334','EIGHTH MAN','12 hours']]);
  assert.deepEqual(problems.map(line=>[line.sheet,line.row,line.reason]),[
    ['DUDHICHUA EAST OB',3,'No Employee ID on this row'],['DUDHICHUA EAST OB',4,'No hours on this row']]);
  assert.deepEqual(sheets.map(sheet=>[sheet.sheet,sheet.read,sheet.idColumn||'',sheet.hoursColumn||'']),[
    ['DHOPTALA OB',2,'Emp Id','Hours'],['DUDHICHUA EAST OB',1,'EMPLOYEE ID','Remarks'],['GOURI POUNI OB',2,'CMLL ID','Shift Hours'],['JAYANT OB',2,'CMPL EMPL ID','W.HRS'],['NOTES',0,'','']]);
  // Only the Employee ID, the name and the hours are read from a row.
  assert.deepEqual(Object.keys(entries[0]),['sheet','row','employeeId','name','hours']);
});

function database({register,joined}) {
  const statements = [];
  const db = {release(){},query:async(sql,params)=>{
    statements.push({sql,params});
    if (sql.includes('FROM hr_employee_master_register WHERE')) return {rows:register};
    if (sql.includes("FROM hr_records e WHERE e.kind='employees'")) return {rows:joined};
    return {rows:[],rowCount:1};
  }};
  return {db,statements,pool:{connect:async()=>db,query:async()=>({rows:[]})}};
}
const register = [
  {id:'10000000-0000-4000-8000-000000000001',name:'FIRST MAN',site:'Majri OB',employee_id:'CMLL101',hours:''},
  {id:'10000000-0000-4000-8000-000000000002',name:'SECOND MAN',site:'Majri OB',employee_id:'CMLL102',hours:'12 hours'},
  {id:'10000000-0000-4000-8000-000000000003',name:'TWIN ONE',site:'Majri OB',employee_id:'CMLL103',hours:''},
  {id:'10000000-0000-4000-8000-000000000004',name:'TWIN TWO',site:'Sasti OB',employee_id:'CMPL103',hours:''},
  {id:'10000000-0000-4000-8000-000000000005',name:'SOMEBODY ELSE',site:'Majri OB',employee_id:'CMLL104',hours:''},
  {id:'10000000-0000-4000-8000-000000000006',name:'BOTH PLACES',site:'Majri OB',employee_id:'CMLL105',hours:'8 hours'},
  {id:'10000000-0000-4000-8000-000000000008',name:'TWO HOURS',site:'Majri OB',employee_id:'CMLL107',hours:''},
];
const joined = [{id:'20000000-0000-4000-8000-000000000007',name:'Both Places',employee_id:'CMLL105',hours:''}];
const rows = [
  {employeeId:'CMPL101',name:'FIRST MAN',hours:'8 hours',sheet:'MAJRI OB',row:2},
  {employeeId:'CMPL102',name:'SECOND MAN',hours:'12 hours',sheet:'MAJRI OB',row:3},
  {employeeId:'CMPL103',name:'TWIN ONE',hours:'8 hours',sheet:'MAJRI OB',row:4},
  {employeeId:'CMPL104',name:'RAM KUMAR YADAV',hours:'8 hours',sheet:'MAJRI OB',row:5},
  {employeeId:'CMPL105',name:'BOTH PLACES',hours:'12 hours',sheet:'MAJRI OB',row:6},
  {employeeId:'CMPL999',name:'NOT LISTED',hours:'8 hours',sheet:'MAJRI OB',row:7},
  {employeeId:'CMPL107',name:'TWO HOURS',hours:'8 hours',sheet:'MAJRI OB',row:8},
  {employeeId:'CMLL107',name:'TWO HOURS',hours:'12 hours',sheet:'JAYANT OB',row:9},
  {employeeId:'CMLL101',name:'FIRST MAN',hours:'8 hours',sheet:'JAYANT OB',row:10},
];
// CMPL104 has another spelling of the name in Employee Master: it goes by Employee ID, so it is updated and listed.
const expected = {rows:9,people:7,updated:3,same:1,registerLines:3,joinedEmployees:1,held:{notFound:1,twoLines:1,twoHours:1},nameDiffers:1};
const figures = result => ({rows:result.rows,people:result.people,updated:result.updated,same:result.same,registerLines:result.registerLines,joinedEmployees:result.joinedEmployees,held:result.held,nameDiffers:result.nameDiffers});

test('the preview says what would change and writes nothing', async()=>{
  const {pool,statements} = database({register,joined});
  const result = await createWorkingHoursImport(pool).importEmployeeWorkingHours(admin,{rows});
  assert.equal(result.applied,false);
  assert.deepEqual(figures(result),expected);
  assert.equal(result.lists.notFound[0].employeeId,'CMPL999');
  assert.match(result.lists.twoLines[0].detail,/TWIN ONE, Majri OB \/ TWIN TWO, Sasti OB/);
  assert.equal(result.lists.otherName,undefined);
  assert.deepEqual([result.nameDiffersList[0].employeeId,result.nameDiffersList[0].name,result.nameDiffersList[0].detail],['CMPL104','RAM KUMAR YADAV','Employee Master: SOMEBODY ELSE']);
  assert.match(result.lists.twoHours[0].detail,/8 hours.*12 hours/);
  assert.equal(statements.some(({sql})=>/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)),false);
  assert.equal(statements.some(({sql})=>sql.includes('FOR UPDATE')),false);
  assert.equal(statements.at(-1).sql,'ROLLBACK');
});

test('the update writes Working Hours only: no line is added, removed or moved and no other field is touched', async()=>{
  const {pool,statements} = database({register,joined});
  const result = await createWorkingHoursImport(pool).importEmployeeWorkingHours(admin,{rows,apply:true});
  assert.equal(result.applied,true);
  assert.deepEqual(figures(result),expected);
  const writes = statements.filter(({sql})=>/^\s*(UPDATE|INSERT|DELETE)/i.test(sql));
  assert.equal(writes.length,3);
  const [toRegister,toJoined,audit] = writes;
  assert.match(toRegister.sql,/UPDATE hr_employee_master_register r SET data=r\.data\|\|jsonb_build_object\('workingHours',e\.hours\),version=r\.version\+1\s+FROM jsonb_to_recordset/);
  assert.deepEqual(JSON.parse(toRegister.params[0]),[{id:register[0].id,hours:'8 hours'},{id:register[4].id,hours:'8 hours'},{id:register[5].id,hours:'12 hours'}]);
  assert.equal(audit.params[1].nameDiffers,1);
  assert.match(toJoined.sql,/UPDATE hr_records r SET data=jsonb_set\(/);
  assert.match(toJoined.sql,/ARRAY\['officeData',\$2::text\],to_jsonb\(e\.hours\)\),version=r\.version\+1,updated_by=\$3,updated_at=now\(\)/);
  assert.deepEqual([JSON.parse(toJoined.params[0]),toJoined.params[1],toJoined.params[2]],[[{id:joined[0].id,hours:'12 hours'}],'Working Hours *','hr-test']);
  assert.match(audit.sql,/INSERT INTO hr_audit/);
  assert.deepEqual(audit.params[1].fields,['workingHours']);
  for (const {sql} of writes.slice(0,2)) assert.doesNotMatch(sql,/site_|name=|status|DELETE|employeeId/);
  assert.equal(statements.at(-1).sql,'COMMIT');
});

test('the update needs both HR menus, real Employee IDs and hours of 8 to 12', async()=>{
  const service = createWorkingHoursImport(database({register,joined}).pool);
  await assert.rejects(service.importEmployeeWorkingHours({actor:'x',permissions:{hrDesktopAccess:['Employee Master']}},{rows}),{status:403});
  await assert.rejects(service.importEmployeeWorkingHours(admin,{rows:[]}),/1 to 15,000/);
  await assert.rejects(service.importEmployeeWorkingHours(admin,{rows:[{employeeId:'LEFT',hours:'8 hours'}]}),/valid Employee ID/);
  await assert.rejects(service.importEmployeeWorkingHours(admin,{rows:[{employeeId:'CMPL101',hours:'7 hours'}]}),/8, 9, 10, 11 or 12/);
});

test('one register line takes Working Hours on Edit, and nothing but 8 to 12 hours', async()=>{
  const id = '10000000-0000-4000-8000-000000000001', writes = [];
  const db = {release(){},query:async(sql,params)=>{
    if (sql.includes('SELECT version,site_id')) return {rows:[{version:1,site_id:'s',site_code:'WCL-MAJRI',site_name:'Majri OB',name:'FIRST MAN',employee_id:'CMLL101'}]};
    if (sql.startsWith('UPDATE hr_employee_master_register')) writes.push(JSON.parse(params[1]));
    return {rows:[],rowCount:1};
  }};
  const service = createEmployeeMasterRegister({connect:async()=>db,query:async()=>({rows:[]})});
  await service.updateEmployeeMasterRegister(admin,id,{version:1,changes:{workingHours:'12 hrs'}});
  assert.deepEqual(writes,[{workingHours:'12 hours'}]);
  await assert.rejects(service.updateEmployeeMasterRegister(admin,id,{version:1,changes:{workingHours:'7'}}),/8, 9, 10, 11 or 12 hours/);
});
