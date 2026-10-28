import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

for(const kind of ['employeeTransfers','outDutyRequests'])test(kind+' drafts respect employee site scope and never change the employee posting',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const input={code:'TR-1',name:'Transfer',employeeId:id,transferDate:'2026-10-27',outDutyDate:'2026-10-28',designation:'Operator',department:'Operations',siteId:id,purpose:'Site meeting',visitLocation:'Nagpur',fromSiteId:id,toSiteId:id,fromCompanyId:id,toCompanyId:id,fromDesignation:'Operator',toDesignation:'Supervisor',fromManager:'Manager A',toManager:'Manager B'};
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
 const result=await service.save(profile,kind,input);
 assert.equal(result.status,'DRAFT');
 assert.equal(writes.length,2); // Transfer record and audit entry only.
 assert.ok(writes.every(sql=>sql.startsWith('INSERT INTO hr_records')||sql.startsWith('INSERT INTO hr_audit')));
 writes.length=0;employeeSite='another-site';
 await assert.rejects(service.save(profile,kind,input),e=>e.status===403);
 assert.equal(writes.length,0);
});
