// Owner, 23 Nov 2026: a site move made in Pulse-II with an OTP on a card corrects HR Pulse's Employee Master at once,
// with no second approval. The people and numbers below are made up.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createMisSiteMove,readSiteMove,hrSiteCode,siteMoveMessage,SITE_MOVE_REASON,SITE_MOVE_SOURCE} from './mis-site-move.mjs';
import {createApi} from './app.mjs';

const KEY='k'.repeat(40);
const MOVE={moveId:'41',employeeId:'CMPL7001',name:'SAMPLE DRIVER',fromSite:'Majri OC',toSite:'Sasti OC',fromDate:'2026-11-20',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],card:{door:'V942',cardNo:'A-5512'}};
const SITE={majri:'10000000-0000-4000-8000-0000000000a1',sasti:'10000000-0000-4000-8000-0000000000a2'};

test('Pulse-II\'s site names are read as HR Pulse\'s sites',()=>{
 assert.deepEqual(['Majri OC','MAJRI OB','Sasti OC','Jayant OC','JAYANT OB 2ND','Dudhichua East OC','Dudhichua OC','DUDHICHUA OB','Gauri Pauni OC (2nd)','GOURI POUNI OB (2ND)','Dhoptala OC (2nd)','Lalpeth OC','Nagpur CO',''].map(hrSiteCode),
  ['WCL-MAJRI','WCL-MAJRI','WCL-SASTI','NCL-JAYANT','NCL-JAYANT','NCL-DUDE','NCL-DUDW','NCL-DUDW','WCL-GAURI','WCL-GAURI','WCL-DHOPTALA','','','']);
});

test('only a real move is taken: an id, an employee number, a date and a site',()=>{
 assert.deepEqual(readSiteMove(MOVE),{moveId:'41',employeeId:'CMPL7001',name:'SAMPLE DRIVER',fromSite:'Majri OC',toSite:'Sasti OC',fromDate:'2026-11-20',requestedBy:'sasti.operator',requestedName:'Sasti Operator',approvedBy:['majri.pm'],door:'V942',cardNo:'A-5512'});
 for(const bad of [null,[],{...MOVE,moveId:''},{...MOVE,moveId:'a b'},{...MOVE,employeeId:'LEFT'},{...MOVE,fromDate:'20-11-2026'},{...MOVE,toSite:''}])assert.throws(()=>readSiteMove(bad),{status:400});
 const message=siteMoveMessage(readSiteMove(MOVE),{from:'Majri OB',to:'Sasti OB',code:'TR0007/20-11-2026/CMLL7001'});
 assert.match(message,/CMPL7001 SAMPLE DRIVER\nMajri OB → Sasti OB\nFrom 20\/11\/2026 · vehicle V942\nAsked by Sasti Operator · OTP given by majri\.pm/);
 assert.match(message,/If this is not right, raise an Employee Transfer in HR Pulse\./);
});

