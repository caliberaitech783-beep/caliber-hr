import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {employeeTrackSteps,missingTrackApprovers,employeeTrackRoster,employeeTrackInvite,trackOtpMessage,queueTrackStep,otpEnterers,isEmployeeTrack,DIRECTORS_OTP_LABEL} from './employee-track.mjs';
import {createTelegram,deliverTelegram,additionBot} from './telegram.mjs';
import {nextApproval} from './joining-hierarchy.mjs';
import {createService} from './service.mjs';

/* Owner, 21 Nov 2026: every new employee goes Site HR (initiates) → Regional HR → Directors (approve by OTP) → Active,
   on the CALIBER Employee Track bot. Owner, 21 Nov 2026 (evening): OB / COAL sites add Site PM and Office HR after Site HR. */
const siteSteps=[{label:'HR Manager',approvers:['amitsingh']},{label:'Driver Trainer',approvers:['trainer']},{label:'Project Manager',approvers:['gulnawaz']},{label:'Office HR',approvers:['mayuriumate']}];
const roles=steps=>steps.map(s=>[s.label.replace(/ — .*/,''),s.approvers.join(',')]);

test('OB / COAL, Site HR initiating: Site PM → Office HR → Regional HR → Directors (OTP); no Driver Trainer step',()=>{
 const steps=employeeTrackSteps({code:'NCL-JAYANT',steps:siteSteps,requester:'AmitSingh'});
 assert.deepEqual(roles(steps),[['Project Manager','gulnawaz'],['Office HR','mayuriumate'],['HR Manager','vinodpinjarkar'],['Directors','mohitchadda,manishchadda,rahulchadda']]);
 assert.equal(steps[3].label,DIRECTORS_OTP_LABEL);
 assert.deepEqual(steps.map(s=>!!s.otp),[false,false,false,true]);
 assert.deepEqual(otpEnterers(steps,3),['vinodpinjarkar'],'Regional HR enters the Directors\' OTP');
 assert.ok(isEmployeeTrack(steps));
 const a={requested_by:'amitsingh',stage:0,approval_steps:steps};
 assert.equal(nextApproval(a,'gulnawaz','APPROVED').state,'PENDING','Site PM approves normally and it moves to Office HR');
 assert.throws(()=>nextApproval(a,'vinodpinjarkar','APPROVED'),e=>e.status===403,'Regional HR waits for Site PM and Office HR');
 assert.throws(()=>nextApproval(a,'trainer','APPROVED'),e=>e.status===403,'Driver Trainer is not on the route');
});

test('OB / COAL: Site PM and Office HR must be set in the site hierarchy; offices do not need them',()=>{
 assert.deepEqual(missingTrackApprovers({code:'NCL-JAYANT',steps:siteSteps}),[]);
 assert.deepEqual(missingTrackApprovers({code:'WCL-MAJRI',steps:[{label:'HR Manager',approvers:['majri.hr']}]}),['Site PM (Project Manager)','Office HR']);
 assert.deepEqual(missingTrackApprovers({code:'CMLL-HO',steps:[]}),[]);
 assert.deepEqual(missingTrackApprovers({code:'XYZ',steps:[]}),[]);
});

test('someone else submitting still needs Site HR first; WCL sites use Virat Singh',()=>{
 assert.deepEqual(roles(employeeTrackSteps({code:'NCL-JAYANT',steps:siteSteps,requester:'hr.exec'})).map(r=>r[1]),['amitsingh','gulnawaz','mayuriumate','vinodpinjarkar','mohitchadda,manishchadda,rahulchadda']);
 assert.deepEqual(employeeTrackSteps({code:'WCL-MAJRI',steps:siteSteps,requester:'amitsingh'}).map(s=>s.approvers[0]),['gulnawaz','mayuriumate','viratsingh','mohitchadda']);
});

test('offices: office HR initiates → that office\'s HR Manager (Regional HR) → Directors (OTP)',()=>{
 const ho=employeeTrackSteps({code:'CMLL-HO',steps:[],requester:'monikawadhai'});
 assert.deepEqual(roles(ho),[['HR Manager','viratsingh'],['Directors','mohitchadda,manishchadda,rahulchadda']]);
 assert.equal(ho[0].office,'Chandrapur HO');
 const co=employeeTrackSteps({code:'CMLL-CO',steps:[{label:'HR Manager',approvers:['Nagpur.Manager']}],requester:'mayuriumate'});
 assert.deepEqual(co[0].approvers,['nagpur.manager'],'a saved office HR Manager replaces the default');
});

