import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {trialReviewStage} from './trial-review.mjs';
import {trialAccess,requireTrialRole,trialRoleLabels,assignedTrialSites} from './trial-access.mjs';
const assignedHierarchy=(actor='hr')=>({code:'NCL-JAYANT',data:{group:'NCL',steps:Object.values(trialRoleLabels).map(label=>({label,approvers:[actor]}))}});
test('admin access is read-only and each assigned user receives only their hierarchy role',async()=>{
 const db={query:async()=>({rows:[{code:'NCL-DUDE',data:{group:'NCL',steps:Object.entries(trialRoleLabels).map(([role,label])=>({label,approvers:[role==='hr'?'ankittiwari':role]}))}}]})};
 const target={site:'Dudhichua OB East'};
 assert.deepEqual(await trialAccess(db,{actor:'admin',permissions:{hrDesktopAccess:['Master Configuration']}},target),{roles:[],overview:true});
 assert.deepEqual(await trialAccess(db,{actor:'unassigned',permissions:{hrDesktopAccess:['Employee Master']}},target),{roles:[],overview:false});
 for(const role of Object.keys(trialRoleLabels)){
  const profile={actor:role==='hr'?'ankittiwari':role,permissions:{site:'NCL-DUDE'}};
  assert.deepEqual(await trialAccess(db,profile,target),{roles:[role],overview:false});
  await requireTrialRole(db,profile,role,target);
  await assert.rejects(requireTrialRole(db,{...profile,permissions:{site:'NCL-JAYANT'}},role,target),{status:403});
 }
 for(const [route,reviewer] of [['trial-part1',''],['trial-result',''],['trial-batch-result',''],['trial-forms',''],['trial-approval','pm']]){
  await assert.rejects(createTelegram(db).telegramApi({actor:'admin',permissions:{hrDesktopAccess:['Employee Master']}},route,'POST',{...target,reviewer}),{status:403});
 }
 const admin={actor:'admin',permissions:{hrDesktopAccess:['Employee Master','Master Configuration']}};
 const beforeSelection=await createTelegram({query:async()=>assert.fail('No site query before site selection')}).telegramApi(admin,'trial-trainer','POST',{site:''});
 assert.deepEqual(beforeSelection.roles,[]);assert.equal(beforeSelection.overview,true);
 await assert.rejects(requireTrialRole(db,admin,'hr',{site:''}),{status:403});
 const access=await createTelegram(db).telegramApi(admin,'trial-trainer','POST',target);
 assert.deepEqual(access.roles,[]);assert.equal(access.overview,true);
 const disabled={query:async()=>({rows:[]})};
 await assert.rejects(requireTrialRole(disabled,{actor:'ankittiwari',permissions:{}},'hr',target),{status:403});
});
test('trial reviews cannot skip PM, Office HR, Regional HR or Director',()=>{
 const roles=['pm','ohr','rhr','director'];
 const approvals=roles.map(role=>({role,action:'Approved',at:'2026-11-19T12:00:00Z'}));
 for(let index=0;index<=roles.length;index++)assert.equal(trialReviewStage(approvals.slice(0,index)),roles[index]||'done');
 assert.equal(trialReviewStage(approvals.filter(h=>h.role!=='ohr')),'ohr');
 assert.equal(trialReviewStage(approvals,'2026-11-19T13:00:00Z'),'pm');
});
test('Pulse User Master Trial role-site assignments drive workflow authority',async()=>{
 const db={query:async()=>assert.fail('Pulse assignments must not depend on the legacy hierarchy')};
 const assignment=(role,site='WCL-SASTI')=>({role,allSites:false,sites:[{code:site,name:'Sasti OC',region:'WCL'}]});
 for(const [role,workflowRole] of Object.entries({PM:'pm','HR Manager':'hr','Driver Trainer':'trainer','Office HR':'ohr','Regional HR':'rhr',Director:'director'})){
  const profile={actor:'pulse-user',permissions:{hrAccountStatus:'Active',hrTrialAssignments:[assignment(role)],hrDesktopAccess:['Employee Master']}};
  assert.deepEqual(await trialAccess(db,profile,{site:'Sasti OB'}),{roles:[workflowRole],overview:false});
  assert.deepEqual(await trialAccess(db,profile,{site:'Jayant OB East'}),{roles:[],overview:false});
 }
 assert.deepEqual(await trialAccess(db,{actor:'admin',permissions:{hrAccountStatus:'Active',hrTrialAssignments:[{role:'Trial Admin',allSites:true,sites:[]}]}},{site:'Jayant OB East'}),{roles:[],overview:true});
 assert.deepEqual(await trialAccess(db,{actor:'inactive',permissions:{hrAccountStatus:'Inactive',hrTrialAssignments:[assignment('PM')]}},{site:'Sasti OB'}),{roles:[],overview:false});
});
test('Pulse Trial assignments freeze a user to only their assigned sites',()=>{
 const profile={permissions:{hrAccountStatus:'Active',site:'All Sites',hrTrialAssignments:[{role:'HR Manager',allSites:false,sites:[{code:'WCL-DHOPTALA',name:'Dhoptala OB'}]}]}};
 assert.deepEqual(assignedTrialSites(profile).map(site=>site.code),['WCL-DHOPTALA']);
 assert.equal(assignedTrialSites({permissions:{hrAccountStatus:'Active',hrTrialAssignments:[{role:'Trial Admin',allSites:true,sites:[]}]}}),null);
 assert.deepEqual(assignedTrialSites({...profile,permissions:{...profile.permissions,hrAccountStatus:'Inactive'}}),[]);
});
test('an assigned user sees forms that reached their step (later decisions stay visible); admin sees a read-only overview',async()=>{
 const records=[{id:'pm',data:{site:'Jayant OB East',pendingRole:'pm',stage:'RESULT'}},{id:'office',data:{site:'Jayant OB East',pendingRole:'ohr',stage:'APPROVAL'}},{id:'trainer',data:{site:'Jayant OB East',stage:'PART1'}}];
 const pool={query:async sql=>sql.includes("kind='joiningHierarchies'")?{rows:[{code:'NCL-JAYANT',data:{group:'NCL',steps:[{label:'Project Manager',approvers:['pm']}]}}]}:{rows:records}};
 const service=createTelegram(pool),target={site:'Jayant OB East',region:'NCL'};
 const assigned={actor:'pm',permissions:{site:'NCL-JAYANT',hrDesktopAccess:['Employee Master']}};
 assert.deepEqual((await service.telegramApi(assigned,'trial-review-queue','POST',target)).rows.map(row=>row.id),['pm','office']);
 assert.deepEqual((await service.telegramApi({...assigned,actor:'unassigned'},'trial-review-queue','POST',target)).rows,[]);
 const admin={actor:'admin',permissions:{hrDesktopAccess:['Employee Master','Master Configuration']}};
 assert.deepEqual((await service.telegramApi(admin,'trial-review-queue','POST',target)).rows.map(row=>row.id),['pm','office','trainer']);
});
test('every assigned workflow role retains read-only access to a cleared trial and its approval history',async()=>{
 const cleared={id:'cleared',data:{site:'Dudhichua OB East',stage:'CLEARED',pendingRole:'',history:[{role:'pm',action:'Approved',by:'Sanskar'},{role:'ohr',action:'Approved',by:'Office HR'},{role:'rhr',action:'Approved',by:'Regional HR'},{role:'director',action:'Approved',by:'Director'}]}};
 const pool={query:async()=>({rows:[cleared]})};
 for(const role of ['Driver Trainer','PM','Office HR','Regional HR','Director']){
  const profile={actor:role.toLowerCase().replace(/\s/g,''),permissions:{hrDesktopAccess:['Employee Master'],hrAccountStatus:'Active',hrTrialAssignments:[{role,allSites:false,sites:[{code:'NCL-DUDE',name:'Dudhichua East OC'}]}]}};
  const out=await createTelegram(pool).telegramApi(profile,'trial-review-queue','POST',{site:'Dudhichua OB East',region:'NCL'});
  assert.deepEqual(out.rows.map(row=>row.id),['cleared'],role);assert.equal(out.rows[0].history.length,4);
 }
});
test('the approval endpoint rejects Director review while PM is still pending',async()=>{
 const db={release(){},query:async sql=>sql.includes("kind='joiningHierarchies'")?{rows:[assignedHierarchy('admin')]}:sql.includes('SELECT id,data')?{rows:[{id:'trial',data:{fields:{Result:'PASS'},history:[]}}]}:{rows:[]}};
 const service=createTelegram({query:db.query,connect:async()=>db});
 await assert.rejects(service.telegramApi({actor:'admin',permissions:{hrDesktopAccess:['Employee Master']}},'trial-approval','POST',{
  reviewer:'director',approved:true,site:'Jayant OB East',region:'NCL',rows:[{formNo:'TF/2026-27/0001',fields:{Result:'PASS'},history:[{role:'director',action:'Approved'}]}],
 }),{status:409});
});
test('web approval keeps the authenticated Pulse PM role and site assignment',async()=>{
 const stored={id:'trial',data:{site:'Dudhichua OB East',fields:{Result:'PASS','Name of candidate':'Candidate'},history:[],attachments:[]}};
 const db={release(){},async query(sql){if(sql.includes("SELECT id,data FROM hr_records WHERE kind='trialForms'"))return {rows:[stored]};return {rows:[],rowCount:1};}};
 const profile={actor:'sanskarmanoHare'.toLowerCase(),name:'Sanskar Manohare',permissions:{hrDesktopAccess:['Employee Master'],hrAccountStatus:'Active',hrTrialAssignments:[{role:'PM',allSites:false,sites:[{code:'NCL-DUDE',name:'Dudhichua East OC'}]}]}};
 const service=createTelegram({query:db.query,connect:async()=>db}),input={reviewer:'pm',approved:true,site:'Dudhichua OB East',region:'NCL',rows:[{formNo:'TF/2026-27/0010',fields:{Result:'PASS'}}]};
 const approved=await service.telegramApi(profile,'trial-approval','POST',input);
 assert.equal(approved.saved,true);assert.equal(approved.stage,'ohr','the PM approves directly, no OTP (owner, 21 Nov 2026)');
 stored.data.history=[];
 const out=await service.telegramApi(profile,'trial-approval','POST',{...input,approved:false,note:'Licence doubtful'});
 assert.equal(out.saved,true);assert.equal(out.stage,'reject');
});
test('shared review queue is site-scoped and omits uploaded file payloads',async()=>{
 let query,args;
 const pool={query:async(sql,values)=>{if(sql.includes("kind='joiningHierarchies'"))return {rows:[assignedHierarchy('pm')]};query=sql;args=values;return {rows:[{id:'trial-id',data:{formNo:'TF/1',history:[],fields:{Result:'PASS'},pendingRole:'pm',attachments:[{data:'private-file'}]}}]};}};
 const service=createTelegram(pool),profile={actor:'pm',permissions:{hrDesktopAccess:['Employee Master'],site:'NCL-JAYANT'}};
 const out=await service.telegramApi(profile,'trial-review-queue','POST',{site:'Jayant OB East',region:'NCL'});
 assert.deepEqual(args,[['ncl-jayant','jayant ob east'],['ncl-jayant']]);
 assert.match(query,/\$2::text\[\] IS NULL/);
 assert.equal(out.rows[0].id,'trial-id');assert.ok(!JSON.stringify(out).includes('private-file'));
 await assert.rejects(service.telegramApi({...profile,permissions:{}},'trial-review-queue','POST',{}),{status:403});
});
import {createTelegram,validateTelegramHierarchy,telegramSteps,webhookSecretValid,queueTelegram,deliverTelegram,leaveMessage,trialTrainerFor,requireTrialUploads,keepTrialDocuments} from './telegram.mjs';
test('trial identity documents survive result and approval attachment updates',()=>{
 const old=[{name:'aadhaar.jpg',mime:'image/jpeg',kind:'aadhaar',data:'YWFk'} ,{name:'licence.jpg',mime:'image/jpeg',kind:'drivingLicence',data:'ZGk='}];
 const next=[{name:'result.pdf',mime:'application/pdf',kind:'trialResult',data:'cGRm'}];
 const merged=keepTrialDocuments(old,next);
 assert.deepEqual(merged.map(file=>file.kind),['trialResult','aadhaar','drivingLicence']);
});
test('leave templates distinguish intermediate approval and include verified decision details',()=>{
 const record={code:'LR-1024',name:'Test Employee',data:{fromDate:'2026-10-29',toDate:'2026-10-30',chargeHandedOverTo:'Colleague'}};
 const details={siteName:'Nagpur CO',actor:'hr',name:'HR Manager',telegramId:'123456',at:'2026-10-29T10:00:00Z',comments:'Dates unavailable'};
 const approved=leaveMessage(record,'APPROVED',details);
 for(const text of ['✅ LEAVE REQUEST APPROVED','🏢 Site Name: Nagpur CO','Request ID: LR-1024','Employee: Test Employee','Approved By: HR Manager','Approver Telegram ID: 123456','03:30:00 pm IST','Status: APPROVED','Charge handed over to: Colleague'])assert.ok(approved.includes(text),text);
 const pending=leaveMessage(record,'PENDING',details);assert.match(pending,/Awaiting Regional HR approval/);assert.match(pending,/Status: PENDING/);
 const rejected=leaveMessage(record,'REJECTED',{...details,telegramId:null});assert.match(rejected,/Rejected By: HR Manager/);assert.match(rejected,/Not connected/);assert.match(rejected,/Dates unavailable/);
 const submitted=leaveMessage(record,'SUBMITTED',{siteName:'Jayant OB'});assert.match(submitted,/🏢 Site Name: Jayant OB/);assert.match(submitted,/Awaiting Site HR/);assert.doesNotMatch(submitted,/Approved By/);
});
import {nextApproval} from './joining-hierarchy.mjs';
import {telegramLeaveFlow} from './telegram.mjs';
test('office leave routes use HOD before Regional HR, with directors notification-only',async()=>{
 for(const code of ['CMLL-CO','CMLL-HO','NCL-JAYANT']){
  const flow=await telegramLeaveFlow({query:async()=>({rows:[{code,data:{siteHr:'hod',regionalHr:'hr',directors:['director'],enabled:true}}]})},'site');
  const firstRole=code==='NCL-JAYANT'?'Site HR':'HOD';
  assert.equal(flow.firstRole,firstRole);
  const steps=telegramSteps(flow);assert.equal(steps.length,2);assert.equal(steps[0].label,firstRole+' — any one');assert.deepEqual(steps[1].approvers,['hr']);
  const record={code:'LR-1',name:'Employee',data:{fromDate:'2026-10-29',toDate:'2026-10-30'}};
  assert.ok(leaveMessage(record,'SUBMITTED',{firstRole}).includes('Awaiting '+firstRole+' approval'));
  assert.ok(leaveMessage(record,'PENDING',{firstRole}).includes(firstRole.toUpperCase()+' APPROVED'));
 }
});
const config={siteHr:'AMITSINGH',regionalHr:'VINODPINJARKAR',directors:'MANISHCHADDA,MOHITCHADDA,RAHULCHADDA',enabled:true};
test('Jayant route normalizes usernames and directors are notification-only',()=>{
 const c=validateTelegramHierarchy(config);assert.equal(c.siteHr,'amitsingh');assert.equal(c.directors.length,3);
 const a={requested_by:'employee',stage:0,approval_steps:telegramSteps(c)};
 assert.throws(()=>nextApproval(a,'manishchadda','APPROVED'),e=>e.status===403);
 assert.throws(()=>nextApproval(a,'vinodpinjarkar','APPROVED'),e=>e.status===403);
 assert.equal(nextApproval(a,'amitsingh','APPROVED').state,'PENDING');
 assert.equal(nextApproval({...a,stage:1},'vinodpinjarkar','APPROVED').state,'APPROVED');
 assert.throws(()=>validateTelegramHierarchy({...config,regionalHr:'AMITSINGH'}));
});
test('webhook secret must match, and hierarchy mutation requires unrestricted master access',async()=>{
 assert.equal(webhookSecretValid('x','x'),true);assert.equal(webhookSecretValid('x','xx'),false);assert.equal(webhookSecretValid(undefined,'x'),false);
 const svc=createTelegram({query:()=>{throw new Error('must not query');}});
 await assert.rejects(svc.telegramApi({actor:'user',permissions:{hrDesktopAccess:['Employee Master']}},'hierarchies','POST',config),e=>e.status===403);
 await assert.rejects(svc.telegramApi({actor:'user',permissions:{hrDesktopAccess:['Master Configuration'],site:'Jayant'}},'hierarchies','POST',config),e=>e.status===403);
});
test('queue deduplicates recipients and uses durable unique event keys',async()=>{
 const writes=[];await queueTelegram({query:async(s,v)=>{assert.match(s,/ON CONFLICT DO NOTHING/);writes.push(v);}},'event',['AMIT','amit','','vinod'],'status');
 assert.deepEqual(writes.map(x=>x[1]),['amit','vinod']);
});
test('private one-time connection binds the signed-in actor, never a supplied username',async()=>{
 const previous=process.env.TELEGRAM_WEBHOOK_SECRET;process.env.TELEGRAM_WEBHOOK_SECRET='secret';
 let consumed=false;const writes=[];const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_updates'))return {rowCount:1};if(s.startsWith('DELETE FROM hr_telegram_link_tokens')){assert.equal(v[0],createHash('sha256').update('a'.repeat(32)).digest('hex'));if(consumed)return {rows:[]};consumed=true;return {rows:[{actor:'amitsingh',bot:'leave'}]};}if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
 try{const svc=createTelegram({connect:async()=>db});const update={update_id:1,message:{chat:{type:'private',id:123},from:{id:123},text:'/start '+'a'.repeat(32)}};
 await assert.rejects(svc.telegramWebhook('bad',update),e=>e.status===403);
 await svc.telegramWebhook('secret',update);await svc.telegramWebhook('secret',{...update,update_id:2});
 const bindings=writes.filter(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));assert.equal(bindings.length,1);assert.deepEqual(bindings[0][1],['amitsingh','123',true,false,false,false,false,false,false]);
 }finally{if(previous===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=previous;}
});
test('trial bot connection is tracked separately and retries only trial messages',async()=>{
 const previous=process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET;process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET='trial-secret';const writes=[];
 const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_updates'))return {rowCount:1};if(s.startsWith('DELETE FROM hr_telegram_link_tokens'))return {rows:[{actor:'sajadali',bot:'trial'}]};if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
 try{await createTelegram({connect:async()=>db}).telegramWebhook('trial-secret',{update_id:3,message:{chat:{type:'private',id:456},from:{id:456},text:'/start '+'b'.repeat(32)}},'trial');
 const binding=writes.find(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));assert.deepEqual(binding[1],['sajadali','456',false,true,false,false,false,false,false]);
 const retry=writes.find(([s])=>s.startsWith('UPDATE hr_telegram_outbox'));assert.deepEqual(retry[1],['sajadali','trial']);
 }finally{if(previous===undefined)delete process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET;else process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET=previous;}
});
test('unconnected recipients remain queued without sending',async()=>{
 const previous=process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN='test';let sent=0;const writes=[];
 const db={release(){},async query(s,v){writes.push(s);return {rows:s.startsWith('SELECT o.')?[{id:1,chat_id:null}]:[]};}};
 try{await deliverTelegram({connect:async()=>db},async()=>{sent++;});assert.equal(sent,0);assert.ok(writes.some(s=>s.includes('Recipient has not connected')));}finally{if(previous===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=previous;}
});
test('MT HR routes all three notification types only for recipients who linked the new bot',async t=>{
 const settings={TELEGRAM_MT_BOT_TOKEN:'test',TELEGRAM_MT_BOT_USERNAME:'TestMtBot',TELEGRAM_MT_WEBHOOK_SECRET:'test-secret'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
 Object.assign(process.env,settings);
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 for(const bot of ['leave','trial','joining']){
  for(const linked of [true,false]){
   const markup={inline_keyboard:[[{text:'Test',callback_data:'test'}]]};
   const job={id:1,chat_id:'123',bot,mt_hr_enabled:linked,message:'Test message',markup};
   const db={release(){},async query(sql){return {rows:sql.startsWith('SELECT o.')?[job]:[]};}};
   const send=t.mock.fn();
   await deliverTelegram({connect:async()=>db},send);
   assert.deepEqual(send.mock.calls[0].arguments,['123','Test message',linked?'mt':bot,markup,[]]);
  }
 }
});
test('CMLLHRBOT sends Employee Track notifications with its three workflow links',async t=>{
 const settings={TELEGRAM_MT_BOT_TOKEN:'test',TELEGRAM_MT_BOT_USERNAME:'CMLLHRBOT',TELEGRAM_MT_WEBHOOK_SECRET:'test-secret'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
 Object.assign(process.env,settings);
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const job={id:1,chat_id:'123',bot:'nagpur',mt_hr_enabled:true,message:'Assigned next step'};
 const db={release(){},async query(sql){return {rows:sql.startsWith('SELECT o.')?[job]:[]};}};
 const send=t.mock.fn();
 await deliverTelegram({connect:async()=>db},send);
 const [chat,message,bot,markup]=send.mock.calls[0].arguments;
 assert.deepEqual([chat,message,bot],['123','Assigned next step','mt']);
 assert.deepEqual(markup.inline_keyboard.slice(0,3).flat().map(button=>[button.text,new URL(button.url).searchParams.get('hrWorkflow')]),[
  ['Trial Status','trial'],['Employee Track','employee'],['Leave Request','leave']
 ]);
});
test('multiple HR users allow any one per stage and reject cross-stage overlap',()=>{
 const c=validateTelegramHierarchy({...config,siteHr:' AMITSINGH, APURVAKOPULWAR,amitsingh ',regionalHr:'VINODPINJARKAR, MAYURIUMATE'});
 const steps=telegramSteps(c);assert.deepEqual(steps[0].approvers,['amitsingh','apurvakopulwar']);assert.deepEqual(steps[1].approvers,['vinodpinjarkar','mayuriumate']);
 for(const site of steps[0].approvers){const a={requested_by:'employee',stage:0,approval_steps:steps};const first=nextApproval(a,site,'APPROVED');assert.equal(first.stage,1);assert.equal(first.state,'PENDING');for(const regional of steps[1].approvers)assert.equal(nextApproval({...a,...first},regional,'APPROVED').state,'APPROVED');assert.throws(()=>nextApproval({...a,...first},site,'APPROVED'),e=>e.status===403);}
 assert.throws(()=>validateTelegramHierarchy({...config,siteHr:'amit,vinod',regionalHr:'vinod,mayuri'}));
});
test('notifications expand comma-separated HR groups to individual recipients',async()=>{
 const actors=[];await queueTelegram({query:async(_s,v)=>actors.push(v[1])},'event',['amit,apurva','vinod,mayuri','AMIT'],'message');assert.deepEqual(actors,['amit','apurva','vinod','mayuri']);
});

test('trial Aadhaar history requires Employee Master access and a complete Aadhaar',async()=>{
 const svc=createTelegram({query:async()=>{throw Error('No query expected');}});
 await assert.rejects(svc.telegramApi({actor:'user',permissions:{hrDesktopAccess:['Master Configuration']}},'trial-history','POST',{aadhaar:'123456789012'}),e=>e.status===403);
 await assert.rejects(svc.telegramApi({actor:'user',permissions:{hrDesktopAccess:['Employee Master']}},'trial-history','POST',{aadhaar:'123'}),e=>e.status===400);
});
test('trial Aadhaar history returns only site-scoped result metadata from both trial stores',async()=>{
 let query,values;const pool={query:async(sql,args)=>{query=sql;values=args;return {rows:[
  {code:'TF/shared',kind:'trialWorkflow',data:{site:'Jayant OB East',aadhaar:'123456789012',name:'private',trialDate:'2026-11-03',result:'PASS',
   outcome:{at:'2026-11-04',post:'Operator',machine:'Excavator'}}},
  {code:'TF/old',kind:'trialForms',data:{site:'Jayant OB East',savedAt:'2026-11-01',fields:{Result:'FAIL','Trial date & time':'2026-10-31T12:30',
   'Aadhaar no.':'123456789012','Vehicle / equipment for trial':'Dozer','Post applied for':'Operator','If FAIL – reason':'Unsafe handling','Mobile no.':'private'}}},
 ]};}};
 const out=await createTelegram(pool).telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Employee Master'],site:'NCL-JAYANT'}},'trial-history','POST',{aadhaar:'1234 5678 9012',excludeFormNo:'TF/current'});
 assert.deepEqual(values,['123456789012','TF/current',['ncl-jayant']]);assert.match(query,/t.code<>\$2/);assert.match(query,/regexp_replace/);assert.match(query,/\$3::text\[\] IS NULL/);assert.match(query,/EXISTS\(SELECT 1 FROM hr_records s/);
 assert.match(query,/s.id::text=t.data->>'siteId'/);
 assert.deepEqual(out,{matches:[
  {formNo:'TF/shared',result:'PASS',site:'Jayant OB East',trialDate:'2026-11-03',savedAt:'2026-11-04',post:'Operator',equipment:'Excavator',failureReason:''},
  {formNo:'TF/old',result:'FAIL',site:'Jayant OB East',trialDate:'2026-10-31T12:30',savedAt:'2026-11-01',post:'Operator',equipment:'Dozer',failureReason:'Unsafe handling'},
 ]});assert.ok(!JSON.stringify(out).includes('123456789012'));assert.ok(!JSON.stringify(out).includes('private'));
});

test('already-passed Aadhaar cannot create a trial, overwrite it, or queue Telegram',async()=>{
 for(const result of ['PASS','FAIL']){
  const sql=[];const db={query:async(query)=>{sql.push(query);if(query.includes("kind='joiningHierarchies'"))return {rows:[assignedHierarchy()]};if(query.includes("code='SETTINGS'"))return {rows:[]};if(query.includes("data->'fields'->>'Result'='PASS'"))return {rows:[{id:'passed'}]};return {rows:[]};},release(){}};
  const pool={query:db.query,connect:async()=>db};
  await assert.rejects(createTelegram(pool).telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}},'trial-forms','POST',{site:'Jayant OB East',formNo:'TF/new',fields:{'Name of candidate':'Candidate','Aadhaar no.':'123456789012',Result:result}}),e=>e.status===409&&/already passed/.test(e.message));
  assert.ok(sql.some(query=>query.includes('pg_advisory_xact_lock')));assert.ok(sql.includes('ROLLBACK'));assert.ok(!sql.some(query=>/INSERT INTO|UPDATE hr_records|hr_telegram_outbox/.test(query)));
 }
});
test('a candidate without a previous PASS can save a re-trial',async()=>{
 const sql=[];const db={query:async(query)=>{sql.push(query);if(query.includes("kind='joiningHierarchies'"))return {rows:[assignedHierarchy()]};if(query.startsWith('INSERT INTO hr_records'))return {rows:[{id:'new'}]};return {rows:[]};},release(){}};
 const out=await createTelegram({query:db.query,connect:async()=>db}).telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}},'trial-forms','POST',{site:'Jayant OB East',formNo:'TF/retrial',fields:{'Name of candidate':'Candidate','Aadhaar no.':'123456789012',Result:'FAIL'}});
 assert.equal(out.saved,true);assert.ok(sql.includes('COMMIT'));assert.ok(sql.some(query=>query.startsWith('INSERT INTO hr_records')));
});