// A stand-in for the tables the inbox touches.
function store({lines=[],forms=[],flows=[],sites=[{id:SITE.majri,code:'WCL-MAJRI'},{id:SITE.sasti,code:'WCL-SASTI'}],transfers=0}={}){
 const state={lines,forms,moves:new Map(),inserted:[],audit:[],telegram:[],statements:[]};
 const query=async(sql,params=[])=>{
  state.statements.push(sql.trim().split(/\s+/).slice(0,3).join(' '));
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock')||sql.startsWith('CREATE TABLE IF NOT EXISTS hr_mis_site_moves'))return {rows:[]};
  if(sql.startsWith('SELECT outcome,detail FROM hr_mis_site_moves'))return {rows:state.moves.has(params[0])?[state.moves.get(params[0])]:[]};
  if(sql.startsWith('INSERT INTO hr_mis_site_moves')){state.moves.set(params[0],{outcome:params[2],detail:params[3]});return {rowCount:1};}
  if(sql.includes("kind='sites' AND code=$1"))return {rows:sites.filter(site=>site.code===params[0])};
  if(sql.includes('FROM hr_employee_master_register WHERE'))return {rows:state.lines.filter(line=>line.number===params[0])};
  if(sql.includes("FROM hr_records WHERE kind='employees'"))return {rows:state.forms.filter(form=>form.number===params[0])};
  if(sql.startsWith('UPDATE hr_employee_master_register SET site_id')){const line=state.lines.find(entry=>entry.id===params[3]);Object.assign(line,{site_id:params[0],site_code:params[1],site_name:params[2]});return {rowCount:1};}
  if(sql.startsWith('UPDATE hr_records SET data=$1')){state.forms.find(form=>form.id===params[2]).data=params[0];return {rowCount:1};}
  if(sql.includes("substring(code from '^TR([0-9]+)/')"))return {rows:[{next:transfers+1}]};
  if(sql.startsWith("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'employeeTransfers'")){state.inserted.push({code:params[1],name:params[2],data:params[3]});return {rowCount:1};}
  if(sql.startsWith('INSERT INTO hr_audit'))return state.audit.push(params[1]),{rowCount:1};
  if(sql.includes("kind='transferFlows'"))return {rows:flows.filter(flow=>params[0].includes(flow.code))};
  if(sql.startsWith('INSERT INTO hr_telegram_outbox'))return state.telegram.push([params[1],params[2]]),{rowCount:1};
  throw new Error('unexpected query: '+sql.slice(0,90));
 };
 return {state,pool:{query,connect:async()=>({query,release(){}})}};
}
const line=(extra={})=>({id:'l1',number:'7001',name:'SAMPLE DRIVER',site_id:SITE.majri,site_code:'WCL-MAJRI',site_name:'Majri OB',code:'CMLL7001',designation:'TIPPER DRIVER',manager:'A MANAGER',...extra});
const FLOWS=[{code:'COMMON',data:{regionalHrHead:'regional.hr',officeHr:'office.hr',directors:'director.one'}},{code:'WCL-MAJRI',data:{siteHr:'majri.hr',pm:'majri.pm'}},{code:'WCL-SASTI',data:{siteHr:'sasti.hr, sasti.hr2',pm:'sasti.pm'}}];

test('the key is needed, and nothing is read without it',async()=>{
 const {state,pool}=store({lines:[line()]});
 await assert.rejects(createMisSiteMove(pool,{syncKey:''}).misSiteMove(KEY,MOVE),{status:503});
 await assert.rejects(createMisSiteMove(pool,{syncKey:KEY}).misSiteMove('wrong',MOVE),{status:401});
 await assert.rejects(createMisSiteMove(pool,{syncKey:KEY}).misSiteMove(KEY,{...MOVE,fromDate:''}),{status:400});
 assert.deepEqual(state.statements,[]);
});

test('the Employee Master line moves at once, the move is an approved transfer, and HR is told, not asked',async()=>{
 const {state,pool}=store({lines:[line()],flows:FLOWS,transfers:6});
 const inbox=createMisSiteMove(pool,{syncKey:KEY});
 const answer=await inbox.misSiteMove(KEY,MOVE);
 assert.deepEqual([answer.received,answer.again,answer.outcome],[true,false,'applied']);
 assert.match(answer.detail,/now shows Sasti OB\. Transfer TR0007\/20-11-2026\/CMLL7001\. 4 HR people told on Telegram\./);
 assert.deepEqual([state.lines[0].site_code,state.lines[0].site_name,state.lines[0].site_id],['WCL-SASTI','Sasti OB',SITE.sasti]);
 const transfer=state.inserted[0];
 assert.deepEqual([transfer.code,transfer.name,transfer.data.source,transfer.data.registerId,transfer.data.employeeId,transfer.data.transferDate,transfer.data.fromSiteId,transfer.data.toSiteId,transfer.data.empCode,transfer.data.misMoveId,transfer.data.approvedBy],
  ['TR0007/20-11-2026/CMLL7001',SITE_MOVE_REASON,SITE_MOVE_SOURCE,'l1','','2026-11-20',SITE.majri,SITE.sasti,'CMLL7001','41','majri.pm']);
 assert.deepEqual([transfer.data.fromDesignation,transfer.data.toDesignation],['TIPPER DRIVER','TIPPER DRIVER'],'the designation is not changed from Pulse-II');
 assert.equal(state.audit[0].to,'Sasti OB');
 // Site HR of both sites and the Regional HR Head; never the PM, Office HR or the Directors, and nobody approves.
 assert.deepEqual(state.telegram.map(([actor])=>actor).sort(),['majri.hr','regional.hr','sasti.hr','sasti.hr2']);
 assert.match(state.telegram[0][1],/Employee site changed in Pulse-II \(OTP on a card\)/);
 assert.equal(state.statements.some(sql=>sql.includes('hr_approvals')),false);
 // The same move sent again gives the first answer and changes nothing more.
 const again=await inbox.misSiteMove(KEY,MOVE);
 assert.deepEqual([again.again,again.outcome,state.inserted.length,state.telegram.length],[true,'applied',1,4]);
});

