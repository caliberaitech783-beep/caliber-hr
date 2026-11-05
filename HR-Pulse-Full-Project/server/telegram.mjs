import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {grantedMenus} from './modules.mjs';
import {assignedSites} from './scope.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const username=value=>String(value||'').trim().toLowerCase();
export const telegramUsers=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(username).filter(Boolean))];
export function validateTelegramHierarchy(input){
 const regionalUsers=telegramUsers(input.regionalHr),directors=telegramUsers(input.directors),valid=x=>/^[-a-z0-9_.@]{1,100}$/.test(x);
 /* Leave flow (two types). office: Employee → HOD (concerned) → Directors → Regional HR. site: HR Manager initiates → HOD (concerned) → PM Sir → Regional HR → Directors. */
 if(!input.hods&&!input.type){   /* legacy two-stage route: Site HR / HOD → Regional HR */
  const siteUsers=telegramUsers(input.siteHr);
  if([siteUsers,regionalUsers,directors].some(users=>!users.length||users.length>20)||![...siteUsers,...regionalUsers,...directors].every(valid))fail('Enter 1–20 valid comma-separated Pulse usernames for each role.');
  if(siteUsers.some(actor=>regionalUsers.includes(actor)))fail('Site HR and Regional HR must use different approvers.');
  return {siteHr:siteUsers.join(','),regionalHr:regionalUsers.join(','),directors,enabled:input.enabled===true};
 }
 const type=input.type==='office'?'office':'site';
 const hods={};for(const [department,user] of Object.entries(input.hods&&typeof input.hods==='object'?input.hods:{})){const d=String(department).trim().slice(0,80),u=String(user||'').trim().toLowerCase();if(!d||!u)continue;if(!valid(u))fail(`Enter a valid Pulse username for the HOD of ${d}.`);hods[d]=u;}
 if(!Object.keys(hods).length)fail('Enter the HOD (concerned) Pulse username for at least one department.');
 if([regionalUsers,directors].some(users=>!users.length||users.length>20)||![...regionalUsers,...directors].every(valid))fail('Enter 1–20 valid comma-separated Pulse usernames for Regional HR and Directors.');
 const hrManager=String(input.hrManager||'').trim().toLowerCase(),pm=telegramUsers(input.pm);
 if(type==='site'){if(!valid(hrManager))fail('Enter the site HR Manager Pulse username (who raises leave requests).');if(!pm.length||pm.length>20||!pm.every(valid))fail('Enter 1–20 valid Pulse usernames for PM Sir.');}
 const siteUsers=telegramUsers(input.siteHr).filter(valid);
 return {type,hods,hrManager:type==='site'?hrManager:'',pm:type==='site'?pm.join(','):'',siteHr:siteUsers.join(','),regionalHr:regionalUsers.join(','),directors,enabled:input.enabled===true};
}
/* OD flow. office: Employee → HOD (concerned) → Regional HR. site: HR Manager initiates → HOD (concerned) → Regional HR. */
export function validateOdHierarchy(input){
 const valid=x=>/^[-a-z0-9_.@]{1,100}$/.test(x),type=input.type==='office'?'office':'site',regionalUsers=telegramUsers(input.regionalHr);
 const hods={};for(const [department,user] of Object.entries(input.hods&&typeof input.hods==='object'?input.hods:{})){const d=String(department).trim().slice(0,80),u=String(user||'').trim().toLowerCase();if(!d||!u)continue;if(!valid(u))fail(`Enter a valid Pulse username for the HOD of ${d}.`);hods[d]=u;}
 if(!Object.keys(hods).length)fail('Enter the HOD (concerned) Pulse username for at least one department.');
 if(!regionalUsers.length||regionalUsers.length>20||!regionalUsers.every(valid))fail('Enter 1–20 valid comma-separated Pulse usernames for Regional HR.');
 const hrManager=String(input.hrManager||'').trim().toLowerCase();if(type==='site'&&!valid(hrManager))fail('Enter the site HR Manager Pulse username (who raises OD requests).');
 return {type,hods,hrManager:type==='site'?hrManager:'',regionalHr:regionalUsers.join(','),enabled:input.enabled===true};
}
/* The site's OD flow when enabled (independent of the leave route being enabled). */
export async function odSiteFlow(db,siteId){if(!siteId)return null;const row=(await db.query('SELECT h.data,s.code FROM hr_telegram_hierarchies h JOIN hr_records s ON s.id=h.site_id WHERE site_id=$1',[siteId])).rows[0];return row?.data?.od?.enabled?{...row.data.od,siteCode:row.code}:null;}
/* Approval steps for one request. department = the employee's department name (HOD concerned). */
export function telegramSteps(config,department=''){
 if(!config.hods||!Object.keys(config.hods).length)return [{stage:1,label:`${config.firstRole||'Site HR'} — any one`,approvers:telegramUsers(config.siteHr)},{stage:2,label:'Regional HR — final approval, any one',approvers:telegramUsers(config.regionalHr)}];   /* legacy route */
 const key=Object.keys(config.hods).find(k=>k.toLowerCase()===String(department||'').trim().toLowerCase()),hod=key?config.hods[key]:config.hods['*'];
 if(!hod)fail(`Configure the HOD (concerned) for the ${department||'employee\'s'} department in the leave hierarchy before submitting.`,409);
 const hodStep={stage:1,label:'HOD (concerned) — any one',approvers:telegramUsers(hod)};
 return config.type==='office'
  ?[hodStep,{stage:2,label:'Directors — any one',approvers:config.directors||[]},{stage:3,label:'Regional HR — final approval, any one',approvers:telegramUsers(config.regionalHr)}]
  :[hodStep,{stage:2,label:'PM Sir — any one',approvers:telegramUsers(config.pm)},{stage:3,label:'Regional HR — any one',approvers:telegramUsers(config.regionalHr)},{stage:4,label:'Directors — final approval, any one',approvers:config.directors||[]}];
}
export async function telegramLeaveFlow(db,siteId){const row=(await db.query('SELECT h.data,s.code FROM hr_telegram_hierarchies h JOIN hr_records s ON s.id=h.site_id WHERE site_id=$1',[siteId])).rows[0];return row?.data.enabled?{...row.data,siteCode:row.code,type:row.data.type||(['CMLL-CO','CMLL-HO'].includes(row.code)?'office':'site'),firstRole:row.data.hods?'HOD (concerned)':(['CMLL-CO','CMLL-HO'].includes(row.code)?'HOD':'Site HR')}:null;}
export async function seedTelegram(db){
 const data={siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true};
 await db.query("INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) SELECT id,$1,'initial-configuration' FROM hr_records WHERE kind='sites' AND code='NCL-JAYANT' ON CONFLICT DO NOTHING",[data]);
}
/* Trial-result recipients: a Pulse user already connected to the leave bot (actor) or a phone linked via the trial connect link. */
export const DEFAULT_TRIAL_RECIPIENTS=[{name:'Apurva Kopulwar',phone:'8087477229',actor:'apurvakopulwar'}];
export const recipientActor=r=>r.actor||('trial:'+r.phone);
export async function trialRecipients(db){const row=(await db.query("SELECT data FROM hr_records WHERE kind='trialForms' AND code='SETTINGS'")).rows[0];return row?.data?.recipients||DEFAULT_TRIAL_RECIPIENTS;}
/* Telegram text for a saved trial form – matches the agreed format. */
export function trialResultMessage(record,enteredBy){const f=record.fields||{},pass=f['Result']==='PASS';const d=f['Trial date & time']?new Date(f['Trial date & time']):null;const date=d&&!Number.isNaN(d.valueOf())?d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-'):'';
 const vehicle=[f['Vehicle / equipment for trial'],f['Other equipment']].filter(Boolean).join(', ').replace(/Dumper\/Tipper/,'Dumper / Tipper'),post=(pass?f['If PASS – recommended for']:'')||f['Post applied for']||'Driver / Operator';
 const lines=['🚛 VEHICLE TRIAL RESULT','',`Result: ${pass?'✅ PASS':'❌ FAIL'}`,`Name: ${f['Name of candidate']||''}`,`Post: ${post}${pass&&f['Machine']?' – '+f['Machine']:''}`,`Vehicle: ${vehicle}`,`Experience: ${f['Total experience (years)']||''} years`,`Referred by: ${f['Referred by']||''}`,`Trial date: ${date}`];
 if(pass)lines.push(`Remarks: ${f['Examiner remarks']||''}`);else{lines.push(`Reason for fail: ${f['If FAIL – reason']||''}`);const r=f['Re-trial allowed after (date)'];lines.push(`Re-trial after: ${r?r.split('-').reverse().join('-'):''}`);}
 lines.push(`Entered by: ${enteredBy||''}`);if(record.site||record.heading)lines.push(`Site: ${record.site||record.heading}`,`Form no.: ${record.formNo}`);return lines.join('\n');}
