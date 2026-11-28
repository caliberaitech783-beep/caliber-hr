import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBiometricExceptions,exceptionRanges,rangesFor,exemptOn} from './biometric-exceptions.mjs';
import {buildRegister} from './attendance-register.mjs';
import {evaluateDay} from './attendance-policy.mjs';

const admin = {actor:'hr-admin',permissions:{hrDesktopAccess:['Master Configuration','Employee Master']}};
const TODAY = '2026-11-28';
const line = (employeeId,name,designation,extra={}) => ({id:'r-'+employeeId,site_id:'30000000-0000-4000-8000-000000000001',site_name:'Majri OB',name,
  data:{employeeId,name,designation,department:'STORE',status:'ACTIVE',...extra}});

test('an employee on the list is exempt from punching for the days of the entry, and only those days', () => {
  const ranges = new Map([['101',[{from:'2026-11-24',to:''}]],['102',[{from:'2026-11-20',to:'2026-11-23'}]]]);
  assert.deepEqual(rangesFor(ranges,'CMPL101'),[{from:'2026-11-24',to:''}]);
  assert.deepEqual(rangesFor(ranges,'CMLL0101'),[{from:'2026-11-24',to:''}]);
  assert.deepEqual(rangesFor(ranges,'CMLL999'),[]);
  assert.equal(exemptOn(rangesFor(ranges,'101'),'2026-11-23'),false);
  assert.equal(exemptOn(rangesFor(ranges,'101'),'2026-11-24'),true);
  assert.equal(exemptOn(rangesFor(ranges,'102'),'2026-11-23'),true);
  assert.equal(exemptOn(rangesFor(ranges,'102'),'2026-11-24'),false);
  // One punch is a miss punch for everybody else; an exempt day is Present with no late, early or cut.
  assert.equal(evaluateDay({inMinute:600,designation:'STORE KEEPER'}).status,'MP');
  assert.deepEqual(evaluateDay({inMinute:600,designation:'STORE KEEPER',exempt:true}),
    {status:'P',exempt:true,missPunch:false,workedMinutes:null,late:false,early:false,gatePassMinutes:0,gatePassDeduction:0});
});

test('the register marks an exempt employee present by itself; holidays and the others are as before', () => {
  const employees = [
    {id:'a',code:'CMLL101',name:'ON THE LIST',site:'Majri OB',siteId:'s1',designation:'STORE KEEPER',exceptions:[{from:'2026-11-24',to:'2026-11-27'}]},
    {id:'b',code:'CMLL104',name:'NOT ON THE LIST',site:'Majri OB',siteId:'s1',designation:'HELPER'},
  ];
  const register = buildRegister({from:'2026-11-22',to:'2026-11-28',today:TODAY,employees,
    punches:[{employeeId:'a',at:'2026-11-26 11:40'},{employeeId:'b',at:'2026-11-26 05:55'},{employeeId:'b',at:'2026-11-26 14:05'}],
    holidays:[{date:'2026-11-25',siteId:'',name:'Site Holiday'}]});
  const [listed,other] = register.rows;
  assert.deepEqual(listed.days.map(day=>day.status),['A','A','P','H','P','P','A']);
  assert.deepEqual(listed.days.map(day=>Boolean(day.biometricException)),[false,false,true,true,true,true,false]);
  assert.equal(listed.days[2].note,'Biometric exception: marked present, no punch needed');
  // A single late punch on an exempt day is still Present: no miss punch, no late mark.
  assert.deepEqual([listed.days[4].status,listed.days[4].missPunch,listed.days[4].late,listed.days[4].in],['P',false,false,'11:40']);
  assert.equal(listed.exempt,true);
  assert.equal(listed.biometricException,true);
  assert.equal(listed.summary.full,3);
  // Everyone else follows the biometric process exactly as before.
  assert.deepEqual(other.days.map(day=>day.status),['A','A','A','H','P','A','A']);
  assert.equal(other.exempt,false);
  assert.equal(other.biometricException,undefined);
  assert.equal(other.days.some(day=>'biometricException' in day),false);
});

