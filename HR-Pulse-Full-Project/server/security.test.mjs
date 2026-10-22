import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApi} from './app.mjs';
import {createService} from './service.mjs';
import {validate,canRead,canWrite} from './modules.mjs';
import {assignedSites} from './scope.mjs';
test('Pulse site assignments are normalized and unknown scope formats fail closed',()=>{
 assert.equal(assignedSites({permissions:{site:'All Sites'}}),null);
 assert.deepEqual(assignedSites({permissions:{site:' Site A '}}),['site a']);
 assert.deepEqual(assignedSites({permissions:{site:'Nagpur | Chandrapur'}}),['nagpur','chandrapur']);
 assert.deepEqual(assignedSites({permissions:{adminLevel:'Site',site:''}}),[]);
 assert.throws(()=>assignedSites({permissions:{site:{unexpected:true}}}),e=>e.status===403);
});
const profile=(menus,actor='operator')=>({actor,permissions:{application:'HR',hrDesktopAccess:menus}});
test('directory access cannot write and onboarding can create employee drafts',()=>{
 assert.equal(canRead(profile(['Employee Directory']),'employees'),true);
 assert.equal(canWrite(profile(['Employee Directory']),'employees'),false);
 assert.equal(canWrite(profile(['Employee Onboarding']),'employees'),true);
 assert.equal(canWrite(profile(['Dashboard']),'employees'),false);
});
test('validates real dates, whitelists fields and normalizes approver identities',()=>{
 assert.throws(()=>validate('holidays',{code:'H',name:'Holiday',date:'2026-02-30'}));
 assert.throws(()=>validate('leaveRequests',{code:'L',name:'Leave',employeeId:'x',policyId:'y',fromDate:'2026-12-02',toDate:'2026-12-01'}));
 assert.deepEqual(validate('workflows',{code:'W',name:'Flow',approvers:' Alice, BOB ',status:'APPROVED'}),{code:'W',name:'Flow',approvers:'alice,bob'});
 assert.throws(()=>validate('workflows',{code:'W',name:'Flow',approvers:'Alice,alice'}));
});
test('unauthenticated and revoked grants cannot reach records; client profile is ignored',async()=>{
 let calls=0;const server=createApi({query:async()=>{},authenticate:async token=>token==='a'.repeat(43)?profile(['Employee Directory']):null,service:{save:async user=>{calls++;assert.equal(user.actor,'operator');throw Object.assign(new Error('Forbidden'),{status:403});}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const token of ['', 'b'.repeat(43)])assert.equal((await fetch(base+'/api/records/employees',{headers:{Authorization:'Bearer '+token}})).status,401);
  assert.equal(calls,0);
  const response=await fetch(base+'/api/records/employees',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(43),'Content-Type':'application/json'},body:JSON.stringify({profile:{actor:'admin'},code:'E1',name:'Example'})});
  assert.equal(response.status,403);assert.equal(calls,1);
  const preflight=await fetch(base+'/api/records/employees',{method:'OPTIONS',headers:{Origin:'https://hrpulse.cmll.in'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('self-approval and stale versions are blocked inside a rolled-back transaction',async()=>{
 const statements=[];let releases=0;const db={query:async(sql)=>{statements.push(sql);return {rows:[{state:'PENDING',version:2,requested_by:'operator',approvers:['operator'],stage:0}],rowCount:1};},release:()=>releases++};
 const service=createService({connect:async()=>db});const user=profile(['Approval Management']);
 await assert.rejects(service.decide(user,'00000000-0000-4000-8000-000000000001',{version:2,decision:'APPROVED'}),e=>e.status===403);
 await assert.rejects(service.decide(user,'00000000-0000-4000-8000-000000000001',{version:1,decision:'APPROVED'}),e=>e.status===409);
 assert.equal(statements.filter(x=>x==='ROLLBACK').length,2);assert.equal(releases,2);assert.equal(statements.some(x=>x.startsWith('UPDATE')),false);
});
test('permission denial never executes a database write',async()=>{
 let writes=0;const db={query:async sql=>{if(!['BEGIN','ROLLBACK'].includes(sql))writes++;return{};},release:()=>{}};
 await assert.rejects(createService({connect:async()=>db}).save(profile(['Employee Directory']),'employees',{code:'E',name:'Name'}),e=>e.status===403);assert.equal(writes,0);
});
test('lookup endpoints expose only reference types needed by permitted forms, never leave reasons',async()=>{
 let kinds;const service=createService({query:async(sql,values)=>{kinds=values[0];return{rows:[]};}});
 await service.lookups(profile(['Dashboard']));assert.deepEqual(kinds,[]);
 await service.lookups(profile(['Holiday & Leave']));assert.ok(kinds.includes('employees'));assert.ok(!kinds.includes('leaveRequests'));
 await service.lookups(profile(['Master Configuration']));assert.ok(!kinds.includes('leaveRequests'));
});