test('trial Part 1 and batch messages follow the agreed formats',async()=>{
 const {trialSubmittedMessage,trialBatchResultMessage,splitTelegram}=await import('./telegram.mjs');
 const rec={formNo:'TF/2026-27/0001',site:'Jayant OB East',department:'Driver',trialBy:'driver trainer',fields:{'Name of candidate':'Apurva Dnyaninath Kopulwar','Post applied for':'Driver','Vehicle / equipment for trial':'Water Tanker','Trial date & time':'2026-11-12T10:30'}};
 const m=trialSubmittedMessage(rec);
 assert.equal(m,'🚛 VEHICLE TRIAL RESULT\n\nTrial Form Submitted\nName: Apurva Dnyaninath Kopulwar\nPost: Driver\nVehicle: Water Tanker\nExperience: –\nReferred by: –\nTrial date: 12-11-2026\nForm No: TF/2026-27/0001\nTrial by: driver trainer\nStatus: Sent to driver trainer\nSite: Jayant OB East');
 const batch=trialBatchResultMessage({batchId:'B261112-7F3A',site:'Jayant OB East',trialBy:'Raju Mahto',trialDate:'2026-11-12',vehicle:'Dumper / Tipper',post:'Driver'},[
  {formNo:'TF/1',fields:{Result:'PASS','Name of candidate':'Ramesh Kumar','Post applied for':'Driver','Total experience (years)':'5','Referred by':'Suresh'}},
  {formNo:'TF/2',fields:{Result:'FAIL','Name of candidate':'Ajay Singh','If FAIL – reason':'Poor reversing'}}],{passed:1,failed:1});
 assert.match(batch,/^🚛 BULK VEHICLE TRIAL RESULT – B261112-7F3A\nSite: JAYANT OB EAST\nTrial date: 12-11-2026\nVehicle: Dumper \/ Tipper   Post: Driver\nTrial by: Raju Mahto\nTotal: 2  ✅ PASS 1  ❌ FAIL 1\n\n✅ PASSED\n1\. Ramesh Kumar – Driver, 5 yrs, Ref: Suresh\n\n❌ FAILED\n1\. Ajay Singh – Poor reversing\n\n📎 Attachments: PASS list \(PDF \+ Excel\) · FAIL list \(PDF \+ Excel\)$/);
 const parts=splitTelegram(Array.from({length:300},(_,i)=>`${i+1}. Candidate number ${i+1} – Driver – Dumper`).join('\n'));
 assert.ok(parts.length>1&&parts.every(p=>p.length<=4000));
});

