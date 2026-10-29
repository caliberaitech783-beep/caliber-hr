import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTelegram,validateTelegramHierarchy,telegramSteps,webhookSecretValid,queueTelegram,deliverTelegram,leaveMessage} from './telegram.mjs';
test('leave templates distinguish intermediate approval and include verified decision details',()=>{
 const record={code:'LR-1024',name:'Test Employee',data:{fromDate:'2026-10-29',toDate:'2026-10-30',chargeHandedOverTo:'Colleague'}};
 const details={actor:'hr',name:'HR Manager',telegramId:'123456',at:'2026-10-29T10:00:00Z',comments:'Dates unavailable'};
 const approved=leaveMessage(record,'APPROVED',details);
 for(const text of ['✅ LEAVE REQUEST APPROVED','Request ID: LR-1024','Employee: Test Employee','Approved By: HR Manager','Approver Telegram ID: 123456','03:30:00 pm IST','Status: APPROVED','Charge handed over to: Colleague'])assert.ok(approved.includes(text),text);
 const pending=leaveMessage(record,'PENDING',details);assert.match(pending,/Awaiting Regional HR approval/);assert.match(pending,/Status: PENDING/);
 const rejected=leaveMessage(record,'REJECTED',{...details,telegramId:null});assert.match(rejected,/Rejected By: HR Manager/);assert.match(rejected,/Not connected/);assert.match(rejected,/Dates unavailable/);
 const submitted=leaveMessage(record,'SUBMITTED');assert.match(submitted,/Awaiting Site HR/);assert.doesNotMatch(submitted,/Approved By/);
});
import {nextApproval} from './joining-hierarchy.mjs';
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
