// One employee number, one person (owner, 23 Nov 2026). Until this rule a new joiner's number was counted from the
// joining forms alone and landed on numbers the Employee Master register already gave to working drivers.
// The people and numbers below are made up.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {employeeNumber,typedIdProblem,nextEmployeeNumber,samePerson,heldNumbers,numberHolders,otherPersonWithNumber,holderLine,NUMBER_FLOOR} from './employee-number.mjs';
import {createEmployeeMasterRegister,isEmployeeEntry} from './employee-master-register.mjs';
import {employeeNumber as feedNumber} from './mis-employee-sync.mjs';

const menus=['Master Configuration','Employee Master'];
const admin={actor:'hr-test',permissions:{hrDesktopAccess:menus}};
const siteId='20000000-0000-4000-8000-000000000008';

test('CMPL123, CMLL123, "CMLL 123" and 123 are one number; what is not a number is nothing',()=>{
 for(const id of ['CMPL123','CMLL123','cmll 123','CMLL-123','123','CMLL0123'])assert.equal(employeeNumber(id),'123',id);
 for(const id of ['','LEFT','ID PROBLEM','0','CMLL','CMLLCMPL6665','E123'])assert.equal(employeeNumber(id),'',id);
 assert.equal(feedNumber,employeeNumber,'the copy to Pulse-II reads a number the same way');
});

test('an ID typed on a register line is empty or a plain number; a slash number is refused',()=>{
 for(const id of ['','CMLL12345','CMPL12345','CMLL 7554','CMLL-04','12345'])assert.equal(typedIdProblem(id),'',id);
 for(const id of ['CMLL6665/1','LEFT','ID PROBLEM','0','CMLL','CMLL12A','CMLL 12 34'])assert.match(typedIdProblem(id),/digits only/,id);
});

test('a new number is above the old numbering and never one somebody holds',()=>{
 assert.equal(NUMBER_FLOOR,22500);
 // The joining forms had reached 21227 while the register and Pulse-II held everything up to 22356.
 assert.equal(nextEmployeeNumber([21124,21224,21227,21955,22227],[21124,21224,21227]),22501);
 // Once HR Pulse has issued numbers, the count goes on from its own last one.
 assert.equal(nextEmployeeNumber([21227,22501,22502],[21227,22501,22502]),22503);
 // A stray number that already exists is skipped when reached, wherever it is held.
 assert.equal(nextEmployeeNumber([22501,22502,22503,70000],[22501]),22504);
 assert.equal(nextEmployeeNumber([22501,22502,22504],[22501,22502]),22503);
 assert.equal(nextEmployeeNumber([69999,70000,70001],[69999]),70002);
 assert.equal(nextEmployeeNumber([],[]),22501);
});

test('two names of one person, and two people',()=>{
 assert.equal(samePerson('Sample Kumar Patel','SAMPLE KUMAR PATEL'),true);
 assert.equal(samePerson('SAMPLE','SAMPLE YADAV'),true,'a short form of the same name');
 assert.equal(samePerson('SAMPLE KUMAR PATEL','SAMPLE PATEL'),true);
 assert.equal(samePerson('First Kumar Example','OTHER RAY'),false);
 assert.equal(samePerson('RAM KUMAR YADAV','SHYAM KUMAR SINGH'),false,'a shared middle name is not the same person');
 assert.equal(samePerson('RAM KUMAR','RAM SINGH'),false,'the same first name alone is not enough when both have more');
 assert.equal(samePerson('',''),false);assert.equal(samePerson('RAM',''),false);
});

// A small stand-in for the two tables: register lines and hr_records.
const store=({register=[],records=[]}={})=>{
 const clean=value=>String(value??'').toUpperCase().replace(/[\s/-]/g,'');
 return {register,records,async query(sql,params=[]){
  if(sql.includes("UNION ALL SELECT code AS id,kind AS source"))return {rows:[...register.map(row=>({id:row.employeeId,source:'register'})),...records.filter(row=>['employees','employeeCodes'].includes(row.kind)).map(row=>({id:row.code,source:row.kind}))]};
  if(sql.includes('FROM hr_employee_master_register')&&sql.includes('~ $1')){const pattern=new RegExp(params[0]);return {rows:register.filter(row=>pattern.test(clean(row.employeeId))&&row.id!==params[1]).map(row=>({id:row.id,name:row.name,site:row.site,code:row.employeeId}))};}
  if(sql.includes("r.kind='employees'")&&sql.includes('~ $1')){const pattern=new RegExp(params[0]);return {rows:records.filter(row=>row.kind==='employees'&&!['REJECTED','CANCELLED'].includes(row.status)&&pattern.test(clean(row.code))&&row.id!==params[1]).map(row=>({id:row.id,name:row.name,code:row.code,site:row.site||null}))};}
  throw new Error('unexpected query: '+sql.slice(0,80));
 }};
};

