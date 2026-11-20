import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {leaveSteps,leaveRequestRoster,leaveRequestInvite,leaveOtpMessage,leaveOtpNeededMessage} from './leave-request-bot.mjs';
import {telegramSteps,validateTelegramHierarchy,createTelegram,deliverTelegram,leaveBot,queueLeaveStep} from './telegram.mjs';
import {nextApproval} from './joining-hierarchy.mjs';
import {createService} from './service.mjs';

/* Owner, 20 Nov 2026: one leave route for every site and office – Employee → HOD → Directors (OTP) → Regional HR (final). */
const flow={type:'site',hods:{Operations:'ops.hod','*':'default.hod'},hrManager:'amitsingh',pm:'gulnawaz',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true};

test('site and office leave both go HOD → Directors by OTP → Regional HR final, with no PM step',()=>{
 for(const type of ['site','office']){
  const steps=telegramSteps({...flow,type},'operations');
  assert.deepEqual(steps.map(s=>s.label),['HOD (concerned) — any one','Directors — approve by OTP, any one','Regional HR — final approval, any one']);
  assert.deepEqual(steps.map(s=>s.approvers),[['ops.hod'],['manishchadda','mohitchadda','rahulchadda'],['vinodpinjarkar']]);
  assert.deepEqual(steps.map(s=>!!s.otp),[false,true,false]);
  const a={requested_by:'employee',stage:0,approval_steps:steps};
  assert.equal(nextApproval(a,'ops.hod','APPROVED').state,'PENDING');
  assert.equal(nextApproval({...a,stage:2},'vinodpinjarkar','APPROVED').state,'APPROVED','Regional HR gives final approval');
  assert.throws(()=>nextApproval(a,'gulnawaz','APPROVED'),e=>e.status===403,'PM is no longer on the leave route');
 }
 assert.deepEqual(telegramSteps(flow,'Accounts')[0].approvers,['default.hod'],'department without its own HOD uses the * HOD');
});

test('nobody approves their own leave',()=>{
 assert.deepEqual(leaveSteps(flow,'ops.hod','ops.hod').map(s=>s.label.replace(/ — .*/,'')),['Directors','Regional HR'],'HOD raising own leave skips the HOD step');
 assert.deepEqual(leaveSteps(flow,'ops.hod','mohitchadda')[1].approvers,['manishchadda','rahulchadda'],'a Director\'s leave goes to the other Directors');
 const rhr=leaveSteps(flow,'ops.hod','vinodpinjarkar');
 assert.deepEqual(rhr.map(s=>s.label.replace(/ — .*/,'')),['HOD (concerned)','Directors']);
 assert.equal(rhr[1].otp,undefined,'with no Regional HR left to enter an OTP, the Directors approve directly');
});

test('the leave flow no longer needs a site HR Manager or PM',()=>{
 const saved=validateTelegramHierarchy({type:'site',hods:{Operations:'OPS.HOD'},regionalHr:'VinodPinjarkar',directors:'MohitChadda',enabled:true});
 assert.equal(saved.hrManager,'');assert.equal(saved.pm,'');assert.equal(saved.hods.Operations,'ops.hod');
});

test('the join-link roster lists every employee with a Pulse login and every leave approver, approvers first',()=>{
 const roster=leaveRequestRoster({
  employees:[{actor:'Ravi.K',name:'Ravi Kumar',site:'Jayant OB'},{actor:'ops.hod',name:'Ops Head',site:'Jayant OB'},{actor:'',name:'No login'}],
  flows:[{name:'Jayant OB',data:{...flow}},{name:'Sasti OB',data:{...flow,hods:{Workshop:'sasti.hod'}}},{name:'Off',data:{...flow,enabled:false,hods:{X:'disabled.hod'}}}],
 });
 const by=actor=>roster.find(p=>p.actor===actor);
 assert.deepEqual(by('ravi.k'),{actor:'ravi.k',name:'Ravi Kumar',stage:'Employee',roles:['Employee · Jayant OB']});
 assert.deepEqual(by('ops.hod').roles,['Employee · Jayant OB','HOD · Jayant OB']);
 assert.deepEqual(by('mohitchadda').roles,['Directors (OTP) · all sites']);
 assert.equal(by('disabled.hod'),undefined,'routes that are switched off are not listed');
 assert.equal(roster.length,8);
 assert.equal(roster.at(-1).actor,'ravi.k','employees come after the approvers');
 assert.match(leaveRequestInvite({roles:['Employee · Jayant OB'],url:'https://t.me/x?start=y',botUsername:'CMLLLeaveRequestBot'}),/@CMLLLeaveRequestBot[\s\S]*Employee → HOD → Directors \(OTP\) → Regional HR[\s\S]*You: Employee · Jayant OB[\s\S]*https:\/\/t\.me\/x\?start=y/);
});

