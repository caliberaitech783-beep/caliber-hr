import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hierarchyRecipients,createTelegram,deliverTelegram,trialBot} from './telegram.mjs';
import {trialStatusRoster,trialStatusInvite} from './trial-status-bot.mjs';

/* Two sites with their own people; Regional HR and Directors come from trial-routing.mjs. */
const site=(code,group,people)=>({code,data:{code,group,steps:[
 {stage:1,label:'HR Manager',approvers:[people.hr]},{stage:1,label:'Driver Trainer',approvers:[people.trainer]},
 {stage:1,label:'Project Manager',approvers:[people.pm]},{stage:2,label:'Office HR — either one',approvers:[people.ohr]},
 {stage:2,label:'HR Manager — either one',approvers:[]},{stage:2,label:'Final approval — any one',approvers:[]}]}});
const rows=[site('NCL-JAYANT','NCL',{hr:'amitsingh',trainer:'jayanttrainer',pm:'gulnawaz',ohr:'apurvakopulwar'}),
 site('WCL-SASTI','WCL',{hr:'sastihr',trainer:'sastitrainer',pm:'sastipm',ohr:'sastiohr'})];
const db={query:async()=>({rows})};
const actors=async(stage,siteName)=>(await hierarchyRecipients(db,stage,{site:siteName})).map(r=>r.actor);

test('each trial step reaches only the next person of that site',async()=>{
 assert.deepEqual(await actors('part1','Jayant OB East'),['jayanttrainer'],'Site HR starts → only the Driver Trainer of Jayant');
 assert.deepEqual(await actors('part1','Sasti OB'),['sastitrainer']);
 assert.deepEqual(await actors('result','Jayant OB East'),['gulnawaz'],'trial PASS / FAIL → only the PM of Jayant');
 assert.deepEqual(await actors('ohr','Jayant OB East'),['apurvakopulwar'],'PM approves → only Office HR of Jayant');
 assert.deepEqual(await actors('rhr','Jayant OB East'),['vinodpinjarkar'],'NCL → Vinod Pinjarkar');
 assert.deepEqual(await actors('rhr','Sasti OB'),['viratsingh'],'WCL → Virat Singh');
 assert.deepEqual((await actors('director','Sasti OB')).sort(),['manishchadda','mohitchadda','rahulchadda']);
});

test('the roster lists everyone on the trial routes in route order, without the offices',async()=>{
 const recipients=await hierarchyRecipients(db,'all');
 const roster=trialStatusRoster([...recipients,{actor:'mayuriumate',site:'Nagpur Office',role:'HR Manager'}],['Jayant OB East','Sasti OB']);
 const by=actor=>roster.find(p=>p.actor===actor);
 assert.equal(roster[0].stage,'Site HR');
 assert.deepEqual(by('jayanttrainer').roles,['Driver Trainer · Jayant OB East']);
 assert.deepEqual(by('mohitchadda').roles,['Director · all sites']);
 assert.deepEqual(by('vinodpinjarkar').roles,['Regional HR · Jayant OB East']);
 assert.equal(by('mayuriumate'),undefined);
 assert.match(trialStatusInvite({roles:['PM · Jayant OB East'],url:'https://t.me/x?start=y',botUsername:'CMLLTrialStatusBot'}),/@CMLLTrialStatusBot[\s\S]*Your step: PM · Jayant OB East[\s\S]*https:\/\/t\.me\/x\?start=y/);
});

