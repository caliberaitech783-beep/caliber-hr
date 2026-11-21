import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';
import {canRead,canWrite} from './modules.mjs';
import {isProjectManager,PM_EMPLOYEE_WRITE_ERROR} from './pm-access.mjs';

/* Owner, 21 Nov 2026: a PM login only approves. The server refuses employee creation, import, edits,
   submission and deletion for it, whatever menus Pulse assigned; approvals stay open to it. */
const menus=['Dashboard','Employee Master','Employee Onboarding','Approval Management'];
const pm={actor:'chitranjan',assignedRole:'PM',permissions:{application:'HR',site:'WCL-MAJRI',hrDesktopAccess:menus}};
const siteHr={...pm,actor:'sitehr',assignedRole:'HR Manager'};
const query=async sql=>{if(['BEGIN','ROLLBACK'].includes(sql))return {rows:[]};throw Error('PM request reached the database: '+sql);};
const noDb={query,async connect(){return {query,release(){}};}};
const id='40000000-0000-4000-8000-000000000001';

test('PM logins are recognised by Pulse role or PM-only trial assignments',()=>{
 for(const role of ['PM','Project Manager','Site PM','project-manager'])assert.equal(isProjectManager({...pm,assignedRole:role}),true,role);
 for(const role of ['HR Manager','Director','Office HR','Driver Trainer',''])assert.equal(isProjectManager({...pm,assignedRole:role}),false,role);
 assert.equal(isProjectManager({...pm,assignedRole:'',permissions:{...pm.permissions,hrTrialAssignments:[{role:'PM',sites:[]}]}}),true);
 assert.equal(isProjectManager({...pm,assignedRole:'',permissions:{...pm.permissions,hrTrialAssignments:[{role:'PM'},{role:'Office HR'}]}}),false);
});

test('a PM can read employees but never write them; Site HR keeps write access',()=>{
 assert.equal(canRead(pm,'employees'),true);
 assert.equal(canWrite(pm,'employees'),false);
 assert.equal(canWrite(siteHr,'employees'),true);
});

test('the server refuses every employee write from a PM before touching the database',async()=>{
 const service=createService(noDb);
 const refused=async(name,run)=>assert.rejects(run,error=>error.status===403&&error.message===PM_EMPLOYEE_WRITE_ERROR,name);
 await refused('create',()=>service.save(pm,'employees',{name:'New driver'}));
 await refused('edit',()=>service.save(pm,'employees',{name:'New driver'},id));
 await refused('import',()=>service.importEmployees(pm,[{name:'New driver'}],true));
 await refused('submit',()=>service.submit(pm,'employees',id,1));
 await refused('office details',()=>service.updateEmployeeDetails(pm,id,{version:1,officeData:{}}));
 const config=await service.config(pm);
 assert.equal(config.modules.employees?.canWrite,false);
});