const withEnv=async(values,fn)=>{const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{return await fn();}finally{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const botEnv={TELEGRAM_LEAVE_REQUEST_BOT_TOKEN:'lr-token',TELEGRAM_LEAVE_REQUEST_BOT_USERNAME:'CMLLLeaveRequestBot',TELEGRAM_LEAVE_REQUEST_WEBHOOK_SECRET:'lr-secret'};

test('leave messages use the Leave Request bot once it is set up',async()=>{
 await withEnv({TELEGRAM_LEAVE_REQUEST_BOT_TOKEN:'',TELEGRAM_LEAVE_REQUEST_BOT_USERNAME:''},async()=>assert.equal(leaveBot(),'leave'));
 await withEnv(botEnv,async()=>assert.equal(leaveBot(),'leave-request'));
});

test('a personal join link connects that login on the Leave Request bot',async()=>{
 await withEnv(botEnv,async()=>{const writes=[];
  const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_leave_request_updates'))return {rowCount:1};
   if(s.startsWith('DELETE FROM hr_telegram_link_tokens WHERE hash')){assert.equal(v[0],createHash('sha256').update('d'.repeat(32)).digest('hex'));return {rows:[{actor:'ravi.k',bot:'leave-request'}]};}
   if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
  await createTelegram({connect:async()=>db}).telegramWebhook('lr-secret',{update_id:9,message:{chat:{type:'private',id:321},from:{id:321},text:'/start '+'d'.repeat(32)}},'leave-request');
  const binding=writes.find(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));
  assert.deepEqual(binding[1],['ravi.k','321',false,false,false,false,false,true]);
  assert.ok(writes.some(([s,v])=>s.startsWith('UPDATE hr_telegram_outbox')&&v[1]==='leave-request'),'waiting leave messages are retried at once');
  assert.ok(writes.some(([s,v])=>s.startsWith("DELETE FROM hr_telegram_link_tokens WHERE actor=$1 AND bot='leave-request'")&&v[0]==='ravi.k'),'once joined, the other links of the person are cleared');
  assert.ok(writes.some(([s,v])=>s.startsWith('INSERT INTO hr_telegram_outbox')&&v[3]==='leave-request'&&/Connected to CALIBER Leave Request/.test(v[2])));
 });
});

test('Leave Request messages leave on the Leave Request bot, never on CMLL HR',async()=>{
 await withEnv({...botEnv,TELEGRAM_MT_BOT_TOKEN:'mt',TELEGRAM_MT_BOT_USERNAME:'CMLLHRBOT',TELEGRAM_MT_WEBHOOK_SECRET:'mt-secret'},async()=>{
  const sent=[];const db={release(){},async query(s){if(s.startsWith('SELECT o.')){assert.match(s,/o\.bot='leave-request' AND a\.leave_request_connected/);return {rows:[{id:1,bot:'leave-request',actor:'ops.hod',chat_id:'77',mt_hr_enabled:true,message:'m'}]};}return {rows:[]};}};
  await deliverTelegram({connect:async()=>db},async(chat,text,bot)=>{sent.push([chat,bot]);});
  assert.deepEqual(sent,[['77','leave-request']]);
 });
});

const record={code:'LR-77',name:'Family function',data:{employeeName:'Ravi Kumar',fromDate:'2026-11-25',toDate:'2026-11-26',days:2,name:'Family function'}};
test('each step is told only to the next people: HOD on submit, Regional HR to request the OTP after the HOD',async()=>{
 await withEnv(botEnv,async()=>{
  const out=[];const db={async query(s,v){if(s.startsWith('INSERT INTO hr_telegram_outbox'))out.push({actor:v[1],message:v[2],bot:v[3]});return {rows:[]};}};
  const steps=telegramSteps(flow,'Operations');
  assert.deepEqual(await queueLeaveStep(db,{key:'a:submitted',record,steps,stage:0,siteName:'Jayant OB',sender:'ravi.k'}),['ops.hod']);
  assert.match(out[0].message,/LEAVE REQUEST SUBMITTED[\s\S]*Awaiting HOD \(concerned\) approval/);
  assert.equal(out[0].bot,'leave-request');
  out.length=0;
  assert.deepEqual(await queueLeaveStep(db,{key:'a:1',record,steps,stage:1,siteName:'Jayant OB',sender:'ops.hod',decision:{actor:'ops.hod',name:'Ops Head',at:'2026-11-20T10:00:00Z'}}),['vinodpinjarkar'],'the Directors get nothing until the OTP is requested');
  assert.match(out[0].message,/DIRECTORS' OTP NEEDED[\s\S]*Approved by HOD: Ops Head[\s\S]*Request OTP from Directors/);
  assert.match(leaveOtpMessage({record,siteName:'Jayant OB',otp:'123456',requestedBy:'Vinod'}),/OTP: 123456 \(valid 15 min\)[\s\S]*Tell this OTP to Regional HR/);
  assert.match(leaveOtpNeededMessage({record,siteName:'Jayant OB',hod:'Ops Head'}),/Leave: 25 Nov 2026 to 26 Nov 2026 \(2 days\)/);
 });
});

/* Regional HR requests the Directors' OTP, a wrong OTP is counted, the right one moves the leave to Regional HR's final approval. */
const approvalId='11111111-1111-4111-8111-111111111111',recordId='22222222-2222-4222-8222-222222222222';
const rhr={actor:'vinodpinjarkar',name:'Vinod',permissions:{hrDesktopAccess:['Approval Management']}};
function otpDb(){
 const state={approval:{id:approvalId,record_id:recordId,state:'PENDING',stage:1,version:3,history:[{actor:'ops.hod',stage:1,decision:'APPROVED'}],requested_by:'ravi.k',approval_steps:telegramSteps(flow,'Operations'),record_snapshot:{telegramSiteName:'Jayant OB',telegramFlow:flow}},otp:null,outbox:[],updates:[]};
 const db={release(){},async query(s,v=[]){
  if(s.startsWith('SELECT * FROM hr_approvals'))return {rows:[state.approval]};
  if(s.startsWith('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE'))return {rows:[{id:recordId,kind:'leaveRequests',...record}]};
  if(s.startsWith("SELECT data FROM hr_records WHERE kind='leaveOtps'"))return {rows:state.otp?[{data:state.otp}]:[]};
  if(s.startsWith("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'leaveOtps'")){state.otp=v[2];return {rows:[]};}
  if(s.startsWith("UPDATE hr_records SET data=$2")&&s.includes("kind='leaveOtps'")){state.otp=v[1];return {rows:[]};}
  if(s.startsWith('INSERT INTO hr_telegram_outbox')){state.outbox.push({actor:v[1],message:v[2]});return {rows:[]};}
  if(s.startsWith('UPDATE hr_approvals')){state.updates.push(v);return {rows:[]};}
  return {rows:[],rowCount:1};
 }};
 return {state,service:createService({connect:async()=>db})};
}
test('Regional HR requests the Directors\' OTP and enters it; a wrong OTP is refused and counted',async()=>{
 const {state,service}=otpDb();
 await assert.rejects(service.leaveOtp({...rhr,actor:'ops.hod'},approvalId,{}),e=>e.status===403,'only Regional HR of this leave');
 const sent=await service.leaveOtp(rhr,approvalId,{});
 assert.deepEqual(sent.sentTo,['manishchadda','mohitchadda','rahulchadda']);
 const otp=state.outbox[0].message.match(/OTP: (\d{6})/)[1];
 await assert.rejects(service.leaveOtp(rhr,approvalId,{otp:otp==='000000'?'111111':'000000'},true),/Wrong OTP \(4 attempts left\)/);
 assert.equal(state.otp.attempts,1);
 const done=await service.leaveOtp(rhr,approvalId,{otp},true);
 assert.equal(done.status,'APPROVED');assert.match(done.next,/Regional HR/);
 const [stage,history]=state.updates[0];assert.equal(stage,2);
 assert.match(JSON.parse(history).at(-1).comments,/Directors' OTP entered by Vinod/);
 assert.equal(state.otp.otpHash,null,'single use');
});
test('Directors cannot approve leave directly – only by OTP; they can still reject',async()=>{
 const {service}=otpDb();
 await assert.rejects(service.decide({actor:'mohitchadda',permissions:{hrDesktopAccess:['Approval Management']}},approvalId,{decision:'APPROVED',version:3}),/approve leave by OTP/);
});

/* Owner, 20 Nov 2026: an old, used or replaced join link must not leave someone stuck on "link expired". */
const startWith=async(account)=>withEnv(botEnv,async()=>{const writes=[],sent=[];
 const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_leave_request_updates'))return {rowCount:1};
  if(s.startsWith('DELETE FROM hr_telegram_link_tokens WHERE hash'))return {rows:[]};
  if(s.startsWith('SELECT actor,leave_request_connected'))return {rows:account?[account]:[]};
  return {rows:[],rowCount:1};}};
 const realFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{sent.push(JSON.parse(init.body).text);return new Response(JSON.stringify({ok:true}));};
 try{await createTelegram({connect:async()=>db}).telegramWebhook('lr-secret',{update_id:11,message:{chat:{type:'private',id:555},from:{id:555},text:'/start '+'e'.repeat(32)}},'leave-request');}
 finally{globalThis.fetch=realFetch;}
 return {writes,sent};});
test('a used link from someone already joined says they are connected, not that the link expired',async()=>{
 const {sent,writes}=await startWith({actor:'ravi.k',leave_request_connected:true});
 assert.deepEqual(sent,["You're already connected to CALIBER Leave Request. Your leave status, and leave waiting for your approval, will arrive here."]);
 assert.ok(!writes.some(([s])=>s.startsWith('UPDATE hr_telegram_accounts')));
});
test('a used or replaced link from a Telegram account HR already knows joins them anyway',async()=>{
 const {sent,writes}=await startWith({actor:'ops.hod',leave_request_connected:false});
 assert.deepEqual(sent,[]);
 assert.ok(writes.some(([s,v])=>s.startsWith('UPDATE hr_telegram_accounts SET leave_request_connected=true')&&v[0]==='ops.hod'));
 assert.ok(writes.some(([s,v])=>s.startsWith('INSERT INTO hr_telegram_outbox')&&v[1]==='ops.hod'&&/Connected to CALIBER Leave Request/.test(v[2])));
});
test('an unknown Telegram account with a dead link is still told to ask HR for a new one',async()=>{
 const {sent}=await startWith(null);
 assert.deepEqual(sent,['This link has expired or was already used. Ask HR for a new Leave Request link.']);
});
test('making a new join link keeps the person\'s older links working',async()=>{
 await withEnv(botEnv,async()=>{const writes=[];
  const db={release(){},async query(s,v){writes.push([s,v]);
   if(s.includes('FROM hr_records e'))return {rows:[{actor:'ravi.k',name:'Ravi',site:'Jayant OB'}]};
   return {rows:[],rowCount:1};}};
  const svc=createTelegram({query:db.query,connect:async()=>db});
  await svc.telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Approval Management']}},'leave-request-link','POST',{actor:'ravi.k'});
  const cleanup=writes.filter(([s])=>s.startsWith('DELETE FROM hr_telegram_link_tokens'));
  assert.deepEqual(cleanup.map(([s])=>s),['DELETE FROM hr_telegram_link_tokens WHERE expires_at<now()']);
 });
});
