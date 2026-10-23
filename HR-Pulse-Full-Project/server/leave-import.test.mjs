import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';
const kinds=['holidays','leaveTypes','leavePolicies','leavePeriods','leaveAllocations','leaveRequests','leaveEncashments','leaveBlocks'];
test('every leave import routes through validation and rolls back invalid rows',async()=>{
 for(const kind of kinds){const queries=[];const db={query:async sql=>{queries.push(sql);return {rows:[],rowCount:0};},release:()=>{}};const service=createService({connect:async()=>db});await assert.rejects(service.importMasters({actor:'hr',permissions:{hrDesktopAccess:['Master Configuration']}},kind,[{}]),e=>e.status===400&&!e.message.includes('Unsupported'));assert.deepEqual(queries,['BEGIN','ROLLBACK']);}
});
test('leave import requires write permission before opening a transaction',async()=>{const service=createService({connect:async()=>{throw Error('must not connect');}});await assert.rejects(service.importMasters({permissions:{hrDesktopAccess:[]}},'leaveTypes',[{}]),e=>e.status===403);});
