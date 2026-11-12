import {buildPdf} from './pdf.mjs';
import {hierarchyTemplates,currentHierarchy,withOfficeHr,withDriverTrainer} from './joining-hierarchy.mjs';
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
/* Registers the Vehicle Trial Result bot's webhook with Telegram at startup (the API host can reach api.telegram.org). */
export async function registerBotWebhook(bot,fetchImpl=fetch,logger=console){
 const token=botToken(bot),secret=botSecret(bot),base=process.env.API_PUBLIC_URL||'https://hr-api-cmll-783.azurewebsites.net';
 if(!token||!secret)return {skipped:true};
 try{const response=await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:`${base}/api/telegram/${bot}-webhook`,secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:true}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();logger.log?.(`${botLabel(bot)} webhook: ${result.ok?'registered':'failed – '+result.description}`);return result;}
 catch(error){logger.error?.(`${botLabel(bot)} webhook registration failed`,error instanceof Error?error.message:error);return {ok:false};}
}
export const registerTrialWebhook=(fetchImpl=fetch,logger=console)=>registerBotWebhook('trial',fetchImpl,logger);
export const registerJoiningWebhook=(fetchImpl=fetch,logger=console)=>registerBotWebhook('joining',fetchImpl,logger);
export async function seedTelegram(db){
 const data={siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true};
 await db.query("INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) SELECT id,$1,'initial-configuration' FROM hr_records WHERE kind='sites' AND code='NCL-JAYANT' ON CONFLICT DO NOTHING",[data]);
}
/* Trial-result recipients: a Pulse user already connected to the leave bot (actor) or a phone linked via the trial connect link. */
export const DEFAULT_TRIAL_RECIPIENTS=[{name:'Apurva Kopulwar',phone:'8087477229',actor:'apurvakopulwar'},{name:'Arjun Keshri',phone:'',actor:'arjunkeshri'},{name:'Mayuri Umate',phone:'',actor:'mayuriumate'}];
/* Recipients that are always included even after the list is edited in the app. */
const ALWAYS_TRIAL_ACTORS=['apurvakopulwar','arjunkeshri','mayuriumate'];
export const recipientActor=r=>r.actor||('trial:'+r.phone);
/* A recipient's scope is a comma list of site names / codes and groups (region, company, employee group), e.g. "Jayant OB East, NCL".
   Empty or "ALL" = every site. A message for a site goes only to recipients whose scope names that site or one of its groups. */
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
export function recipientInScope(r,target){const scope=String(r.scope||'').split(',').map(norm).filter(Boolean);if(!scope.length||scope.includes('all'))return true;
 const keys=[target?.site,target?.siteCode,target?.region,target?.company,target?.group].map(norm).filter(Boolean);return scope.some(x=>keys.some(k=>k===x||k.startsWith(x+' ')||x.startsWith(k+' ')));}
export const scopedRecipients=(list,target)=>target?list.filter(r=>recipientInScope(r,target)):list;
/* Recipients taken from Approval Master › Hierarchy (joining hierarchy per site), so nothing has to be typed twice:
   part1  → the site's "Driver Trainer" step
   result → Project Manager, Office HR, HR Manager — either one (regional), Final approval (directors) */
const HIERARCHY_STEPS={part1:['Driver Trainer'],result:['Project Manager','Office HR — either one','HR Manager — either one','Final approval — any one']};
export async function hierarchyRecipients(db,stage,target){
 const rows=(await db.query("SELECT code,data FROM hr_records WHERE kind='joiningHierarchies'")).rows;
 const out=[];for(const t of hierarchyTemplates){const saved=rows.find(r=>r.code===t.code);const data={...t,...withOfficeHr(withDriverTrainer(currentHierarchy(saved?.data)))};
  /* Nagpur Office (CMLL-CO) HR Executive / HR Manager are the Office HR for every site: Part 2 results reach them for all sites. */
  const officeHr=stage==='result'&&t.code==='CMLL-CO';
  if(!officeHr&&target&&!recipientInScope({scope:t.name},target))continue;
  const labels=officeHr?['HR Executive','HR Manager']:HIERARCHY_STEPS[stage];
  for(const step of data.steps||[])if(labels.includes(step.label))for(const actor of step.approvers||[]){const a=String(actor).trim().toLowerCase();if(a&&!out.some(r=>r.actor===a&&r.site===t.name))out.push({actor:a,name:a,phone:'',scope:officeHr?'ALL':t.name,site:officeHr?'All sites (Office HR – Nagpur Office)':t.name,role:officeHr?`Office HR – ${step.label}`:step.label,source:'hierarchy'});}}
 return out;}
