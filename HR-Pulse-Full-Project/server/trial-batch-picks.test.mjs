import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegram,trialGroupMarkup,parseTrialCallback,trialPreviewMarkup,sendTrialPicksPreview} from './telegram.mjs';

/* Owner, 21 Nov 2026: in a batch on the CALIBER Trial Status bot every approver ticks Yes or No for each candidate, then taps Submit. */
const CODE='TA-0123456789AB';

test('a batch gets a Yes / No pair per candidate and a Submit button; one candidate keeps Approve / Decline',()=>{
 const m=trialGroupMarkup(CODE,['TF/1','TF/2'],['Vijay Kumar','Rajendra Singh']);
 assert.equal(m.inline_keyboard.length,3);
 assert.deepEqual(m.inline_keyboard[0].map(b=>b.callback_data),[`ta:${CODE}:0:a`,`ta:${CODE}:0:d`]);
 assert.match(m.inline_keyboard[0][0].text,/✅ Yes – 1\. Vijay Kumar/);
 assert.match(m.inline_keyboard[1][0].text,/2\. Rajendra Singh/);
 assert.equal(m.inline_keyboard[2][0].callback_data,`ta:${CODE}:s`);
 assert.match(m.inline_keyboard[2][0].text,/2 Yes · 0 No/);
 const ticked=trialGroupMarkup(CODE,['TF/1','TF/2'],['Vijay Kumar','Rajendra Singh'],{'TF/2':'d'});
 assert.match(ticked.inline_keyboard[1][0].text,/^⬜ Yes/);
 assert.match(ticked.inline_keyboard[1][1].text,/^❌ No/);
 assert.match(ticked.inline_keyboard[2][0].text,/1 Yes · 1 No/);
 for(const row of m.inline_keyboard)for(const b of row)assert.ok(Buffer.byteLength(b.callback_data)<=64);
 assert.deepEqual(trialGroupMarkup(CODE,['TF/1'],['Vijay']).inline_keyboard,[[{text:'✅ Approve',callback_data:`ta:${CODE}:a`},{text:'❌ Decline',callback_data:`ta:${CODE}:d`}]]);
});

test('old Approve / Decline buttons, per-candidate ticks and Submit are all understood',()=>{
 assert.deepEqual(parseTrialCallback(`ta:${CODE}:a`),{code:CODE,kind:'all',approved:true});
 assert.deepEqual(parseTrialCallback(`ta:${CODE}:d`),{code:CODE,kind:'all',approved:false});
 assert.deepEqual(parseTrialCallback(`ta:${CODE}:1:d`),{code:CODE,kind:'pick',index:1,approved:false});
 assert.deepEqual(parseTrialCallback(`ta:${CODE}:s`),{code:CODE,kind:'submit'});
 assert.equal(parseTrialCallback(`ta:${CODE}:x`),null);
});

/* A fake database holding the Jayant hierarchy, one PM approval group and two PASS forms waiting for the PM. */
const site={code:'NCL-JAYANT',data:{code:'NCL-JAYANT',group:'NCL',steps:[
 {stage:1,label:'HR Manager',approvers:['amitsingh']},{stage:1,label:'Driver Trainer',approvers:['jayanttrainer']},
 {stage:1,label:'Project Manager',approvers:['gulnawaz']},{stage:2,label:'Office HR — either one',approvers:['apurvakopulwar']},
 {stage:2,label:'HR Manager — either one',approvers:[]},{stage:2,label:'Final approval — any one',approvers:[]}]}};