test('every held number counts: register lines, joining forms and reserved numbers',async()=>{
 const db=store({register:[{id:'r1',employeeId:'CMLL21227',name:'SAMPLE DRIVER',site:'Gauri Pauni OB 2nd'},{id:'r2',employeeId:'LEFT',name:'GONE MAN',site:'Jayant OB'},{id:'r3',employeeId:'22227',name:'STRAY',site:'Majri OB'}],
  records:[{id:'e1',kind:'employees',code:'CMLL21124',name:'Form Person',status:'ACTIVE'},{id:'c1',kind:'employeeCodes',code:'CMLL22501',name:'Reserved employee code',status:'ACTIVE'},{id:'x',kind:'sites',code:'WCL-MAJRI',name:'Majri OB',status:'ACTIVE'}]});
 const {held,issued}=await heldNumbers(db,isEmployeeEntry);
 assert.deepEqual([...held].sort((a,b)=>a-b),[21124,21227,22227,22501]);
 assert.deepEqual([...issued].sort((a,b)=>a-b),[21124,22501],'only the numbers HR Pulse gave move its own count');
 assert.equal(nextEmployeeNumber(held,issued),22502);
});

test('who holds a number: a register line or a live joining form, whatever the prefix or spacing',async()=>{
 const db=store({register:[{id:'r1',employeeId:'CMLL 21227',name:'SAMPLE DRIVER',site:'Gauri Pauni OB 2nd'},{id:'r2',employeeId:'CMLL212270',name:'TEN TIMES',site:'Sasti OB'}],
  records:[{id:'e1',kind:'employees',code:'CMPL21227',name:'Office Person',status:'ACTIVE',site:'Nagpur CO'},{id:'e2',kind:'employees',code:'CMLL21227',name:'Rejected Person',status:'REJECTED'}]});
 const holders=await numberHolders(db,'CMLL21227',{registerFilter:isEmployeeEntry});
 assert.deepEqual(holders.map(holder=>[holder.where,holder.name]),[['Employee Master','SAMPLE DRIVER'],['a joining form','Office Person']]);
 assert.equal(holderLine(holders[0]),'SAMPLE DRIVER (Gauri Pauni OB 2nd) in Employee Master');
 assert.deepEqual((await numberHolders(db,'21227',{registerFilter:isEmployeeEntry,exceptRecordId:'e1',exceptRegisterId:'r1'})),[]);
 assert.deepEqual(await numberHolders(db,'LEFT',{registerFilter:isEmployeeEntry}),[]);
});

test('a joining form may carry the person\'s own number, never somebody else\'s',async()=>{
 const db=store({register:[{id:'r1',employeeId:'CMLL21227',name:'SAMPLE DRIVER',site:'Gauri Pauni OB 2nd'}],records:[{id:'e9',kind:'employees',code:'CMLL0003',name:'DUMMY',status:'ACTIVE',site:'Nagpur CO'}]});
 const check=(code,name,exceptRecordId)=>otherPersonWithNumber(db,{code,name,registerFilter:isEmployeeEntry,exceptRecordId});
 assert.equal((await check('CMLL21227','New Office Person')).name,'SAMPLE DRIVER','the number of a working driver');
 assert.equal(await check('CMPL21227','Sample Driver'),null,'the same person rejoining keeps the number');
 assert.equal((await check('CMLL3','Real Mechanic')).name,'DUMMY','CMLL0003 and CMLL3 are one number');
 assert.equal(await check('CMLL0003','DUMMY','e9'),null,'a form is not its own clash');
 assert.equal(await check('CMLL22501','Anybody'),null);
 assert.equal(await check('ABC001','Other company'),null,'another company\'s code is not our numbering');
});

