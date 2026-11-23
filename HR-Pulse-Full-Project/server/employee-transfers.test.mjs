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
  if(sql.startsWith("SELECT code,name,data->>'siteId'"))return {rows:[{code:'E-77',name:'Joined Person',site:home}]};
  if(sql.startsWith("SELECT code FROM hr_records"))return {rows:args[0]?[{code:'E-77'}]:[]};
  if(sql.includes('FROM hr_employee_master_register WHERE id=$1'))return {rows:[{site:home,name:'Register Person',code:'CMLL00440'}]};
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
 assert.equal(inserted.data.employeeName,'Joined Person');
 // Owner, 23 Nov 2026: an Employee Master register line can be transferred too ("reg:<id>").
 const line='00000000-0000-4000-8000-0000000000c3';
 await service.save(profile,'employeeTransfers',{...input,employeeId:'reg:'+line});
 assert.equal(inserted.data.employeeId,'');assert.equal(inserted.data.registerId,line);
 assert.equal(inserted.data.empCode,'CMLL00440');assert.equal(inserted.data.employeeName,'Register Person');
 assert.equal(inserted.data.fromSiteId,home);assert.equal(inserted.code,'TR0005/24-11-2026/CMLL00440');
 await assert.rejects(service.save(profile,'employeeTransfers',{...input,employeeId:''}),/Employee is required/);
});

test('approving a register-line transfer moves that line to the new site and designation',async()=>{
 const {applyTransfer}=await import('./employee-transfer-flow.mjs');
 const calls=[];
 const db={async query(sql,args){calls.push([sql,args]);if(sql.includes("kind='sites'"))return {rows:[{code:'NCL-JAYANT',name:'Jayant OB'}]};return {rows:[]};}};
 await applyTransfer(db,{id:'t1',data:{employeeId:'',registerId:'r1',toSiteId:'s2',toDesignation:'Supervisor',toManager:'CMLL00099 · P. Rao'}},'hr');
 const update=calls.find(([sql])=>sql.startsWith('UPDATE hr_employee_master_register'));
 assert.ok(update);assert.deepEqual(update[1].slice(0,3),['s2','NCL-JAYANT','Jayant OB']);
 assert.deepEqual(JSON.parse(update[1][3]),{designation:'Supervisor',reportingTo:'CMLL00099 · P. Rao'});assert.equal(update[1][4],'r1');
 assert.ok(!calls.some(([sql])=>sql.startsWith('UPDATE hr_records')));
});
