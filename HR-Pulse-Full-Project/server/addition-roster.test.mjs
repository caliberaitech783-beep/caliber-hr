import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hierarchyTemplates,officeStepsOf} from './joining-hierarchy.mjs';
import {additionRoster,connectInviteMessage} from './addition-roster.mjs';
import {createTelegram} from './telegram.mjs';

const site=(code,status='ACTIVE')=>{const t=hierarchyTemplates.find(x=>x.code===code);return {code,status,data:{...t,steps:t.steps.map(s=>({...s,approvers:[]})),officeSteps:officeStepsOf(t.steps).map((s,i)=>({...s,approvers:i<3?[`${code.toLowerCase()}-${i}`]:['ignored']}))}};};
const nagpur={code:'CMLL-CO',status:'ACTIVE',data:{steps:[{label:'HR Executive',approvers:['mayuriumate']},{label:'HR Manager',approvers:[]}]}};
const actors=list=>list.map(p=>p.actor);

test('the list covers enabled sites, both offices and the fixed Regional HR and Directors',()=>{
 const roster=additionRoster([site('NCL-DUDE'),site('WCL-SASTI'),site('WCL-MAJRI','DRAFT'),nagpur]);
 for(const a of ['ncl-dude-0','ncl-dude-1','ncl-dude-2','wcl-sasti-0','vinodpinjarkar','viratsingh','mohitchadda','manishchadda','rahulchadda','mayuriumate'])assert.ok(actors(roster).includes(a),a);
 assert.ok(!actors(roster).some(a=>a.startsWith('wcl-majri')),'a hierarchy that is not enabled is left out');
 assert.ok(!actors(roster).includes('ignored'),'saved Regional HR / Directors are replaced by the fixed ones');
 const vinod=roster.find(p=>p.actor==='vinodpinjarkar');
 assert.deepEqual(vinod.roles.sort(),['HR Manager · Nagpur Office','Regional HR · Dudhichua OB East']);
 assert.deepEqual(roster.find(p=>p.actor==='ncl-dude-1').roles,['PM / HOD · Dudhichua OB East']);
});

test('the invite names the bot, the role and the personal link',()=>{
 const text=connectInviteMessage({roles:['PM / HOD · Dudhichua OB East'],url:'https://t.me/NagpurEmployeeAdditionBot?start=x',botUsername:'NagpurEmployeeAdditionBot'});
 assert.match(text,/@NagpurEmployeeAdditionBot/);assert.match(text,/PM \/ HOD · Dudhichua OB East/);assert.match(text,/\?start=x/);
});