test('reading who is exempt never fails the attendance register', async () => {
  const seen = [];
  const ranges = await exceptionRanges({query:async(sql,params)=>{seen.push({sql,params});return {rows:[
    {number:'101',from_date:'2026-11-24',to_date:''},{number:'101',from_date:'2026-10-01',to_date:'2026-10-05'},
    {number:'102',from_date:'2026-11-28',to_date:'2026-11-27'}]};}},'2026-11-01','2026-11-30');
  assert.match(seen[0].sql,/FROM hr_biometric_exceptions WHERE from_date<=\$2::date AND \(to_date IS NULL OR to_date>=\$1::date\)/);
  assert.deepEqual(seen[0].params,['2026-11-01','2026-11-30']);
  assert.deepEqual([...ranges],[['101',[{from:'2026-11-24',to:''},{from:'2026-10-01',to:'2026-10-05'}]]]);   // added and removed the same day: never exempt
  // The table is made at start-up: a server that has not restarted yet exempts nobody.
  assert.equal((await exceptionRanges({query:async()=>{throw Object.assign(new Error('relation does not exist'),{code:'42P01'});}},'2026-11-01','2026-11-30')).size,0);
  assert.equal((await exceptionRanges({query:async()=>undefined},'2026-11-01','2026-11-30')).size,0);
  await assert.rejects(exceptionRanges({query:async()=>{throw new Error('connection lost');}},'2026-11-01','2026-11-30'),/connection lost/);
});

function database({lines=[],active=false,entry=null}={}) {
  const statements = [];
  const db = {release(){},query:async(sql,params)=>{
    statements.push({sql,params});
    if (sql.includes('FROM lines')) return {rows:lines};
    if (sql.includes('SELECT 1 FROM hr_biometric_exceptions')) return {rows:[],rowCount:active?1:0};
    if (sql.includes('FROM hr_biometric_exceptions') && sql.includes('FOR UPDATE')) return {rows:entry?[entry]:[]};
    return {rows:[],rowCount:1};
  }};
  return {statements,pool:{connect:async()=>db,query:db.query}};
}
const writes = statements => statements.filter(({sql})=>/^\s*(INSERT|UPDATE|DELETE)/i.test(sql));

test('adding takes the employee from Employee Master by Employee ID and keeps who, from when and why', async () => {
  const {pool,statements} = database({lines:[line('CMLL101','STORE KEEPER ONE','STORE KEEPER')]});
  const service = createBiometricExceptions(pool,{today:()=>TODAY});
  const result = await service.addBiometricException(admin,{employeeId:'cmpl 101',fromDate:'2026-11-24',reason:'Works from the stores office'});
  assert.deepEqual({...result,id:''},{added:true,id:'',employeeId:'CMLL101',name:'STORE KEEPER ONE',fromDate:'2026-11-24'});
  const [insert,audit] = writes(statements);
  assert.match(insert.sql,/INSERT INTO hr_biometric_exceptions\(id,employee_number,employee_id,name,site_id,site,department,designation,from_date,reason,added_by\)/);
  assert.deepEqual(insert.params.slice(1),['101','CMLL101','STORE KEEPER ONE','30000000-0000-4000-8000-000000000001','Majri OB','STORE','STORE KEEPER','2026-11-24','Works from the stores office','hr-admin']);
  assert.match(audit.sql,/INSERT INTO hr_audit/);
  assert.equal(writes(statements).length,2);
  assert.equal(statements.at(-1).sql,'COMMIT');
  // The date defaults to today.
  const later = database({lines:[line('CMLL101','STORE KEEPER ONE','STORE KEEPER')]});
  assert.equal((await createBiometricExceptions(later.pool,{today:()=>TODAY}).addBiometricException(admin,{employeeId:'101',reason:'No machine at this office'})).fromDate,TODAY);
});