test('trial recipients are filtered by site / group scope',async()=>{
 const {recipientInScope}=await import('./telegram.mjs');
 const t={site:'Jayant OB East',region:'NCL',company:'CMLL',group:'OB / COAL'};
 assert.equal(recipientInScope({scope:''},t),true);
 assert.equal(recipientInScope({scope:'ALL'},t),true);
 assert.equal(recipientInScope({scope:'Jayant OB East'},t),true);
 assert.equal(recipientInScope({scope:'jayant ob'},t),true);
 assert.equal(recipientInScope({scope:'NCL'},t),true);
 assert.equal(recipientInScope({scope:'WCL, Umrer'},t),false);
 assert.equal(recipientInScope({scope:'Jayant OB West'},t),false);
});

test('approval stage messages follow the agreed formats',async()=>{
 const {trialApprovalMessage,joiningApprovedMessage,bulkJoiningApprovedMessage,trialFormPdf}=await import('./telegram.mjs');
 const row={formNo:'TF/2026-27/0001',site:'Jayant OB East',trialBy:'driver trainer',docs:{aadhaar:'Yes',dl:'Yes',medical:'Yes'},fields:{Result:'PASS','Name of candidate':'Apurva Dnyaninath Kopulwar','Post applied for':'Driver','Vehicle / equipment for trial':'Water Tanker','Trial date & time':'2026-11-12T10:00'},
  history:[{role:'pm',action:'Approved',at:'2026-11-12T11:50:00Z'},{role:'ohr',action:'Approved',at:'2026-11-13T05:35:00Z'}]};
 const pm=trialApprovalMessage(row,'pm',{approved:true,note:'OK for joining',at:'2026-11-12T11:50:00Z'});
 assert.match(pm,/^✅ APPROVED BY PM SIR\n\nResult: ✅ PASS\nName: Apurva Dnyaninath Kopulwar\nPost: Driver\nVehicle: Water Tanker\nExperience: –\nReferred by: –\nTrial date: 12-11-2026\nForm No: TF\/2026-27\/0001\nTrial by: driver trainer\nApproved by: PM Sir\nApproved on: 12-11-2026, 17:20\nRemark: OK for joining\nStatus: Sent to Office HR for approval\nSite: Jayant OB East$/);
 const ohr=trialApprovalMessage(row,'ohr',{approved:true,note:'Documents verified',at:'2026-11-13T05:35:00Z'});
 assert.match(ohr,/APPROVED BY OFFICE HR[\s\S]*Approved by PM Sir: 12-11-2026\nApproved by: Office HR\nApproved on: 13-11-2026, 11:05\nDocuments: Aadhaar ✓  DL ✓  Medical ✓\nRemark: Documents verified\nStatus: Sent to Regional HR for approval/);
 const dir=trialApprovalMessage(row,'director',{approved:true,note:'',at:'2026-11-13T11:10:00Z'});
 assert.match(dir,/^🎉 FINAL APPROVAL – DIRECTORS[\s\S]*Approved by: Directors\nApproved on: 13-11-2026, 16:40\nJoining: Report to Site HR with original documents\nStatus: ✅ CLEARED TO JOIN\nSite: Jayant OB East$/);
 assert.match(joiningApprovedMessage(row),/^📢 JOINING APPROVED – CLEARED TO JOIN\n\nDear All,\nApurva Dnyaninath Kopulwar has passed the vehicle trial[\s\S]*📝 Action – Site HR[\s\S]*7\. PPE issue & ID card \/ gate pass\n\nPlease update here once joining is complete\.\nStatus: ✅ CLEARED TO JOIN$/);
 assert.match(bulkJoiningApprovedMessage('B261112-7F3A',[row,row]),/^📢 BULK JOINING APPROVED – CLEARED TO JOIN[\s\S]*Batch: B261112-7F3A[\s\S]*✅ Cleared to join \(2\)\n1\. Apurva/);
 assert.equal(trialFormPdf(row,'Trial joining form').subarray(0,5).toString(),'%PDF-');
});

