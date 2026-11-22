import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMisEmployeeSync,mergeEmployees,employeeNumber} from './mis-employee-sync.mjs';
import {createApi} from './app.mjs';

const KEY='k'.repeat(40);

test('one line per employee number: the employee who joined through HR replaces the register line', ()=>{
 const register=[
  {employeeId:'CMLL0123',name:'Old Name',site:'Sasti OB',region:'WCL',department:'Ops',designation:'Driver',category:'Contract',status:''},
  {employeeId:'CMLL555',name:'Register Only',site:'Majri OB',region:'WCL',department:'',designation:'',category:'',status:'left'},
 ];
 const joined=[{employeeId:'CMPL123',name:'New Name',site:'Majri OB',region:'WCL',department:'Ops',designation:'Operator',category:'Permanent',status:''},
  {employeeId:'CMLL900',name:'Joined Only',site:'Jayant OB',region:'NCL',department:'',designation:'',category:'',status:'LEFT'}];
 const {employees,counts}=mergeEmployees(register,joined);
 assert.equal(employeeNumber('CMPL0123'),'123');
 assert.deepEqual(employees.map(row=>[row.employeeId,row.name,row.site,row.status,row.source]),[
  ['CMPL123','New Name','Majri OB','','HR joining'],['CMLL555','Register Only','Majri OB','LEFT','HR register'],['CMLL900','Joined Only','Jayant OB','LEFT','HR joining']]);
 assert.deepEqual(counts,{register:2,joined:2,replaced:1,lines:3});
});

test('the sync refuses without the key and reads only approved transfers', async()=>{
 const seen=[];
 const pool={query:async sql=>{seen.push(sql);return {rows:sql.includes("employeeTransfers")?[{id:'t1',code:'TR-1',transferDate:'2026-11-21',employeeId:'CMLL1',name:'A',fromSite:'Sasti OB',toSite:'Majri OB',fromDesignation:'',toDesignation:'',approvedAt:new Date('2026-11-21T10:00:00Z')}]:[]};}};
 await assert.rejects(createMisEmployeeSync(pool,{syncKey:''}).misEmployeeSync(KEY,'employees'),{status:503});
 await assert.rejects(createMisEmployeeSync(pool,{syncKey:'short'}).misEmployeeSync('short','employees'),{status:503});
 const sync=createMisEmployeeSync(pool,{syncKey:KEY});
 await assert.rejects(sync.misEmployeeSync('wrong','employees'),{status:401});
 await assert.rejects(sync.misEmployeeSync(undefined,'transfers'),{status:401});
 const result=await sync.misEmployeeSync(KEY,'transfers');
 assert.match(seen.at(-1),/t\.status='APPROVED'/);
 assert.deepEqual(result.transfers[0],{id:'t1',code:'TR-1',transferDate:'2026-11-21',employeeId:'CMLL1',name:'A',fromSite:'Sasti OB',toSite:'Majri OB',fromDesignation:'',toDesignation:'',approvedAt:'2026-11-21T10:00:00.000Z'});
 assert.equal((await sync.misEmployeeSync(KEY,'employees')).counts.lines,0);
 assert.ok(seen.every(sql=>/^\s*SELECT/i.test(sql)));
});

test('the route needs no Pulse sign-in, only GET, and passes the key header', async()=>{
 let got;
 const server=createApi({query:async()=>({}),service:{misEmployeeSync:async(key,what)=>{got=[key,what];return {ok:true};}}}).listen(0);
 try{
  const base=`http://127.0.0.1:${server.address().port}/api/integrations/mis/`;
  const ok=await fetch(base+'employees',{headers:{'X-MIS-Sync-Key':KEY}});
  assert.equal(ok.status,200);assert.deepEqual(got,[KEY,'employees']);
  assert.equal((await fetch(base+'transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,405);
  assert.equal((await fetch(base+'people')).status,404);
 }finally{server.close();}
});
