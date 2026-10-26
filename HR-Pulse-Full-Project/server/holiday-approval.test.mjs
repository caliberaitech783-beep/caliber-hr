import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';
const user={actor:'requester',permissions:{hrDesktopAccess:['Master Configuration','Holiday & Leave']}};
test('manual and imported holidays are pending and routed to VinodPinjarkar',async()=>{
 const approvals=[],rows=[];
 const db={release(){},async query(sql,args=[]){
  if(sql.startsWith('INSERT INTO hr_records')){const [id,kind,code,name,data,status,actor]=args;const row={id,kind,code,name,data,status,created_by:actor,version:1};rows.push(row);return {rows:[row],rowCount:1};}
  if(sql.startsWith('INSERT INTO hr_approvals'))approvals.push(args);
  return {rows:[],rowCount:0};
 }};
 const service=createService({connect:async()=>db});
 const record={code:'TEST',name:'Test holiday',date:'2026-12-25',siteId:'NGP',holidayType:'National'};
 const saved=await service.save(user,'holidays',record);
 assert.equal(saved.status,'PENDING');
 const result=await service.importMasters(user,'holidays',[{...record,code:'IMPORT'}]);
 assert.equal(result.ready,1);assert.equal(rows[1].status,'PENDING');
 assert.equal(approvals.length,2);
 for(const approval of approvals){assert.deepEqual(JSON.parse(approval[2]),['vinodpinjarkar']);assert.equal(approval[3],'requester');assert.equal(JSON.parse(approval[5])[0].label,'HR Manager — holiday approval');}
});