test('trial approvals use the active Driver & Operator steps for the form group and site',async()=>{
 const {hierarchyRecipients}=await import('./telegram.mjs');
 const step=(label,...approvers)=>({label,approvers});
 const rows=[
  {code:'CMLL-CO',status:'ACTIVE',data:{steps:[step('HR Manager','nagpurhr'),step('Final approval — any one','nagpurdir')]}},
  {code:'NCL-JAYANT',status:'ACTIVE',data:{group:'NCL',steps:[
   step('HR Manager','site'),step('Project Manager','pm1'),step('Driver Trainer','dt'),
   step('Office HR — either one','office'),step('HR Manager — either one','rhr'),step('Final approval — any one','dir'),
  ],officeSteps:[step('Project Manager','officepm'),step('Final approval — any one','officedir')]}},
  {code:'NCL-JAYANT-W',status:'ACTIVE',data:{steps:[step('Driver Trainer','westdt')]}},
  {code:'NCL-DUDE',status:'DRAFT',data:{steps:[step('Driver Trainer','disabled')]}},
  {code:'WCL-GAURI',status:'ACTIVE',data:{steps:[step('Driver Trainer','wcldt')]}},
 ];
 const db={query:async sql=>{assert.match(sql,/status='ACTIVE'/);return {rows:rows.filter(row=>row.status==='ACTIVE')};}};
 const east={site:'Jayant OB East',region:'NCL',group:'OB / COAL'};
 const actors=async(stage,target=east)=>(await hierarchyRecipients(db,stage,target)).map(r=>r.actor);
 for(const [stage,actor] of Object.entries({siteHr:'site',result:'pm1',part1:'dt',ohr:'office',rhr:'rhr',director:'dir'})){
  assert.deepEqual(await actors(stage),[actor]);
 }
 assert.deepEqual(await actors('all'),['site','dt','pm1','office','rhr','dir']);
 assert.deepEqual(await actors('part1',{site:'NCL-JAYANT-W',group:'NCL'}),['westdt']);
 assert.deepEqual(await actors('part1',{site:'Gauri Pauni OB 2nd',region:'WCL'}),['wcldt']);
 assert.deepEqual(await actors('director',{site:'Nagpur CO',region:'Nagpur Corporate Office'}),['nagpurdir']);
 assert.deepEqual(await actors('part1',{...east,region:'WCL'}),[]);
 assert.deepEqual(await actors('part1',{...east,site:'Jayant OB'}),[]);
 assert.deepEqual(await actors('part1',{...east,site:'Dudichua OB East'}),[]);
 assert.deepEqual(await actors('part1',{...east,site:''}),[]);
});