function fixture(){
 const form=(code,name)=>({id:'id-'+code,code,data:{formNo:code,site:'Jayant OB East',stage:'APPROVAL',pendingRole:'pm',resultAt:'2026-11-21T06:00:00.000Z',history:[],fields:{'Name of candidate':name,Result:'PASS','Post applied for':'Driver'}}});
 const state={group:{id:'g1',status:'PENDING',data:{role:'pm',formNos:['TF/1','TF/2'],names:['Vijay Kumar','Rajendra Singh'],target:{site:'Jayant OB East'},batchId:'B1'}},
  forms:{'TF/1':form('TF/1','Vijay Kumar'),'TF/2':form('TF/2','Rajendra Singh')},outbox:[],updates:0};
 const db={release(){},async query(sql,v=[]){
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.startsWith('INSERT INTO hr_telegram_trial_status_updates'))return {rowCount:1,rows:[{id:v[0]}]};
  if(sql.startsWith('SELECT actor FROM hr_telegram_accounts'))return {rows:[{actor:'gulnawaz'}]};
  if(sql.includes("kind='trialApprovals' AND code=$1"))return {rows:state.group.status?[structuredClone(state.group)]:[]};
  if(sql.includes("kind='joiningHierarchies'"))return {rows:[site]};
  if(sql.includes("kind='employees'"))return {rows:[{name:'Gul Nawaz'}]};
  if(sql.includes("kind='trialForms' AND code = ANY"))return {rows:v[0].map(c=>structuredClone(state.forms[c])).filter(Boolean)};
  if(sql.includes("kind='trialForms' AND code=$1 FOR UPDATE"))return {rows:[structuredClone(state.forms[v[0]])]};
  if(sql.startsWith('UPDATE hr_records SET data=$1,status=$2')){const f=Object.values(state.forms).find(x=>x.id===v[3]);f.data=v[0];f.status=v[1];return {rowCount:1,rows:[]};}
  if(sql.startsWith("UPDATE hr_records SET data=$2,updated_at=now() WHERE id=$1")){state.group.data=v[1];state.updates++;return {rowCount:1,rows:[]};}
  if(sql.startsWith("UPDATE hr_records SET status='CLOSED',data=$2")){state.group.status='CLOSED';state.group.data=v[1];return {rowCount:1,rows:[]};}
  if(sql.startsWith("UPDATE hr_records SET status='CLOSED'")&&sql.includes("kind='trialApprovals'")){if(v[0]===state.group.data.role&&v[1].some(f=>state.group.data.formNos.includes(f)))state.group.status='CLOSED';return {rowCount:1,rows:[]};}
  if(sql.startsWith('INSERT INTO hr_telegram_files'))return {rows:[{id:state.outbox.length+1}]};
  if(sql.startsWith('INSERT INTO hr_telegram_outbox')){state.outbox.push({key:v[0],actor:v[1],message:v[2],markup:v[4]&&JSON.parse(v[4])});return {rowCount:1,rows:[]};}
  return {rows:[],rowCount:1};}};
 return {state,db};
}
const env={TELEGRAM_TRIAL_STATUS_BOT_TOKEN:'ts-token',TELEGRAM_TRIAL_STATUS_BOT_USERNAME:'CMLLTrialStatusBot',TELEGRAM_TRIAL_STATUS_WEBHOOK_SECRET:'ts-secret'};
async function withBot(fn){const old={...process.env},oldFetch=globalThis.fetch,calls=[];Object.assign(process.env,env);
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:init?.body?JSON.parse(init.body):null});return {json:async()=>({ok:true})};};
 try{return await fn(calls);}finally{process.env=old;globalThis.fetch=oldFetch;}}
const tap=(telegram,id,data)=>telegram.telegramWebhook('ts-secret',{update_id:id,callback_query:{id:'cb'+id,data,from:{id:555,first_name:'Gul'},message:{chat:{id:555},message_id:42}}},'trial-status');

