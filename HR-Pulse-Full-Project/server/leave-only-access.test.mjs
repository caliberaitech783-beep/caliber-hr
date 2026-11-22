import test from 'node:test';
import assert from 'node:assert/strict';
import {canRead,canWrite,grantedMenus} from './modules.mjs';

const profile={permissions:{hrDesktopAccess:['Leave / OD / Gatepass'],hrMobileAccess:[]}};

test('Pulse leave-only grants expose request forms and their lookups, not other HR modules',()=>{
  assert.deepEqual([...grantedMenus(profile)],['Leave / OD / Gatepass']);
  for(const kind of ['leaveRequests','outDutyRequests','gatePasses','employees','companies','sites','departments','leaveTypes','leavePolicies','leavePeriods'])assert.equal(canRead(profile,kind),true,kind);
  for(const kind of ['leaveRequests','outDutyRequests','gatePasses'])assert.equal(canWrite(profile,kind),true,kind);
  for(const kind of ['employees','companies','sites','departments','leaveTypes','leavePolicies','leavePeriods','assets','payrollRuns'])assert.equal(canWrite(profile,kind),false,kind);
  for(const kind of ['assets','shifts','workflows','approvalRules'])assert.equal(canRead(profile,kind),false,kind);
});
