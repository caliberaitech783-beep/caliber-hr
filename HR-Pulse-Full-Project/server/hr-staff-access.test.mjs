import test from 'node:test';
import assert from 'node:assert/strict';
import {isHrStaff,withAllHrMenus} from './hr-staff-access.mjs';
import {canRead,canWrite,grantedMenus,menus} from './modules.mjs';

/* Owner, 22 Nov 2026 (latest): every HR login (site HR, office HR, regional HR) gets every HRMS menu. */
const hr=(extra={})=>({actor:'majrihr',assignedRole:'HR Executive',...extra,permissions:{application:'HR',site:'WCL-MAJRI',hrDesktopAccess:['Employee Master','Leave / OD / Gatepass'],...extra.permissions}});

test('site HR, office HR and regional HR get every HRMS menu',()=>{
 for(const profile of [hr(),hr({assignedRole:'Office HR',permissions:{site:'Chandrapur HO'}}),hr({actor:'viratsingh',assignedRole:'Regional HR',permissions:{site:'WCL-SASTI|WCL-MAJRI',hrDesktopAccess:[]}}),
  hr({assignedRole:'',permissions:{hrDesktopAccess:[],hrTrialAssignments:[{role:'Site HR',sites:[{code:'WCL-MAJRI'}]}]}})]){
  assert.equal(isHrStaff(profile),true,profile.assignedRole);
  assert.deepEqual([...grantedMenus(withAllHrMenus(profile))].sort(),[...menus].sort());
 }
 const site=withAllHrMenus(hr());
 assert.equal(site.permissions.site,'WCL-MAJRI','site rights stay as Pulse set them');
 for(const kind of ['employees','leaveRequests','gatePasses','shifts','designations'])assert.equal(canRead(site,kind),true,kind);
 assert.equal(canWrite(site,'employees'),true);
});

test('PM logins, leave-only logins and employees who only raise their own leave keep their menus',()=>{
 const pm=hr({assignedRole:'PM',permissions:{hrDesktopAccess:['Approval Management','Employee Master']}});
 const leaveOnly=hr({assignedRole:'Employee',permissions:{leaveOnly:true,hrDesktopAccess:['Leave / OD / Gatepass']}});
 const employee=hr({assignedRole:'Operator',permissions:{hrDesktopAccess:['Leave / OD / Gatepass']}});
 for(const profile of [pm,leaveOnly,employee]){
  assert.equal(isHrStaff(profile),false,profile.assignedRole);
  assert.equal(withAllHrMenus(profile),profile);
 }
 assert.equal(canWrite(employee,'employees'),false);
 assert.equal(canRead(employee,'shifts'),false);
});