test('the PM ticks No for one candidate and submits: the Yes candidate goes to Office HR, the No candidate is rejected',async()=>{
 await withBot(async calls=>{const {state,db}=fixture();const telegram=createTelegram({connect:async()=>db});
  await tap(telegram,1,`ta:${CODE}:1:d`);
  assert.deepEqual(state.group.data.picks,{gulnawaz:{'TF/2':'d'}},'the tick is kept for this PM');
  assert.equal(state.group.status,'PENDING','a tick decides nothing yet');
  const redraw=calls.find(c=>c.url.endsWith('/editMessageReplyMarkup'));
  assert.ok(redraw,'the buttons are redrawn on the PM\'s message');
  assert.match(redraw.body.reply_markup.inline_keyboard[1][1].text,/❌ No/);
  assert.match(redraw.body.reply_markup.inline_keyboard[2][0].text,/1 Yes · 1 No/);
  await tap(telegram,2,`ta:${CODE}:s`);
  assert.equal(state.forms['TF/1'].data.pendingRole,'ohr','Vijay Kumar goes to Office HR');
  assert.equal(state.forms['TF/1'].data.history.at(-1).action,'Approved');
  assert.equal(state.forms['TF/2'].data.stage,'REJECTED','Rajendra Singh is rejected');
  assert.equal(state.forms['TF/2'].data.history.at(-1).action,'Rejected');
  assert.equal(state.group.status,'CLOSED');
  assert.equal(state.group.data.decision,'partly approved');
  const toOhr=state.outbox.find(o=>o.actor==='apurvakopulwar'&&o.markup);
  assert.ok(toOhr,'Office HR gets the Yes candidate with buttons');
  assert.match(toOhr.message,/Vijay Kumar/);
  assert.doesNotMatch(toOhr.message,/Rajendra Singh/);
  const ack=state.outbox.find(o=>o.key.startsWith('trial-ack:')&&o.actor==='gulnawaz');
  assert.match(ack.message,/Approved by you[\s\S]*Vijay Kumar[\s\S]*Declined by you[\s\S]*Rajendra Singh/);
  assert.deepEqual(calls.filter(c=>c.url.endsWith('/editMessageReplyMarkup')).at(-1).body.reply_markup,{inline_keyboard:[]},'the buttons go once submitted');
 });
});

test('Submit with no ticks changed approves the whole batch; someone else cannot tick',async()=>{
 await withBot(async()=>{const {state,db}=fixture();const telegram=createTelegram({connect:async()=>db});
  const other={...db,async query(sql,v){if(sql.startsWith('SELECT actor FROM hr_telegram_accounts'))return {rows:[{actor:'amitsingh'}]};return db.query(sql,v);}};
  await createTelegram({connect:async()=>other}).telegramWebhook('ts-secret',{update_id:9,callback_query:{id:'x',data:`ta:${CODE}:0:d`,from:{id:1},message:{chat:{id:1},message_id:1}}},'trial-status');
  assert.equal(state.group.data.picks,undefined,'Site HR cannot tick for the PM');
  await tap(telegram,3,`ta:${CODE}:s`);
  assert.equal(state.forms['TF/1'].data.pendingRole,'ohr');
  assert.equal(state.forms['TF/2'].data.pendingRole,'ohr');
  assert.equal(state.group.data.decision,'approved');
 });
});

test('the TEST preview goes to everyone on the trial route; its taps only redraw and Submit saves nothing',async()=>{
 await withBot(async calls=>{const {state,db}=fixture();
  const out=await sendTrialPicksPreview(db);
 
  for(const a of ['jayanttrainer','gulnawaz','apurvakopulwar','mohitchadda'])assert.ok(out.actors.includes(a),a+' gets the preview');
  assert.ok(!out.actors.includes('amitsingh'),'Site HR does not approve, so no preview');
  const sent=state.outbox.find(o=>o.actor==='gulnawaz');
  assert.match(sent.message,/TEST ONLY/);
  assert.equal(sent.markup.inline_keyboard[1][1].callback_data,'tp:2');
  const before=JSON.stringify(state.forms);
  const telegram=createTelegram({connect:async()=>db});
  await tap(telegram,20,'tp:2');
  const redraw=calls.filter(c=>c.url.endsWith('/editMessageReplyMarkup')).at(-1).body.reply_markup;
  assert.deepEqual(redraw,trialPreviewMarkup(2));
  assert.match(redraw.inline_keyboard[1][1].text,/❌ No/);
  assert.equal(redraw.inline_keyboard[1][0].callback_data,'tp:0','tapping Yes again clears the No');
  await tap(telegram,21,'tp:2:s');
  assert.match(calls.filter(c=>c.url.endsWith('/answerCallbackQuery')).at(-1).body.text,/nothing saved.*2 Yes · 1 No/);
  assert.equal(JSON.stringify(state.forms),before,'no trial form changes');
  assert.equal(state.group.status,'PENDING');
 });
});