test('the register: a changed ID must be a number that no other line holds; an unchanged one never blocks an edit',async()=>{
 const lineId='20000000-0000-4000-8000-000000000009',writes=[];
 const lines=[{id:'other-line',employeeId:'CMLL7001',name:'OTHER MAN',site:'Sasti OB'}];
 const inner=store({register:lines,records:[{id:'f1',kind:'employees',code:'CMLL7002',name:'Form Person',status:'ACTIVE',site:'Nagpur CO'}]});
 let current='CMLL6665';
 const db={release(){},query:async(sql,params)=>{
  if(sql.includes('FOR UPDATE'))return {rows:[{version:3,site_id:siteId,site_code:'WCL-SASTI',site_name:'Sasti OB',name:'SAMPLE WORKER',employee_id:current}]};
  if(sql.includes('UPDATE hr_employee_master_register')){writes.push(params[1]);return {rowCount:1};}
  if(sql.includes('~ $1'))return inner.query(sql,params);
  return {rowCount:0};
 }};
 const service=createEmployeeMasterRegister({connect:async()=>db,query:async()=>({rows:[{id:siteId}]})});
 const edit=changes=>service.updateEmployeeMasterRegister(admin,lineId,{version:3,changes});
 await assert.rejects(edit({employeeId:'CMLL6665/1'}),{status:400,message:/digits only/});
 await assert.rejects(edit({employeeId:'CMLL7001'}),{status:409,message:'CMLL7001 is already held by OTHER MAN (Sasti OB) in Employee Master. One number can be on one line only.'});
 await assert.rejects(edit({employeeId:'CMLL7002'}),{status:409,message:/already held by Form Person \(Nagpur CO\) in a joining form/});
 assert.equal(writes.length,0);
 assert.deepEqual(await edit({employeeId:'CMLL7003',contact:'123'}),{saved:true});
 assert.deepEqual(await edit({employeeId:''}),{saved:true},'an ID can be cleared');
 // A line that already holds a bad or shared ID can still be opened and corrected in its other fields.
 current='LEFT';
 assert.deepEqual(await edit({employeeId:'LEFT',status:'LEFT'}),{saved:true});
 current='CMLL7001';
 assert.deepEqual(await edit({employeeId:'CMLL7001',name:'SAMPLE WORKER SR'}),{saved:true});
 assert.equal(writes.length,4);
});

test('the register import does not add a second line for a number that is already there',async()=>{
 const stored=[{import_key:'k-existing',id:'CMLL8001'}],inserted=[];
 const db={release(){},query:async(sql,params)=>{
  if(sql.startsWith('SELECT id, code'))return {rows:[{id:siteId,code:'WCL-SASTI'},{id:siteId,code:'WCL-MAJRI'}]};
  if(sql.startsWith('SELECT import_key')){assert.ok(sql.includes(isEmployeeEntry));return {rows:stored};}
  if(sql.includes('INSERT INTO hr_employee_master_register')){const batch=JSON.parse(params[1]);inserted.push(...batch);return {rowCount:batch.length};}
  return {rowCount:0};
 }};
 const service=createEmployeeMasterRegister({connect:async()=>db});
 const row=(key,employeeId,name,siteCode='WCL-SASTI')=>({key:key.repeat(64),siteCode,name,employeeId,department:'',designation:'',category:'',reportingTo:'',contact:'',email:'',status:'',sources:[{label:'Test workbook',fields:[['Employee Name',name]]}]});
 const result=await service.importEmployeeMasterRegister(admin,[
  row('a','CMLL8001','SAME NUMBER OTHER SITE','WCL-MAJRI'),   // held by another line already
  row('b','CMLL8002','NEW MAN'),
  row('c','CMPL8002','SECOND LINE IN THE FILE','WCL-MAJRI'),  // the same number twice in one file
  row('d','LEFT','NO NUMBER ONE'),row('e','LEFT','NO NUMBER TWO'), // lines without a number are not compared
 ]);
 assert.deepEqual(inserted.map(line=>line.name),['NEW MAN','NO NUMBER ONE','NO NUMBER TWO']);
 assert.deepEqual([result.inserted,result.alreadyImported,result.numberOnAnotherLine],[3,0,2]);
 assert.deepEqual(result.notAdded,[{employeeId:'CMLL8001',name:'SAME NUMBER OTHER SITE',site:'Majri OB'},{employeeId:'CMLL8002',name:'SECOND LINE IN THE FILE',site:'Majri OB'}]);
});

test('the service asks the register too when it gives a number or saves a joining form',()=>{
 const service=readFileSync(new URL('./service.mjs',import.meta.url),'utf8');
 assert.ok(service.includes('const {held,issued}=await heldNumbers(db,isEmployeeEntry);next=nextEmployeeNumber(held,issued);'));
 assert.ok(service.includes("if(kind==='employees'&&(!existing||employeeNumber(existing.code)!==employeeNumber(data.code))){"));
 assert.ok(service.includes("await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['employee-code:'+(ours?'CMLL':prefix)]);"),'CMLL and CMPL share one count');
});
