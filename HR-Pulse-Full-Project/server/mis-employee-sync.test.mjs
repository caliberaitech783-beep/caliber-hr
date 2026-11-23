import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createMisEmployeeSync,mergeEmployees,employeeNumber,employeeChanges,CHANGE_BATCH,RECENT_LIMIT,CHANGES_SQL,RECENT_SQL,REGISTER_FOR_SQL,JOINED_FOR_SQL} from './mis-employee-sync.mjs';
import {createApi} from './app.mjs';
// The way back (a site move made in Pulse-II) is checked with the copy: this file is on the list the deploy runs.
import './mis-site-move.test.mjs';

const KEY='k'.repeat(40);

test('one line per employee number: the same person who joined through HR replaces the register line', ()=>{
 const register=[
  {employeeId:'CMLL0123',name:'SAMPLE KUMAR DRIVER',site:'Sasti OB',region:'WCL',department:'Ops',designation:'Driver',category:'Contract',status:'',reportingTo:'A Manager',contact:'900',leavingDate:''},
  {employeeId:'CMLL555',name:'Register Only',site:'Majri OB',region:'WCL',department:'',designation:'',category:'',status:'left',leavingDate:'2026-11-20T00:00:00Z'},
 ];
 const joined=[{employeeId:'CMPL123',name:'Sample Kumar Driver',site:'Majri OB',region:'WCL',department:'Ops',designation:'Operator',category:'Permanent',status:''},
  {employeeId:'CMLL900',name:'Joined Only',site:'Jayant OB',region:'NCL',department:'',designation:'',category:'',status:'LEFT'}];
 const {employees,counts}=mergeEmployees(register,joined);
 assert.equal(employeeNumber('CMPL0123'),'123');
 assert.deepEqual(employees.map(row=>[row.employeeId,row.name,row.site,row.status,row.source]),[
  ['CMPL123','Sample Kumar Driver','Majri OB','','HR joining'],['CMLL555','Register Only','Majri OB','LEFT','HR register'],['CMLL900','Joined Only','Jayant OB','LEFT','HR joining']]);
 assert.deepEqual(counts,{register:2,joined:2,replaced:1,clashes:0,lines:3});
 // The work details Pulse-II takes; nothing personal (no Aadhaar, bank or salary) is in a line.
 assert.deepEqual(Object.keys(employees[1]),['employeeId','name','region','site','department','designation','category','status','reportingTo','contact','leavingDate','source']);
 assert.equal(employees[1].leavingDate,'2026-11-20');
});

test('a joining form on somebody else\'s number never replaces that person: both lines are sent', ()=>{
 const register=[{employeeId:'CMLL21227',name:'SAMPLE DRIVER',site:'Gauri Pauni OB 2nd',region:'WCL',designation:'VOLVO DRIVER',status:'ACTIV'}];
 const joined=[{employeeId:'CMLL21227',name:'New Office Person',site:'Dudhichua OB East',region:'NCL',designation:'Executive',status:''}];
 const {employees,counts}=mergeEmployees(register,joined);
 assert.deepEqual(employees.map(row=>[row.employeeId,row.name,row.source]),[['CMLL21227','SAMPLE DRIVER','HR register'],['CMLL21227','New Office Person','HR joining']]);
 assert.deepEqual(counts,{register:1,joined:1,replaced:0,clashes:1,lines:2});
});

test('the sync refuses without the key and reads only approved transfers', async()=>{
 const seen=[];
 const pool={query:async sql=>{seen.push(sql);return {rows:sql.includes("employeeTransfers")?[{id:'t1',code:'TR-1',transferDate:'2026-11-21',employeeId:'CMLL1',name:'A',fromSite:'Sasti OB',toSite:'Majri OB',fromDesignation:'',toDesignation:'',approvedAt:new Date('2026-11-21T10:00:00Z')}]:[]};}};
 await assert.rejects(createMisEmployeeSync(pool,{syncKey:''}).misEmployeeSync(KEY,'employees'),{status:503});
 await assert.rejects(createMisEmployeeSync(pool,{syncKey:'short'}).misEmployeeSync('short','employees'),{status:503});
 const sync=createMisEmployeeSync(pool,{syncKey:KEY});
 await assert.rejects(sync.misEmployeeSync('wrong','employees'),{status:401});
 await assert.rejects(sync.misEmployeeSync(undefined,'transfers'),{status:401});
 await assert.rejects(sync.misEmployeeSync('wrong','employee-changes',{after:'5'}),{status:401});
 const result=await sync.misEmployeeSync(KEY,'transfers');
 assert.match(seen.at(-1),/t\.status='APPROVED'/);
 assert.deepEqual(result.transfers[0],{id:'t1',code:'TR-1',transferDate:'2026-11-21',employeeId:'CMLL1',name:'A',fromSite:'Sasti OB',toSite:'Majri OB',fromDesignation:'',toDesignation:'',approvedAt:'2026-11-21T10:00:00.000Z'});
 assert.equal((await sync.misEmployeeSync(KEY,'employees')).counts.lines,0);
 assert.ok(seen.every(sql=>/^\s*SELECT/i.test(sql)));
});

// A stand-in for the change list and the two reads of the people named in it.
const changePool=({changes=[],recent=[],register=[],joined=[],missing=false}={})=>{
 const seen=[];
 return {seen,query:async(sql,params)=>{
  seen.push([sql,params]);
  if(missing&&sql===CHANGES_SQL)throw Object.assign(new Error('relation "hr_employee_changes" does not exist'),{code:'42P01'});
  if(sql===CHANGES_SQL)return {rows:changes.filter(row=>BigInt(row.seq)>BigInt(params[0])).slice(0,CHANGE_BATCH)};
  if(sql===RECENT_SQL)return {rows:recent.map(number=>({number}))};
  if(sql===REGISTER_FOR_SQL)return {rows:register.filter(row=>params[0].includes(employeeNumber(row.employeeId)))};
  if(sql===JOINED_FOR_SQL)return {rows:joined.filter(row=>params[0].includes(employeeNumber(row.employeeId)))};
  throw new Error('unexpected query');
 }};
};
const change=(seq,old_number,new_number)=>({seq:String(seq),old_number,new_number});

