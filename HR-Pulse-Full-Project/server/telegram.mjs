import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {grantedMenus} from './modules.mjs';
import {assignedSites} from './scope.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const username=value=>String(value||'').trim().toLowerCase();
export function validateTelegramHierarchy(input){
 const siteHr=username(input.siteHr),regionalHr=username(input.regionalHr);
 const directors=[...new Set((Array.isArray(input.directors)?input.directors:String(input.directors||'').split(',')).map(username).filter(Boolean))];
 if(![siteHr,regionalHr,...directors].every(x=>/^[-a-z0-9_.@]{1,100}$/.test(x))||siteHr===regionalHr||!directors.length||directors.length>20)fail('Enter distinct Site HR and Regional HR Pulse usernames and 1–20 director usernames.');
 return {siteHr,regionalHr,directors,enabled:input.enabled===true};
}
export function telegramSteps(config){return [{stage:1,label:'Site HR',approvers:[config.siteHr]},{stage:2,label:'Regional HR — final approval',approvers:[config.regionalHr]}];}
export async function telegramLeaveFlow(db,siteId){const row=(await db.query('SELECT data FROM hr_telegram_hierarchies WHERE site_id=$1',[siteId])).rows[0];return row?.data.enabled?row.data:null;}
export async function seedTelegram(db){
 const data={siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true};
 await db.query("INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) SELECT id,$1,'initial-configuration' FROM hr_records WHERE kind='sites' AND code='NCL-JAYANT' ON CONFLICT DO NOTHING",[data]);
}
export async function queueTelegram(db,eventKey,actors,message){for(const actor of new Set(actors.filter(Boolean).map(username)))await db.query('INSERT INTO hr_telegram_outbox(event_key,actor,message) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[eventKey,actor,message]);}
export function leaveMessage(record,status){return `Leave request ${record.code}\nEmployee: ${record.data.employeeName||record.name}\nDates: ${record.data.fromDate} to ${record.data.toDate}\nStatus: ${status}`;}
export async function employeeActor(db,employeeId,fallback='') {const r=(await db.query("SELECT data FROM hr_records WHERE id=$1 AND kind='employees'",[employeeId])).rows[0];return username(r?.data.pulseUsername||r?.data.username||fallback);}
export function webhookSecretValid(actual,expected){if(!expected||typeof actual!=='string')return false;const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export function createTelegram(pool){
 const admin=p=>{if(!grantedMenus(p).has('Master Configuration')||assignedSites(p)!==null)fail('Unrestricted Master Configuration access required',403);};
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 return {
 async telegramApi(profile,route,method,input){
  if(!grantedMenus(profile).size)fail('HR access required',403);
  if(route==='account'&&method==='GET')return {connected:!!(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor=$1',[profile.actor])).rowCount,botUsername:process.env.TELEGRAM_BOT_USERNAME||'',configured:!!process.env.TELEGRAM_BOT_TOKEN};
  if(route==='connect'&&method==='POST'){
   if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_BOT_USERNAME)fail('Telegram bot is not configured',503);
   const token=randomBytes(24).toString('base64url');await tx(async db=>{await db.query('DELETE FROM hr_telegram_link_tokens WHERE actor=$1 OR expires_at<now()',[profile.actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,expires_at) VALUES($1,$2,now()+interval '10 minutes')",[hash(token),profile.actor]);});
   return {url:`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}`};
  }
  if(route==='disconnect'&&method==='POST'){await pool.query('DELETE FROM hr_telegram_accounts WHERE actor=$1',[profile.actor]);return {disconnected:true};}
  admin(profile);
  if(route==='hierarchies'&&method==='GET'){
   const sites=(await pool.query("SELECT s.id,s.code,s.name,h.data,h.version FROM hr_records s LEFT JOIN hr_telegram_hierarchies h ON h.site_id=s.id WHERE s.kind='sites' AND s.status='ACTIVE' ORDER BY s.name")).rows;
   const accounts=(await pool.query('SELECT actor,linked_at FROM hr_telegram_accounts ORDER BY actor')).rows;
   const deliveries=(await pool.query('SELECT id,actor,state,last_error,sent_at FROM hr_telegram_outbox ORDER BY id DESC LIMIT 50')).rows;
   const employees=(await pool.query("SELECT id,code,name,data->>'pulseUsername' AS actor FROM hr_records WHERE kind='employees' AND status IN ('ACTIVE','APPROVED') ORDER BY name")).rows;
   return {sites,accounts,deliveries,employees};
  }
  if(route==='employee-link'&&method==='POST'){
   const actor=username(input.actor);if(!/^[-a-z0-9_.@]{1,100}$/.test(actor))fail('Enter a valid Pulse username');
   return tx(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('telegram-employee-links'))");
    if((await db.query("SELECT id FROM hr_records WHERE kind='employees' AND id<>$1 AND (lower(data->>'pulseUsername')=$2 OR lower(data->>'username')=$2)",[input.employeeId,actor])).rowCount)fail('That Pulse username is already linked to another employee');
    const updated=await db.query("UPDATE hr_records SET data=jsonb_set(data,'{pulseUsername}',to_jsonb($2::text)),version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 AND kind='employees' AND status IN ('ACTIVE','APPROVED') RETURNING id",[input.employeeId,actor,profile.actor]);
    if(!updated.rowCount)fail('Choose an active employee');
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'LINK_PULSE_USERNAME','employees',$2,$3)",[profile.actor,input.employeeId,{pulseUsername:actor}]);return {saved:true};
   });
  }
  if(route==='hierarchies'&&method==='POST'){
   const data=validateTelegramHierarchy(input);return tx(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['telegram-hierarchy:'+input.siteId]);
    if(!(await db.query("SELECT id FROM hr_records WHERE id=$1 AND kind='sites' AND status='ACTIVE'",[input.siteId])).rowCount)fail('Choose an active site');
    const old=(await db.query('SELECT version FROM hr_telegram_hierarchies WHERE site_id=$1 FOR UPDATE',[input.siteId])).rows[0];
    if(Number(input.version)!==(old?.version||0))fail('Configuration changed. Reload and try again.',409);
    await db.query('INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) VALUES($1,$2,$3) ON CONFLICT(site_id) DO UPDATE SET data=$2,version=hr_telegram_hierarchies.version+1,updated_by=$3,updated_at=now()',[input.siteId,data,profile.actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'CONFIGURE_TELEGRAM','sites',$2,$3)",[profile.actor,input.siteId,data]);return {saved:true};
   });
  }
  fail('Not found',404);
 },
 async telegramWebhook(secret,update){
  if(!webhookSecretValid(secret,process.env.TELEGRAM_WEBHOOK_SECRET))fail('Unauthorized webhook',403);
  if(!Number.isSafeInteger(update.update_id))fail('Invalid update');
  await tx(async db=>{
   if(!(await db.query('INSERT INTO hr_telegram_updates(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[update.update_id])).rowCount)return;
   const msg=update.message;if(msg?.chat?.type!=='private'||!msg.from?.id||String(msg.chat.id)!==String(msg.from.id))return;
   const token=String(msg.text||'').match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/)?.[1];if(!token)return;
   const link=(await db.query('DELETE FROM hr_telegram_link_tokens WHERE hash=$1 AND expires_at>now() RETURNING actor',[hash(token)])).rows[0];if(!link)return;
   const taken=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 OR chat_id=$1',[String(msg.from.id)])).rows[0];if(taken&&taken.actor!==link.actor)return;
   await db.query('INSERT INTO hr_telegram_accounts(actor,chat_id,telegram_user_id) VALUES($1,$2,$2) ON CONFLICT(actor) DO UPDATE SET chat_id=$2,telegram_user_id=$2,linked_at=now()',[link.actor,String(msg.from.id)]);
   await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND state IN ('PENDING','FAILED')",[link.actor]);
   await queueTelegram(db,'linked:'+update.update_id,[link.actor],'Your Telegram account is connected to Caliber HR. Leave notifications will appear here.');
  });return {ok:true};
 }
 };
}
export async function deliverTelegram(pool,send=async(chat,text)=>{
 const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,reply_markup:{inline_keyboard:[[{text:'Open HRMS',url:'https://hrpulse.cmll.in/#Employee%20Master'}]]}}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!result.ok)throw new Error('Telegram delivery failed');
}){
 if(!process.env.TELEGRAM_BOT_TOKEN)return;
 const db=await pool.connect();try{
  await db.query('BEGIN');
  const jobs=(await db.query("SELECT o.*,a.chat_id FROM hr_telegram_outbox o LEFT JOIN hr_telegram_accounts a ON a.actor=o.actor WHERE o.state='PENDING' AND o.next_attempt<=now() ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED")).rows;
  for(const job of jobs){
   if(!job.chat_id){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now()+interval '5 minutes',last_error='Recipient has not connected Telegram' WHERE id=$1",[job.id]);continue;}
   try{await send(job.chat_id,job.message);await db.query("UPDATE hr_telegram_outbox SET state='SENT',sent_at=now(),last_error=NULL WHERE id=$1",[job.id]);}
   catch{await db.query("UPDATE hr_telegram_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=9 THEN 'FAILED' ELSE 'PENDING' END,next_attempt=now()+interval '5 minutes',last_error='Delivery failed; recipient may have blocked the bot' WHERE id=$1",[job.id]);}
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