test('trial trainer comes from the active site hierarchy and only the trial result file is required',async()=>{
 const queries=[];const db={query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes("kind='joiningHierarchies'"))return {rows:[{code:'NCL-JAYANT',data:{group:'NCL',steps:[{label:'Driver Trainer',approvers:['sajadali']}]}}]};if(sql.includes("kind='employees'"))return {rows:[{name:'Sajad Ali'}]};return {rows:[]};}};
 assert.deepEqual(await trialTrainerFor(db,{site:'Jayant OB East',region:'NCL',group:'OB / COAL'}),{actor:'sajadali',name:'Sajad Ali',site:'Jayant OB East',trainers:[{actor:'sajadali',name:'Sajad Ali'}]});
 assert.equal(queries.at(-1)[1][0],'sajadali');
 assert.throws(()=>requireTrialUploads([]),/trial result file/);
 assert.doesNotThrow(()=>requireTrialUploads([{kind:'trialResult'}]));
 assert.doesNotThrow(()=>requireTrialUploads([{kind:'trialResult'},{kind:'drivingVideo'}]));
});
test('joining OTP reaches an approver who started another Caliber HR bot but not the Joining bot (21 Nov 2026)',async t=>{
 const settings={TELEGRAM_BOT_TOKEN:'leave-token',TELEGRAM_JOINING_BOT_TOKEN:'joining-token'};
 const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]));
 Object.assign(process.env,settings);
 t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const markup={inline_keyboard:[[{text:'✅ Approve',callback_data:'ja:JA-0123456789AB:approve'}]]};
 const cases=[[{joining_connected:false,leave_connected:true},'leave'],[{joining_connected:true,leave_connected:true},'joining'],[{joining_connected:false,leave_request_connected:true},'joining']];
 for(const [flags,expected] of cases){
  const job={id:1,chat_id:'777',bot:'joining',mt_hr_enabled:false,message:'Joining OTP 123456',markup,...flags};
  let sql='';const db={release(){},async query(q){if(q.startsWith('SELECT o.'))sql=q;return {rows:q.startsWith('SELECT o.')?[job]:[]};}};
  const send=t.mock.fn();
  await deliverTelegram({connect:async()=>db},send);
  assert.match(sql,/o\.bot='joining' AND \(a\.joining_connected OR a\.leave_connected OR/);
  assert.deepEqual(send.mock.calls[0].arguments,['777','Joining OTP 123456',expected,markup,[]]);
 }
});
test('joining Approve tapped on the leave bot approves the request',async()=>{
 const previous=process.env.TELEGRAM_WEBHOOK_SECRET;process.env.TELEGRAM_WEBHOOK_SECRET='leave-secret';
 const data={status:'PENDING',approvers:['vinodpinjarkar'],candidate:'Anush',expires:new Date(Date.now()+60000).toISOString()};
 const writes=[];
 const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_updates'))return {rowCount:1,rows:[{id:1}]};
  if(s.includes('FROM hr_telegram_accounts WHERE telegram_user_id'))return {rows:[{actor:'vinodpinjarkar'}]};
  if(s.includes("kind='joiningApprovals' AND code=$1 FOR UPDATE"))return {rows:[{data}]};return {rows:[],rowCount:1};}};
 const fetchMock=globalThis.fetch;globalThis.fetch=async()=>({json:async()=>({ok:true})});
 try{await createTelegram({connect:async()=>db}).telegramWebhook('leave-secret',{update_id:9,callback_query:{id:'c1',from:{id:777},data:'ja:JA-0123456789AB:approve'}},'leave');
  const update=writes.find(([s])=>s.startsWith('UPDATE hr_records SET data=$2,status=$3'));
  assert.ok(update,'request was not approved');assert.equal(update[1][2],'APPROVED');assert.equal(update[1][1].approvedBy,'vinodpinjarkar');
 }finally{globalThis.fetch=fetchMock;if(previous===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=previous;}
});