const withEnv=async(values,fn)=>{const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{return await fn();}finally{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const trialStatusEnv={TELEGRAM_TRIAL_STATUS_BOT_TOKEN:'ts-token',TELEGRAM_TRIAL_STATUS_BOT_USERNAME:'CMLLTrialStatusBot',TELEGRAM_TRIAL_STATUS_WEBHOOK_SECRET:'ts-secret'};

test('trial messages use the Trial Status bot once it is set up',async()=>{
 await withEnv({TELEGRAM_TRIAL_STATUS_BOT_TOKEN:'',TELEGRAM_TRIAL_STATUS_BOT_USERNAME:''},async()=>assert.equal(trialBot(),'trial'));
 await withEnv(trialStatusEnv,async()=>assert.equal(trialBot(),'trial-status'));
});

test('a personal Trial Status link connects that login on the Trial Status bot',async()=>{
 await withEnv(trialStatusEnv,async()=>{const writes=[];
  const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_trial_status_updates'))return {rowCount:1};
   if(s.startsWith('DELETE FROM hr_telegram_link_tokens')){assert.equal(v[0],createHash('sha256').update('c'.repeat(32)).digest('hex'));return {rows:[{actor:'jayanttrainer',bot:'trial-status'}]};}
   if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
  await createTelegram({connect:async()=>db}).telegramWebhook('ts-secret',{update_id:7,message:{chat:{type:'private',id:789},from:{id:789},text:'/start '+'c'.repeat(32)}},'trial-status');
  const binding=writes.find(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));
  assert.deepEqual(binding[1],['jayanttrainer','789',false,false,false,false,true,false]);
  assert.ok(writes.some(([s,v])=>s.startsWith('UPDATE hr_telegram_outbox')&&v[1]==='trial-status'),'waiting trial messages are retried at once');
  assert.ok(!writes.some(([s])=>s.startsWith('INSERT INTO hr_telegram_updates')),'Trial Status updates are kept apart from the other bots');
 });
});

test('Trial Status messages leave on the Trial Status bot, never on CMLL HR',async()=>{
 await withEnv({...trialStatusEnv,TELEGRAM_MT_BOT_TOKEN:'mt',TELEGRAM_MT_BOT_USERNAME:'CMLLHRBOT',TELEGRAM_MT_WEBHOOK_SECRET:'mt-secret'},async()=>{
  const sent=[];const db={release(){},async query(s){if(s.startsWith('SELECT o.'))return {rows:[{id:1,bot:'trial-status',actor:'gulnawaz',chat_id:'55',mt_hr_enabled:true,message:'m'}]};return {rows:[]};}};
  await deliverTelegram({connect:async()=>db},async(chat,text,bot)=>{sent.push([chat,bot]);});
  assert.deepEqual(sent,[['55','trial-status']]);
 });
});

/* Owner, 21 Nov 2026: the PM approves directly like the Driver Trainer; only Directors approve by OTP. */
test('the PM approves directly in HRMS (no OTP) and the form moves to Office HR',async()=>{
 await withEnv(trialStatusEnv,async()=>{
  const records=new Map([['trialForms:TF/1',{id:'f1',code:'TF/1',data:{formNo:'TF/1',site:'Jayant OB East',fields:{Result:'PASS','Name of candidate':'Ramesh Yadav'},history:[],pendingRole:'pm'}}]]);
  const outbox=[];
  const db={release(){},async query(sql,v=[]){
   if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
   if(sql.includes("kind='joiningHierarchies'"))return {rows};
   if(sql.includes("kind='trialForms' AND code = ANY"))return {rows:v[0].map(code=>records.get('trialForms:'+code)).filter(Boolean)};
   if(sql.includes("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1"))return {rows:[records.get('trialForms:'+v[0])].filter(Boolean)};
   if(sql.startsWith('UPDATE hr_records SET data=$1,status=$2')){const r=[...records.values()].find(x=>x.id===v[3]);r.data=v[0];return {rowCount:1};}
   if(sql.includes("kind='trialOtps'")&&sql.startsWith('SELECT'))return {rows:[records.get('trialOtps:'+v[0])].filter(Boolean)};
   if(sql.includes("'trialOtps'")&&sql.startsWith('INSERT')){records.set('trialOtps:'+v[0],{data:v[2]});return {rowCount:1};}
   if(sql.includes("kind='trialOtps'")&&sql.startsWith('UPDATE')){records.get('trialOtps:'+v[0]).data=v[1];return {rowCount:1};}
   if(sql.startsWith('INSERT INTO hr_telegram_outbox')){outbox.push({actor:v[1],message:v[2],bot:v[3],markup:JSON.parse(v[4]||'null')});return {rowCount:1};}
   if(sql.startsWith('INSERT INTO hr_telegram_files'))return {rows:[{id:1}]};
   return {rows:[],rowCount:1};}};
  const pool={query:db.query,connect:async()=>db},service=createTelegram(pool);
  const ohr={actor:'apurvakopulwar',name:'Apurva Kopulwar',permissions:{hrDesktopAccess:['Employee Master'],hrAccountStatus:'Active',hrTrialAssignments:[{role:'Office HR',sites:[{code:'NCL-JAYANT'}]}]}};
  const target={site:'Jayant OB East',region:'NCL'};
  const pm={...ohr,actor:'gulnawaz',name:'PM Sir',permissions:{...ohr.permissions,hrTrialAssignments:[{role:'PM',sites:[{code:'NCL-JAYANT'}]}]}};
  await assert.rejects(service.telegramApi(ohr,'trial-otp','POST',{...target,reviewer:'pm',formNos:['TF/1']}),{status:400},'there is no PM OTP any more');
  await assert.rejects(service.telegramApi(ohr,'trial-approval','POST',{...target,reviewer:'pm',approved:true,rows:[{formNo:'TF/1',fields:{Result:'PASS'}}]}),{status:403},'only the PM approves the PM step');
  const out=await service.telegramApi(pm,'trial-approval','POST',{...target,reviewer:'pm',approved:true,rows:[{formNo:'TF/1',fields:{Result:'PASS','Name of candidate':'Ramesh Yadav'}}]});
  assert.equal(out.stage,'ohr');
  assert.equal(records.get('trialForms:TF/1').data.pendingRole,'ohr');
  assert.equal(records.get('trialForms:TF/1').data.history[0].action,'Approved');
  assert.deepEqual(outbox.map(o=>o.actor),['apurvakopulwar'],'after the PM, the form goes to Office HR');
  assert.deepEqual(outbox[0].markup.inline_keyboard[0].map(b=>b.text),['✅ Approve','❌ Decline']);
 });
});

test('a PASS goes to the PM with Approve and Decline buttons; Office HR is not asked for a PM OTP',async()=>{
 await withEnv(trialStatusEnv,async()=>{
  const outbox=[];
  const db={release(){},async query(sql,v=[]){
   if(sql.includes("kind='joiningHierarchies'"))return {rows};
   if(sql.startsWith('INSERT INTO hr_telegram_outbox')){outbox.push({key:v[0],actor:v[1],message:v[2],bot:v[3],markup:JSON.parse(v[4]||'null')});return {rowCount:1};}
   if(sql.startsWith('INSERT INTO hr_telegram_files'))return {rows:[{id:1}]};
   if(sql.includes('RETURNING id'))return {rows:[{id:'new'}]};
   return {rows:[],rowCount:1};}};
  const service=createTelegram({query:db.query,connect:async()=>db});
  const trainer={actor:'jayanttrainer',name:'Rakesh Singh',permissions:{hrDesktopAccess:['Employee Master'],hrAccountStatus:'Active',hrTrialAssignments:[{role:'Driver Trainer',sites:[{code:'NCL-JAYANT'}]}]}};
  const files=[{name:'r.pdf',mime:'application/pdf',kind:'trialResult',data:'QQ=='},{name:'v.mp4',mime:'video/mp4',kind:'drivingVideo',data:'QQ=='}];
  const send=(formNo,Result)=>service.telegramApi(trainer,'trial-result','POST',{formNo,site:'Jayant OB East',region:'NCL',fields:{Result,'Name of candidate':'Ramesh Yadav','If FAIL – reason':Result==='FAIL'?'Could not reverse':''},attachments:files});
  await send('TF/9','PASS');
  assert.deepEqual(outbox.map(o=>[o.actor,o.bot]),[['gulnawaz','trial-status']],'only the PM is told');
  assert.deepEqual(outbox[0].markup?.inline_keyboard[0].map(b=>b.text),['✅ Approve','❌ Decline'],'the PM approves on Telegram');
  assert.doesNotMatch(outbox[0].message,/OTP/);
  outbox.length=0;
  await send('TF/10','FAIL');
  assert.deepEqual(outbox.map(o=>o.actor),['gulnawaz'],'a failed candidate goes to the PM only');
 });
});

/* 20 Nov 2026: the PM's OTP was stuck behind messages for people who never linked a bot. */
test('a deliverable OTP is sent in the same sweep even behind many unlinked recipients',async()=>{
 await withEnv(trialStatusEnv,async()=>{
  const queue=[...Array.from({length:80},(_,i)=>({id:i+1,bot:'leave',actor:'nobody'+i,chat_id:null,message:'old'})),{id:81,bot:'trial-status',actor:'gulnawaz',chat_id:'55',message:'OTP: 123456'}];
  let sql='';const db={release(){},async query(s){if(s.startsWith('SELECT o.')){sql=s;return {rows:queue};}return {rows:[]};}};
  const sent=[];await deliverTelegram({connect:async()=>db},async(chat,text,bot)=>{sent.push([chat,text,bot]);});
  assert.match(sql,/LIMIT 100 /);
  assert.deepEqual(sent,[['55','OTP: 123456','trial-status']]);
 });
});
test('one sweep sends at most five messages; the rest stay due',async()=>{
 await withEnv(trialStatusEnv,async()=>{
  const queue=Array.from({length:8},(_,i)=>({id:i+1,bot:'trial-status',actor:'p'+i,chat_id:String(i),message:'m'}));
  const writes=[];const db={release(){},async query(s,v){if(s.startsWith('SELECT o.'))return {rows:queue};writes.push([s,v]);return {rows:[]};}};
  let sent=0;await deliverTelegram({connect:async()=>db},async()=>{sent++;});
  assert.equal(sent,5);
  assert.equal(writes.filter(([s])=>s.includes("state='SENT'")).length,5);
 });
});
