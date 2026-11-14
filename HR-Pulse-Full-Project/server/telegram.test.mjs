import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTelegram,validateTelegramHierarchy,telegramSteps,webhookSecretValid,queueTelegram,deliverTelegram,leaveMessage} from './telegram.mjs';
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
 let consumed=false;const writes=[];const db={release(){},async query(s,v){writes.push([s,v]);if(s.startsWith('INSERT INTO hr_telegram_updates'))return {rowCount:1};if(s.startsWith('DELETE FROM hr_telegram_link_tokens')){assert.equal(v[0],createHash('sha256').update('a'.repeat(32)).digest('hex'));if(consumed)return {rows:[]};consumed=true;return {rows:[{actor:'amitsingh'}]};}if(s.startsWith('SELECT actor'))return {rows:[]};return {rows:[],rowCount:1};}};
 try{const svc=createTelegram({connect:async()=>db});const update={update_id:1,message:{chat:{type:'private',id:123},from:{id:123},text:'/start '+'a'.repeat(32)}};
 await assert.rejects(svc.telegramWebhook('bad',update),e=>e.status===403);
 await svc.telegramWebhook('secret',update);await svc.telegramWebhook('secret',{...update,update_id:2});
 const bindings=writes.filter(([s])=>s.startsWith('INSERT INTO hr_telegram_accounts'));assert.equal(bindings.length,1);assert.deepEqual(bindings[0][1],['amitsingh','123']);
 }finally{if(previous===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=previous;}
});
test('unconnected recipients remain queued without sending',async()=>{
 const previous=process.env.TELEGRAM_BOT_TOKEN;process.env.TELEGRAM_BOT_TOKEN='test';let sent=0;const writes=[];
 const db={release(){},async query(s,v){writes.push(s);return {rows:s.startsWith('SELECT o.')?[{id:1,chat_id:null}]:[]};}};
 try{await deliverTelegram({connect:async()=>db},async()=>{sent++;});assert.equal(sent,0);assert.ok(writes.some(s=>s.includes('Recipient has not connected')));}finally{if(previous===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=previous;}
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
  const sql=[];const db={query:async(query)=>{sql.push(query);if(query.includes("code='SETTINGS'"))return {rows:[]};if(query.includes("data->'fields'->>'Result'='PASS'"))return {rows:[{id:'passed'}]};return {rows:[]};},release(){}};
  const pool={query:db.query,connect:async()=>db};
  await assert.rejects(createTelegram(pool).telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}},'trial-forms','POST',{formNo:'TF/new',fields:{'Name of candidate':'Candidate','Aadhaar no.':'123456789012',Result:result}}),e=>e.status===409&&/already passed/.test(e.message));
  assert.ok(sql.some(query=>query.includes('pg_advisory_xact_lock')));assert.ok(sql.includes('ROLLBACK'));assert.ok(!sql.some(query=>/INSERT INTO|UPDATE hr_records|hr_telegram_outbox/.test(query)));
 }
});
test('a candidate without a previous PASS can save a re-trial',async()=>{
 const sql=[];const db={query:async(query)=>{sql.push(query);if(query.startsWith('INSERT INTO hr_records'))return {rows:[{id:'new'}]};return {rows:[]};},release(){}};
 const out=await createTelegram({query:db.query,connect:async()=>db}).telegramApi({actor:'hr',permissions:{hrDesktopAccess:['Employee Master']}},'trial-forms','POST',{formNo:'TF/retrial',fields:{'Name of candidate':'Candidate','Aadhaar no.':'123456789012',Result:'FAIL'}});
 assert.equal(out.saved,true);assert.ok(sql.includes('COMMIT'));assert.ok(sql.some(query=>query.startsWith('INSERT INTO hr_records')));
});

test('trial Part 1 and batch messages follow the agreed formats',async()=>{
 const {trialSubmittedMessage,trialBatchResultMessage,splitTelegram}=await import('./telegram.mjs');
 const rec={formNo:'TF/2026-27/0001',site:'Jayant OB East',department:'Driver',trialBy:'driver trainer',fields:{'Name of candidate':'Apurva Dnyaninath Kopulwar','Post applied for':'Driver','Vehicle / equipment for trial':'Water Tanker','Trial date & time':'2026-11-12T10:30'}};
 const m=trialSubmittedMessage(rec);
 assert.equal(m,'🚛 VEHICLE TRIAL RESULT\n\nTrial Form Submitted\nName: Apurva Dnyaninath Kopulwar\nPost: Driver\nVehicle: Water Tanker\nExperience: –\nReferred by: –\nTrial date: 12-11-2026\nForm No: TF/2026-27/0001\nTrial by: driver trainer\nStatus: Sent to driver trainer\nSite: Jayant OB East');
 const batch=trialBatchResultMessage({batchId:'B261112-7F3A',site:'Jayant OB East',trialBy:'Raju Mahto',trialDate:'2026-11-12',vehicle:'Dumper / Tipper',post:'Driver'},[
  {formNo:'TF/1',fields:{Result:'PASS','Name of candidate':'Ramesh Kumar','Post applied for':'Driver','Total experience (years)':'5','Referred by':'Suresh'}},
  {formNo:'TF/2',fields:{Result:'FAIL','Name of candidate':'Ajay Singh','If FAIL – reason':'Poor reversing'}}],9);
 assert.match(batch,/^🚛 BULK VEHICLE TRIAL RESULT – B261112-7F3A\nSite: JAYANT OB EAST\nTrial date: 12-11-2026\nVehicle: Dumper \/ Tipper   Post: Driver\nTrial by: Raju Mahto\nTotal: 2  ✅ PASS 1  ❌ FAIL 1\n\n✅ PASSED\n1\. Ramesh Kumar – Driver, 5 yrs, Ref: Suresh\n\n❌ FAILED\n1\. Ajay Singh – Poor reversing\n\n📎 Attachments: 9 file\(s\) \+ Excel result sheet$/);
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

test('hierarchy recipients per stage: site steps, company-wide Office HR and Directors, office fallback',async()=>{
 const {hierarchyRecipients}=await import('./telegram.mjs');
 const rows=[{code:'CMLL-CO',data:{code:'CMLL-CO',steps:[{label:'HR Executive',approvers:['mayuriumate']},{label:'HR Manager',approvers:['vinod']},{label:'Final approval — any one',approvers:['mohit']}]}},{code:'NCL-JAYANT',data:{code:'NCL-JAYANT',group:'NCL',steps:[{label:'HR Manager',approvers:['site']},{label:'Project Manager',approvers:['pm1']},{label:'Driver Trainer',approvers:['dt']},{label:'HR Manager — either one',approvers:['rhr']},{label:'Final approval — any one',approvers:['dir']}]}}];
 const db={query:async q=>({rows:q.includes('joiningHierarchies')?rows:[]})};
 const actors=async(stage,site)=>(await hierarchyRecipients(db,stage,{site})).map(r=>r.actor);
 assert.deepEqual(await actors('result','Jayant OB East'),['pm1']);
 assert.deepEqual(await actors('ohr','Jayant OB East'),['mayuriumate','vinod']);
 assert.deepEqual(await actors('director','Jayant OB East'),['dir','mohit']);
 assert.deepEqual(await actors('result','Nagpur CO'),['mayuriumate','vinod']);
 assert.deepEqual(await actors('director','Nagpur CO'),['mohit']);
 assert.deepEqual((await hierarchyRecipients(db,'part1')).map(r=>r.actor),['dt']);
});