/* Manual list (scoped) + hierarchy for a site, de-duplicated by actor. */
export async function trialRecipientsFor(db,stage,target){const manual=scopedRecipients(await trialRecipients(db,stage),target),auto=await hierarchyRecipients(db,stage,target);const seen=new Set(manual.map(recipientActor));return [...manual,...auto.filter(r=>!seen.has(r.actor))];}
/* stage 'result' = Part 2 result messages (default list); stage 'part1' = "Trial Form Submitted" messages to the driver trainer. */
export async function trialRecipients(db,stage='result'){const row=(await db.query("SELECT data FROM hr_records WHERE kind='trialForms' AND code='SETTINGS'")).rows[0];const d=row?.data||{};if(stage==='part1')return Array.isArray(d.part1Recipients)?d.part1Recipients:[];const saved=d.recipients||[];const merged=[...saved];for(const x of DEFAULT_TRIAL_RECIPIENTS)if(ALWAYS_TRIAL_ACTORS.includes(x.actor)&&!merged.some(r=>r.actor===x.actor))merged.push(x);return merged;}
const fmtDate=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.valueOf())){const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(v);}return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');};
const vehicleOf=f=>[f['Vehicle / equipment for trial'],f['Other equipment']].filter(Boolean).join(', ').replace(/Dumper\/Tipper/,'Dumper / Tipper');
const dash=v=>String(v??'').trim()||'–';
/* Part 1 – "Trial Form Submitted" (single candidate) */
export function trialSubmittedMessage(record){const f=record.fields||{};return ['🚛 VEHICLE TRIAL RESULT','','Trial Form Submitted',`Name: ${dash(f['Name of candidate'])}`,`Post: ${dash(f['Post applied for']||record.department)}`,`Vehicle: ${dash(vehicleOf(f))}`,`Experience: ${dash(f['Total experience (years)'])}`,`Referred by: ${dash(f['Referred by'])}`,`Trial date: ${dash(fmtDate(f['Trial date & time']))}`,`Form No: ${record.formNo}`,`Trial by: ${dash(record.trialBy||'driver trainer')}`,'Status: Sent to driver trainer',`Site: ${dash(record.site||record.heading)}`].join('\n');}
/* Part 1 – batch */
export function trialBatchSubmittedMessage(batch,records){const first=records[0]?.fields||{};const lines=['🚛 VEHICLE TRIAL RESULT','',`Trial Forms Submitted – Batch ${batch.batchId} (${records.length} candidate${records.length===1?'':'s'})`,`Trial date: ${dash(fmtDate(batch.trialDate||first['Trial date & time']))} · Site: ${dash(batch.site)} · Trial by: ${dash(batch.trialBy||'driver trainer')}`,'Status: Sent to driver trainer',''];
 records.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['Post applied for']||r.department)} – ${dash(vehicleOf(f))} – ${r.formNo}`);});lines.push('','📎 Batch sheet attached (PDF)');return lines.join('\n');}
/* Part 2 – batch result */
export function trialBatchResultMessage(batch,records,attachmentCount){const passed=records.filter(r=>r.fields?.Result==='PASS'),failed=records.filter(r=>r.fields?.Result!=='PASS');const first=records[0]?.fields||{};
 const lines=[`🚛 BULK VEHICLE TRIAL RESULT – ${batch.batchId}`,`Site: ${dash(batch.site).toUpperCase()}`,`Trial date: ${dash(fmtDate(batch.trialDate||first['Trial date & time']))}`,`Vehicle: ${dash(batch.vehicle||vehicleOf(first))}   Post: ${dash(batch.post||first['Post applied for'])}`,`Trial by: ${dash(batch.trialBy)}`,`Total: ${records.length}  ✅ PASS ${passed.length}  ❌ FAIL ${failed.length}`,'','✅ PASSED'];
 if(passed.length)passed.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['Post applied for']||r.department)}, ${dash(f['Total experience (years)'])} yrs, Ref: ${dash(f['Referred by'])}`);});else lines.push('–');
 lines.push('','❌ FAILED');if(failed.length)failed.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['If FAIL – reason'])}`);});else lines.push('–');
 lines.push('',`📎 Attachments: ${attachmentCount} file(s) + Excel result sheet`);return lines.join('\n');}
const newBatchId=()=>{const d=new Date();return 'B'+String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+randomBytes(2).toString('hex').toUpperCase();};
const cleanFields=f=>Object.fromEntries(Object.entries(f&&typeof f==='object'?f:{}).slice(0,80).map(([k,v])=>[String(k).slice(0,80),String(v??'').slice(0,500)]));
const cleanAttachments=list=>(Array.isArray(list)?list:[]).slice(0,6).map(a=>({name:String(a?.name||'file').slice(0,120),mime:String(a?.mime||'application/octet-stream').slice(0,80),data:String(a?.data||'').replace(/^data:[^,]*,/,'').slice(0,4*1024*1024)})).filter(a=>a.data);
const recipientIssues=async(pool,recipients)=>{const connected=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[recipients])).rows.map(r=>r.actor.replace(/^trial:/,''));const pendingNote=(await pool.query("SELECT actor,last_error FROM hr_telegram_outbox WHERE bot='trial' AND state<>'SENT' AND last_error IS NOT NULL AND actor = ANY($1) ORDER BY id DESC LIMIT 5",[recipients])).rows;return {recipients:recipients.length,connected,bot:botUsername('trial'),configured:!!process.env.TELEGRAM_TRIAL_BOT_TOKEN,issues:pendingNote.map(r=>`${r.actor.replace(/^trial:/,'')}: ${r.last_error}`)};};
/* Telegram text for a saved trial form – matches the agreed format. */
export function trialResultMessage(record,enteredBy){const f=record.fields||{},pass=f['Result']==='PASS';const date=fmtDate(f['Trial date & time']);
 const vehicle=vehicleOf(f),post=(pass?f['If PASS – recommended for']:'')||f['Post applied for']||record.department||'Driver / Operator';
 const lines=['🚛 VEHICLE TRIAL RESULT','',`Result: ${pass?'✅ PASS':'❌ FAIL'}`,`Name: ${dash(f['Name of candidate'])}`,`Post: ${post}${pass&&f['Machine']?' – '+f['Machine']:''}`,`Vehicle: ${dash(vehicle)}`,`Experience: ${dash(f['Total experience (years)'])}`,`Referred by: ${dash(f['Referred by'])}`,`Trial date: ${dash(date)}`,`Form No: ${record.formNo}`,`Trial by: ${dash(record.trialBy||f['Examiner name']||enteredBy)}`];
 if(!pass)lines.push(`Reason for fail: ${dash(f['If FAIL – reason'])}`);
 lines.push('Status: Sent to PM for approval',`Site: ${dash(record.site||record.heading)}`);return lines.join('\n');}
export async function queueTelegram(db,eventKey,actors,message,bot='leave',markup=null,files=[]){
 const ids=[];for(const f of files||[]){if(!f?.data)continue;const data=Buffer.isBuffer(f.data)?f.data:Buffer.from(String(f.data).replace(/^data:[^,]*,/,''),'base64');if(!data.length||data.length>45*1024*1024)continue;ids.push((await db.query('INSERT INTO hr_telegram_files(event_key,name,mime,data) VALUES($1,$2,$3,$4) RETURNING id',[eventKey,String(f.name||'file').slice(0,120),String(f.mime||'application/octet-stream').slice(0,80),data])).rows[0].id);}
 for(const actor of new Set(actors.flatMap(telegramUsers)))await db.query('INSERT INTO hr_telegram_outbox(event_key,actor,message,bot,markup,files) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[eventKey,actor,message,bot,markup?JSON.stringify(markup):null,ids.length?JSON.stringify(ids):null]);}
/* Telegram text limit is 4096 chars: long batch messages are split at line breaks. */
export function splitTelegram(text,max=4000){const parts=[];let cur='';for(const line of String(text).split('\n')){if((cur+'\n'+line).length>max&&cur){parts.push(cur);cur=line;}else cur=cur?cur+'\n'+line:line;}if(cur)parts.push(cur);return parts;}
/* Bots: 'leave' = leave/approvals bot (TELEGRAM_BOT_TOKEN); 'trial' = Vehicle Trial Result bot (TELEGRAM_TRIAL_BOT_TOKEN). */
export const botToken=bot=>bot==='trial'?process.env.TELEGRAM_TRIAL_BOT_TOKEN:bot==='joining'?process.env.TELEGRAM_JOINING_BOT_TOKEN:process.env.TELEGRAM_BOT_TOKEN;
export const botUsername=bot=>bot==='trial'?process.env.TELEGRAM_TRIAL_BOT_USERNAME||'':bot==='joining'?process.env.TELEGRAM_JOINING_BOT_USERNAME||'':process.env.TELEGRAM_BOT_USERNAME||'';
export const botSecret=bot=>bot==='trial'?(process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET||process.env.TELEGRAM_WEBHOOK_SECRET):bot==='joining'?(process.env.TELEGRAM_JOINING_WEBHOOK_SECRET||process.env.TELEGRAM_WEBHOOK_SECRET):process.env.TELEGRAM_WEBHOOK_SECRET;
export const botLabel=bot=>bot==='trial'?'Vehicle Trial Result bot':bot==='joining'?'Joining Approval bot':'HR Pulse leave bot';
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

/* ---- Joining approval (Employee Management › Joining & Personal Details): OTP on Telegram + Approve / Reject buttons ---- */
const JOINING_OTP_MINUTES=15,JOINING_OTP_ATTEMPTS=5;
export async function joiningApprovers(db){const row=(await db.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code='SETTINGS'")).rows[0];const d=row?.data||{};return {approvers:String(d.approvers||'').split(',').map(a=>a.trim().toLowerCase()).filter(Boolean),enabled:!!d.enabled};}
export function joiningApprovalMessage(d,otp){return `Joining approval request\nCandidate: ${d.candidate||'-'}\nPost: ${d.post||'-'}\nSite: ${d.site||'-'}\nCompany: ${d.company||'-'}\nSubmitted by: ${d.submittedBy||'-'}\n\nOTP: ${otp} (valid ${JOINING_OTP_MINUTES} min)\nTell the OTP to HR, or tap Approve / Reject below.`;}
const joiningMarkup=code=>({inline_keyboard:[[{text:'✅ Approve',callback_data:`ja:${code}:approve`},{text:'❌ Reject',callback_data:`ja:${code}:reject`}]]});
async function answerCallback(bot,id,text){const token=botToken(bot);if(!token)return;try{await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text,show_alert:false}),signal:AbortSignal.timeout(8000)});}catch{/* best effort */}}
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
  /* ---- Joining approval ---- */
  if(route==='joining-approvers'&&method==='GET'){const cfg=await joiningApprovers(pool);const linked=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[cfg.approvers])).rows.map(r=>r.actor);const issues=Object.fromEntries((await pool.query("SELECT DISTINCT ON (actor) actor,last_error FROM hr_telegram_outbox WHERE bot='joining' AND state<>'SENT' AND last_error IS NOT NULL ORDER BY actor,id DESC")).rows.map(r=>[r.actor,r.last_error]));return {...cfg,approvers:cfg.approvers.join(', '),linked,issues,botUsername:botUsername('joining'),configured:!!process.env.TELEGRAM_JOINING_BOT_TOKEN,canWrite:grantedMenus(profile).has('Approval Management')};}
  if(route==='joining-approvers'&&method==='POST'){
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const approvers=String(input.approvers||'').split(',').map(a=>a.trim().toLowerCase()).filter(a=>/^[-a-z0-9_.@]{1,100}$/.test(a));
   const data={approvers:approvers.join(','),enabled:!!input.enabled&&approvers.length>0,updatedBy:profile.actor,updatedAt:new Date().toISOString()};
   await pool.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'joiningApprovals','SETTINGS','Joining approvers',$1,'ACTIVE',$2,$2) ON CONFLICT(kind,code) DO UPDATE SET data=$1,updated_by=$2,updated_at=now()",[data,profile.actor]);
   return {ok:true,approvers:data.approvers,enabled:data.enabled};
  }
  if(route==='joining-approval'&&method==='POST'){   /* request / resend OTP */
   const cfg=await joiningApprovers(pool);if(!cfg.enabled)return {required:false};
   if(!process.env.TELEGRAM_JOINING_BOT_TOKEN)fail('Joining Approval bot is not configured on the server (TELEGRAM_JOINING_BOT_TOKEN)',503);
   const id=String(input.draftId||'').trim().slice(0,80);if(!/^[-A-Za-z0-9_.]{4,80}$/.test(id))fail('Invalid draft id');
   const code='JA-'+hash(id).slice(0,12).toUpperCase();
   const existing=(await pool.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1",[code])).rows[0]?.data;
   if(existing&&existing.status==='APPROVED')return {required:true,status:'APPROVED',approvedBy:existing.approvedBy,approvedAt:existing.approvedAt,candidate:existing.candidate};
   const otp=String(Math.floor(100000+Math.random()*900000)),expires=new Date(Date.now()+JOINING_OTP_MINUTES*60000).toISOString();
   const data={status:'PENDING',draftId:id,candidate:String(input.candidate||'').trim().slice(0,120),post:String(input.post||'').trim().slice(0,80),site:String(input.site||'').trim().slice(0,80),company:String(input.company||'').trim().slice(0,80),submittedBy:profile.actor,requestedAt:new Date().toISOString(),otpHash:hash(code+':'+otp),expires,attempts:0,approvers:cfg.approvers,resends:(existing?.resends||0)+(existing?1:0)};
   await tx(async db=>{await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'joiningApprovals',$1,$2,$3,'PENDING',$4,$4) ON CONFLICT(kind,code) DO UPDATE SET data=$3,name=$2,status='PENDING',updated_by=$4,updated_at=now()",[code,data.candidate||code,data,profile.actor]);
    await queueTelegram(db,`joining:${code}:${data.resends}`,cfg.approvers,joiningApprovalMessage(data,otp),'joining',joiningMarkup(code));});
   const linked=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[cfg.approvers])).rows.map(r=>r.actor);
   return {required:true,status:'PENDING',expires,approvers:cfg.approvers,connected:linked,notConnected:cfg.approvers.filter(a=>!linked.includes(a))};
  }
  if(route==='joining-approval/status'&&method==='POST'){
   const cfg=await joiningApprovers(pool);if(!cfg.enabled)return {required:false};
   const code='JA-'+hash(String(input.draftId||'')).slice(0,12).toUpperCase();const d=(await pool.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1",[code])).rows[0]?.data;
   if(!d)return {required:true,status:'NONE'};
   const issues=(await pool.query("SELECT actor,last_error FROM hr_telegram_outbox WHERE event_key LIKE $1 AND state<>'SENT' AND last_error IS NOT NULL",[`joining:${code}:%`])).rows;
   return {required:true,status:d.status,approvedBy:d.approvedBy||'',approvedAt:d.approvedAt||'',expires:d.expires,expired:d.status==='PENDING'&&new Date(d.expires)<new Date(),issues:issues.map(i=>`${i.actor}: ${i.last_error}`)};
  }
  if(route==='joining-approval/verify'&&method==='POST'){
   const code='JA-'+hash(String(input.draftId||'')).slice(0,12).toUpperCase(),otp=String(input.otp||'').replace(/\D/g,'');
   return tx(async db=>{const row=(await db.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1 FOR UPDATE",[code])).rows[0];if(!row)fail('No approval request found – click Save & Continue again.',404);
    const d=row.data;if(d.status==='APPROVED')return {status:'APPROVED',approvedBy:d.approvedBy,approvedAt:d.approvedAt};
    if(d.status==='REJECTED')fail(`Rejected by ${d.approvedBy||'approver'}.`,409);
    if(new Date(d.expires)<new Date())fail('OTP expired – click Resend OTP.',410);
    if((d.attempts||0)>=JOINING_OTP_ATTEMPTS)fail('Too many wrong attempts – click Resend OTP.',429);
    if(otp.length!==6||hash(code+':'+otp)!==d.otpHash){d.attempts=(d.attempts||0)+1;await db.query("UPDATE hr_records SET data=$2,updated_at=now() WHERE kind='joiningApprovals' AND code=$1",[code,d]);fail(`Wrong OTP (${JOINING_OTP_ATTEMPTS-d.attempts} attempt${JOINING_OTP_ATTEMPTS-d.attempts===1?'':'s'} left).`,400);}
    Object.assign(d,{status:'APPROVED',approvedBy:'OTP entered by '+profile.actor,approvedAt:new Date().toISOString(),otpHash:null});
    await db.query("UPDATE hr_records SET data=$2,status='APPROVED',updated_at=now() WHERE kind='joiningApprovals' AND code=$1",[code,d]);
    await queueTelegram(db,`joining:${code}:done`,d.approvers||[],`✅ Joining of ${d.candidate||'candidate'} approved – OTP entered by ${profile.actor}.`,'joining');
    return {status:'APPROVED',approvedBy:d.approvedBy,approvedAt:d.approvedAt};});
  }
  /* ---- Trial form (Driver & Operator): save + Telegram result to configured recipients ---- */
  if(route==='trial-status'&&method==='GET'){   /* diagnostics for the Vehicle Trial Result bot */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const token=process.env.TELEGRAM_TRIAL_BOT_TOKEN,secret=process.env.TELEGRAM_TRIAL_WEBHOOK_SECRET||process.env.TELEGRAM_WEBHOOK_SECRET;
   const out={tokenSet:!!token,usernameSet:process.env.TELEGRAM_TRIAL_BOT_USERNAME||'',secretSet:!!secret,me:null,webhook:null,registered:null,outbox:[]};
   if(token){const call=async(m,body)=>{try{const r=await fetch(`https://api.telegram.org/bot${token}/${m}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(10000)});return await r.json();}catch(e){return {ok:false,description:e instanceof Error?e.message:String(e)};}};
    out.me=await call('getMe');out.registered=await registerTrialWebhook();out.webhook=await call('getWebhookInfo');}
   await pool.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING' WHERE bot='trial' AND state IN ('PENDING','FAILED')");
   out.outbox=(await pool.query("SELECT actor,state,attempts,last_error,created_at,sent_at FROM hr_telegram_outbox WHERE bot='trial' ORDER BY id DESC LIMIT 10")).rows;
   return out;
  }
  if(route==='joining-status'&&method==='GET'){   /* diagnostics for the Joining Approval bot */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const token=process.env.TELEGRAM_JOINING_BOT_TOKEN,secret=botSecret('joining');
   const out={tokenSet:!!token,usernameSet:process.env.TELEGRAM_JOINING_BOT_USERNAME||'',secretSet:!!secret,me:null,webhook:null,registered:null,outbox:[]};
   if(token){const call=async(m,body)=>{try{const r=await fetch(`https://api.telegram.org/bot${token}/${m}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(10000)});return await r.json();}catch(e){return {ok:false,description:e instanceof Error?e.message:String(e)};}};
    out.me=await call('getMe');out.registered=await registerJoiningWebhook();out.webhook=await call('getWebhookInfo');}
   await pool.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING' WHERE bot='joining' AND state IN ('PENDING','FAILED')");
   out.outbox=(await pool.query("SELECT actor,state,attempts,last_error,created_at,sent_at FROM hr_telegram_outbox WHERE bot='joining' ORDER BY id DESC LIMIT 10")).rows;
   return out;
  }
  if(route==='trial-recipients'&&method==='GET'){
   const result=await trialRecipients(pool,'result'),part1=await trialRecipients(pool,'part1'),hierarchy={part1:await hierarchyRecipients(pool,'part1'),result:await hierarchyRecipients(pool,'result')},all=[...result,...part1,...hierarchy.part1,...hierarchy.result];
   const linked=(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor = ANY($1)',[all.map(recipientActor)])).rows.map(r=>r.actor);
   const issues=Object.fromEntries((await pool.query("SELECT DISTINCT ON (actor) actor,last_error FROM hr_telegram_outbox WHERE bot='trial' AND state<>'SENT' AND last_error IS NOT NULL ORDER BY actor,id DESC")).rows.map(r=>[r.actor,r.last_error]));
   const decorate=list=>list.map(r=>({...r,connected:linked.includes(recipientActor(r)),issue:issues[recipientActor(r)]||''}));
   return {recipients:decorate(result),part1Recipients:decorate(part1),hierarchy:{part1:decorate(hierarchy.part1),result:decorate(hierarchy.result)},botUsername:botUsername('trial'),configured:!!process.env.TELEGRAM_TRIAL_BOT_TOKEN};
  }
  if(route==='trial-recipients'&&method==='POST'){
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const recipients=(Array.isArray(input.recipients)?input.recipients:[]).map(r=>({phone:String(r.phone||'').replace(/\D/g,'').slice(-10),name:String(r.name||'').trim().slice(0,80),actor:String(r.actor||'').trim().toLowerCase().slice(0,100),scope:String(r.scope||'').trim().slice(0,300)})).filter(r=>r.phone.length===10||/^[-a-z0-9_.@]{1,100}$/.test(r.actor));
   const stage=input.stage==='part1'?'part1':'result';
   await tx(async db=>{const old=(await db.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code='SETTINGS' FOR UPDATE")).rows[0];const data={...(old?.data||{})};if(stage==='part1')data.part1Recipients=recipients;else data.recipients=recipients;
    if(old)await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[data,profile.actor,old.id]);
    else await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms','SETTINGS','Trial form Telegram recipients',$1,'ACTIVE',$2,$2)",[data,profile.actor]);});
   return {saved:true};
  }
  if(route==='joining-connect'&&method==='POST'){   /* connect link for an approver on the Joining Approval bot */
   if(!process.env.TELEGRAM_JOINING_BOT_TOKEN||!process.env.TELEGRAM_JOINING_BOT_USERNAME)fail('Joining Approval bot is not configured on the server',503);
   const pulse=String(input.actor||profile.actor).trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(pulse))fail('Enter a Pulse username');
   if(pulse!==profile.actor&&!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query('DELETE FROM hr_telegram_link_tokens WHERE actor=$1 OR expires_at<now()',[pulse]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),pulse]);});
   return {url:`https://t.me/${process.env.TELEGRAM_JOINING_BOT_USERNAME}?start=${token}`,botUsername:process.env.TELEGRAM_JOINING_BOT_USERNAME};
  }
  if(route==='trial-connect'&&method==='POST'){   /* connect link for a recipient's Telegram (they open it and tap Start) */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   if(!process.env.TELEGRAM_TRIAL_BOT_TOKEN||!process.env.TELEGRAM_TRIAL_BOT_USERNAME)fail('Vehicle Trial Result bot is not configured on the server',503);
   const phone=String(input.phone||'').replace(/\D/g,'').slice(-10),pulse=String(input.actor||'').trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(pulse)&&phone.length!==10)fail('Enter a Pulse username or a 10-digit mobile number');
   const actor=pulse||'trial:'+phone,token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query('DELETE FROM hr_telegram_link_tokens WHERE actor=$1 OR expires_at<now()',[actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),actor]);});
   return {url:`https://t.me/${process.env.TELEGRAM_TRIAL_BOT_USERNAME}?start=${token}`};
  }
  if(route==='trial-history'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const aadhaar=String(input.aadhaar||'').replace(/\D/g,'');if(!/^\d{12}$/.test(aadhaar))fail('Enter a 12-digit Aadhaar number');
   const scope=assignedSites(profile),exclude=String(input.excludeFormNo||'').slice(0,40);
   const rows=(await pool.query(`SELECT t.code,t.kind,t.updated_at,t.data - 'resultDocument' - 'photo' AS data
    FROM hr_records t WHERE t.code<>'SETTINGS' AND t.code<>$2
    AND ((t.kind='trialForms' AND t.status='ACTIVE' AND t.data->'fields'->>'Result' IN ('PASS','FAIL')
      AND regexp_replace(COALESCE(t.data->'fields'->>'Aadhaar no.',t.data->'fields'->>'Aadhaar No.',t.data->'fields'->>'Aadhaar No. *',''),'[^0-9]','','g')=$1)
     OR (t.kind='trialWorkflow' AND t.status<>'REJECTED' AND t.data->>'result' IN ('PASS','FAIL') AND t.data->>'aadhaar'=$1))
    AND ($3::text[] IS NULL OR (t.kind='trialForms' AND lower(t.data->>'site')=ANY($3))
     OR EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites' AND (lower(s.code)=ANY($3) OR lower(s.name)=ANY($3) OR s.id::text=ANY($3))
      AND (s.id::text=t.data->>'siteId' OR (t.kind='trialForms' AND (lower(s.name)=lower(t.data->>'site') OR lower(s.code)=lower(t.data->>'site'))))))
    ORDER BY (COALESCE(t.data->>'result',t.data->'fields'->>'Result')='PASS') DESC,t.updated_at DESC LIMIT 20`,[aadhaar,exclude,scope])).rows;
   return {matches:rows.flatMap(row=>{
    const data=row.data||{},fields=data.fields||{};
    const managed=row.kind==='trialWorkflow';
    const result=managed?data.result:fields.Result;
    if(!['PASS','FAIL'].includes(result))return [];
    const outcome=data.outcome||{};
    const vehicle=managed?(Array.isArray(data.vehicles)?data.vehicles.map(item=>item==='Other'?data.otherVehicle||item:item).join(', '):'')
      :[fields['Vehicle / equipment for trial'],fields['Other equipment']].filter(Boolean).join(', ');
    return [{formNo:row.code,result,site:data.site||'',trialDate:(managed?data.trialDate:fields['Trial date & time'])||'',
     savedAt:(managed?outcome.at:data.savedAt)||row.updated_at||'',post:(managed?outcome.post||data.post:fields['Post applied for']||data.department)||'',
     equipment:(managed?outcome.machine:fields.Machine)||vehicle,
     failureReason:result==='FAIL'?((managed?outcome.reason:fields['If FAIL – reason'])||''):''}];
   })};
  }
  /* ---- Part 1 (Site HR): save candidate(s) and tell the driver trainer; a batch also carries a PDF sheet ---- */
  if(route==='trial-part1'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const items=(Array.isArray(input.candidates)?input.candidates:[]).slice(0,100);if(!items.length)fail('Add at least one candidate');
   const site=String(input.site||'').slice(0,80),company=String(input.company||'').slice(0,120),department=String(input.department||'').slice(0,80),heading=String(input.heading||'').slice(0,120),trialBy=String(input.trialBy||'').slice(0,80);
   const batchId=items.length>1?(String(input.batchId||'').trim().slice(0,40)||newBatchId()):'';
   const records=items.map(c=>{const fields=cleanFields(c.fields),formNo=String(c.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');const name=String(fields['Name of candidate']||'').trim();if(!name)fail('Candidate name is required for every row');
    return {formNo,heading,site,company,department,fields,stage:'PART1',status:'Sent to driver trainer',batchId,trialBy,attachments:cleanAttachments(c.attachments),part1By:profile.actor,part1At:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};});
   const target={site,region:String(input.region||'').slice(0,80),company,group:String(input.group||'').slice(0,80)};
   const recipients=(await trialRecipientsFor(pool,'part1',target)).map(recipientActor);
   let message,files=[];
   if(batchId){const batch={batchId,site,trialBy,trialDate:records[0].fields['Trial date & time']};message=trialBatchSubmittedMessage(batch,records);
    const pdf=buildPdf({title:`Vehicle trial – Batch ${batchId}`,subtitle:[`Site: ${site||heading||'-'} · Trial date: ${fmtDate(batch.trialDate)||'-'} · Trial by: ${trialBy||'driver trainer'} · Submitted by: ${profile.name||profile.actor}`,company||''].filter(Boolean),
     columns:[{label:'#',width:20},{label:'Form No',width:85},{label:'Name',width:150},{label:'Post',width:65},{label:'Vehicle',width:95},{label:'Exp (yrs)',width:45},{label:'Referred by',width:85},{label:'Aadhaar',width:80},{label:'PASS / FAIL',width:60},{label:'Remarks',width:120}],
     rows:records.map((r,i)=>[i+1,r.formNo,r.fields['Name of candidate'],r.fields['Post applied for']||department,vehicleOf(r.fields),r.fields['Total experience (years)'],r.fields['Referred by'],r.fields['Aadhaar no.'],'','']),footer:'Generated by HR Pulse'});
    files=[{name:`Trial_${batchId}.pdf`,mime:'application/pdf',data:pdf,caption:`Batch sheet – ${batchId}`}];}
   else message=trialSubmittedMessage(records[0]);
   await tx(async db=>{for(const r of records){const old=(await db.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1",[r.formNo])).rows[0];
     if(old&&['PASS','FAIL'].includes(old.data?.fields?.Result))fail(`${r.formNo} already has a result – start a new form number`,409);
     const name=r.fields['Name of candidate'];let id;
     if(old){id=old.id;await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[name,r,profile.actor,id]);}
     else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[r.formNo,name,r,profile.actor])).rows[0].id;
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SUBMIT_TRIAL_PART1','trialForms',$2,$3)",[profile.actor,id,{formNo:r.formNo,batchId}]);}
    if(recipients.length)await queueTelegram(db,`trial-part1:${batchId||records[0].formNo}:${Date.now()}`,recipients,message,'trial',null,files);});
   return {saved:true,batchId,formNos:records.map(r=>r.formNo),telegram:{...(await recipientIssues(pool,recipients)),message}};
  }
  /* ---- Part 2 list: forms waiting for the driver trainer ---- */
  if(route==='trial-pending'&&method==='GET'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const scope=assignedSites(profile);
   const rows=(await pool.query(`SELECT code,data,updated_at FROM hr_records t WHERE kind='trialForms' AND status='ACTIVE' AND code<>'SETTINGS' AND data->>'stage'='PART1' AND COALESCE(data->'fields'->>'Result','') NOT IN ('PASS','FAIL')
    AND ($1::text[] IS NULL OR lower(t.data->>'site')=ANY($1) OR EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites' AND (lower(s.code)=ANY($1) OR lower(s.name)=ANY($1) OR s.id::text=ANY($1)) AND (lower(s.name)=lower(t.data->>'site') OR lower(s.code)=lower(t.data->>'site')))) ORDER BY updated_at DESC LIMIT 300`,[scope])).rows;
   return {pending:rows.map(r=>{const {attachments,...rest}=r.data;return {...rest,formNo:r.code,attachmentCount:(attachments||[]).length,updatedAt:r.updated_at};})};
  }
  if(route==='trial-form'&&method==='POST'){   /* one saved trial form with its attachments (Part 2 opens it) */
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const formNo=String(input.formNo||'').trim().slice(0,40);const row=(await pool.query("SELECT data FROM hr_records WHERE kind='trialForms' AND status='ACTIVE' AND code=$1",[formNo])).rows[0];if(!row)fail('Trial form not found',404);
   return {data:row.data};
  }
  /* ---- Part 2 single result (driver trainer) → PM, with the candidate's attachments ---- */
  if(route==='trial-result'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const formNo=String(input.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');
   const fields=cleanFields(input.fields);if(!['PASS','FAIL'].includes(fields.Result))fail('Result must be PASS or FAIL');if(!fields['Name of candidate'])fail('Candidate name is required');
   const prev=(await pool.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0];
   const attachments=cleanAttachments(input.attachments);
   const record={...(prev?.data||{}),formNo,heading:String(input.heading||'').slice(0,120),site:String(input.site||'').slice(0,80),company:String(input.company||'').slice(0,120),department:String(input.department||'').slice(0,80),batchId:String(input.batchId||prev?.data?.batchId||'').slice(0,40),fields:{...(prev?.data?.fields||{}),...fields},attachments:attachments.length?attachments:prev?.data?.attachments||[],stage:'RESULT',status:'Sent to PM for approval',trialBy:String(input.trialBy||fields['Examiner name']||profile.name||profile.actor).slice(0,80),resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
   const message=trialResultMessage(record,profile.name||profile.actor),recipients=(await trialRecipientsFor(pool,'result',{site:record.site,region:String(input.region||'').slice(0,80),company:record.company,group:String(input.group||'').slice(0,80)})).map(recipientActor);
   await tx(async db=>{let id=prev?.id;
    if(id)await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[record.fields['Name of candidate'],record,profile.actor,id]);
    else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[formNo,record.fields['Name of candidate'],record,profile.actor])).rows[0].id;
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIAL_FORM','trialForms',$2,$3)",[profile.actor,id,{formNo,result:fields.Result}]);
    const files=(record.attachments||[]).map(a=>({name:`${formNo.replace(/\//g,'-')}_${a.name}`,mime:a.mime,data:a.data,caption:`${record.fields['Name of candidate']} – ${formNo}`}));
    if(recipients.length)await queueTelegram(db,`trial:${formNo}:${fields.Result}:${Date.now()}`,recipients,message,'trial',null,files);});
   return {saved:true,result:fields.Result,telegram:{...(await recipientIssues(pool,recipients)),message}};
  }
  /* ---- Part 2 batch result (driver trainer): PASS/FAIL per candidate → PM, with Excel sheet + attachments ---- */
  if(route==='trial-batch-result'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const batchId=String(input.batchId||'').trim().slice(0,40);if(!batchId)fail('Batch id is required');
   const results=(Array.isArray(input.results)?input.results:[]).slice(0,100).map(r=>({formNo:String(r.formNo||'').slice(0,40),result:r.result==='PASS'?'PASS':r.result==='FAIL'?'FAIL':'',reason:String(r.reason||'').slice(0,300),remarks:String(r.remarks||'').slice(0,300)}));
   if(!results.length||results.some(r=>!r.result))fail('Mark PASS or FAIL for every candidate');
   const trialBy=String(input.trialBy||profile.name||profile.actor).slice(0,80);
   const xlsx=input.xlsx?String(input.xlsx).replace(/^data:[^,]*,/,'').slice(0,8*1024*1024):'';
   const recipients=(await trialRecipientsFor(pool,'result',{site:String(input.site||''),region:String(input.region||'').slice(0,80),company:String(input.company||''),group:String(input.group||'').slice(0,80)})).map(recipientActor);
   let message;const records=[];
   const site=String(input.site||'').slice(0,80),company=String(input.company||'').slice(0,120),department=String(input.department||'').slice(0,80),heading=String(input.heading||'').slice(0,120);
   const given=new Map((Array.isArray(input.rows)?input.rows:[]).slice(0,100).map(r=>[String(r.formNo||'').slice(0,40),{fields:cleanFields(r.fields),attachments:cleanAttachments(r.attachments)}]));
   await tx(async db=>{const stored=(await db.query("SELECT id,code,data FROM hr_records WHERE kind='trialForms' AND status='ACTIVE' AND data->>'batchId'=$1 FOR UPDATE",[batchId])).rows;
    const rows=[...stored];for(const [formNo,g] of given)if(!stored.some(r=>r.code===formNo))rows.push({id:null,code:formNo,data:{formNo,heading,site,company,department,batchId,fields:g.fields,attachments:g.attachments,stage:'PART1',status:'Sent to driver trainer'}});
    if(!rows.length)fail('Batch not found',404);
    for(const row of rows){const res=results.find(r=>r.formNo===row.code);if(!res)fail(`Missing result for ${row.code}`);const g=given.get(row.code);const data={...row.data,fields:{...row.data.fields,...(g?.fields||{}),Result:res.result,'If FAIL – reason':res.result==='FAIL'?res.reason:'', 'Examiner remarks':res.remarks,'Examiner name':trialBy},attachments:g?.attachments?.length?g.attachments:row.data.attachments||[],stage:'RESULT',status:'Sent to PM for approval',trialBy,resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
     if(row.id)await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[data,profile.actor,row.id]);
     else row.id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[row.code,data.fields['Name of candidate']||row.code,data,profile.actor])).rows[0].id;
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIAL_FORM','trialForms',$2,$3)",[profile.actor,row.id,{formNo:row.code,result:res.result,batchId}]);records.push(data);}
    const files=[];for(const r of records)for(const a of r.attachments||[])files.push({name:`${r.formNo.replace(/\//g,'-')}_${a.name}`,mime:a.mime,data:a.data,caption:`${r.fields['Name of candidate']} – ${r.formNo}`});
    if(xlsx)files.push({name:`Trial_${batchId}.xlsx`,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:xlsx,caption:`Trial result sheet – ${batchId}`});
    const first=records[0];message=trialBatchResultMessage({batchId,site:first.site||first.heading,trialBy,trialDate:first.fields['Trial date & time'],vehicle:vehicleOf(first.fields),post:first.fields['Post applied for']||first.department},records,files.length-(xlsx?1:0));
    if(recipients.length)await queueTelegram(db,`trial-batch:${batchId}:${Date.now()}`,recipients,message,'trial',null,files);});
   return {saved:true,batchId,passed:records.filter(r=>r.fields.Result==='PASS').map(r=>r.formNo),telegram:{...(await recipientIssues(pool,recipients)),message}};
  }
  if(route==='trial-forms'&&method==='POST'){
   const f=input.fields&&typeof input.fields==='object'?input.fields:{},formNo=String(input.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');
   const name=String(f['Name of candidate']||'').trim();if(!name)fail('Candidate name is required.');
   const result=f['Result']==='PASS'?'PASS':f['Result']==='FAIL'?'FAIL':'';if(!result)fail('Select the trial Result (PASS / FAIL) before saving.');
   const prev=(await pool.query("SELECT data FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0]?.data||{};
   const record={...prev,formNo,heading:String(input.heading||'').slice(0,120),site:String(input.site||'').slice(0,80),company:String(input.company||'').slice(0,120),department:String(input.department||'').slice(0,80),fields:cleanFields(f),stage:'RESULT',status:'Sent to PM for approval',trialBy:String(input.trialBy||f['Examiner name']||profile.name||profile.actor).slice(0,80),resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
   const message=trialResultMessage(record,profile.name||profile.actor);
   const recipients=(await trialRecipients(pool)).map(recipientActor);
   let id;await tx(async db=>{
    const aadhaar=String(f['Aadhaar no.']||f['Aadhaar No.']||f['Aadhaar No. *']||'').replace(/\D/g,'');
    if(!/^\d{12}$/.test(aadhaar))fail('Enter a 12-digit Aadhaar number');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['trial-aadhaar:'+aadhaar]);
    const passed=(await db.query("SELECT id FROM hr_records WHERE kind='trialForms' AND status='ACTIVE' AND data->'fields'->>'Result'='PASS' AND regexp_replace(COALESCE(data->'fields'->>'Aadhaar no.',data->'fields'->>'Aadhaar No.',data->'fields'->>'Aadhaar No. *',''),'[^0-9]','','g')=$1 LIMIT 1",[aadhaar])).rows[0];
    if(passed)fail('This candidate has already passed. View the previous result or start another trial; another trial cannot be saved.',409);
    const old=(await db.query("SELECT id FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0];
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
  if(!webhookSecretValid(secret,botSecret(bot)))fail('Unauthorized webhook',403);
  if(!Number.isSafeInteger(update.update_id))fail('Invalid update');
  let callback=null;
  await tx(async db=>{
   if(!(await db.query('INSERT INTO hr_telegram_updates(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[update.update_id])).rowCount)return;
   const cb=update.callback_query;
   if(cb&&bot==='joining'){const m=String(cb.data||'').match(/^ja:(JA-[0-9A-F]{12}):(approve|reject)$/);if(!m||!cb.from?.id){callback={bot,id:cb.id,text:'Unknown action'};return;}
    const actor=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(cb.from.id)])).rows[0]?.actor;
    const row=(await db.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1 FOR UPDATE",[m[1]])).rows[0];
    if(!row){callback={bot,id:cb.id,text:'Request not found'};return;}
    const d=row.data;if(!actor||!(d.approvers||[]).includes(actor)){callback={bot,id:cb.id,text:'You are not an approver for this request'};return;}
    if(d.status!=='PENDING'){callback={bot,id:cb.id,text:`Already ${d.status.toLowerCase()} by ${d.approvedBy||'-'}`};return;}
    if(new Date(d.expires)<new Date()){callback={bot,id:cb.id,text:'Request expired – HR must resend'};return;}
    const approve=m[2]==='approve';Object.assign(d,{status:approve?'APPROVED':'REJECTED',approvedBy:actor,approvedAt:new Date().toISOString(),otpHash:null});
    await db.query("UPDATE hr_records SET data=$2,status=$3,updated_at=now() WHERE kind='joiningApprovals' AND code=$1",[m[1],d,d.status]);
    await queueTelegram(db,`joining:${m[1]}:done`,d.approvers||[],`${approve?'✅':'❌'} Joining of ${d.candidate||'candidate'} ${approve?'approved':'rejected'} by ${actor}.`,'joining');
    callback={bot,id:cb.id,text:approve?'Approved':'Rejected'};return;}
   const msg=update.message;if(msg?.chat?.type!=='private'||!msg.from?.id||String(msg.chat.id)!==String(msg.from.id))return;
   const token=String(msg.text||'').match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/)?.[1];
   if(!token){if(bot==='joining'&&/^\/start/.test(String(msg.text||''))){const known=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(msg.from.id)])).rows[0];if(known){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot='joining' AND state IN ('PENDING','FAILED')",[known.actor]);await queueTelegram(db,'joining-start:'+update.update_id,[known.actor],'Connected. Joining approval requests from Caliber HR will appear here.','joining');}}if(bot==='trial'&&/^\/start/.test(String(msg.text||''))){const known=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(msg.from.id)])).rows[0];if(known){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot='trial' AND state IN ('PENDING','FAILED')",[known.actor]);await queueTelegram(db,'trial-start:'+update.update_id,[known.actor],'Connected. Vehicle trial results from Caliber HR will appear here.','trial');}}return;}
   const link=(await db.query('DELETE FROM hr_telegram_link_tokens WHERE hash=$1 AND expires_at>now() RETURNING actor',[hash(token)])).rows[0];if(!link)return;
   const taken=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 OR chat_id=$1',[String(msg.from.id)])).rows[0];if(taken&&taken.actor!==link.actor)return;
   await db.query('INSERT INTO hr_telegram_accounts(actor,chat_id,telegram_user_id) VALUES($1,$2,$2) ON CONFLICT(actor) DO UPDATE SET chat_id=$2,telegram_user_id=$2,linked_at=now()',[link.actor,String(msg.from.id)]);
   await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND state IN ('PENDING','FAILED')",[link.actor]);
   await queueTelegram(db,'linked:'+update.update_id,[link.actor],bot==='trial'?'Connected. Vehicle trial results from Caliber HR will appear here.':bot==='joining'?'Connected. Joining approval requests from Caliber HR will appear here.':'Your Telegram account is connected to Caliber HR. Leave notifications will appear here.',bot);
  });if(callback)await answerCallback(callback.bot,callback.id,callback.text);return {ok:true};
 }
 };
}
const telegramError=result=>Object.assign(new Error('Telegram delivery failed'),{code:result.error_code===401?'BAD_TOKEN':result.error_code===403||/chat not found/i.test(result.description||'')?'NOT_STARTED':'FAILED',description:result.description});
export async function deliverTelegram(pool,send=async(chat,text,bot='leave',markup=null,files=[])=>{
 const token=botToken(bot);if(!token)throw Object.assign(new Error('Bot not configured'),{code:'NO_BOT'});
 for(const part of splitTelegram(text)){const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:part,...(markup?{reply_markup:markup}:bot==='leave'?{reply_markup:{inline_keyboard:[[{text:'Open HRMS',url:'https://hrpulse.cmll.in/#Employee%20Master'}]]}}:{})}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!result.ok)throw telegramError(result);}
 for(const f of files){const form=new FormData();form.append('chat_id',String(chat));if(f.caption)form.append('caption',String(f.caption).slice(0,1000));form.append('document',new Blob([f.data],{type:f.mime||'application/octet-stream'}),f.name||'file');
  const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!result.ok)throw telegramError(result);}
}){
 if(!process.env.TELEGRAM_BOT_TOKEN&&!process.env.TELEGRAM_TRIAL_BOT_TOKEN&&!process.env.TELEGRAM_JOINING_BOT_TOKEN)return;
 const db=await pool.connect();try{
  await db.query('BEGIN');
  const jobs=(await db.query("SELECT o.*,a.chat_id FROM hr_telegram_outbox o LEFT JOIN hr_telegram_accounts a ON a.actor=o.actor WHERE o.state='PENDING' AND o.next_attempt<=now() ORDER BY o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED")).rows;
  for(const job of jobs){
   if(!job.chat_id){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now()+interval '5 minutes',last_error='Recipient has not connected Telegram' WHERE id=$1",[job.id]);continue;}
   try{const files=job.files?.length?(await db.query('SELECT name,mime,data,caption FROM hr_telegram_files WHERE id = ANY($1) ORDER BY id',[job.files])).rows:[];await send(job.chat_id,job.message,job.bot||'leave',job.markup||null,files);await db.query("UPDATE hr_telegram_outbox SET state='SENT',sent_at=now(),last_error=NULL WHERE id=$1",[job.id]);}
   catch(error){const reason=error?.code==='NO_BOT'?`${botLabel(job.bot)} is not configured on the server`:error?.code==='BAD_TOKEN'?`${job.bot==='trial'?'TELEGRAM_TRIAL_BOT_TOKEN':job.bot==='joining'?'TELEGRAM_JOINING_BOT_TOKEN':'TELEGRAM_BOT_TOKEN'} is wrong – Telegram rejected it`:error?.code==='NOT_STARTED'?`Recipient must open @${botUsername(job.bot)||job.bot+' bot'} and tap Start`:`Delivery failed${error?.description?': '+error.description:'; recipient may have blocked the bot'}`;
    await db.query("UPDATE hr_telegram_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=9 THEN 'FAILED' ELSE 'PENDING' END,next_attempt=now()+interval '5 minutes',last_error=$2 WHERE id=$1",[job.id,reason]);}
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