export async function queueTelegram(db,eventKey,actors,message,bot='leave'){for(const actor of new Set(actors.flatMap(telegramUsers)))await db.query('INSERT INTO hr_telegram_outbox(event_key,actor,message,bot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[eventKey,actor,message,bot]);}
/* Bots: 'leave' = leave/approvals bot (TELEGRAM_BOT_TOKEN); 'trial' = Vehicle Trial Result bot (TELEGRAM_TRIAL_BOT_TOKEN). */
export const botToken=bot=>bot==='trial'?process.env.TELEGRAM_TRIAL_BOT_TOKEN:process.env.TELEGRAM_BOT_TOKEN;
export const botUsername=bot=>bot==='trial'?process.env.TELEGRAM_TRIAL_BOT_USERNAME||'':process.env.TELEGRAM_BOT_USERNAME||'';
export function leaveMessage(record,status,details={}){
 const date=value=>value?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(value)):'Not available';
 const firstRole=details.firstRole||'Site HR';
 const headings={SUBMITTED:'📩 LEAVE REQUEST SUBMITTED',PENDING:`✅ LEAVE REQUEST — ${(details.stageRole||firstRole).toUpperCase()} APPROVED`,APPROVED:'✅ LEAVE REQUEST APPROVED',REJECTED:'❌ LEAVE REQUEST REJECTED'};
 const lines=[headings[status]||'📩 LEAVE REQUEST UPDATE','',`🏢 Site Name: ${details.siteName||'Not available'}`,`🆔 Request ID: ${record.code}`,`👤 Employee: ${record.data.employeeName||record.name}`,`📅 Leave Dates: ${date(record.data.fromDate)} to ${date(record.data.toDate)}`];
 if(details.actor){
  const rejected=status==='REJECTED';
  const at=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(new Date(details.at));
  lines.push('',`${rejected?'❌ Rejected':'✅ Approved'} By: ${details.name||details.actor}`,`🆔 ${rejected?'Reviewer':'Approver'} Telegram ID: ${details.telegramId||'Not connected'}`,`📅 ${rejected?'Rejection':'Approval'} Date: ${at} IST`);
 }
 if(status==='SUBMITTED')lines.push('',`⏳ Awaiting ${firstRole} approval`);
 if(status==='PENDING')lines.push('',`⏳ Awaiting ${details.nextRole||'Regional HR'} approval`);
 if(status==='REJECTED'&&details.comments)lines.push(`📝 Reason: ${details.comments}`);
 if(status==='APPROVED'&&record.data.chargeHandedOverTo)lines.push(`🤝 Charge handed over to: ${record.data.chargeHandedOverTo}`);
 lines.push('',`📊 Status: ${status}`);
 return lines.join('\n');
}
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
  /* ---- Trial form (Driver & Operator): save + Telegram result to configured recipients ---- */
  if(route==='trial-recipients'&&method==='GET'){
   const recipients=await trialRecipients(pool);
   const linked=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[recipients.map(recipientActor)])).rows.map(r=>r.actor);
   const issues=Object.fromEntries((await pool.query("SELECT DISTINCT ON (actor) actor,last_error FROM hr_telegram_outbox WHERE bot='trial' AND state<>'SENT' AND last_error IS NOT NULL ORDER BY actor,id DESC")).rows.map(r=>[r.actor,r.last_error]));
   return {recipients:recipients.map(r=>({...r,connected:linked.includes(recipientActor(r)),issue:issues[recipientActor(r)]||''})),botUsername:botUsername('trial'),configured:!!process.env.TELEGRAM_TRIAL_BOT_TOKEN};
  }
  if(route==='trial-recipients'&&method==='POST'){
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const recipients=(Array.isArray(input.recipients)?input.recipients:[]).map(r=>({phone:String(r.phone||'').replace(/\D/g,'').slice(-10),name:String(r.name||'').trim().slice(0,80),actor:String(r.actor||'').trim().toLowerCase().slice(0,100)})).filter(r=>r.phone.length===10||/^[-a-z0-9_.@]{1,100}$/.test(r.actor));
   await tx(async db=>{const old=(await db.query("SELECT id FROM hr_records WHERE kind='trialForms' AND code='SETTINGS'")).rows[0];
    if(old)await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[{recipients},profile.actor,old.id]);
    else await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms','SETTINGS','Trial form Telegram recipients',$1,'ACTIVE',$2,$2)",[{recipients},profile.actor]);});
   return {saved:true};
  }
  if(route==='trial-connect'&&method==='POST'){   /* connect link for a recipient's Telegram (they open it and tap Start) */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   if(!process.env.TELEGRAM_TRIAL_BOT_TOKEN||!process.env.TELEGRAM_TRIAL_BOT_USERNAME)fail('Vehicle Trial Result bot is not configured on the server',503);
   const phone=String(input.phone||'').replace(/\D/g,'').slice(-10);if(phone.length!==10)fail('Enter a 10-digit mobile number');
   const actor='trial:'+phone,token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query('DELETE FROM hr_telegram_link_tokens WHERE actor=$1 OR expires_at<now()',[actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),actor]);});
   return {url:`https://t.me/${process.env.TELEGRAM_TRIAL_BOT_USERNAME}?start=${token}`};
  }
  if(route==='trial-forms'&&method==='POST'){
   const f=input.fields&&typeof input.fields==='object'?input.fields:{},formNo=String(input.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');
   const name=String(f['Name of candidate']||'').trim();if(!name)fail('Candidate name is required.');
   const result=f['Result']==='PASS'?'PASS':f['Result']==='FAIL'?'FAIL':'';if(!result)fail('Select the trial Result (PASS / FAIL) before saving.');
   const record={formNo,heading:String(input.heading||'').slice(0,120),site:String(input.site||'').slice(0,80),company:String(input.company||'').slice(0,120),department:String(input.department||'').slice(0,80),fields:Object.fromEntries(Object.entries(f).slice(0,80).map(([k,v])=>[String(k).slice(0,80),String(v??'').slice(0,500)])),savedBy:profile.actor,savedAt:new Date().toISOString()};
   const message=trialResultMessage(record,profile.name||profile.actor);
   const recipients=(await trialRecipients(pool)).map(recipientActor);
   let id;await tx(async db=>{const old=(await db.query("SELECT id FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0];
    if(old){id=old.id;await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[name,record,profile.actor,id]);}
    else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[formNo,name,record,profile.actor])).rows[0].id;
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIAL_FORM','trialForms',$2,$3)",[profile.actor,id,{formNo,result}]);
    if(recipients.length)await queueTelegram(db,`trial:${formNo}:${result}:${Date.now()}`,recipients,message,'trial');});
   const connected=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[recipients])).rows.map(r=>r.actor.replace(/^trial:/,''));
   const pendingNote=(await pool.query("SELECT actor,last_error FROM hr_telegram_outbox WHERE bot='trial' AND state<>'SENT' AND last_error IS NOT NULL AND actor = ANY($1) ORDER BY id DESC LIMIT 5",[recipients])).rows;
   return {saved:true,id,result,telegram:{recipients:recipients.length,connected,message,bot:botUsername('trial'),configured:!!process.env.TELEGRAM_TRIAL_BOT_TOKEN,issues:pendingNote.map(r=>`${r.actor.replace(/^trial:/,'')}: ${r.last_error}`)}};
  }
  if(route==='disconnect'&&method==='POST'){await pool.query('DELETE FROM hr_telegram_accounts WHERE actor=$1',[profile.actor]);return {disconnected:true};}
  admin(profile);
  if(route==='hierarchies'&&method==='GET'){
   const sites=(await pool.query("SELECT s.id,s.code,s.name,h.data,h.version FROM hr_records s LEFT JOIN hr_telegram_hierarchies h ON h.site_id=s.id WHERE s.kind='sites' AND s.status='ACTIVE' ORDER BY s.name")).rows;
   const accounts=(await pool.query('SELECT actor,linked_at FROM hr_telegram_accounts ORDER BY actor')).rows;
   const deliveries=(await pool.query('SELECT id,actor,state,last_error,sent_at FROM hr_telegram_outbox ORDER BY id DESC LIMIT 50')).rows;
   const employees=(await pool.query("SELECT id,code,name,data->>'pulseUsername' AS actor FROM hr_records WHERE kind='employees' AND status IN ('ACTIVE','APPROVED') ORDER BY name")).rows;
   const departments=(await pool.query("SELECT name FROM hr_records WHERE kind='departments' AND status='ACTIVE' ORDER BY name")).rows.map(r=>r.name);
   return {sites,accounts,deliveries,employees,departments};
  }
  if(route==='my-flow'&&method==='GET'){
   const me=(await pool.query("SELECT e.data->>'siteId' AS site_id FROM hr_records e WHERE e.kind='employees' AND lower(e.data->>'pulseUsername')=$1 ORDER BY e.updated_at DESC LIMIT 1",[profile.actor])).rows[0];
   const flow=me?.site_id?await telegramLeaveFlow(pool,me.site_id):null,od=me?.site_id?await odSiteFlow(pool,me.site_id):null;
   const site=me?.site_id?(await pool.query("SELECT name FROM hr_records WHERE id::text=$1",[me.site_id])).rows[0]:null;
   return {type:flow?.type||null,siteName:site?.name||'',hrManager:flow?.hrManager||'',canInitiate:!flow||flow.type!=='site'||!flow.hods||flow.hrManager===profile.actor,
    odType:od?.type||null,odHrManager:od?.hrManager||'',odCanInitiate:!od||od.type!=='site'||od.hrManager===profile.actor};
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
  if(route==='od-hierarchies'&&method==='POST'){
   const od=validateOdHierarchy(input);return tx(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['telegram-hierarchy:'+input.siteId]);
    if(!(await db.query("SELECT id FROM hr_records WHERE id=$1 AND kind='sites' AND status='ACTIVE'",[input.siteId])).rowCount)fail('Choose an active site');
    const old=(await db.query('SELECT data,version FROM hr_telegram_hierarchies WHERE site_id=$1 FOR UPDATE',[input.siteId])).rows[0];
    if(Number(input.version)!==(old?.version||0))fail('Configuration changed. Reload and try again.',409);
    const data={...(old?.data||{siteHr:'',regionalHr:'',directors:[],enabled:false}),od};
    await db.query('INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) VALUES($1,$2,$3) ON CONFLICT(site_id) DO UPDATE SET data=$2,version=hr_telegram_hierarchies.version+1,updated_by=$3,updated_at=now()',[input.siteId,data,profile.actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'CONFIGURE_OD_FLOW','sites',$2,$3)",[profile.actor,input.siteId,od]);return {saved:true};
   });
  }
  if(route==='hierarchies'&&method==='POST'){
   const leaveData=validateTelegramHierarchy(input);return tx(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['telegram-hierarchy:'+input.siteId]);
    if(!(await db.query("SELECT id FROM hr_records WHERE id=$1 AND kind='sites' AND status='ACTIVE'",[input.siteId])).rowCount)fail('Choose an active site');
    const old=(await db.query('SELECT data,version FROM hr_telegram_hierarchies WHERE site_id=$1 FOR UPDATE',[input.siteId])).rows[0];
    if(Number(input.version)!==(old?.version||0))fail('Configuration changed. Reload and try again.',409);
    const data=old?.data?.od?{...leaveData,od:old.data.od}:leaveData;
    await db.query('INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) VALUES($1,$2,$3) ON CONFLICT(site_id) DO UPDATE SET data=$2,version=hr_telegram_hierarchies.version+1,updated_by=$3,updated_at=now()',[input.siteId,data,profile.actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'CONFIGURE_TELEGRAM','sites',$2,$3)",[profile.actor,input.siteId,data]);return {saved:true};
   });
  }
  fail('Not found',404);
 },
 async telegramWebhook(secret,update,bot='leave'){
  if(!webhookSecretValid(secret,bot==='trial'?(process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET||process.env.TELEGRAM_WEBHOOK_SECRET):process.env.TELEGRAM_WEBHOOK_SECRET))fail('Unauthorized webhook',403);
  if(!Number.isSafeInteger(update.update_id))fail('Invalid update');
  await tx(async db=>{
   if(!(await db.query('INSERT INTO hr_telegram_updates(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[update.update_id])).rowCount)return;
   const msg=update.message;if(msg?.chat?.type!=='private'||!msg.from?.id||String(msg.chat.id)!==String(msg.from.id))return;
   const token=String(msg.text||'').match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/)?.[1];
   if(!token){if(bot==='trial'&&/^\/start/.test(String(msg.text||''))){const known=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(msg.from.id)])).rows[0];if(known){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot='trial' AND state IN ('PENDING','FAILED')",[known.actor]);await queueTelegram(db,'trial-start:'+update.update_id,[known.actor],'Connected. Vehicle trial results from Caliber HR will appear here.','trial');}}return;}
   const link=(await db.query('DELETE FROM hr_telegram_link_tokens WHERE hash=$1 AND expires_at>now() RETURNING actor',[hash(token)])).rows[0];if(!link)return;
   const taken=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 OR chat_id=$1',[String(msg.from.id)])).rows[0];if(taken&&taken.actor!==link.actor)return;
   await db.query('INSERT INTO hr_telegram_accounts(actor,chat_id,telegram_user_id) VALUES($1,$2,$2) ON CONFLICT(actor) DO UPDATE SET chat_id=$2,telegram_user_id=$2,linked_at=now()',[link.actor,String(msg.from.id)]);
   await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND state IN ('PENDING','FAILED')",[link.actor]);
   await queueTelegram(db,'linked:'+update.update_id,[link.actor],bot==='trial'?'Connected. Vehicle trial results from Caliber HR will appear here.':'Your Telegram account is connected to Caliber HR. Leave notifications will appear here.',bot);
  });return {ok:true};
 }
 };
}
export async function deliverTelegram(pool,send=async(chat,text,bot='leave')=>{
 const token=botToken(bot);if(!token)throw Object.assign(new Error('Bot not configured'),{code:'NO_BOT'});
 const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,...(bot==='leave'?{reply_markup:{inline_keyboard:[[{text:'Open HRMS',url:'https://hrpulse.cmll.in/#Employee%20Master'}]]}}:{})}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!result.ok)throw Object.assign(new Error('Telegram delivery failed'),{code:result.error_code===403?'NOT_STARTED':'FAILED'});
}){
 if(!process.env.TELEGRAM_BOT_TOKEN&&!process.env.TELEGRAM_TRIAL_BOT_TOKEN)return;
 const db=await pool.connect();try{
  await db.query('BEGIN');
  const jobs=(await db.query("SELECT o.*,a.chat_id FROM hr_telegram_outbox o LEFT JOIN hr_telegram_accounts a ON a.actor=o.actor WHERE o.state='PENDING' AND o.next_attempt<=now() ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED")).rows;
  for(const job of jobs){
   if(!job.chat_id){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now()+interval '5 minutes',last_error='Recipient has not connected Telegram' WHERE id=$1",[job.id]);continue;}
   try{await send(job.chat_id,job.message,job.bot||'leave');await db.query("UPDATE hr_telegram_outbox SET state='SENT',sent_at=now(),last_error=NULL WHERE id=$1",[job.id]);}
   catch(error){const reason=error?.code==='NO_BOT'?`${job.bot} bot is not configured on the server`:error?.code==='NOT_STARTED'?`Recipient must open @${botUsername(job.bot)||job.bot+' bot'} and tap Start`:'Delivery failed; recipient may have blocked the bot';
    await db.query("UPDATE hr_telegram_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=9 THEN 'FAILED' ELSE 'PENDING' END,next_attempt=now()+interval '5 minutes',last_error=$2 WHERE id=$1",[job.id,reason]);}
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
