import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createEmployeeMasterRegister,reportBankDetails} from './employee-master-register.mjs';
// "One employee number, one person" is checked with the register: this file is on the list the deploy runs.
import './employee-number.test.mjs';
import './employee-master-remove.test.mjs';

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
    assert.deepEqual(sql.includes('WHERE id=$1')?params[1]:params[0],[siteId]);
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
  const imported = {...employee,employeeId:'cmpl-001a',reportingTo:'CMPL-002'};
  assert.deepEqual(await service.importEmployeeMasterRegister(admin,[imported]),{inserted:1,alreadyImported:0,numberOnAnotherLine:0,notAdded:[]});
  assert.deepEqual(await service.importEmployeeMasterRegister(admin,[imported]),{inserted:0,alreadyImported:1,numberOnAnotherLine:0,notAdded:[]});
  assert.equal(stored.get(employee.key).site_id,siteId);
  assert.equal(stored.get(employee.key).data.employeeId,'CMLL-001a');
  assert.equal(stored.get(employee.key).data.reportingTo,'CMPL-002');
  assert.equal(stored.get(employee.key).data.sources[0].label,'Test workbook');
  assert.equal(statements.filter(sql=>sql==='COMMIT').length,2);
  assert.ok(statements.every(sql=>!/(INSERT INTO|UPDATE|DELETE FROM) hr_records/.test(sql)));
});

test('details correct only the employee ID fields copied from the workbook',async()=>{
  const fields = [
    ['Employee Code','CMPL001'],['EMPLOYEE ID','cmpl-002a'],['EMP ID','CMLL003'],
    ['Employee ID','OTHER-CMPL004'],['Company Code','CMPL'],['Reports To Employee Code','CMPL005'],
  ];
  const service = createEmployeeMasterRegister({
    query:async()=>({rowCount:1,rows:[{name:'Test Employee',sources:[{label:'Workbook',fields}]}]}),
  });
  const result = await service.employeeMasterRegisterDetails(admin,siteId);
  assert.deepEqual(result.sources[0].fields,[
    ['Employee Code','CMLL001'],['EMPLOYEE ID','CMLL-002a'],...fields.slice(2),
  ]);
  assert.equal(fields[0][1],'CMPL001');
});

test('export returns the full filtered register within the assigned sites',async()=>{
  const queries = [];
  const service = createEmployeeMasterRegister({query:async(sql,params)=>{
    if (sql.includes("kind='sites'")) return {rows:[{id:siteId}]};
    queries.push({sql,params});
    return {rows:Array.from({length:51},(_,index)=>({
      id:String(index),site_name:'Sasti OB',site_code:'WCL-SASTI',data:{employeeId:`CMLL${index}`,name:'Test Operator',sources:[{label:'Sheet',fields:[['Bank Name','SBI'],['IFSC','SBIN0001234'],['A/C No.','00123'],['Bank Branch','Sasti'],['Father Name','Parent']]}]},
    }))};
  }});
  const scoped = {actor:'hr-test',permissions:{hrDesktopAccess:menus,site:'WCL-SASTI'}};
  const result = await service.employeeMasterRegister(scoped,new URLSearchParams({export:'1',site:'WCL-SASTI',search:'Operator'}));
  assert.equal(queries.length,1);
  assert.deepEqual(queries[0].params,[[siteId],'WCL-SASTI','Operator']);
  assert.match(queries[0].sql,/site_id=ANY\(\$1\)/);
  assert.match(queries[0].sql,/\bdata\b/);
  assert.doesNotMatch(queries[0].sql,/\b(?:LIMIT|OFFSET)\b/i);
  assert.equal(result.rows.length,51);
  assert.equal(result.rows.at(-1).region,'WCL');
  assert.deepEqual(
    {bankName:result.rows[0].bankName,ifscCode:result.rows[0].ifscCode,accountNo:result.rows[0].accountNo,branch:result.rows[0].branch},
    {bankName:'SBI',ifscCode:'SBIN0001234',accountNo:'00123',branch:'Sasti'},
  );
  assert.equal(result.rows[0].sources,undefined);
});

test('report exposes only the requested bank detail fields and accepts their common workbook headings',()=>{
  const details=reportBankDetails({sources:[{fields:[
    ['A-Form No','AF-009'],['Name of Bank','State Bank of India'],['IFSC Code','SBIN0001234'],['Bank Account Number','0012345'],['Branch Name','Nagpur'],
    ['UAN','not a bank report column'],
  ]}]});
  assert.deepEqual(details,{aFormNo:'AF-009',bankName:'State Bank of India',ifscCode:'SBIN0001234',accountNo:'0012345',branch:'Nagpur'});
});

