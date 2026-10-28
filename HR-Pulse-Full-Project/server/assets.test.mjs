import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookValue,transition,permit,nextTag,categoryData,customData} from './asset-domain.mjs';
import {createAssets} from './assets.mjs';
const p=r=>({actor:'test',assignedRole:r,permissions:{}});
test('depreciation uses fractional years, floor and lost/disposed override',()=>{
 const a={purchaseCost:100000,purchaseDate:'2020-01-01',status:'Available'};const at=new Date(Date.parse(a.purchaseDate)+365.25*86400000);
 assert.equal(bookValue(a,{rate:40,method:'WDV'},at),60000);assert.equal(bookValue(a,{rate:33,method:'SLM'},at),67000);
 assert.equal(bookValue(a,{rate:40,method:'SLM'},new Date('2030-01-01')),5000);
 assert.equal(bookValue(a,{rate:100,method:'WDV'},at),5000);
 for(const status of ['Lost','Disposed'])assert.equal(bookValue({...a,status},{rate:40,method:'WDV'},at),0);
 assert.equal(bookValue(a,{rate:40,method:'WDV'},new Date('2019-01-01')),100000);
});
test('valid movements and invalid transitions return 422',()=>{
 const e={id:'one',status:'ACTIVE',data:{}};assert.deepEqual(transition({status:'Available'},{action:'Issue'},e),{status:'Assigned',employee_id:'one'});
 assert.equal(transition({status:'Assigned'},{action:'Return',toRepair:true}).status,'Under Repair');
 assert.equal(transition({status:'Under Repair'},{action:'Repair done'}).status,'Available');
 assert.equal(transition({status:'Lost'},{action:'Found'}).status,'Available');
 assert.equal(transition({status:'Available'},{action:'Dispose',method:'Scrap',amount:0}).status,'Disposed');
 for(const status of ['Assigned','Lost','Disposed','Under Repair'])assert.throws(()=>transition({status},{action:'Issue'},e),x=>x.status===422);
 assert.throws(()=>transition({status:'Assigned',employee_id:'one'},{action:'Transfer'},e),/different/);
 for(const employmentStatus of ['Exited','Terminated','Inactive'])assert.throws(()=>transition({status:'Available'},{action:'Issue'},{...e,data:{employmentStatus}}),/exited/);
 assert.throws(()=>transition({status:'Available'},{action:'Mark lost',amount:-1}),/amount/);
});
test('roles enforce admin categories/settings, HR writes, Manager movements, Employee reads',()=>{
 for(const r of ['Admin','HR','Manager','Employee'])assert.equal(permit(p(r),'read'),r);
 for(const r of ['Admin','HR'])assert.doesNotThrow(()=>permit(p(r),'write'));
 for(const r of ['Employee','Manager'])assert.throws(()=>permit(p(r),'write'),e=>e.status===403);
 assert.doesNotThrow(()=>permit(p('Manager'),'move'));assert.throws(()=>permit(p('Employee'),'move'),e=>e.status===403);
 for(const r of ['HR','Manager','Employee'])assert.throws(()=>permit(p(r),'admin'),e=>e.status===403);
});
test('tag allocation uses atomic upsert and preserves long counters',async()=>{
 let n=9998;const db={query:async(sql,args)=>{assert.match(sql,/ON CONFLICT\(prefix\) DO UPDATE SET value=hr_asset_counters.value\+1 RETURNING value/);assert.deepEqual(args,['LAP']);return {rows:[{value:++n}]};}};
 assert.deepEqual(await Promise.all([nextTag(db,'LAP'),nextTag(db,'LAP')]),['LAP-9999','LAP-10000']);
});
test('category custom fields validate required values, types and dropdown choices',()=>{
 const c=categoryData({name:'Vehicle',prefix:'VEH',group:'Vehicles & Tools',rate:15,method:'WDV',fields:[{key:'reg',label:'Registration',type:'text',required:true},{key:'expiry',label:'Expiry',type:'date'},{key:'fuel',label:'Fuel',type:'dropdown',options:['Diesel']}]});
 assert.throws(()=>customData(c.fields,{}),/required/);assert.throws(()=>customData(c.fields,{reg:'AB',expiry:'2026-02-30'}),/date/);assert.throws(()=>customData(c.fields,{reg:'AB',fuel:'Water'}),/Invalid/);
 assert.deepEqual(customData(c.fields,{reg:'AB',untrusted:'ignored'}),{reg:'AB'});
});
test('employee self-view fails closed without verified employee link',async()=>{
 const pool={query:async()=>({rows:[],rowCount:0})};await assert.rejects(createAssets(pool).assetApi(p('Employee'),'register','GET'),e=>e.status===403);
});
test('manager cannot bypass write permission through register or categories',async()=>{
 const pool={connect:async()=>{throw Error('should not connect');}};for(const path of ['register','category','settings'])await assert.rejects(createAssets(pool).assetApi(p('Manager'),path,'POST',{}),e=>e.status===403);
});