test('Regional HR starting a form: only the Directors\' OTP step is left, still entered by Regional HR; unknown sites keep the old rules',()=>{
 const steps=employeeTrackSteps({code:'NCL-DUDE',steps:[],requester:'vinodpinjarkar'});
 assert.deepEqual(steps.map(s=>s.label),[DIRECTORS_OTP_LABEL]);
 assert.deepEqual(steps[0].otpBy,['vinodpinjarkar']);
 assert.equal(employeeTrackSteps({code:'XYZ',steps:siteSteps,requester:'a'}),null);
});

const withEnv=async(values,fn)=>{const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{return await fn();}finally{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
const botEnv={TELEGRAM_EMPLOYEE_TRACK_BOT_TOKEN:'et-token',TELEGRAM_EMPLOYEE_TRACK_BOT_USERNAME:'CMLLEmployeeTrackBot',TELEGRAM_EMPLOYEE_TRACK_WEBHOOK_SECRET:'et-secret'};

test('new employee messages use the Employee Track bot once it is set up',async()=>{
 await withEnv({TELEGRAM_EMPLOYEE_TRACK_BOT_TOKEN:'',TELEGRAM_EMPLOYEE_TRACK_BOT_USERNAME:''},async()=>assert.equal(additionBot(),'nagpur'));
 await withEnv(botEnv,async()=>assert.equal(additionBot(),'employee-track'));
});

const record={code:'EMP-101',name:'Ravi Kumar',data:{officeData:{'Department *':'Operations','Designation *':'Supervisor'}}};
test('each step is told only to the next people; Site HR hears the result',async()=>{
 const out=[];const db={};const queue=async(_db,key,actors,message,bot,markup)=>{out.push({key,actors,message,bot,markup});};
 const steps=employeeTrackSteps({code:'NCL-JAYANT',steps:siteSteps,requester:'hr.exec'});
 assert.deepEqual(await queueTrackStep(db,queue,'employee-track',{key:'k',approvalId:'id',record,siteName:'Jayant OB',steps,stage:0,state:'SUBMITTED',requestedBy:'hr.exec',sender:'hr.exec'}),['amitsingh']);
 assert.match(out[0].message,/NEW EMPLOYEE — APPROVAL REQUIRED[\s\S]*Step 1 of 5: Site HR[\s\S]*Ravi Kumar \(EMP-101\)[\s\S]*Route: Site HR → PM \/ HOD → Office HR → Regional HR → Directors \(OTP\)/);
 assert.deepEqual(out[0].markup.inline_keyboard[0].map(b=>b.text),['✅ Approve','❌ Reject']);
 out.length=0;
 assert.deepEqual(await queueTrackStep(db,queue,'employee-track',{key:'k',approvalId:'id',record,siteName:'Jayant OB',steps,stage:4,state:'PENDING',requestedBy:'hr.exec',sender:'vinodpinjarkar'}),[],'the OTP step is sent by the OTP issuer, not here');
 assert.deepEqual(await queueTrackStep(db,queue,'employee-track',{key:'k',approvalId:'id',record,siteName:'Jayant OB',steps,stage:5,state:'APPROVED',requestedBy:'hr.exec',sender:'vinodpinjarkar',actor:'Vinod'}),['hr.exec']);
 assert.match(out[0].message,/NOW ACTIVE[\s\S]*Final approval by: Vinod/);
 out.length=0;
 assert.deepEqual(await queueTrackStep(db,queue,'employee-track',{key:'k',approvalId:'id',record,siteName:'Jayant OB',steps,stage:5,state:'REJECTED',requestedBy:'hr.exec',sender:'mohitchadda',actor:'Mohit',comments:'Documents missing'}),['hr.exec','amitsingh','gulnawaz','mayuriumate','vinodpinjarkar']);
 assert.match(out[0].message,/REJECTED[\s\S]*Documents missing[\s\S]*back to Site HR/);
 assert.match(trackOtpMessage({record,siteName:'Jayant OB',otp:'123456',requestedBy:'Vinod',minutes:15}),/OTP: 123456 \(valid 15 min\)[\s\S]*Tell this OTP to Regional HR/);
});

test('join-link roster: Site HR, Site PM and Office HR of enabled sites, the fixed Regional HR, office HR and the Directors',()=>{
 const roster=employeeTrackRoster({sites:[{code:'NCL-JAYANT',name:'Jayant OB East'},{code:'NCL-DUDE',name:'Dudhichua OB East'},{code:'CMLL-HO',name:'Chandrapur HO'}],
  saved:[{code:'NCL-JAYANT',status:'ACTIVE',data:{steps:siteSteps}},{code:'NCL-DUDE',status:'DRAFT',data:{steps:[{label:'HR Manager',approvers:['dude.hr']}]}}]});
 const by=actor=>roster.find(p=>p.actor===actor);
 assert.deepEqual(by('amitsingh').roles,['Site HR · Jayant OB East']);
 assert.equal(by('dude.hr'),undefined,'a site whose hierarchy is not enabled takes no forms yet');
 assert.deepEqual(by('vinodpinjarkar').roles,['Regional HR · Jayant OB East, Dudhichua OB East']);
 assert.deepEqual(by('viratsingh').roles,['Regional HR · Chandrapur HO']);
 assert.deepEqual(by('monikawadhai').roles,['Site HR · Chandrapur HO']);
 assert.deepEqual(by('mohitchadda').roles,['Directors (OTP) · all sites']);
 assert.deepEqual(by('gulnawaz').roles,['PM / HOD · Jayant OB East']);
 assert.deepEqual(by('mayuriumate').roles,['Office HR · Jayant OB East']);
 assert.equal(by('trainer'),undefined,'Driver Trainer is not on the route');
 assert.equal(roster[0].stage,'Directors (OTP)');
 assert.match(employeeTrackInvite({roles:['Site HR · Jayant OB East'],url:'https://t.me/x?start=y',botUsername:'CMLLEmployeeTrackBot'}),/@CMLLEmployeeTrackBot[\s\S]*Site HR → PM \/ HOD → Office HR → Regional HR → Directors \(OTP\)[\s\S]*https:\/\/t\.me\/x\?start=y/);
});

test('a personal join link connects that login on the Employee Track bot',async()=>{
 await withEnv(botEnv,async()=>{const writes=[];
  const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_employee_track_updates'))return {rowCount:1};
   if(s.startsWith('DELETE FROM hr_telegram_link_tokens WHERE hash')){assert.equal(v[0],createHash('sha256').update('e'.repeat(32)).digest('hex'));return {rows:[{actor:'amitsingh',bot:'employee-track'}]};}
   if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
  await createTelegram({connect:async()=>db}).telegramWebhook('et-secret',{update_id:5,message:{chat:{type:'private',id:654},from:{id:654},text:'/start '+'e'.repeat(32)}},'employee-track');
  const binding=writes.find(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));
  assert.deepEqual(binding[1],['amitsingh','654',false,false,false,false,false,false,true]);
  assert.ok(writes.some(([s,v])=>s.startsWith('INSERT INTO hr_telegram_outbox')&&v[3]==='employee-track'&&/Connected to CALIBER Employee Track/.test(v[2])));
 });
});

test('Employee Track messages leave on the Employee Track bot',async()=>{
 await withEnv({...botEnv,TELEGRAM_MT_BOT_TOKEN:'mt',TELEGRAM_MT_BOT_USERNAME:'CMLLHRBOT',TELEGRAM_MT_WEBHOOK_SECRET:'mt-secret'},async()=>{
  const sent=[];const db={release(){},async query(s){if(s.startsWith('SELECT o.')){assert.match(s,/o\.bot='employee-track' AND a\.employee_track_connected/);return {rows:[{id:1,bot:'employee-track',actor:'vinodpinjarkar',chat_id:'88',mt_hr_enabled:true,message:'m'}]};}return {rows:[]};}};
  await deliverTelegram({connect:async()=>db},async(chat,text,bot)=>{sent.push([chat,bot]);});
  assert.deepEqual(sent,[['88','employee-track']]);
 });
});

/* Regional HR approves → the Directors get the OTP on the bot → Regional HR enters it → the employee is Active.
   The form starts at the Regional HR step (Site PM and Office HR already approved). */
const approvalId='33333333-3333-4333-8333-333333333333',recordId='44444444-4444-4444-8444-444444444444';
const perms={permissions:{hrDesktopAccess:['Approval Management']}};
const rhr={actor:'vinodpinjarkar',name:'Vinod',...perms};
function trackDb(){
 const steps=employeeTrackSteps({code:'NCL-JAYANT',steps:siteSteps,requester:'amitsingh'});
 const state={approval:{id:approvalId,record_id:recordId,state:'PENDING',stage:steps.length-2,version:1,history:[],requested_by:'amitsingh',approvers:steps.flatMap(s=>s.approvers),approval_steps:steps,record_snapshot:{...record}},record:{id:recordId,kind:'employees',status:'PENDING',...record,data:{...record.data,siteId:'site-1'}},otp:null,outbox:[]};
 const db={release(){},async query(s,v=[]){
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(s))return {rows:[]};
  if(s.startsWith('SELECT * FROM hr_approvals'))return {rows:[{...state.approval}]};
  if(s.startsWith('SELECT * FROM hr_records WHERE id=$1 FOR UPDATE'))return {rows:[{...state.record}]};
  if(s.includes("kind='sites'")&&s.startsWith('SELECT name'))return {rows:[{name:'Jayant OB East'}]};
  if(s.startsWith("SELECT data FROM hr_records WHERE kind='leaveOtps'"))return {rows:state.otp?[{data:state.otp}]:[]};
  if(s.startsWith("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'leaveOtps'")){state.otp=v[2];return {rows:[]};}
  if(s.startsWith('UPDATE hr_records SET data=$2')&&s.includes("kind='leaveOtps'")){state.otp=v[1];return {rows:[]};}
  if(s.startsWith('INSERT INTO hr_telegram_outbox')){state.outbox.push({actor:v[1],message:v[2],bot:v[3],markup:v[4]&&JSON.parse(v[4])});return {rows:[]};}
  if(s.startsWith('UPDATE hr_approvals SET stage=$1,state=$2,history=$3')){Object.assign(state.approval,{stage:v[0],state:v[1],history:JSON.parse(v[2])});state.approval.version++;return {rows:[]};}
  if(s.startsWith('UPDATE hr_records SET status=$1')){state.record.status=v[0];return {rows:[]};}
  return {rows:[],rowCount:1};
 }};
 return {state,service:createService({connect:async()=>db})};
}
test('Regional HR\'s approval sends the Directors the OTP; the right OTP makes the employee Active',async()=>{
 await withEnv(botEnv,async()=>{
  const {state,service}=trackDb();
  const approved=await service.decide(rhr,approvalId,{decision:'APPROVED',version:1});
  assert.deepEqual(approved.otpSentTo,['mohitchadda','manishchadda','rahulchadda']);
  assert.equal(state.approval.stage,3);assert.equal(state.approval.state,'PENDING');
  const msg=state.outbox.at(-1);
  assert.equal(msg.bot,'employee-track');
  assert.deepEqual(msg.markup.inline_keyboard[0].map(b=>b.text),['✅ Approve','❌ Reject'],'Directors can approve directly; the OTP is the backup');
  assert.match(msg.message,/Tap Approve below[\s\S]*Out of station\? Tell this OTP to Regional HR/);
  const otp=msg.message.match(/OTP: (\d{6})/)[1];
  await assert.rejects(service.leaveOtp({actor:'amitsingh',...perms},approvalId,{otp},true),e=>e.status===403,'only Regional HR enters it');
  await assert.rejects(service.leaveOtp(rhr,approvalId,{otp:otp==='000000'?'111111':'000000'},true),/Wrong OTP \(4 attempts left\)/);
  state.outbox.length=0;
  const done=await service.leaveOtp(rhr,approvalId,{otp},true);
  assert.equal(done.final,true);
  assert.equal(state.approval.state,'APPROVED');assert.equal(state.record.status,'ACTIVE');
  assert.match(state.approval.history.at(-1).comments,/Directors' OTP entered by Vinod/);
  assert.deepEqual(state.outbox.map(o=>o.actor),['amitsingh'],'Site HR hears the result; the sender does not');
  assert.match(state.outbox[0].message,/NOW ACTIVE/);
  assert.equal(state.otp.otpHash,null,'single use');
 });
});
/* Owner, 21 Nov 2026: a Director may also approve directly (HRMS or the Approve button) – no OTP needed. */
test('a Director approves a new employee directly and the employee becomes Active',async()=>{
 await withEnv(botEnv,async()=>{
  const {state,service}=trackDb();
  await service.decide(rhr,approvalId,{decision:'APPROVED',version:1});
  state.outbox.length=0;
  const done=await service.decide({actor:'mohitchadda',name:'Mohit',...perms},approvalId,{decision:'APPROVED',version:state.approval.version});
  assert.equal(done.state,'APPROVED');
  assert.equal(state.approval.state,'APPROVED');assert.equal(state.record.status,'ACTIVE');
  assert.ok(state.outbox.some(o=>o.actor==='amitsingh'&&/NOW ACTIVE[\s\S]*Final approval by: Mohit/.test(o.message)),'Site HR hears the result');
 });
});