test('what is refused: no Master Configuration, an unknown or doubled ID, a driver, a person who left, a second entry, a bad date or no reason', async () => {
  const add = (setup,input,profile=admin) => createBiometricExceptions(database(setup).pool,{today:()=>TODAY}).addBiometricException(profile,{fromDate:'2026-11-24',reason:'A real reason',...input});
  const one = [line('CMLL101','STORE KEEPER ONE','STORE KEEPER')];
  await assert.rejects(add({lines:one},{employeeId:'CMLL101'},{actor:'x',permissions:{hrDesktopAccess:['Employee Master']}}),{status:403});
  await assert.rejects(add({lines:one},{employeeId:'LEFT'}),/valid Employee ID/);
  await assert.rejects(add({lines:[]},{employeeId:'CMLL999'}),{status:404});
  await assert.rejects(add({lines:[...one,line('CMPL101','ANOTHER LINE','HELPER')]},{employeeId:'CMLL101'}),{status:409,message:/more than one line/});
  await assert.rejects(add({lines:[line('CMLL102','DRIVER ONE','TIPPER DRIVER')]},{employeeId:'CMLL102'}),{status:409,message:/trip card and logbook/});
  await assert.rejects(add({lines:[line('CMLL103','LEFT ONE','HELPER',{status:'Left'})]},{employeeId:'CMLL103'}),{status:409,message:/has left/});
  await assert.rejects(add({lines:one,active:true},{employeeId:'CMLL101'}),{status:409,message:/already on the exception list/});
  await assert.rejects(add({lines:one},{employeeId:'CMLL101',reason:'no'}),/Write why/);
  await assert.rejects(add({lines:one},{employeeId:'CMLL101',fromDate:'24-11-2026'}),/date the exemption starts/);
  await assert.rejects(add({lines:one},{employeeId:'CMLL101',fromDate:'2026-08-01'}),/62 days back/);
  await assert.rejects(add({lines:one},{employeeId:'CMLL101',fromDate:'2027-02-01'}),/31 days ahead/);
});

test('removing ends the exemption with yesterday and keeps the entry', async () => {
  const id = '40000000-0000-4000-8000-000000000001';
  const {pool,statements} = database({entry:{id,employee_id:'CMLL101',name:'STORE KEEPER ONE',site:'Majri OB',from_date:'2026-11-24'}});
  const service = createBiometricExceptions(pool,{today:()=>TODAY});
  await assert.rejects(service.removeBiometricException(admin,id,{reason:'x'}),/Write why/);
  assert.deepEqual(await service.removeBiometricException(admin,id,{reason:'Back on site duty'}),{removed:true,lastDay:'2026-11-27'});
  const [update,audit] = writes(statements);
  assert.match(update.sql,/UPDATE hr_biometric_exceptions SET to_date=\$2::date,removed_by=\$3,removed_at=now\(\),remove_reason=\$4 WHERE id=\$1/);
  assert.deepEqual(update.params,[id,'2026-11-27','hr-admin','Back on site duty']);
  assert.match(audit.sql,/INSERT INTO hr_audit/);
  assert.equal(statements.some(({sql})=>/DELETE/i.test(sql)),false);
  await assert.rejects(createBiometricExceptions(database().pool,{today:()=>TODAY}).removeBiometricException(admin,id,{reason:'Back on site duty'}),{status:404});
});

test('the list and the Employee Master search stay inside the login\'s sites', async () => {
  const {pool,statements} = database({lines:[line('CMLL101','STORE KEEPER ONE','STORE KEEPER'),line('CMLL102','DRIVER ONE','TIPPER DRIVER')]});
  const service = createBiometricExceptions(pool,{today:()=>TODAY});
  const found = await service.biometricExceptions(admin,new URLSearchParams({find:'one'}));
  assert.deepEqual(found.employees.map(person=>[person.employeeId,person.name,person.site,person.driver,person.onList]),[['CMLL101','STORE KEEPER ONE','Majri OB',false,false],['CMLL102','DRIVER ONE','Majri OB',true,false]]);
  assert.match(statements[0].sql,/\(\$1::uuid\[\] IS NULL OR site_id=ANY\(\$1\)\)/);
  assert.deepEqual(await service.biometricExceptions(admin,new URLSearchParams({find:'x'})),{employees:[]});
  statements.length = 0;
  const list = await service.biometricExceptions(admin,new URLSearchParams());
  assert.deepEqual([list.today,list.entries],[TODAY,[]]);
  assert.match(statements[0].sql,/\(\$1::uuid\[\] IS NULL OR x\.site_id=ANY\(\$1\)\) AND \(\$2 OR x\.removed_at IS NULL\)/);
  assert.deepEqual(statements[0].params,[null,false]);
});

test('the table is made at start-up with the attendance schema', () => {
  const schema = readFileSync(new URL('./attendance-schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS hr_biometric_exceptions\(/);
  assert.match(schema,/CREATE UNIQUE INDEX IF NOT EXISTS hr_biometric_exceptions_active ON hr_biometric_exceptions\(employee_number\) WHERE removed_at IS NULL/);
});
