import {validate} from './modules.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

for(const kind of ['employeeTransfers','outDutyRequests'])test(kind+' drafts respect employee site scope and never change the employee posting',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const input={code:'TR-1',name:'Transfer',employeeId:id,transferDate:'2026-10-27',outDutyDate:'2026-10-28',toDate:'2026-10-29',designation:'Operator',department:'Operations',siteId:id,purpose:'Site meeting',visitLocation:'Nagpur',fromSiteId:id,toSiteId:'00000000-0000-4000-8000-000000000002',fromDesignation:'Operator',toDesignation:'Supervisor',fromManager:'Manager A',toManager:'Manager B'};
 let employeeSite=id;const writes=[];
 const db={release(){},async query(sql,args){
  if(sql.startsWith('SELECT id FROM hr_records'))return {rows:[{id}]};
  if(sql.startsWith("SELECT data->>'siteId'"))return {rows:[{site:employeeSite}]};
  if(sql.startsWith('SELECT * FROM hr_records'))return {rows:[{id,data:{}}],rowCount:1};
  if(sql.startsWith('INSERT INTO hr_records')){writes.push(sql);return {rows:[{id,code:args[2],status:args[5]}]};}
  if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))writes.push(sql);
  return {rows:[]};
 }};
 const service=createService({connect:async()=>db});
 const profile={actor:'hr',permissions:{hrDesktopAccess:['Employee Master'],site:'Site A'}};
 if(kind==='outDutyRequests')assert.throws(()=>validate(kind,{...input,toDate:'2026-10-27'}),/To date/);
 const result=await service.save(profile,kind,input);
 assert.equal(result.status,'DRAFT');
 assert.equal(writes.length,2); // Transfer record and audit entry only.
 assert.ok(writes.every(sql=>sql.startsWith('INSERT INTO hr_records')||sql.startsWith('INSERT INTO hr_audit')));
 writes.length=0;employeeSite='another-site';
 await assert.rejects(service.save(profile,kind,input),e=>e.status===403);
 assert.equal(writes.length,0);
});

// Owner, 23 Nov 2026: the transfer form numbers itself, starts From the employee's current site and never moves to the same site.
test('employee transfer gets a TR number, From location from Employee Master, and refuses the same site',async()=>{
 const emp='00000000-0000-4000-8000-0000000000e1',home='00000000-0000-4000-8000-0000000000a1',other='00000000-0000-4000-8000-0000000000b2';
 let inserted=null;
 const db={release(){},async query(sql,args){
  if(sql.startsWith('SELECT id FROM hr_records')||sql.startsWith('SELECT * FROM hr_records'))return {rows:[{id:args?.[0],data:{}}],rowCount:1};
  if(sql.startsWith("SELECT data->>'siteId'"))return {rows:[{site:home}]};
  if(sql.startsWith("SELECT code FROM hr_records"))return {rows:[{code:'E-77'}]};
  if(sql.startsWith('SELECT COALESCE(MAX'))return {rows:[{next:5}]};
  if(sql.startsWith('INSERT INTO hr_records')){inserted={code:args[2],data:args[4]};return {rows:[{id:args[0],code:args[2],status:args[5]}]};}
  return {rows:[]};
 }};
 const service=createService({connect:async()=>db});
 const profile={actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}};
 const input={name:'New project',employeeId:emp,transferDate:'2026-11-24',fromSiteId:other,toSiteId:other,fromDesignation:'Operator',toDesignation:'Supervisor',fromManager:'A',toManager:'B'};
 await assert.rejects(service.save(profile,'employeeTransfers',{...input,toSiteId:home}),/different from the current location/);
 await service.save(profile,'employeeTransfers',input);
 assert.equal(inserted.code,'TR0005/24-11-2026/E-77');
 assert.equal(inserted.data.fromSiteId,home); // typed From location is replaced by the employee's site
});
