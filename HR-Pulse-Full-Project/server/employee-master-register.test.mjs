import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEmployeeMasterRegister} from './employee-master-register.mjs';

const menus = ['Master Configuration','Employee Master'];
const admin = {actor:'hr-test',permissions:{hrDesktopAccess:menus}};
const employee = {
  key:'a'.repeat(64),siteCode:'WCL-SASTI',name:'Test Employee',employeeId:'E123',
  department:'',designation:'',category:'',reportingTo:'',contact:'',email:'',status:'',
  sources:[{label:'Test workbook',fields:[['Employee Name','Test Employee']]}],
};
const siteId = '20000000-0000-4000-8000-000000000008';

test('register requires both HR menus and restricts the rows and details to the user site', async()=>{
  const service = createEmployeeMasterRegister({query:async(sql,params)=>{
    if (sql.includes("kind='sites'")) return {rows:[{id:siteId}]};
    assert.match(sql,/hr_employee_master_register/);
    assert.match(sql,/site_id=ANY/);
    assert.deepEqual(sql.includes("data->'sources'")?params[1]:params[0],[siteId]);
    return sql.includes('count(*)')?{rows:[{total:0}]}:{rows:[],rowCount:0};
  }});
  const scoped = {actor:'hr-test',permissions:{hrDesktopAccess:menus,site:'WCL-SASTI'}};
  await assert.rejects(service.employeeMasterRegister({permissions:{hrDesktopAccess:['Employee Master']}},new URLSearchParams()),{status:403});
  await assert.rejects(service.importEmployeeMasterRegister(scoped,[employee]),{status:403});
  assert.equal((await service.employeeMasterRegister(scoped,new URLSearchParams())).canImport,false);
  await assert.rejects(service.employeeMasterRegisterDetails(scoped,siteId),{status:404});
});

test('import writes to the separate register and can be safely retried', async()=>{
  const stored = new Map();
  const statements = [];
  const db = {release(){},query:async(sql,params)=>{
    statements.push(sql);
    if (sql.startsWith('SELECT id, code')) return {rows:[{id:siteId,code:'WCL-SASTI'}]};
    if (sql.includes('INSERT INTO hr_employee_master_register')) {
      assert.match(sql,/ON CONFLICT \(import_key\) DO NOTHING/);
      let rowCount = 0;
      for (const row of JSON.parse(params[1])) {
        if (stored.has(row.import_key)) continue;
        stored.set(row.import_key,row);
        rowCount++;
      }
      return {rowCount};
    }
    return {rowCount:0};
  }};
  const service = createEmployeeMasterRegister({connect:async()=>db});
  assert.deepEqual(await service.importEmployeeMasterRegister(admin,[employee]),{inserted:1,alreadyImported:0});
  assert.deepEqual(await service.importEmployeeMasterRegister(admin,[employee]),{inserted:0,alreadyImported:1});
  assert.equal(stored.get(employee.key).site_id,siteId);
  assert.equal(stored.get(employee.key).data.sources[0].label,'Test workbook');
  assert.equal(statements.filter(sql=>sql==='COMMIT').length,2);
  assert.ok(statements.every(sql=>!/(INSERT INTO|UPDATE|DELETE FROM) hr_records/.test(sql)));
});