test('what changed after N: the people, the highest number read, and their lines as they are now', async()=>{
 const pool=changePool({changes:[change(11,'','22501'),change(12,'7001','7001'),change(13,'7001','7002'),change(14,'8000','')],
  register:[{employeeId:'CMLL7002',name:'RENUMBERED MAN',site:'Sasti OB',region:'WCL',status:''},{employeeId:'CMLL9999',name:'NOT ASKED',site:'Sasti OB',region:'WCL'}],
  joined:[{employeeId:'CMLL22501',name:'New Joiner',site:'Majri OB',region:'WCL',status:''}]});
 const result=await employeeChanges(pool,'10');
 assert.deepEqual([result.ready,result.after,result.latest,result.more],[true,'10','14',false]);
 assert.deepEqual(result.numbers,['22501','7001','7002','8000']);
 // 7001 and 8000 have no line any more: the old number of a renumbered person, and a removed person.
 assert.deepEqual(result.employees.map(row=>[row.employeeId,row.name,row.source]),[['CMLL7002','RENUMBERED MAN','HR register'],['CMLL22501','New Joiner','HR joining']]);
 // Asking again from the number just read: nothing new.
 const again=await employeeChanges(pool,'14');
 assert.deepEqual([again.latest,again.numbers,again.employees],['14',[],[]]);
 assert.ok(pool.seen.every(([sql])=>/^\s*SELECT/i.test(sql)),'the copy only reads');
 // A bad N reads from the start.
 assert.equal((await employeeChanges(pool,'abc')).after,'0');
});

test('the people changed in the last ten minutes are given again, unless a large import made too many', async()=>{
 const one=await employeeChanges(changePool({changes:[change(5,'','7005')],recent:['7001'],register:[{employeeId:'CMLL7001',name:'LATE COMMIT',site:'Sasti OB'}]}),'5');
 assert.deepEqual([one.latest,one.numbers,one.employees.map(row=>row.name)],['5',['7001'],['LATE COMMIT']]);
 const many=await employeeChanges(changePool({recent:Array.from({length:RECENT_LIMIT+1},(_,i)=>String(30000+i))}),'5');
 assert.deepEqual([many.latest,many.numbers.length],['5',0]);
 assert.match(RECENT_SQL,/at>now\(\)-interval '10 minutes'/);assert.match(RECENT_SQL,/seq<=\$1::bigint/);
});

test('a long list is read in parts, and a database without the change list says it is not ready', async()=>{
 const changes=Array.from({length:CHANGE_BATCH+3},(_,i)=>change(i+1,'',String(40000+i)));
 const pool=changePool({changes});
 const first=await employeeChanges(pool,'0');
 assert.deepEqual([first.more,first.latest,first.numbers.length],[true,String(CHANGE_BATCH),CHANGE_BATCH]);
 assert.equal(pool.seen.some(([sql])=>sql===RECENT_SQL),false,'the second look waits until the list is read to its end');
 const rest=await employeeChanges(pool,first.latest);
 assert.deepEqual([rest.more,rest.latest,rest.numbers.length],[false,String(CHANGE_BATCH+3),3]);
 const absent=await employeeChanges(changePool({missing:true}),'7');
 assert.deepEqual(absent,{ready:false,after:'7',latest:'7',more:false,numbers:[],employees:[]});
});

test('the route needs no Pulse sign-in, only GET, and passes the key header and N', async()=>{
 let got;
 const server=createApi({query:async()=>({}),service:{misEmployeeSync:async(key,what,options)=>{got=[key,what,options];return {ok:true};}}}).listen(0);
 try{
  const base=`http://127.0.0.1:${server.address().port}/api/integrations/mis/`;
  const ok=await fetch(base+'employees',{headers:{'X-MIS-Sync-Key':KEY}});
  assert.equal(ok.status,200);assert.deepEqual(got,[KEY,'employees',{after:null}]);
  assert.equal((await fetch(base+'employee-changes?after=120',{headers:{'X-MIS-Sync-Key':KEY}})).status,200);
  assert.deepEqual(got,[KEY,'employee-changes',{after:'120'}]);
  assert.equal((await fetch(base+'transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  assert.equal((await fetch(base+'employee-changes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  assert.equal((await fetch(base+'people')).status,404);
 }finally{server.close();}
});

test('the change list is written by the database and HR Pulse starts even if it cannot be made', ()=>{
 const schema=readFileSync(new URL('./employee-changes-schema.sql',import.meta.url),'utf8');
 for(const part of ['CREATE TABLE IF NOT EXISTS hr_employee_changes','CREATE OR REPLACE FUNCTION hr_employee_number(value text)','AFTER INSERT OR UPDATE OR DELETE ON hr_employee_master_register','AFTER INSERT OR UPDATE OR DELETE ON hr_records',"ARRAY['ACTIVE','APPROVED','INACTIVE']"])assert.ok(schema.includes(part),part);
 assert.equal(/DROP\s+(TABLE|TRIGGER)/i.test(schema),false,'a start-up never drops anything');
 const index=readFileSync(new URL('./index.mjs',import.meta.url),'utf8');
 assert.match(index,/employee-changes-schema\.sql',import\.meta\.url\),'utf8'\)\)\s*\.catch\(/);
});