test('Bank Details import links by Employee ID and updates only its five detail fields',async()=>{
  const writes=[];const db={release(){},query:async(sql,params)=>{
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
    if(sql.startsWith('SELECT id,name'))return {rows:[{id:'line-1',name:'Test Employee',employee_id:'CMLL123'}]};
    if(sql.startsWith('UPDATE hr_employee_master_register')){writes.push(JSON.parse(params[1]));return {rowCount:1};}
    return {rowCount:1,rows:[]};
  }};
  const service=createEmployeeMasterRegister({connect:async()=>db});
  const result=await service.importEmployeeBankDetails(admin,[{employeeId:'CMPL123',aFormNo:'AF-009',name:'Test Employee',bankName:'SBI',ifscCode:'SBIN0001234',accountNo:'00123',branch:'Nagpur'}]);
  assert.deepEqual(result,{updated:1});
  assert.deepEqual(writes,[{aFormNo:'AF-009',bankName:'SBI',ifscCode:'SBIN0001234',accountNo:'00123',branch:'Nagpur'}]);
});

test('delete all Bank Details employees requires all-site access and explicit confirmation',async()=>{
  const statements=[];const db={release(){},query:async(sql,params)=>{
    statements.push({sql,params});
    if(sql.startsWith('DELETE FROM hr_employee_master_register'))return {rowCount:8849,rows:[]};
    return {rowCount:1,rows:[]};
  }};
  const service=createEmployeeMasterRegister({connect:async()=>db,query:async()=>({rows:[]})});
  await assert.rejects(service.deleteAllEmployeeMasterBankDetails(admin,{}),{status:400});
  const scoped={actor:'site-hr',permissions:{hrDesktopAccess:menus,site:'WCL-SASTI'}};
  await assert.rejects(service.deleteAllEmployeeMasterBankDetails(scoped,{confirmation:'DELETE ALL'}),{status:403});
  assert.deepEqual(await service.deleteAllEmployeeMasterBankDetails(admin,{confirmation:'DELETE ALL'}),{removed:8849});
  assert.match(statements.find(entry=>entry.sql.startsWith('DELETE FROM'))?.sql??'',/hr_employee_master_register/);
  assert.ok(statements.some(entry=>entry.sql.includes("'REMOVE_ALL'")));
});

test('editing a register entry preserves site scope and rejects stale saves',async()=>{
  const writes = [];
  const employeeId = '20000000-0000-4000-8000-000000000009';
  const scoped = {actor:'hr-test',permissions:{hrDesktopAccess:menus,site:'WCL-SASTI'}};
  const db = {release(){},query:async(sql,params)=>{
    if (sql.includes('FOR UPDATE')) {
      assert.deepEqual(params,[employeeId,[siteId]]);
      return {rows:[{version:3,site_id:siteId,site_code:'WCL-SASTI',site_name:'Sasti OB'}]};
    }
    if (sql.startsWith('SELECT id,code')) return {rows:[{id:siteId,code:'WCL-SASTI'}]};
    if (sql.includes('UPDATE hr_employee_master_register')) writes.push(params);
    return {rowCount:0};
  }};
  const service = createEmployeeMasterRegister({connect:async()=>db,query:async()=>({rows:[{id:siteId}]})});
  await assert.rejects(service.updateEmployeeMasterRegister(scoped,employeeId,{version:2,changes:{name:'New name'}}),{status:409});
  await assert.rejects(service.updateEmployeeMasterRegister(scoped,employeeId,{version:3,changes:{siteCode:'NCL-DUDE'}}),{status:403});
  await assert.rejects(service.updateEmployeeMasterRegister(scoped,employeeId,{version:3,changes:{sources:[]}}),{status:400});
  assert.equal(writes.length,0);
  assert.deepEqual(await service.updateEmployeeMasterRegister(scoped,employeeId,{version:3,changes:{employeeId:'CMPL-04',contact:'123'}}),{saved:true});
  assert.deepEqual(writes,[[employeeId,'{"employeeId":"CMLL-04","contact":"123"}',siteId,'WCL-SASTI','Sasti OB']]);
});