test('Send connect links: skips the connected, sends through a bot they use, returns a link to forward for the rest',async()=>{
 const env={...process.env};process.env.TELEGRAM_NAGPUR_BOT_TOKEN='t';process.env.TELEGRAM_NAGPUR_BOT_USERNAME='NagpurEmployeeAdditionBot';process.env.TELEGRAM_NAGPUR_RECIPIENTS='{"rahulchadda":"9"}';
 const writes=[];
 const accounts=[{actor:'vinodpinjarkar',leave_connected:true,joining_connected:false,trial_connected:false,nagpur_connected:false},{actor:'viratsingh',leave_connected:false,joining_connected:false,trial_connected:true,nagpur_connected:false},{actor:'mohitchadda',leave_connected:true,joining_connected:false,trial_connected:false,nagpur_connected:true}];
 const query=async(sql,values)=>{writes.push([sql,values]);if(sql.includes("kind='joiningHierarchies'"))return {rows:[site('NCL-DUDE'),site('WCL-SASTI')]};if(sql.startsWith('SELECT actor,leave_connected'))return {rows:accounts};return {rows:[],rowCount:1};};
 const pool={query,connect:async()=>({query,release(){}})};
 const admin={actor:'admin',permissions:{hrDesktopAccess:['Approval Management']}};
 try{
  const svc=createTelegram(pool);
  await assert.rejects(svc.telegramApi({actor:'x',permissions:{hrDesktopAccess:['Employee Master']}},'addition-links','GET',{}),e=>e.status===403);
  const preview=await svc.telegramApi(admin,'addition-links','GET',{});
  const by=a=>preview.people.find(p=>p.actor===a);
  assert.equal(by('mohitchadda').connected,true);assert.equal(by('rahulchadda').connected,true,'TELEGRAM_NAGPUR_RECIPIENTS counts as connected');
  assert.equal(by('vinodpinjarkar').via,'leave');assert.equal(by('viratsingh').via,'trial');assert.equal(by('ncl-dude-1').via,'');
  writes.length=0;
  const result=await svc.telegramApi(admin,'addition-links','POST',{});
  const res=a=>result.people.find(p=>p.actor===a);
  assert.equal(res('mohitchadda').status,'already connected');assert.equal(res('mohitchadda').url,undefined);
  assert.match(res('vinodpinjarkar').status,/^sent on HR Pulse leave bot/);assert.equal(res('vinodpinjarkar').url,undefined);
  assert.match(res('viratsingh').status,/^sent on Vehicle Trial Result bot/);
  assert.match(res('ncl-dude-1').url,/^https:\/\/t\.me\/NagpurEmployeeAdditionBot\?start=[A-Za-z0-9_-]{32}$/);
  const queued=writes.filter(([sql])=>sql.startsWith('INSERT INTO hr_telegram_outbox')).map(([,v])=>[v[1],v[3]]);
  assert.deepEqual(queued.sort(),[['vinodpinjarkar','leave'],['viratsingh','trial']]);
  const tokens=writes.filter(([sql])=>sql.startsWith('INSERT INTO hr_telegram_link_tokens')).map(([,v])=>v[1]);
  assert.ok(!tokens.includes('mohitchadda')&&tokens.includes('ncl-dude-1')&&tokens.includes('vinodpinjarkar'));
  assert.ok(writes.some(([sql])=>sql.includes("'SEND_ADDITION_BOT_LINKS'")));
 }finally{for(const k of ['TELEGRAM_NAGPUR_BOT_TOKEN','TELEGRAM_NAGPUR_BOT_USERNAME','TELEGRAM_NAGPUR_RECIPIENTS'])if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
});

test('Link delivery: delivered, waiting with reason, failed, and a link handed out to forward',async()=>{
 const query=async sql=>{
  if(sql.includes("kind='joiningHierarchies'"))return {rows:[site('NCL-DUDE')]};
  if(sql.startsWith('SELECT actor,leave_connected'))return {rows:[]};
  if(sql.includes("event_key LIKE 'nagpur-invite:%'"))return {rows:[
   {actor:'vinodpinjarkar',bot:'leave',state:'SENT',last_error:null,sent_at:'2026-11-20T08:00:00Z',created_at:'2026-11-20T07:59:00Z'},
   {actor:'mohitchadda',bot:'leave',state:'PENDING',last_error:'Recipient must open @LeaveRequestt_Bot and tap Start',sent_at:null,created_at:'2026-11-20T07:59:00Z'},
   {actor:'manishchadda',bot:'joining',state:'FAILED',last_error:'Delivery failed; recipient may have blocked the bot',sent_at:null,created_at:'2026-11-20T07:59:00Z'}]};
  if(sql.includes('FROM hr_telegram_link_tokens'))return {rows:[{actor:'ncl-dude-1',expires_at:'2099-01-01T00:00:00Z'},{actor:'ncl-dude-2',expires_at:'2000-01-01T00:00:00Z'},{actor:'vinodpinjarkar',expires_at:'2099-01-01T00:00:00Z'}]};
  return {rows:[]};};
 const out=await createTelegram({query,connect:async()=>({query,release(){}})}).telegramApi({actor:'admin',permissions:{hrDesktopAccess:['Approval Management']}},'addition-links','GET',{});
 const d=a=>out.people.find(p=>p.actor===a).delivery;
 assert.deepEqual({state:d('vinodpinjarkar').state,bot:d('vinodpinjarkar').bot},{state:'DELIVERED',bot:'leave'},'a sent message wins over the open link');
 assert.equal(d('mohitchadda').state,'WAITING');assert.match(d('mohitchadda').error,/tap Start/);
 assert.equal(d('manishchadda').state,'FAILED');
 assert.equal(d('ncl-dude-1').state,'FORWARD');assert.equal(d('ncl-dude-2').state,'EXPIRED');
 assert.equal(d('rahulchadda'),null);
});

test('office HR Executives default to Mayuri Umate (Nagpur) and Monika Wadhai (Chandrapur) when none is saved',()=>{
 const roster=additionRoster([]);
 assert.deepEqual(roster.find(p=>p.actor==='mayuriumate')?.roles,['Office HR · Nagpur Office']);
 assert.deepEqual(roster.find(p=>p.actor==='monikawadhai')?.roles,['Office HR · Chandrapur HO']);
 assert.ok(!actors(additionRoster([{code:'CMLL-HO',status:'ACTIVE',data:{steps:[{label:'HR Executive',approvers:['otherhr']}]}}])).includes('monikawadhai'),'a saved HR Executive replaces the default');
});