test('an employee who joined through HR moves too, and a move HR Pulse already shows is only noted',async()=>{
 const form={id:'e1',number:'7001',code:'CMLL7001',name:'Sample Driver',data:{siteId:SITE.majri,officeData:{}}};
 const {state,pool}=store({lines:[line()],forms:[form]});
 const answer=await createMisSiteMove(pool,{syncKey:KEY}).misSiteMove(KEY,MOVE);
 assert.equal(answer.outcome,'applied');assert.match(answer.detail,/Nobody is set to be told/);
 assert.deepEqual([state.forms[0].data.siteId,state.forms[0].data.transferredFromSiteId,state.forms[0].data.lastTransferDate],[SITE.sasti,SITE.majri,'2026-11-20']);
 assert.deepEqual([state.inserted[0].data.employeeId,state.inserted[0].data.registerId],['e1','']);
 const there=store({lines:[line({site_id:SITE.sasti,site_code:'WCL-SASTI',site_name:'Sasti OB'})]});
 const noted=await createMisSiteMove(there.pool,{syncKey:KEY}).misSiteMove(KEY,MOVE);
 assert.deepEqual([noted.outcome,noted.detail,there.state.inserted.length],['applied','HR Pulse already shows Sasti OB.',0]);
});

test('what cannot be placed is held with the reason, and nothing changes',async()=>{
 const cases=[
  [store({lines:[]}),MOVE,/CMPL7001 is not in HR Pulse's Employee Master\./],
  [store({lines:[line(),line({id:'l2',site_code:'WCL-SASTI'})]}),MOVE,/is on 2 lines in HR Pulse's Employee Master/],
  [store({lines:[line({name:'OTHER PERSON'})]}),MOVE,/CMPL7001 is OTHER PERSON in HR Pulse, and SAMPLE DRIVER in Pulse-II\. Nobody was moved\./],
  [store({lines:[line()]}),{...MOVE,toSite:'Lalpeth OC'},/Lalpeth OC is not a site of HR Pulse's Employee Master\./],
  [store({lines:[line()],sites:[]}),MOVE,/Sasti OB is not an active site in HR Pulse\./],
 ];
 for(const [{state,pool},move,reason] of cases){
  const answer=await createMisSiteMove(pool,{syncKey:KEY}).misSiteMove(KEY,move);
  assert.equal(answer.outcome,'held');assert.match(answer.detail,reason);
  assert.deepEqual([state.inserted.length,state.telegram.length,state.lines[0]?.site_code||'WCL-MAJRI'],[0,0,'WCL-MAJRI']);
 }
});

test('the route takes only a POST with Pulse-II\'s key, without a Pulse sign-in',async()=>{
 let got;
 const server=createApi({query:async()=>({}),service:{misSiteMove:async(key,body)=>{got=[key,body.moveId];return {received:true,outcome:'applied'};}}}).listen(0);
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/integrations/mis/site-move`;
  const ok=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-MIS-Sync-Key':KEY},body:JSON.stringify(MOVE)});
  assert.equal(ok.status,200);assert.deepEqual(got,[KEY,'41']);assert.equal((await ok.json()).outcome,'applied');
  assert.equal((await fetch(url)).status,405);
 }finally{server.close();}
});
