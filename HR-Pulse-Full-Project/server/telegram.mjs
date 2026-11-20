import {buildPdf} from './pdf.mjs';
import {hierarchyTemplates,currentHierarchy,withOfficeHr,withDriverTrainer} from './joining-hierarchy.mjs';
import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {grantedMenus} from './modules.mjs';
import {assignedSites} from './scope.mjs';
import {trialReviewStage} from './trial-review.mjs';
import {nagpurRecipients} from './employee-addition-bot.mjs';
import {additionRoster,connectInviteMessage} from './addition-roster.mjs';
import {withTrialRouting} from './trial-routing.mjs';
import {trialAccess,requireTrialRole,canReadTrial,trialSite,assignedTrialSites} from './trial-access.mjs';
import {trialStatusRoster,trialStatusInvite,TRIAL_STATUS_CONNECTED,TRIAL_STATUS_WELCOME} from './trial-status-bot.mjs';
import {leaveSteps,leaveRequestRoster,leaveRequestInvite,leaveOtpNeededMessage,LEAVE_REQUEST_CONNECTED,LEAVE_REQUEST_ALREADY,LEAVE_REQUEST_WELCOME} from './leave-request-bot.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const username=value=>String(value||'').trim().toLowerCase();
export const telegramUsers=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(username).filter(Boolean))];
export function validateTelegramHierarchy(input){
 const regionalUsers=telegramUsers(input.regionalHr),directors=telegramUsers(input.directors),valid=x=>/^[-a-z0-9_.@]{1,100}$/.test(x);
 /* Leave flow (owner, 20 Nov 2026): one route for every site and office – Employee → HOD (concerned) → Directors (OTP) → Regional HR (final). */
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
 const siteUsers=telegramUsers(input.siteHr).filter(valid);
 return {type,hods,hrManager:'',pm:'',siteHr:siteUsers.join(','),regionalHr:regionalUsers.join(','),directors,enabled:input.enabled===true};
}
/* OD flow. office: Employee → HOD (concerned) → Regional HR. site: HR Manager initiates → HOD (concerned) → Regional HR. */
export function validateOdHierarchy(input){
 const valid=x=>/^[-a-z0-9_.@]{1,100}$/.test(x),type=input.type==='office'?'office':'site',regionalUsers=telegramUsers(input.regionalHr);
 const hods={};for(const [department,user] of Object.entries(input.hods&&typeof input.hods==='object'?input.hods:{})){const d=String(department).trim().slice(0,80),u=String(user||'').trim().toLowerCase();if(!d||!u)continue;if(!valid(u))fail(`Enter a valid Pulse username for the HOD of ${d}.`);hods[d]=u;}
 if(!Object.keys(hods).length)fail('Enter the HOD (concerned) Pulse username for at least one department.');
 if(!regionalUsers.length||regionalUsers.length>20||!regionalUsers.every(valid))fail('Enter 1–20 valid comma-separated Pulse usernames for Regional HR.');
 const hrManager=String(input.hrManager||'').trim().toLowerCase();if(type==='site'&&!valid(hrManager))fail('Enter the site HR Manager Pulse username (who raises OD requests).');
 const gateUsers=String(input.gateSecurity||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);if(gateUsers.length>20||!gateUsers.every(valid))fail('Enter up to 20 valid comma-separated Pulse usernames for gate security.');
 return {type,hods,hrManager:type==='site'?hrManager:'',regionalHr:regionalUsers.join(','),gateSecurity:gateUsers.join(','),enabled:input.enabled===true};
}
/* The site's OD flow when enabled (independent of the leave route being enabled). */
export async function odSiteFlow(db,siteId){if(!siteId)return null;const row=(await db.query('SELECT h.data,s.code FROM hr_telegram_hierarchies h JOIN hr_records s ON s.id=h.site_id WHERE site_id=$1',[siteId])).rows[0];return row?.data?.od?.enabled?{...row.data.od,siteCode:row.code}:null;}
/* Approval steps for one request. department = the employee's department name (HOD concerned); requester = who raises it. */
export function telegramSteps(config,department='',requester=''){
 if(!config.hods||!Object.keys(config.hods).length)return [{stage:1,label:`${config.firstRole||'Site HR'} — any one`,approvers:telegramUsers(config.siteHr)},{stage:2,label:'Regional HR — final approval, any one',approvers:telegramUsers(config.regionalHr)}];   /* legacy route */
 const key=Object.keys(config.hods).find(k=>k.toLowerCase()===String(department||'').trim().toLowerCase()),hod=key?config.hods[key]:config.hods['*'];
 if(!hod)fail(`Configure the HOD (concerned) for the ${department||'employee\'s'} department in the leave hierarchy before submitting.`,409);
 return leaveSteps(config,hod,requester);
}
export async function telegramLeaveFlow(db,siteId){const row=(await db.query('SELECT h.data,s.code FROM hr_telegram_hierarchies h JOIN hr_records s ON s.id=h.site_id WHERE site_id=$1',[siteId])).rows[0];return row?.data.enabled?{...row.data,siteCode:row.code,type:row.data.type||(['CMLL-CO','CMLL-HO'].includes(row.code)?'office':'site'),firstRole:row.data.hods?'HOD (concerned)':(['CMLL-CO','CMLL-HO'].includes(row.code)?'HOD':'Site HR')}:null;}
/* Registers the Vehicle Trial Result bot's webhook with Telegram at startup (the API host can reach api.telegram.org). */
export async function registerBotWebhook(bot,fetchImpl=fetch,logger=console){
 const token=botToken(bot),secret=botSecret(bot),base=process.env.API_PUBLIC_URL||'https://hr-api-cmll-783.azurewebsites.net';
 if(!token||!secret)return {skipped:true};
 const workflowChat=workflowChatIds.includes(bot);
 try{const response=await fetchImpl(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:`${base}/api/telegram/${bot}-webhook`,secret_token:secret,allowed_updates:workflowChat&&bot!=='trial-status'?['message']:['message','callback_query'],drop_pending_updates:bot!=='mt'&&!workflowChat}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();logger.log?.(`${botLabel(bot)} webhook: ${result.ok?'registered':'failed – '+result.description}`);return result;}
 catch(error){logger.error?.(`${botLabel(bot)} webhook registration failed`,error instanceof Error?error.message:error);return {ok:false};}
}
export const registerTrialWebhook=(fetchImpl=fetch,logger=console)=>registerBotWebhook('trial',fetchImpl,logger);
export const registerJoiningWebhook=(fetchImpl=fetch,logger=console)=>registerBotWebhook('joining',fetchImpl,logger);
export const registerNagpurWebhook=(fetchImpl=fetch,logger=console)=>registerBotWebhook('nagpur',fetchImpl,logger);
export async function seedTelegram(db){
 const data={siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true};
 await db.query("INSERT INTO hr_telegram_hierarchies(site_id,data,updated_by) SELECT id,$1,'initial-configuration' FROM hr_records WHERE kind='sites' AND code='NCL-JAYANT' ON CONFLICT DO NOTHING",[data]);
}
/* Trial-result recipients: a Pulse user already connected to the leave bot (actor) or a phone linked via the trial connect link. */
export const DEFAULT_TRIAL_RECIPIENTS=[{name:'Apurva Kopulwar',phone:'8087477229',actor:'apurvakopulwar'},{name:'Arjun Keshri',phone:'',actor:'arjunkeshri'},{name:'Mayuri Umate',phone:'',actor:'mayuriumate'}];
/* Recipients that are always included even after the list is edited in the app. */
const ALWAYS_TRIAL_ACTORS=['apurvakopulwar','arjunkeshri','mayuriumate'];
export const recipientActor=r=>r.actor||('trial:'+r.phone);
/* Rule (owner, 20 Nov 2026): the user who submits or approves a trial form is never sent that message;
   it goes only to the next assigned users. */
export const notSender=actor=>recipient=>String(recipient||'').replace(/^trial:/,'').trim().toLowerCase()!==String(actor||'').trim().toLowerCase();
/* A recipient's scope is a comma list of site names / codes and groups (region, company, employee group), e.g. "Jayant OB East, NCL".
   Empty or "ALL" = every site. A message for a site goes only to recipients whose scope names that site or one of its groups. */
const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
export function recipientInScope(r,target){const scope=String(r.scope||'').split(',').map(norm).filter(Boolean);if(!scope.length||scope.includes('all'))return true;
 const keys=[target?.site,target?.siteCode,target?.region,target?.company,target?.group].map(norm).filter(Boolean);return scope.some(x=>keys.some(k=>k===x||k.startsWith(x+' ')||x.startsWith(k+' ')));}
export const scopedRecipients=(list,target)=>target?list.filter(r=>recipientInScope(r,target)):list;
const HIERARCHY_STEPS={part1:['Driver Trainer'],result:['Project Manager'],ohr:['Office HR — either one'],rhr:['HR Manager — either one'],director:['Final approval — any one'],siteHr:['HR Manager'],
 all:['HR Manager','Project Manager','Driver Trainer','Office HR — either one','HR Manager — either one','Final approval — any one']};
const trialSiteAliases={
 'NCL-DUDE':['Dudichua OB East','Dhudhichua OB East'],
 'NCL-DUDW':['Dudichua OB West','Dhudhichua OB West'],
 'WCL-DHOPTALA':['Dhoptala OB 2nd'],
 'WCL-GAURI':['Gauri Pauni OB 2nd'],
 'WCL-LALPETH':['Lalpeth OB'],
 'CMLL-CO':['Nagpur CO','Nagpur Corporate Office'],
 'CMLL-HO':['Chandrapur Head Office'],
};
function trialHierarchySite(target){
 const site=norm(target.site);
 // Region is the hierarchy group. Older requests may carry only the site or employee category.
 const selectedGroup=norm(target.region)||norm(target.group);
 const group=({'nagpur corporate office':'corporate office','chandrapur head office':'chandrapur ho'})[selectedGroup]||selectedGroup;
 return hierarchyTemplates.find(template=>{
  const matchesGroup=!group||['ob / coal','corporate / ho'].includes(group)||group===norm(template.group);
  return matchesGroup&&[template.code,template.name,...(trialSiteAliases[template.code]||[])].some(name=>norm(name)===site);
 });
}
export async function hierarchyRecipients(db,stage,target){
 const site=target&&trialHierarchySite(target);
 if(target&&!site)return [];
 const rows=(await db.query("SELECT code,data FROM hr_records WHERE kind='joiningHierarchies' AND status='ACTIVE'")).rows;
 const labels=HIERARCHY_STEPS[stage]||[];
 const recipients=[];
 for(const template of site?[site]:hierarchyTemplates){
  const saved=rows.find(row=>row.code===template.code);
  const data=withTrialRouting(withOfficeHr(withDriverTrainer(currentHierarchy(saved?.data))));
  const seen=new Set();
  for(const step of data?.steps||[]){
   if(!labels.includes(step.label))continue;
   for(const username of step.approvers||[]){
    const actor=norm(username);
    if(!actor||seen.has(actor))continue;
    seen.add(actor);
    recipients.push({actor,name:actor,phone:'',scope:template.name,site:template.name,role:step.label,source:'hierarchy'});
   }
  }
 }
 return recipients;
}
export async function trialTrainerFor(db,target){
 const list=await hierarchyRecipients(db,'part1',target);
 if(!list.length)return {actor:'',name:'',site:String(target?.site||''),reason:'Assign a Driver Trainer in the active site hierarchy.',trainers:[]};
 const trainers=[];
 for(const trainer of list){
  const employee=(await db.query("SELECT name FROM hr_records WHERE kind='employees' AND status IN ('ACTIVE','APPROVED') AND lower(COALESCE(data->>'pulseUsername',data->>'username',''))=$1 ORDER BY updated_at DESC LIMIT 1",[trainer.actor])).rows[0];
  trainers.push({actor:trainer.actor,name:String(employee?.name||trainer.actor).trim()});
 }
 return {...trainers[0],site:list[0].site||String(target?.site||''),trainers};
}
/* Owner, 20 Nov 2026: with two or more Driver Trainers each one ticks Yes or No; PASS only when every trainer says Yes. */
export function trainerVotesProblem(fields){
 const votes=String(fields?.['Trainer votes']||'');
 if(votes&&fields?.Result==='PASS'&&/:\s*NO\b/.test(votes))return 'A Driver Trainer said No – the result must be FAIL.';
 return '';
}
/* Manual list (scoped) + hierarchy for a site, de-duplicated by actor. */
export async function trialRecipientsFor(db,stage,target){const manual=scopedRecipients(await trialRecipients(db,stage),target),auto=await hierarchyRecipients(db,stage,target);const seen=new Set(manual.map(recipientActor));return [...manual,...auto.filter(r=>!seen.has(r.actor))];}
/* stage 'result' = Part 2 result messages (default list); stage 'part1' = "Trial Form Submitted" messages to the driver trainer. */
export async function trialRecipients(db,stage='result'){const row=(await db.query("SELECT data FROM hr_records WHERE kind='trialForms' AND code='SETTINGS'")).rows[0];const d=row?.data||{};if(stage==='part1')return Array.isArray(d.part1Recipients)?d.part1Recipients:[];const saved=d.recipients||[];const merged=[...saved];for(const x of DEFAULT_TRIAL_RECIPIENTS)if(ALWAYS_TRIAL_ACTORS.includes(x.actor)&&!merged.some(r=>r.actor===x.actor))merged.push(x);return merged;}
const fmtDate=v=>{if(!v)return '';const d=new Date(v);if(Number.isNaN(d.valueOf())){const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(v);}return d.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');};
const vehicleOf=f=>[f['Vehicle / equipment for trial'],f['Other equipment']].filter(Boolean).join(', ').replace(/Dumper\/Tipper/,'Dumper / Tipper');
const dash=v=>String(v??'').trim()||'–';
/* Part 1 – "Trial Form Submitted" (single candidate) */
/* The same Part 1 form sent again (a retry) keeps its number; a different form already holding that number does not. */
export function sameTrialSubmission(saved,next){
 if(!saved)return false;
 if(saved.site&&trialSite(saved.site)?.code!==trialSite(next.site)?.code)return false;
 if(['PASS','FAIL'].includes(saved.fields?.Result)||saved.stage&&saved.stage!=='PART1')return false;
 if(saved.clientId&&next.clientId)return saved.clientId===next.clientId;
 const key=f=>String(f?.['Name of candidate']||'').trim().toLowerCase()+'|'+String(f?.['Mobile no.']||'').replace(/\D/g,'');
 return key(saved.fields)===key(next.fields);
}
/* Next unused number in the same series, e.g. TF/2026-27/0001 → TF/2026-27/0007 when 0006 is the highest saved. */
export async function nextFreeTrialNumber(db,formNo){
 const match=String(formNo).match(/^(.*\/)(\d+)$/),prefix=match?match[1]:String(formNo)+'/',width=Math.max(4,match?.[2].length||0);
 const like=prefix.replace(/[\\%_]/g,c=>'\\'+c)+'%';
 const codes=(await db.query("SELECT code FROM hr_records WHERE kind IN ('trialForms','trialWorkflow') AND code LIKE $1",[like])).rows.map(row=>String(row.code));
 const last=Math.max(0,...codes.map(code=>code.slice(prefix.length)).filter(rest=>/^\d+$/.test(rest)).map(Number));
 return prefix+String(last+1).padStart(width,'0');
}
export function trialSubmittedMessage(record){const f=record.fields||{};return ['🚛 VEHICLE TRIAL RESULT','','Trial Form Submitted',`Name: ${dash(f['Name of candidate'])}`,`Post: ${dash(f['Post applied for']||record.department)}`,`Vehicle: ${dash(vehicleOf(f))}`,`Experience: ${dash(f['Total experience (years)'])}`,`Referred by: ${dash(f['Referred by'])}`,`Trial date: ${dash(fmtDate(f['Trial date & time']))}`,`Form No: ${record.formNo}`,`Trial by: ${dash(record.trialBy||'driver trainer')}`,'Status: Sent to driver trainer',`Site: ${dash(record.site||record.heading)}`].join('\n');}
/* Part 1 – batch */
export function trialBatchSubmittedMessage(batch,records){const first=records[0]?.fields||{};const lines=['🚛 VEHICLE TRIAL RESULT','',`Trial Forms Submitted – Batch ${batch.batchId} (${records.length} candidate${records.length===1?'':'s'})`,`Trial date: ${dash(fmtDate(batch.trialDate||first['Trial date & time']))} · Site: ${dash(batch.site)} · Trial by: ${dash(batch.trialBy||'driver trainer')}`,'Status: Sent to driver trainer',''];
 records.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['Post applied for']||r.department)} – ${dash(vehicleOf(f))} – ${r.formNo}`);});lines.push('','📎 Batch sheet attached (PDF)');return lines.join('\n');}
/* Part 2 – batch result */
export function trialBatchResultMessage(batch,records,attachments){const passed=records.filter(r=>r.fields?.Result==='PASS'),failed=records.filter(r=>r.fields?.Result!=='PASS');const first=records[0]?.fields||{};
 const lines=[`🚛 BULK VEHICLE TRIAL RESULT – ${batch.batchId}`,`Site: ${dash(batch.site).toUpperCase()}`,`Trial date: ${dash(fmtDate(batch.trialDate||first['Trial date & time']))}`,`Vehicle: ${dash(batch.vehicle||vehicleOf(first))}   Post: ${dash(batch.post||first['Post applied for'])}`,`Trial by: ${dash(batch.trialBy)}`,`Total: ${records.length}  ✅ PASS ${passed.length}  ❌ FAIL ${failed.length}`,'','✅ PASSED'];
 if(passed.length)passed.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['Post applied for']||r.department)}, ${dash(f['Total experience (years)'])} yrs, Ref: ${dash(f['Referred by'])}`);});else lines.push('–');
 lines.push('','❌ FAILED');if(failed.length)failed.forEach((r,i)=>{const f=r.fields||{};lines.push(`${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['If FAIL – reason'])}`);});else lines.push('–');
 const a=typeof attachments==='object'&&attachments?attachments:null;
 lines.push('',a?`📎 Attachments: ${[a.passed?'PASS list (PDF + Excel)':'',a.failed?'FAIL list (PDF + Excel)':''].filter(Boolean).join(' · ')||'none'}`:`📎 Attachments: ${attachments} file(s) + Excel result sheet`);return lines.join('\n');}
const ROLE_TITLE={pm:'PM Sir',ohr:'Office HR',rhr:'Regional HR',director:'Directors'};
const NEXT_STATUS={pm:'Sent to Office HR for approval',ohr:'Sent to Regional HR for approval',rhr:"Waiting for Directors' OTP – Office HR to request it"};
const approvedOn=(history,role)=>{const h=(history||[]).find(x=>x.role===role&&/approv/i.test(x.action||''));return h?fmtDate(h.at):'';};
const fmtDateTime=v=>{const d=new Date(v);return Number.isNaN(d.valueOf())?'':`${fmtDate(v)}, ${d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}`;};
const candidateLines=(r)=>{const f=r.fields||{};return [`Result: ${f.Result==='PASS'?'✅ PASS':'❌ FAIL'}`,`Name: ${dash(f['Name of candidate'])}`,`Post: ${dash(f['If PASS – recommended for']||f['Post applied for']||r.department)}`,`Vehicle: ${dash(f['Machine']||vehicleOf(f))}`,`Experience: ${dash(f['Total experience (years)'])}`,`Referred by: ${dash(f['Referred by'])}`,`Trial date: ${dash(fmtDate(f['Trial date & time']))}`,`Form No: ${r.formNo}`,`Trial by: ${dash(r.trialBy||f['Examiner name'])}`,...(f['Trainer votes']?[`Trainer votes: ${f['Trainer votes']}`]:[])];};
const docLine=r=>{const d=r.docs||{};const mark=k=>d[k]==='Yes'?'✓':'✗';return `Documents: Aadhaar ${mark('aadhaar')}  DL ${mark('dl')}  Medical ${mark('medical')}`;};
/* Stage approval messages (PM → Office HR → Regional HR → Directors) */
export function trialApprovalMessage(r,reviewer,decision){const {approved,note,at}=decision;const h=r.history||[];
 if(!approved)return [`❌ REJECTED BY ${ROLE_TITLE[reviewer].toUpperCase()}`,'',...candidateLines(r),`Rejected by: ${ROLE_TITLE[reviewer]}`,`Rejected on: ${fmtDateTime(at)}`,`Reason: ${dash(note)}`,'Status: ❌ Rejected – trial closed',`Site: ${dash(r.site)}`].join('\n');
 const prior=[];if(['ohr','rhr','director'].includes(reviewer))prior.push(`Approved by PM Sir: ${dash(approvedOn(h,'pm'))}`);if(['rhr','director'].includes(reviewer))prior.push(`Approved by Office HR: ${dash(approvedOn(h,'ohr'))}`);if(reviewer==='director')prior.push(`Approved by Regional HR: ${dash(approvedOn(h,'rhr'))}`);
 const head=reviewer==='director'?'🎉 FINAL APPROVAL – DIRECTORS':`✅ APPROVED BY ${ROLE_TITLE[reviewer].toUpperCase()}`;
 const lines=[head,'',...candidateLines(r),...prior,`Approved by: ${ROLE_TITLE[reviewer]}`,`Approved on: ${fmtDateTime(at)}`];
 if(reviewer==='ohr')lines.push(docLine(r));
 if(note)lines.push(`Remark: ${note}`);
 if(reviewer==='director')lines.push('Joining: Report to Site HR with original documents','Status: ✅ CLEARED TO JOIN');else lines.push(`Status: ${NEXT_STATUS[reviewer]}`);
 lines.push(`Site: ${dash(r.site)}`);return lines.join('\n');}
const JOIN_STEPS=['1. Joining date & employee code','2. Bank account details','3. PF (UAN) & ESIC details','4. Nominee & emergency contact','5. Form B register entry','6. VTC / induction training','7. PPE issue & ID card / gate pass'];
const approvedByBlock=h=>['Approved by:',`✅ PM Sir – ${dash(approvedOn(h,'pm'))}`,`✅ Office HR – ${dash(approvedOn(h,'ohr'))}`,`✅ Regional HR – ${dash(approvedOn(h,'rhr'))}`,`✅ Directors – ${dash(approvedOn(h,'director'))}`];
export function joiningApprovedMessage(r){const f=r.fields||{};const name=dash(f['Name of candidate']);const he=/female/i.test(f.Gender||'')?'She':'He';
 return ['📢 JOINING APPROVED – CLEARED TO JOIN','','Dear All,',`${name} has passed the vehicle trial and is approved by PM Sir, Office HR, Regional HR and Directors. ${he} is cleared to join the organisation.`,'',`Name: ${name}`,`Post: ${dash(f['If PASS – recommended for']||f['Post applied for']||r.department)}`,`Vehicle: ${dash(f['Machine']||vehicleOf(f))}`,`Form No: ${r.formNo}`,`Trial date: ${dash(fmtDate(f['Trial date & time']))}`,`Site: ${dash(r.site)}`,'',...approvedByBlock(r.history),'','📝 Action – Site HR','Please complete the remaining joining entries:',...JOIN_STEPS,'','Please update here once joining is complete.','Status: ✅ CLEARED TO JOIN'].join('\n');}
export function bulkJoiningApprovedMessage(batchId,rows){const first=rows[0]||{};const f0=first.fields||{};
 return ['📢 BULK JOINING APPROVED – CLEARED TO JOIN','','Dear All,',`The following ${rows.length} candidates have passed the vehicle trial and are approved by PM Sir, Office HR, Regional HR and Directors. They are cleared to join the organisation.`,'',`Batch: ${batchId}`,`Trial date: ${dash(fmtDate(f0['Trial date & time']))}`,`Site: ${dash(first.site)}`,'',`✅ Cleared to join (${rows.length})`,...rows.map((r,i)=>{const f=r.fields||{};return `${i+1}. ${dash(f['Name of candidate'])} – ${dash(f['If PASS – recommended for']||f['Post applied for']||r.department)}, ${dash(f['Machine']||vehicleOf(f))}`;}),'',...approvedByBlock(first.history),'','📝 Action – Site HR','Please complete the remaining joining entries for each candidate (see attached Excel):',...JOIN_STEPS,'','Fill the pending columns in the Excel and send it back here once joining is complete.',`Status: ✅ CLEARED TO JOIN – ${rows.length} candidates`].join('\n');}
/* Trial form / joining approval PDF (one candidate) */
const TRIAL_PDF_FIELDS=['Name of candidate',"Father's name",'Date of birth / Age','Mobile no.','Aadhaar no.','Address','Post applied for','Vehicle / equipment for trial','Driving licence no.','DL class details','DL issue date','DL valid up to dates','Total experience (years)','Previous employer','Trial date & time','Referred by','Trial Conducted by','Result','If PASS – recommended for','Machine','If FAIL – reason','Examiner name','Trainer votes','Examiner remarks'];
export function trialFormPdf(r,title){const f=r.fields||{};const rows=TRIAL_PDF_FIELDS.map(k=>[k,f[k]||'']);const h=r.history||[];for(const role of ['pm','ohr','rhr','director']){const d=approvedOn(h,role);if(d)rows.push([`Approved by ${ROLE_TITLE[role]}`,d]);}
 return buildPdf({title:`${title} – ${r.formNo}`,subtitle:[`${r.company||'Caliber Mining & Logistics'} · Site: ${r.site||'-'} · Status: ${r.status||''}`],columns:[{label:'Field',width:160},{label:'Value',width:440}],rows,footer:'Generated by HR Pulse'});}
const newBatchId=()=>{const d=new Date();return 'B'+String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'-'+randomBytes(2).toString('hex').toUpperCase();};
const cleanFields=f=>Object.fromEntries(Object.entries(f&&typeof f==='object'?f:{}).slice(0,80).map(([k,v])=>[String(k).slice(0,80),String(v??'').slice(0,500)]));
const cleanAttachments=list=>(Array.isArray(list)?list:[]).slice(0,8).map(a=>({name:String(a?.name||'file').slice(0,120),mime:String(a?.mime||'application/octet-stream').slice(0,80),kind:['photo','trialResult','drivingVideo','aadhaar','drivingLicence'].includes(a?.kind)?a.kind:'',data:String(a?.data||'').replace(/^data:[^,]*,/,'').slice(0,4*1024*1024)})).filter(a=>a.data);
export const keepTrialDocuments=(oldList,nextList)=>{const next=cleanAttachments(nextList),old=cleanAttachments(oldList);for(const kind of ['aadhaar','drivingLicence'])if(!next.some(file=>file.kind===kind)){const file=old.find(item=>item.kind===kind);if(file)next.push(file);}return next;};
export function requireTrialUploads(attachments){
 if(!attachments.some(file=>file.kind==='trialResult'))fail('Upload the trial result file before submitting.');
 if(!attachments.some(file=>file.kind==='drivingVideo'))fail('Upload the driving video before submitting.');
}
const recipientIssues=async(pool,recipients)=>{const connected=(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE ${trialConnectedSql()} AND actor = ANY($2)`,[mtEnabled(),recipients])).rows.map(r=>r.actor.replace(/^trial:/,''));const pendingNote=(await pool.query("SELECT actor,last_error FROM hr_telegram_outbox WHERE bot IN ('trial','trial-status') AND state<>'SENT' AND last_error IS NOT NULL AND actor = ANY($1) ORDER BY id DESC LIMIT 5",[recipients])).rows;return {recipients:recipients.length,connected,bot:trialUsername(),configured:trialConfigured(),issues:pendingNote.map(r=>`${r.actor.replace(/^trial:/,'')}: ${r.last_error}`)};};
/* Telegram text for a saved trial form – matches the agreed format. */
export function trialResultMessage(record,enteredBy){const f=record.fields||{},pass=f['Result']==='PASS';const date=fmtDate(f['Trial date & time']);
 const vehicle=vehicleOf(f),post=(pass?f['If PASS – recommended for']:'')||f['Post applied for']||record.department||'Driver / Operator';
 const lines=['🚛 VEHICLE TRIAL RESULT','',`Result: ${pass?'✅ PASS':'❌ FAIL'}`,`Name: ${dash(f['Name of candidate'])}`,`Post: ${post}${pass&&f['Machine']?' – '+f['Machine']:''}`,`Vehicle: ${dash(vehicle)}`,`Experience: ${dash(f['Total experience (years)'])}`,`Referred by: ${dash(f['Referred by'])}`,`Trial date: ${dash(date)}`,`Form No: ${record.formNo}`,`Trial by: ${dash(record.trialBy||f['Examiner name']||enteredBy)}`];
 if(f['Trainer votes'])lines.push(`Trainer votes: ${f['Trainer votes']}`);
 if(!pass)lines.push(`Reason for fail: ${dash(f['If FAIL – reason'])}`);
 lines.push('Status: Sent to PM for approval',`Site: ${dash(record.site||record.heading)}`);return lines.join('\n');}
export async function queueTelegram(db,eventKey,actors,message,bot='leave',markup=null,files=[]){
 const ids=[];for(const f of files||[]){if(!f?.data)continue;const data=Buffer.isBuffer(f.data)?f.data:Buffer.from(String(f.data).replace(/^data:[^,]*,/,''),'base64');if(!data.length||data.length>45*1024*1024)continue;ids.push((await db.query('INSERT INTO hr_telegram_files(event_key,name,mime,data) VALUES($1,$2,$3,$4) RETURNING id',[eventKey,String(f.name||'file').slice(0,120),String(f.mime||'application/octet-stream').slice(0,80),data])).rows[0].id);}
 for(const actor of new Set(actors.flatMap(telegramUsers)))await db.query('INSERT INTO hr_telegram_outbox(event_key,actor,message,bot,markup,files) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[eventKey,actor,message,bot,markup?JSON.stringify(markup):null,ids.length?JSON.stringify(ids):null]);}
/* Telegram text limit is 4096 chars: long batch messages are split at line breaks. */
export function splitTelegram(text,max=4000){const parts=[];let cur='';for(const line of String(text).split('\n')){if((cur+'\n'+line).length>max&&cur){parts.push(cur);cur=line;}else cur=cur?cur+'\n'+line:line;}if(cur)parts.push(cur);return parts;}
/* Bots: 'leave' = leave/approvals bot (TELEGRAM_BOT_TOKEN); 'trial' = Vehicle Trial Result bot (TELEGRAM_TRIAL_BOT_TOKEN). */
const workflowChats={
 'trial-status':{title:'Trial Status',workflow:'trial',settings:'TELEGRAM_TRIAL_STATUS'},
 'employee-track':{title:'Employee Track',workflow:'employee',settings:'TELEGRAM_EMPLOYEE_TRACK'},
 'leave-request':{title:'Leave Request',workflow:'leave',settings:'TELEGRAM_LEAVE_REQUEST'}
};
export const workflowChatIds=Object.keys(workflowChats);
const botSettings={leave:'TELEGRAM',trial:'TELEGRAM_TRIAL',joining:'TELEGRAM_JOINING',mt:'TELEGRAM_MT',nagpur:'TELEGRAM_NAGPUR',
 ...Object.fromEntries(Object.entries(workflowChats).map(([id,chat])=>[id,chat.settings]))};
export const botToken=bot=>process.env[`${botSettings[bot]||botSettings.leave}_BOT_TOKEN`];
export const botUsername=bot=>process.env[`${botSettings[bot]||botSettings.leave}_BOT_USERNAME`]||(bot==='nagpur'?'NagpurEmployeeAdditionBot':'');
export const botSecret=bot=>process.env[`${botSettings[bot]||botSettings.leave}_WEBHOOK_SECRET`]||(bot==='mt'||workflowChatIds.includes(bot)?undefined:process.env.TELEGRAM_WEBHOOK_SECRET);
export const botLabel=bot=>({'leave-request':'CALIBER Leave Request bot','trial-status':'CALIBER Trial Status bot',trial:'Vehicle Trial Result bot',joining:'Joining Approval bot',mt:'MT HR',nagpur:'Nagpur Employee Addition bot'})[bot]||'HR Pulse leave bot';
const mtEnabled=()=>Boolean(botToken('mt')&&botUsername('mt')&&botSecret('mt'));
const hrmsUrl='https://hrpulse.cmll.in/';
export const cmllHrEnabled=()=>mtEnabled()&&botUsername('mt').toLowerCase()==='cmllhrbot';
const mainBotConnectionColumn=()=>cmllHrEnabled()?'cmll_hr_connected':'mt_hr_enabled';
const workflowBot=bot=>cmllHrEnabled()?'mt':bot;
const workflowUsername=bot=>botUsername(workflowBot(bot));
const workflowConfigured=bot=>Boolean(botToken(workflowBot(bot)));
/* Vehicle trial messages: CALIBER Trial Status bot (@CMLLTrialStatusBot) once its token and username are set; before that the old route. */
export const trialStatusReady=()=>Boolean(botToken('trial-status')&&botUsername('trial-status'));
export const trialBot=()=>trialStatusReady()?'trial-status':'trial';
const trialUsername=()=>trialStatusReady()?botUsername('trial-status'):workflowUsername('trial');
const trialConfigured=()=>trialStatusReady()||workflowConfigured('trial');
const trialConnectedSql=()=>trialStatusReady()?'($1::boolean IS NOT NULL AND trial_status_connected)':`(($1::boolean AND ${mainBotConnectionColumn()}) OR trial_connected)`;
const trialStatusLink=async(db,actor)=>{const token=randomBytes(24).toString('base64url');
 await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='trial-status') OR expires_at<now()",[actor]);
 await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'trial-status',now()+interval '7 days')",[hash(token),actor]);
 return `https://t.me/${botUsername('trial-status')}?start=${token}`;};
/* Leave messages: CALIBER Leave Request bot (@CMLLLeaveRequestBot) once its token and username are set; before that the old leave route. */
export const leaveRequestReady=()=>Boolean(botToken('leave-request')&&botUsername('leave-request'));
export const leaveBot=()=>leaveRequestReady()?'leave-request':'leave';
/* A new link never cancels the person's older ones (owner, 20 Nov 2026): a link copied to WhatsApp and a link sent later both work
   until one of them is used or 7 days pass. */
const leaveRequestLink=async(db,actor)=>{const token=randomBytes(24).toString('base64url');
 await db.query("DELETE FROM hr_telegram_link_tokens WHERE expires_at<now()");
 await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'leave-request',now()+interval '7 days')",[hash(token),actor]);
 return `https://t.me/${botUsername('leave-request')}?start=${token}`;};
const trialSiteNames=()=>hierarchyTemplates.filter(t=>!t.code.startsWith('CMLL-')).map(t=>t.name);
async function cmllConnectLink(db,actor,minutes=10){
 const token=randomBytes(24).toString('base64url');
 await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'mt',now()+$3::integer*interval '1 minute')",[hash('cmll:'+token),actor,minutes]);
 return {url:`https://t.me/${botUsername('mt')}?start=${token}`,botUsername:botUsername('mt')};
}
const workflowUrl=workflow=>hrmsUrl+'?hrWorkflow='+workflow+'#Employee%20Master';
const workflowChatReady=bot=>Boolean(botUsername(bot)&&botToken(bot)&&botSecret(bot));
const mtMenu=()=>({inline_keyboard:cmllHrEnabled()?[
 ...workflowChatIds.map(bot=>[{text:workflowChats[bot].title,url:workflowChatReady(bot)?`https://t.me/${botUsername(bot)}?start=menu`:workflowUrl(workflowChats[bot].workflow)}]),
 [{text:'Link in HRMS',url:hrmsUrl+'#Telegram%20Hierarchy'}]
]:[
 [{text:'Leave & Approvals',url:hrmsUrl+'#Employee%20Master'}],
 [{text:'Vehicle Trial Results',callback_data:'mt:trial'}],
 [{text:'Joining Approval',callback_data:'mt:joining'}],
 [{text:'Link in HRMS',url:hrmsUrl+'#Telegram%20Hierarchy'}]
]});
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
/* Leave route (HOD → Directors by OTP → Regional HR): tell only the people of the step the leave now waits on, never the sender.
   At the Directors' step the OTP is requested by Regional HR, so Regional HR is told to request it. */
export async function queueLeaveStep(db,{key,record,steps,stage,siteName,sender,decision={}}){
 const step=steps[stage];if(!step)return [];
 const roleOf=s=>String(s?.label||'').replace(/ — .*/,'');
 if(step.otp){
  const to=(steps[stage+1]?.approvers||[]).filter(notSender(sender));
  await queueTelegram(db,key,to,leaveOtpNeededMessage({record,siteName,hod:decision.name||decision.actor}),leaveBot());return to;
 }
 const to=step.approvers.filter(notSender(sender));
 await queueTelegram(db,key,to,leaveMessage(record,stage?'PENDING':'SUBMITTED',{siteName,firstRole:roleOf(steps[0]),stageRole:roleOf(steps[stage-1]),nextRole:roleOf(step),...decision}),leaveBot());
 return to;
}
export async function employeeActor(db,employeeId,fallback='') {const r=(await db.query("SELECT data FROM hr_records WHERE id=$1 AND kind='employees'",[employeeId])).rows[0];return username(r?.data.pulseUsername||r?.data.username||fallback);}
export function webhookSecretValid(actual,expected){if(!expected||typeof actual!=='string')return false;const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}

/* ---- Joining approval (Employee Management › Joining & Personal Details): OTP on Telegram + Approve / Reject buttons ---- */
const JOINING_OTP_MINUTES=15,JOINING_OTP_ATTEMPTS=5;
export async function joiningApprovers(db){const row=(await db.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code='SETTINGS'")).rows[0];const d=row?.data||{};return {approvers:String(d.approvers||'').split(',').map(a=>a.trim().toLowerCase()).filter(Boolean),enabled:!!d.enabled};}
export function joiningApprovalMessage(d,otp){return `Joining approval request\nCandidate: ${d.candidate||'-'}\nPost: ${d.post||'-'}\nSite: ${d.site||'-'}\nCompany: ${d.company||'-'}\nSubmitted by: ${d.submittedBy||'-'}\n\nOTP: ${otp} (valid ${JOINING_OTP_MINUTES} min)\nTell the OTP to HR, or tap Approve / Reject below.`;}
const joiningMarkup=code=>({inline_keyboard:[[{text:'✅ Approve',callback_data:`ja:${code}:approve`},{text:'❌ Reject',callback_data:`ja:${code}:reject`}]]});
async function answerCallback(bot,id,text){const token=botToken(bot);if(!token)return;try{await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text,show_alert:false}),signal:AbortSignal.timeout(8000)});}catch{/* best effort */}}
/* ---- Telegram approval groups: one pending group per stage message; Approve / Decline buttons act on it ---- */
const STAGE_ROLE={result:'pm',ohr:'ohr',rhr:'rhr',director:'director'};   /* hierarchy step key → reviewer role */
const ROLE_STEP={pm:'result',ohr:'ohr',rhr:'rhr',director:'director'};
const NEXT_ROLE={pm:'ohr',ohr:'rhr',rhr:'director',director:'done'};
/* Owner, 20 Nov 2026: PM and Directors approve by OTP. Office HR requests it, they tell it to Office HR, who enters it. */
export const OTP_ROLES=['pm','director'];
const TRIAL_OTP_MINUTES=15,TRIAL_OTP_ATTEMPTS=5;
const approvalMarkup=(code,role)=>({inline_keyboard:[OTP_ROLES.includes(role)?[{text:'❌ Decline',callback_data:`ta:${code}:d`}]:[{text:'✅ Approve',callback_data:`ta:${code}:a`},{text:'❌ Decline',callback_data:`ta:${code}:d`}]]});
/* Owner, 20 Nov 2026: when a candidate passes, the site's Office HR is told on Telegram to request the PM's OTP. */
export function trialOhrAlertMessage({forms,site,trialBy}){
 return ['🔔 PM OTP NEEDED – OFFICE HR','',
  `${forms.length} candidate${forms.length===1?' has':'s have'} passed the vehicle trial and wait${forms.length===1?'s':''} for PM approval:`,
  ...forms.map((f,i)=>`${i+1}. ${dash(f.fields?.['Name of candidate'])} – ${f.formNo}`),'',
  `Trial by: ${dash(trialBy)}`,
  'Open HRMS › Trial Status › Approvals and press "Request OTP from PM". The PM gets the OTP on this bot; ask the PM for it and enter it in HRMS.',
  `Site: ${dash(site)}`].join('\n');
}
async function alertOfficeHr(db,{forms,target,trialBy,actor,key}){
 const passed=forms.filter(f=>f.fields?.Result==='PASS');if(!passed.length)return [];
 const to=[...new Set((await hierarchyRecipients(db,'ohr',target)).map(recipientActor))].filter(notSender(actor));
 if(to.length)await queueTelegram(db,key,to,trialOhrAlertMessage({forms:passed,site:target.site,trialBy}),trialBot());
 return to;
}
export function trialOtpMessage({reviewer,forms,otp,requestedBy,site}){
 return [`🔐 OTP FOR ${reviewer==='pm'?'PM APPROVAL':'FINAL APPROVAL – DIRECTORS'}`,'',
  ...forms.map((f,i)=>`${forms.length>1?(i+1)+'. ':''}${dash(f.fields?.['Name of candidate'])} – ${f.formNo} – ✅ PASS`),
  reviewer==='director'?'Approved so far: PM, Office HR, Regional HR':null,
  `Requested by: Office HR (${dash(requestedBy)})`,'',
  `OTP: ${otp} (valid ${TRIAL_OTP_MINUTES} min)`,
  `Tell this OTP to Office HR to ${reviewer==='pm'?'approve':'give final approval'}. Tap Decline below to refuse.`,
  `Site: ${dash(site)}`].filter(line=>line!==null).join('\n');
}
async function openApprovalGroup(db,{role,formNos,target,batchId,actor}){
 await db.query("UPDATE hr_records SET status='CLOSED',updated_at=now() WHERE kind='trialApprovals' AND status='PENDING' AND data->>'role'=$1 AND data->'formNos' ?| $2::text[]",[role,formNos]);
 const code='TA-'+randomBytes(6).toString('hex').toUpperCase();
 await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialApprovals',$1,$2,$3,'PENDING',$4,$4)",[code,`${ROLE_TITLE[role]} approval – ${batchId||formNos[0]}`,{role,formNos,target,batchId,openedAt:new Date().toISOString()},actor]);
 return approvalMarkup(code,role);}
const historyEntry=(role,approved,by,at,note)=>({role,action:approved?'Approved':'Rejected',by,at,note});
/* Advance one stage for a set of forms: save, notify the next stage (with Approve/Decline buttons + Trial_Form.pdf), or broadcast the final joining approval. */
async function applyTrialStage(pool,db,{rows,reviewer,decision,target,batchId,xlsx,actor,profile,authorizeAs}){
 const authorizationProfile=profile||{actor,permissions:{}};
 const stage=!decision.approved?'reject':reviewer==='pm'?'ohr':reviewer==='ohr'?'rhr':reviewer==='rhr'?'director':'final';
 const stageStatus=!decision.approved?`Rejected by ${ROLE_TITLE[reviewer]}`:stage==='final'?'Cleared to join':NEXT_STATUS[reviewer];
 const nextRecipients=stage==='reject'?[...await hierarchyRecipients(db,'siteHr',target),...await hierarchyRecipients(db,'part1',target),...await hierarchyRecipients(db,'result',target)]
   :stage==='final'?[...await hierarchyRecipients(db,'all',target),...scopedRecipients(await trialRecipients(db,'result'),target)]
   :stage==='director'?await hierarchyRecipients(db,'ohr',target)   /* Office HR requests the Directors' OTP */
   :await hierarchyRecipients(db,stage,target);
 const recipients=[...new Set(nextRecipients.map(recipientActor))].filter(notSender(actor));
 const messages=[];
 for(const r of rows){const old=(await db.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1 FOR UPDATE",[r.formNo])).rows[0];
  if(old?.data?.site){
   if(trialSite(old.data.site)?.code!==trialSite(target.site)?.code)fail('The trial form belongs to another site.',403);
   await requireTrialRole(db,authorizationProfile,authorizeAs||reviewer,old.data);
  }
  if(!old||old.data?.fields?.Result!=='PASS'||trialReviewStage(old.data.history,old.data.resultAt)!==reviewer)fail('Complete the previous trial approval stage before this review.',409);
  r.history=[...(old.data.history||[]),{role:reviewer,action:decision.approved?'Approved':'Rejected',by:decision.by,at:decision.at,note:decision.note}];
  const data={...(old?.data||{}),formNo:r.formNo,site:r.site||old?.data?.site,company:r.company||old?.data?.company,department:r.department||old?.data?.department,batchId:batchId||old?.data?.batchId||'',fields:{...(old?.data?.fields||{}),...r.fields},attachments:keepTrialDocuments(old?.data?.attachments,r.attachments?.length?r.attachments:old?.data?.attachments||[]),history:r.history,docs:r.docs||old?.data?.docs||{},trialBy:r.trialBy||old?.data?.trialBy||r.fields['Examiner name']||'',stage:stage==='reject'?'REJECTED':stage==='final'?'CLEARED':'APPROVAL',pendingRole:stage==='reject'||stage==='final'?'':stage,status:stageStatus,lastDecision:{reviewer,...decision},savedBy:actor,savedAt:new Date().toISOString()};
  let id=old?.id;if(id)await db.query('UPDATE hr_records SET data=$1,status=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[data,stage==='reject'?'REJECTED':'ACTIVE',actor,id]);
  else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[r.formNo,data.fields['Name of candidate']||r.formNo,data,actor])).rows[0].id;
  await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'TRIAL_APPROVAL','trialForms',$2,$3)",[actor,id,{formNo:r.formNo,reviewer,approved:decision.approved,via:decision.via||'web'}]);
  Object.assign(r,{site:data.site,company:data.company,department:data.department,trialBy:data.trialBy,attachments:data.attachments,status:stageStatus,fields:data.fields,history:data.history,docs:data.docs});}
 /* the reviewer's own pending group is closed whichever way the decision came in */
 await db.query("UPDATE hr_records SET status='CLOSED',updated_at=now() WHERE kind='trialApprovals' AND status='PENDING' AND data->>'role'=$1 AND data->'formNos' ?| $2::text[]",[reviewer,rows.map(r=>r.formNo)]);
 if(!recipients.length)return {stage,messages,recipients};
 const markup=stage==='reject'||stage==='final'||stage==='director'?null:await openApprovalGroup(db,{role:stage,formNos:rows.map(r=>r.formNo),target,batchId,actor});
 /* Only the form PDF travels with the message – photos / uploaded images are not sent as separate files. */
 const files=r=>[{name:`${r.formNo.replace(/\//g,'-')}_${stage==='final'?'Joining_Approval':'Trial_Form'}.pdf`,mime:'application/pdf',data:trialFormPdf(r,stage==='final'?'Joining approval':'Trial joining form'),caption:stage==='final'?'Joining approval':'Trial joining form'}];
 const key=`trial-approval:${reviewer}:${batchId||rows[0].formNo}:${Date.now()}`;
 if(rows.length===1){const m=trialApprovalMessage(rows[0],reviewer,decision);messages.push(m);await queueTelegram(db,key,recipients,m,trialBot(),markup,stage==='reject'?[]:files(rows[0]));
  if(stage==='final'){const j=joiningApprovedMessage(rows[0]);messages.push(j);await queueTelegram(db,key+':join',recipients,j,trialBot(),null,files(rows[0]));}}
 else{const header=!decision.approved?`❌ REJECTED BY ${ROLE_TITLE[reviewer].toUpperCase()} – Batch ${batchId||''} (${rows.length} candidates)`:stage==='final'?`🎉 FINAL APPROVAL – DIRECTORS – Batch ${batchId||''} (${rows.length} candidates)`:`✅ APPROVED BY ${ROLE_TITLE[reviewer].toUpperCase()} – Batch ${batchId||''} (${rows.length} candidates)`;
  const m=[header,'',`Site: ${dash(target.site)}`,`${decision.approved?'Approved':'Rejected'} by: ${ROLE_TITLE[reviewer]} · ${fmtDateTime(decision.at)}`,decision.note?`Remark: ${decision.note}`:'',`Status: ${stage==='final'?'✅ CLEARED TO JOIN':stageStatus}`,'',...rows.map((r,i)=>`${i+1}. ${dash(r.fields['Name of candidate'])} – ${dash(r.fields['If PASS – recommended for']||r.fields['Post applied for']||r.department)} – ${r.formNo} – ${r.fields.Result==='PASS'?'✅ PASS':'❌ FAIL'}`),markup?'\nTap Approve / Decline below to act on all candidates in this batch.':''].filter(l=>l!=='').join('\n');
  messages.push(m);await queueTelegram(db,key,recipients,m,trialBot(),markup,stage==='reject'?[]:rows.flatMap(files));
  if(stage==='final'){const j=bulkJoiningApprovedMessage(batchId||'-',rows);messages.push(j);await queueTelegram(db,key+':join',recipients,j,trialBot(),null,xlsx?[{name:`${batchId||'batch'}_Joining_List.xlsx`,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:xlsx,caption:`${rows.length} candidates, joining columns pending`}]:[]);}}
 return {stage,messages,recipients};}
export function createTelegram(pool){
 const admin=p=>{if(!grantedMenus(p).has('Master Configuration')||assignedSites(p)!==null)fail('Unrestricted Master Configuration access required',403);};
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 return {
 async telegramApi(profile,route,method,input){
  const actionRole={'trial-otp':'ohr','trial-otp-verify':'ohr','trial-part1':'hr','trial-result':'trainer','trial-batch-result':'trainer','trial-forms':'trainer','trial-approval':String(input?.reviewer||'')}[route];
  if(method==='POST'&&actionRole){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   await requireTrialRole(pool,profile,actionRole,input);
  }
  if(!grantedMenus(profile).size)fail('HR access required',403);
  if(route==='account'&&method==='GET'){
   const account=(await pool.query(`SELECT actor,leave_connected,${mainBotConnectionColumn()} AS mt_hr_enabled FROM hr_telegram_accounts WHERE actor=$1`,[profile.actor])).rows[0];
   return {connected:!!account?.leave_connected,botUsername:botUsername('leave'),configured:!!botToken('leave'),mtConfigured:mtEnabled(),mtConnected:!!account?.mt_hr_enabled,mtName:cmllHrEnabled()?'CMLL HR':'MT HR'};
  }
  if(route==='mt-connect'&&method==='POST'){
   if(!mtEnabled())fail('MT HR is not configured',503);
   if(cmllHrEnabled())return cmllConnectLink(pool,profile.actor);
   const token=randomBytes(24).toString('base64url');
   await pool.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'mt',now()+interval '10 minutes')",[hash((cmllHrEnabled()?'cmll:':'mt:')+token),profile.actor]);
   return {url:`https://t.me/${botUsername('mt')}?start=${token}`};
  }
  if(route==='connect'&&method==='POST'){
   if(cmllHrEnabled())return cmllConnectLink(pool,profile.actor);
   if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_BOT_USERNAME)fail('Telegram bot is not configured',503);
   const token=randomBytes(24).toString('base64url');await tx(async db=>{await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='leave') OR expires_at<now()",[profile.actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'leave',now()+interval '10 minutes')",[hash(token),profile.actor]);});
   return {url:`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}`};
  }
  /* ---- Joining approval ---- */
  if(route==='joining-approvers'&&method==='GET'){const cfg=await joiningApprovers(pool);const linked=(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE (($1::boolean AND ${mainBotConnectionColumn()}) OR joining_connected) AND actor = ANY($2)`,[mtEnabled(),cfg.approvers])).rows.map(r=>r.actor);const issues=Object.fromEntries((await pool.query("SELECT DISTINCT ON (actor) actor,last_error FROM hr_telegram_outbox WHERE bot='joining' AND state<>'SENT' AND last_error IS NOT NULL ORDER BY actor,id DESC")).rows.map(r=>[r.actor,r.last_error]));return {...cfg,approvers:cfg.approvers.join(', '),linked,issues,botUsername:workflowUsername('joining'),configured:workflowConfigured('joining'),canWrite:grantedMenus(profile).has('Approval Management')};}
  if(route==='joining-approvers'&&method==='POST'){
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const approvers=String(input.approvers||'').split(',').map(a=>a.trim().toLowerCase()).filter(a=>/^[-a-z0-9_.@]{1,100}$/.test(a));
   const data={approvers:approvers.join(','),enabled:!!input.enabled&&approvers.length>0,updatedBy:profile.actor,updatedAt:new Date().toISOString()};
   await pool.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'joiningApprovals','SETTINGS','Joining approvers',$1,'ACTIVE',$2,$2) ON CONFLICT(kind,code) DO UPDATE SET data=$1,updated_by=$2,updated_at=now()",[data,profile.actor]);
   return {ok:true,approvers:data.approvers,enabled:data.enabled};
  }
  if(route==='joining-approval'&&method==='POST'){   /* request / resend OTP */
   const cfg=await joiningApprovers(pool);if(!cfg.enabled)return {required:false};
   if(!workflowConfigured('joining'))fail('Joining Approval bot is not configured on the server (TELEGRAM_JOINING_BOT_TOKEN)',503);
   const id=String(input.draftId||'').trim().slice(0,80);if(!/^[-A-Za-z0-9_.]{4,80}$/.test(id))fail('Invalid draft id');
   const code='JA-'+hash(id).slice(0,12).toUpperCase();
   const existing=(await pool.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1",[code])).rows[0]?.data;
   if(existing&&existing.status==='APPROVED')return {required:true,status:'APPROVED',approvedBy:existing.approvedBy,approvedAt:existing.approvedAt,candidate:existing.candidate};
   const otp=String(Math.floor(100000+Math.random()*900000)),expires=new Date(Date.now()+JOINING_OTP_MINUTES*60000).toISOString();
   const data={status:'PENDING',draftId:id,candidate:String(input.candidate||'').trim().slice(0,120),post:String(input.post||'').trim().slice(0,80),site:String(input.site||'').trim().slice(0,80),company:String(input.company||'').trim().slice(0,80),submittedBy:profile.actor,requestedAt:new Date().toISOString(),otpHash:hash(code+':'+otp),expires,attempts:0,approvers:cfg.approvers,resends:(existing?.resends||0)+(existing?1:0)};
   await tx(async db=>{await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'joiningApprovals',$1,$2,$3,'PENDING',$4,$4) ON CONFLICT(kind,code) DO UPDATE SET data=$3,name=$2,status='PENDING',updated_by=$4,updated_at=now()",[code,data.candidate||code,data,profile.actor]);
    await queueTelegram(db,`joining:${code}:${data.resends}`,cfg.approvers,joiningApprovalMessage(data,otp),'joining',joiningMarkup(code));});
   const linked=(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE (($1::boolean AND ${mainBotConnectionColumn()}) OR joining_connected) AND actor = ANY($2)`,[mtEnabled(),cfg.approvers])).rows.map(r=>r.actor);
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
   out.outbox=(await pool.query("SELECT actor,state,attempts,last_error,sent_at FROM hr_telegram_outbox WHERE bot='trial' ORDER BY id DESC LIMIT 10")).rows;
   return out;
  }
  if(route==='joining-status'&&method==='GET'){   /* diagnostics for the Joining Approval bot */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   const token=process.env.TELEGRAM_JOINING_BOT_TOKEN,secret=botSecret('joining');
   const out={tokenSet:!!token,usernameSet:process.env.TELEGRAM_JOINING_BOT_USERNAME||'',secretSet:!!secret,me:null,webhook:null,registered:null,outbox:[]};
   if(token){const call=async(m,body)=>{try{const r=await fetch(`https://api.telegram.org/bot${token}/${m}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(10000)});return await r.json();}catch(e){return {ok:false,description:e instanceof Error?e.message:String(e)};}};
    out.me=await call('getMe');out.registered=await registerJoiningWebhook();out.webhook=await call('getWebhookInfo');}
   await pool.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING' WHERE bot='joining' AND state IN ('PENDING','FAILED')");
   out.outbox=(await pool.query("SELECT actor,state,attempts,last_error,sent_at FROM hr_telegram_outbox WHERE bot='joining' ORDER BY id DESC LIMIT 10")).rows;
   return out;
  }
  if(route==='trial-recipients'&&method==='GET'){
   const result=await trialRecipients(pool,'result'),part1=await trialRecipients(pool,'part1'),hierarchy={part1:await hierarchyRecipients(pool,'part1'),result:[...(await hierarchyRecipients(pool,'result')).map(r=>({...r,role:`Trial result → ${r.role}`})),...(await hierarchyRecipients(pool,'ohr')).map(r=>({...r,role:`PM approved → ${r.role}`})),...(await hierarchyRecipients(pool,'rhr')).map(r=>({...r,role:`Office HR approved → ${r.role} (Regional HR)`})),...(await hierarchyRecipients(pool,'director')).map(r=>({...r,role:`Regional HR approved → ${r.role} (Directors)`}))]},all=[...result,...part1,...hierarchy.part1,...hierarchy.result];
   const linked=(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE ${trialConnectedSql()} AND actor = ANY($2)`,[mtEnabled(),all.map(recipientActor)])).rows.map(r=>r.actor);
   const issues=Object.fromEntries((await pool.query("SELECT DISTINCT ON (actor) actor,last_error FROM hr_telegram_outbox WHERE bot IN ('trial','trial-status') AND state<>'SENT' AND last_error IS NOT NULL ORDER BY actor,id DESC")).rows.map(r=>[r.actor,r.last_error]));
   const decorate=list=>list.map(r=>({...r,connected:linked.includes(recipientActor(r)),issue:issues[recipientActor(r)]||''}));
   return {recipients:decorate(result),part1Recipients:decorate(part1),hierarchy:{part1:decorate(hierarchy.part1),result:decorate(hierarchy.result)},botUsername:trialUsername(),configured:trialConfigured()};
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
  if(route==='addition-bot'&&method==='GET'){   /* Nagpur Employee Addition bot: is this user connected? */
   const connected=cmllHrEnabled()?!!(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor=$1 AND cmll_hr_connected',[profile.actor])).rowCount:!!(await pool.query('SELECT actor FROM hr_telegram_accounts WHERE actor=$1 AND nagpur_connected=true',[profile.actor])).rowCount||!!nagpurRecipients()[profile.actor];
   const issue=(await pool.query("SELECT last_error FROM hr_telegram_outbox WHERE bot='nagpur' AND actor=$1 AND state<>'SENT' AND last_error IS NOT NULL ORDER BY id DESC LIMIT 1",[profile.actor])).rows[0]?.last_error||'';
   return {connected,issue,botUsername:workflowUsername('nagpur'),configured:workflowConfigured('nagpur')};
  }
  if(route==='addition-link'&&method==='POST'){   /* one person's personal link to forward (WhatsApp etc.) when a bot cannot reach them */
   if(!grantedMenus(profile).has('Approval Management')||assignedSites(profile)!==null)fail('Approval Management access without a site restriction is required',403);
   if(!workflowConfigured('nagpur'))fail('Employee Track bot is not configured',503);
   const actor=String(input.actor||'').trim().toLowerCase();
   const person=additionRoster((await pool.query("SELECT code,status,data FROM hr_records WHERE kind='joiningHierarchies'")).rows).find(p=>p.actor===actor);
   if(!person)fail('This login is not on any employee addition route',404);
   if(cmllHrEnabled())return tx(async db=>{
    const link=await cmllConnectLink(db,actor,7*24*60);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'ADDITION_BOT_FORWARD_LINK','telegram',NULL,$2)",[profile.actor,{for:actor}]);
    return {...link,actor,roles:person.roles,message:connectInviteMessage({...link,roles:person.roles})};
   });
   const token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query('DELETE FROM hr_telegram_link_tokens WHERE expires_at<now()');   /* keep the link already queued on Telegram working too */
    await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'nagpur',now()+interval '7 days')",[hash(token),actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'ADDITION_BOT_FORWARD_LINK','telegram',NULL,$2)",[profile.actor,{for:actor}]);});
   return {actor,roles:person.roles,url:`https://t.me/${botUsername('nagpur')}?start=${token}`,message:connectInviteMessage({roles:person.roles,url:`https://t.me/${botUsername('nagpur')}?start=${token}`,botUsername:botUsername('nagpur')})};
  }
  if(route==='addition-links'&&['GET','POST'].includes(method)){   /* Approval Master › Employee Addition bot: connect links for everyone on the routes */
   if(!grantedMenus(profile).has('Approval Management')||assignedSites(profile)!==null)fail('Approval Management access without a site restriction is required',403);
   const roster=additionRoster((await pool.query("SELECT code,status,data FROM hr_records WHERE kind='joiningHierarchies'")).rows);
   const accounts=new Map((await pool.query('SELECT actor,leave_connected,joining_connected,trial_connected,nagpur_connected,cmll_hr_connected FROM hr_telegram_accounts WHERE actor = ANY($1)',[roster.map(p=>p.actor)])).rows.map(r=>[r.actor,r]));
   const listed=nagpurRecipients();
   const viaOf=a=>a?.leave_connected?'leave':a?.joining_connected?'joining':a?.trial_connected?'trial':'';
   const people=roster.map(p=>{const a=accounts.get(p.actor);return {...p,connected:cmllHrEnabled()?!!a?.cmll_hr_connected:!!a?.nagpur_connected||!!listed[p.actor],via:cmllHrEnabled()?'':viaOf(a)};});
   if(method==='GET'){   /* Link delivery: the latest connect-link message per person, or a link handed out to forward */
    const actors=people.map(p=>p.actor);
    const sent=new Map((await pool.query("SELECT DISTINCT ON (actor) actor,bot,state,last_error,sent_at FROM hr_telegram_outbox WHERE event_key LIKE 'nagpur-invite:%' AND actor = ANY($1) ORDER BY actor,id DESC",[actors])).rows.map(r=>[r.actor,r]));
    const tokens=new Map((await pool.query("SELECT actor,max(expires_at) AS expires_at FROM hr_telegram_link_tokens WHERE bot='nagpur' AND actor = ANY($1) GROUP BY actor",[actors])).rows.map(r=>[r.actor,r]));
    const deliveryOf=p=>{const o=sent.get(p.actor);
     if(o)return {state:o.state==='SENT'?'DELIVERED':o.state==='FAILED'?'FAILED':'WAITING',bot:o.bot,at:o.sent_at||'',error:o.state==='SENT'?'':o.last_error||''};
     const t=tokens.get(p.actor);if(t)return {state:new Date(t.expires_at)<new Date()?'EXPIRED':'FORWARD',bot:'',at:t.expires_at,error:''};
     return null;};
    return {people:people.map(p=>({...p,delivery:deliveryOf(p)})),botUsername:workflowUsername('nagpur'),configured:workflowConfigured('nagpur')};
   }
   if(!workflowConfigured('nagpur'))fail('Nagpur Employee Addition bot is not configured on the server (TELEGRAM_NAGPUR_BOT_TOKEN)',503);
   const batch=Date.now().toString(36),results=[];
   await tx(async db=>{for(const p of people){
    if(p.connected){results.push({...p,status:'already connected'});continue;}
    if(cmllHrEnabled()){
     const {url}=await cmllConnectLink(db,p.actor,7*24*60);
     results.push({...p,status:'Forward this link to connect CMLL HR',url});
     continue;
    }
    const token=randomBytes(24).toString('base64url'),url=`https://t.me/${botUsername('nagpur')}?start=${token}`;
    await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='nagpur') OR expires_at<now()",[p.actor]);
    await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'nagpur',now()+interval '7 days')",[hash(token),p.actor]);
    if(p.via){await queueTelegram(db,`nagpur-invite:${batch}`,[p.actor],connectInviteMessage({roles:p.roles,url,botUsername:botUsername('nagpur')}),p.via);results.push({...p,status:`sent on ${botLabel(p.via)}`});}
    else results.push({...p,status:'not on any HR bot – forward this link',url});
   }
   await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SEND_ADDITION_BOT_LINKS','telegram',NULL,$2)",[profile.actor,{sent:results.filter(r=>/^sent/.test(r.status)).map(r=>r.actor),manual:results.filter(r=>r.url).map(r=>r.actor)}]);});
   return {people:results,botUsername:workflowUsername('nagpur')};
  }
  if(route==='trial-status-links'&&['GET','POST'].includes(method)||route==='trial-status-link'&&method==='POST'){   /* Approval Master › Trial Status bot */
   if(!grantedMenus(profile).has('Approval Management')||assignedSites(profile)!==null)fail('Approval Management access without a site restriction is required',403);
   const roster=trialStatusRoster(await hierarchyRecipients(pool,'all'),trialSiteNames());
   const accounts=new Map((await pool.query(`SELECT actor,leave_connected,joining_connected,trial_connected,trial_status_connected,${mainBotConnectionColumn()} AS main_connected FROM hr_telegram_accounts WHERE actor = ANY($1)`,[roster.map(p=>p.actor)])).rows.map(r=>[r.actor,r]));
   const viaOf=a=>a?.main_connected&&mtEnabled()?'mt':a?.leave_connected?'leave':a?.joining_connected?'joining':a?.trial_connected?'trial':'';
   const people=roster.map(p=>{const a=accounts.get(p.actor);return {...p,connected:!!a?.trial_status_connected,via:viaOf(a)};});
   const ready=trialStatusReady(),username=botUsername('trial-status');
   if(route==='trial-status-link'){   /* one person's link, to forward on WhatsApp */
    if(!ready)fail('Trial Status bot is not configured on the server (TELEGRAM_TRIAL_STATUS_BOT_TOKEN)',503);
    const person=people.find(p=>p.actor===String(input.actor||'').trim().toLowerCase());
    if(!person)fail('This login is not on any vehicle trial route',404);
    return tx(async db=>{const url=await trialStatusLink(db,person.actor);
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'TRIAL_STATUS_FORWARD_LINK','telegram',NULL,$2)",[profile.actor,{for:person.actor}]);
     return {actor:person.actor,roles:person.roles,url,message:trialStatusInvite({roles:person.roles,url,botUsername:username})};});
   }
   if(method==='GET'){
    const actors=people.map(p=>p.actor);
    const sent=new Map((await pool.query("SELECT DISTINCT ON (actor) actor,bot,state,last_error,sent_at FROM hr_telegram_outbox WHERE event_key LIKE 'trial-status-invite:%' AND actor = ANY($1) ORDER BY actor,id DESC",[actors])).rows.map(r=>[r.actor,r]));
    const tokens=new Map((await pool.query("SELECT actor,max(expires_at) AS expires_at FROM hr_telegram_link_tokens WHERE bot='trial-status' AND actor = ANY($1) GROUP BY actor",[actors])).rows.map(r=>[r.actor,r]));
    const deliveryOf=p=>{const o=sent.get(p.actor);
     if(o)return {state:o.state==='SENT'?'DELIVERED':o.state==='FAILED'?'FAILED':'WAITING',bot:o.bot,at:o.sent_at||'',error:o.state==='SENT'?'':o.last_error||''};
     const t=tokens.get(p.actor);if(t)return {state:new Date(t.expires_at)<new Date()?'EXPIRED':'FORWARD',bot:'',at:t.expires_at,error:''};
     return null;};
    return {people:people.map(p=>({...p,delivery:deliveryOf(p)})),botUsername:username,configured:ready};
   }
   if(!ready)fail('Trial Status bot is not configured on the server (TELEGRAM_TRIAL_STATUS_BOT_TOKEN)',503);
   const batch=Date.now().toString(36),results=[];
   await tx(async db=>{for(const p of people){
    if(p.connected){results.push({...p,status:'already connected'});continue;}
    const url=await trialStatusLink(db,p.actor);
    if(p.via){await queueTelegram(db,`trial-status-invite:${batch}`,[p.actor],trialStatusInvite({roles:p.roles,url,botUsername:username}),p.via);results.push({...p,status:`sent on ${botLabel(p.via)}`});}
    else results.push({...p,status:'not on any HR bot – forward this link',url});
   }
   await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SEND_TRIAL_STATUS_LINKS','telegram',NULL,$2)",[profile.actor,{sent:results.filter(r=>/^sent/.test(r.status)).map(r=>r.actor),manual:results.filter(r=>r.url).map(r=>r.actor)}]);});
   return {people:results,botUsername:username,configured:ready};
  }
  if(route==='leave-request-links'&&['GET','POST'].includes(method)||route==='leave-request-link'&&method==='POST'){   /* Approval Master › Leave Request bot */
   if(!grantedMenus(profile).has('Approval Management')||assignedSites(profile)!==null)fail('Approval Management access without a site restriction is required',403);
   const employees=(await pool.query("SELECT lower(COALESCE(NULLIF(e.data->>'pulseUsername',''),e.data->>'username')) AS actor,e.name,s.name AS site FROM hr_records e LEFT JOIN hr_records s ON s.kind='sites' AND s.id::text=e.data->>'siteId' WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED') AND COALESCE(NULLIF(e.data->>'pulseUsername',''),e.data->>'username','')<>''")).rows;
   const flows=(await pool.query("SELECT s.name,h.data FROM hr_telegram_hierarchies h JOIN hr_records s ON s.id=h.site_id")).rows;
   const roster=leaveRequestRoster({employees,flows});
   const accounts=new Map((await pool.query(`SELECT actor,leave_connected,joining_connected,trial_connected,trial_status_connected,leave_request_connected,${mainBotConnectionColumn()} AS main_connected FROM hr_telegram_accounts WHERE actor = ANY($1)`,[roster.map(p=>p.actor)])).rows.map(r=>[r.actor,r]));
   const viaOf=a=>a?.main_connected&&mtEnabled()?'mt':a?.leave_connected?'leave':a?.trial_status_connected&&trialStatusReady()?'trial-status':a?.joining_connected?'joining':a?.trial_connected?'trial':'';
   const people=roster.map(p=>{const a=accounts.get(p.actor);return {...p,connected:!!a?.leave_request_connected,via:viaOf(a)};});
   const ready=leaveRequestReady(),leaveBotName=botUsername('leave-request');
   if(route==='leave-request-link'){   /* one person's link, to forward on WhatsApp */
    if(!ready)fail('Leave Request bot is not configured on the server (TELEGRAM_LEAVE_REQUEST_BOT_TOKEN)',503);
    const person=people.find(p=>p.actor===String(input.actor||'').trim().toLowerCase());
    if(!person)fail('This login is not an employee with a Pulse login or a leave approver',404);
    return tx(async db=>{const url=await leaveRequestLink(db,person.actor);
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'LEAVE_REQUEST_FORWARD_LINK','telegram',NULL,$2)",[profile.actor,{for:person.actor}]);
     return {actor:person.actor,roles:person.roles,url,message:leaveRequestInvite({roles:person.roles,url,botUsername:leaveBotName})};});
   }
   if(method==='GET'){
    const actors=people.map(p=>p.actor);
    const sent=new Map((await pool.query("SELECT DISTINCT ON (actor) actor,bot,state,last_error,sent_at FROM hr_telegram_outbox WHERE event_key LIKE 'leave-request-invite:%' AND actor = ANY($1) ORDER BY actor,id DESC",[actors])).rows.map(r=>[r.actor,r]));
    const tokens=new Map((await pool.query("SELECT actor,max(expires_at) AS expires_at FROM hr_telegram_link_tokens WHERE bot='leave-request' AND actor = ANY($1) GROUP BY actor",[actors])).rows.map(r=>[r.actor,r]));
    const deliveryOf=p=>{const o=sent.get(p.actor);
     if(o)return {state:o.state==='SENT'?'DELIVERED':o.state==='FAILED'?'FAILED':'WAITING',bot:o.bot,at:o.sent_at||'',error:o.state==='SENT'?'':o.last_error||''};
     const t=tokens.get(p.actor);if(t)return {state:new Date(t.expires_at)<new Date()?'EXPIRED':'FORWARD',bot:'',at:t.expires_at,error:''};
     return null;};
    return {people:people.map(p=>({...p,delivery:deliveryOf(p)})),botUsername:leaveBotName,configured:ready};
   }
   if(!ready)fail('Leave Request bot is not configured on the server (TELEGRAM_LEAVE_REQUEST_BOT_TOKEN)',503);
   const only=Array.isArray(input.actors)?new Set(input.actors.map(username)):null;
   const batch=Date.now().toString(36),results=[];
   await tx(async db=>{for(const p of people){
    if(only&&!only.has(p.actor))continue;
    if(p.connected){results.push({...p,status:'already connected'});continue;}
    const url=await leaveRequestLink(db,p.actor);
    if(p.via){await queueTelegram(db,`leave-request-invite:${batch}`,[p.actor],leaveRequestInvite({roles:p.roles,url,botUsername:leaveBotName}),p.via);results.push({...p,status:`sent on ${botLabel(p.via)}`});}
    else results.push({...p,status:'not on any HR bot – forward this link',url});
   }
   await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SEND_LEAVE_REQUEST_LINKS','telegram',NULL,$2)",[profile.actor,{sent:results.filter(r=>/^sent/.test(r.status)).map(r=>r.actor),manual:results.filter(r=>r.url).map(r=>r.actor)}]);});
   return {people:results,botUsername:leaveBotName,configured:ready};
  }
  if(route==='addition-connect'&&method==='POST'){   /* connect link for the Nagpur Employee Addition bot (open it and tap Start) */
   if(cmllHrEnabled())return cmllConnectLink(pool,profile.actor);
   if(!workflowConfigured('nagpur'))fail('Nagpur Employee Addition bot is not configured on the server (TELEGRAM_NAGPUR_BOT_TOKEN)',503);
   const token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='nagpur') OR expires_at<now()",[profile.actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'nagpur',now()+interval '7 days')",[hash(token),profile.actor]);});
   return {url:`https://t.me/${botUsername('nagpur')}?start=${token}`,botUsername:botUsername('nagpur')};
  }
  if(route==='joining-connect'&&method==='POST'){   /* connect link for an approver on the Joining Approval bot */
   if(!workflowConfigured('joining')||!workflowUsername('joining'))fail('Joining Approval bot is not configured on the server',503);
   const pulse=String(input.actor||profile.actor).trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(pulse))fail('Enter a Pulse username');
   if(pulse!==profile.actor&&!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   if(cmllHrEnabled())return cmllConnectLink(pool,pulse,7*24*60);
   const token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='joining') OR expires_at<now()",[pulse]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'joining',now()+interval '7 days')",[hash(token),pulse]);});
   return {url:`https://t.me/${process.env.TELEGRAM_JOINING_BOT_USERNAME}?start=${token}`,botUsername:process.env.TELEGRAM_JOINING_BOT_USERNAME};
  }
  if(route==='trial-connect'&&method==='POST'){   /* connect link for a recipient's Telegram (they open it and tap Start) */
   if(!grantedMenus(profile).has('Approval Management'))fail('Approval Management permission required',403);
   if(!trialConfigured()||!trialUsername())fail('Trial Status bot is not configured on the server',503);
   const phone=String(input.phone||'').replace(/\D/g,'').slice(-10),pulse=String(input.actor||'').trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(pulse)&&phone.length!==10)fail('Enter a Pulse username or a 10-digit mobile number');
   if(trialStatusReady())return tx(async db=>({url:await trialStatusLink(db,pulse||'trial:'+phone),botUsername:botUsername('trial-status')}));
   if(cmllHrEnabled())return cmllConnectLink(pool,pulse||'trial:'+phone,7*24*60);
   const actor=pulse||'trial:'+phone,token=randomBytes(24).toString('base64url');
   await tx(async db=>{await db.query("DELETE FROM hr_telegram_link_tokens WHERE (actor=$1 AND bot='trial') OR expires_at<now()",[actor]);await db.query("INSERT INTO hr_telegram_link_tokens(hash,actor,bot,expires_at) VALUES($1,$2,'trial',now()+interval '7 days')",[hash(token),actor]);});
   return {url:`https://t.me/${process.env.TELEGRAM_TRIAL_BOT_USERNAME}?start=${token}`};
  }
  if(route==='trial-trainer'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const target={site:String(input.site||'').slice(0,80),region:String(input.region||'').slice(0,80),company:String(input.company||'').slice(0,120),group:String(input.group||'').slice(0,80)};
   const access=await trialAccess(pool,profile,target);
   const trainer=trialSite(target.site)&&(access.roles.length||access.overview)?await trialTrainerFor(pool,target):{actor:'',name:'',site:target.site};
   return {...trainer,...access};
  }
  if(route==='trial-scope'&&method==='GET'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const scope=assignedSites(profile),templates=hierarchyTemplates.filter(item=>['NCL','WCL'].includes(item.group));
   const trialAssignments=assignedTrialSites(profile);
   if(trialAssignments!==undefined){const sites=(trialAssignments===null?templates:trialAssignments.filter(item=>['NCL','WCL'].includes(item.group)));return {admin:trialAssignments===null,sites:sites.map(item=>({region:item.group,site:item.name,code:item.code}))};}
   if(scope===null)return {admin:true,sites:templates.map(item=>({region:item.group,site:item.name,code:item.code}))};
   if(!scope.length)return {admin:false,sites:[]};
   const rows=(await pool.query("SELECT id::text,code,name FROM hr_records WHERE kind='sites' AND status='ACTIVE' AND (id::text=ANY($1) OR lower(code)=ANY($1) OR lower(name)=ANY($1))",[scope])).rows;
   const allowed=new Set([...scope,...rows.flatMap(row=>[norm(row.id),norm(row.code),norm(row.name)])]);
   return {admin:false,sites:templates.filter(item=>allowed.has(norm(item.code))||allowed.has(norm(item.name))).map(item=>({region:item.group,site:item.name,code:item.code}))};
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
    return {formNo,clientId:String(c.clientId||'').slice(0,64),heading,site,company,department,fields,stage:'PART1',status:'Sent to driver trainer',batchId,trialBy,attachments:cleanAttachments(c.attachments),part1By:profile.actor,part1At:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};});
   const target={site,region:String(input.region||'').slice(0,80),company,group:String(input.group||'').slice(0,80)};
   const recipients=(await hierarchyRecipients(pool,'part1',target)).map(recipientActor).filter(notSender(profile.actor));
   let message,files=[];
   await tx(async db=>{
    /* Each browser numbers its own forms, so two sites or two HR browsers can pick the same number.
       A resend of the same form keeps its number; any other form gets the next free number in the series. */
    await db.query("SELECT pg_advisory_xact_lock(hashtext('hrPulse.trialFormNumber'))");
    for(const r of records){let old=(await db.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1",[r.formNo])).rows[0];
     if(old&&!sameTrialSubmission(old.data,r)){r.formNo=await nextFreeTrialNumber(db,r.formNo);old=undefined;}
     const name=r.fields['Name of candidate'];let id;
     if(old){id=old.id;await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[name,r,profile.actor,id]);}
     else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[r.formNo,name,r,profile.actor])).rows[0].id;
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SUBMIT_TRIAL_PART1','trialForms',$2,$3)",[profile.actor,id,{formNo:r.formNo,batchId}]);}
   if(batchId){const batch={batchId,site,trialBy,trialDate:records[0].fields['Trial date & time']};message=trialBatchSubmittedMessage(batch,records);
    const pdf=buildPdf({title:`Vehicle trial – Batch ${batchId}`,subtitle:[`Site: ${site||heading||'-'} · Trial date: ${fmtDate(batch.trialDate)||'-'} · Trial by: ${trialBy||'driver trainer'} · Submitted by: ${profile.name||profile.actor}`,company||''].filter(Boolean),
     columns:[{label:'#',width:20},{label:'Form No',width:85},{label:'Name',width:150},{label:'Post',width:65},{label:'Vehicle',width:95},{label:'Exp (yrs)',width:45},{label:'Referred by',width:85},{label:'Aadhaar',width:80},{label:'PASS / FAIL',width:60},{label:'Remarks',width:120}],
     rows:records.map((r,i)=>[i+1,r.formNo,r.fields['Name of candidate'],r.fields['Post applied for']||department,vehicleOf(r.fields),r.fields['Total experience (years)'],r.fields['Referred by'],r.fields['Aadhaar no.'],'','']),footer:'Generated by HR Pulse'});
    files=[{name:`Trial_${batchId}.pdf`,mime:'application/pdf',data:pdf,caption:`Batch sheet – ${batchId}`}];}
   else message=trialSubmittedMessage(records[0]);
    if(recipients.length)await queueTelegram(db,`trial-part1:${batchId||records[0].formNo}:${Date.now()}`,recipients,message,trialBot(),null,files);});
   return {saved:true,batchId,formNos:records.map(r=>r.formNo),telegram:{...(await recipientIssues(pool,recipients)),message}};
  }
  /* ---- Part 2 list: forms waiting for the driver trainer ---- */
  if(route==='trial-pending'&&method==='GET'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const scope=assignedSites(profile);
   const rows=(await pool.query(`SELECT code,data,updated_at FROM hr_records t WHERE kind='trialForms' AND status='ACTIVE' AND code<>'SETTINGS' AND data->>'stage'='PART1' AND COALESCE(data->'fields'->>'Result','') NOT IN ('PASS','FAIL')
    AND ($1::text[] IS NULL OR lower(t.data->>'site')=ANY($1) OR EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites' AND (lower(s.code)=ANY($1) OR lower(s.name)=ANY($1) OR s.id::text=ANY($1)) AND (lower(s.name)=lower(t.data->>'site') OR lower(s.code)=lower(t.data->>'site')))) ORDER BY updated_at DESC LIMIT 300`,[scope])).rows;
   const pending=[];
   for(const r of rows){const access=await trialAccess(pool,profile,r.data);if(!canReadTrial(access,r.data))continue;const {attachments,...rest}=r.data;pending.push({...rest,formNo:r.code,attachmentCount:(attachments||[]).length,updatedAt:r.updated_at});}
   return {pending};
  }
  if(route==='trial-form'&&method==='POST'){   /* one saved trial form with its attachments (Part 2 opens it) */
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const formNo=String(input.formNo||'').trim().slice(0,40),scope=assignedSites(profile);const row=(await pool.query(`SELECT data FROM hr_records t WHERE kind='trialForms' AND status='ACTIVE' AND code=$1
    AND ($2::text[] IS NULL OR lower(t.data->>'site')=ANY($2) OR EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites' AND (lower(s.code)=ANY($2) OR lower(s.name)=ANY($2) OR s.id::text=ANY($2)) AND (lower(s.name)=lower(t.data->>'site') OR lower(s.code)=lower(t.data->>'site'))))`,[formNo,scope])).rows[0];if(!row)fail('Trial form not found',404);
   if(!canReadTrial(await trialAccess(pool,profile,row.data),row.data))fail('This trial is not assigned to you.',403);
   return {data:row.data};
  }
  /* ---- PM and Directors: Office HR requests the OTP on the Trial Status bot and enters it here ---- */
  if((route==='trial-otp'||route==='trial-otp-verify')&&method==='POST'){
   const reviewer=String(input.reviewer||'');if(!OTP_ROLES.includes(reviewer))fail('OTP approval is only for PM and Directors');
   const target={site:String(input.site||'').slice(0,80),region:String(input.region||'').slice(0,80),company:String(input.company||'').slice(0,120),group:String(input.group||'').slice(0,80)};
   const formNos=[...new Set((Array.isArray(input.formNos)?input.formNos:[]).slice(0,100).map(f=>String(f||'').trim().slice(0,40)).filter(Boolean))].sort();
   if(!formNos.length)fail('Choose the trial forms');
   const code='TO-'+hash(reviewer+':'+formNos.join(',')).slice(0,12).toUpperCase(),name=String(profile.name||profile.actor);
   if(route==='trial-otp'){
    const otp=String(randomInt(100000,1000000)),expires=new Date(Date.now()+TRIAL_OTP_MINUTES*60000).toISOString();
    const recipients=await tx(async db=>{
     const forms=(await db.query("SELECT code,data FROM hr_records WHERE kind='trialForms' AND code = ANY($1) FOR UPDATE",[formNos])).rows;
     if(forms.length!==formNos.length)fail('A trial form was not found',404);
     for(const f of forms){
      if(trialSite(f.data?.site)?.code!==trialSite(target.site)?.code)fail('The trial form belongs to another site.',403);
      if(f.data?.fields?.Result!=='PASS'||trialReviewStage(f.data.history,f.data.resultAt)!==reviewer)fail(`${f.code} is not waiting for ${ROLE_TITLE[reviewer]}.`,409);
     }
     const old=(await db.query("SELECT data FROM hr_records WHERE kind='trialOtps' AND code=$1",[code])).rows[0]?.data;
     const data={status:'PENDING',reviewer,formNos,target,otpHash:hash(code+':'+otp),expires,attempts:0,requestedBy:profile.actor,requestedByName:name,requestedAt:new Date().toISOString(),resends:(old?.resends||0)+(old?1:0)};
     await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialOtps',$1,$2,$3,'PENDING',$4,$4) ON CONFLICT(kind,code) DO UPDATE SET data=$3,name=$2,status='PENDING',updated_by=$4,updated_at=now()",[code,`${ROLE_TITLE[reviewer]} OTP – ${formNos[0]}`,data,profile.actor]);
     const to=[...new Set((await hierarchyRecipients(db,ROLE_STEP[reviewer],target)).map(recipientActor))];
     if(!to.length)fail(`No ${ROLE_TITLE[reviewer]} is set for this site in Trial Hierarchy.`,409);
     const markup=await openApprovalGroup(db,{role:reviewer,formNos,target,batchId:forms[0].data?.batchId||'',actor:profile.actor});
     await queueTelegram(db,`trial-otp:${code}:${data.resends}`,to,trialOtpMessage({reviewer,forms:forms.map(f=>({...f.data,formNo:f.code})),otp,requestedBy:name,site:target.site}),trialBot(),markup);
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'TRIAL_OTP_REQUEST','trialForms',NULL,$2)",[profile.actor,{reviewer,formNos}]);
     return to;});
    return {status:'PENDING',expires,sentTo:recipients,telegram:{...(await recipientIssues(pool,recipients)),message:''}};
   }
   const otp=String(input.otp||'').replace(/\D/g,'');
   const out=await tx(async db=>{
    const row=(await db.query("SELECT data FROM hr_records WHERE kind='trialOtps' AND code=$1 FOR UPDATE",[code])).rows[0];
    if(!row)fail('Request the OTP first.',404);
    const d=row.data;
    if(d.status==='APPROVED')fail('These forms were already approved with this OTP.',409);
    if(new Date(d.expires)<new Date())fail('OTP expired – press Resend OTP.',410);
    if((d.attempts||0)>=TRIAL_OTP_ATTEMPTS)fail('Too many wrong attempts – press Resend OTP.',429);
    if(otp.length!==6||hash(code+':'+otp)!==d.otpHash){d.attempts=(d.attempts||0)+1;await db.query("UPDATE hr_records SET data=$2,updated_at=now() WHERE kind='trialOtps' AND code=$1",[code,d]);return {wrong:TRIAL_OTP_ATTEMPTS-d.attempts};}
    const at=new Date().toISOString();
    Object.assign(d,{status:'APPROVED',otpHash:null,approvedAt:at,enteredBy:profile.actor});
    await db.query("UPDATE hr_records SET data=$2,status='APPROVED',updated_at=now() WHERE kind='trialOtps' AND code=$1",[code,d]);
    const stored=(await db.query("SELECT code,data FROM hr_records WHERE kind='trialForms' AND code = ANY($1)",[d.formNos])).rows;
    const rows=stored.map(r=>({formNo:r.code,fields:r.data.fields||{},attachments:r.data.attachments||[],history:[],docs:r.data.docs||{},site:r.data.site,company:r.data.company,department:r.data.department,batchId:r.data.batchId||'',trialBy:r.data.trialBy||''}));
    const by=`${ROLE_TITLE[reviewer]} (OTP entered by ${name})`;
    const stage=await applyTrialStage(pool,db,{rows,reviewer,decision:{approved:true,note:'Approved by OTP',at,by,via:'otp'},target,batchId:rows[0]?.batchId||'',xlsx:'',actor:'otp:'+profile.actor,profile,authorizeAs:'ohr'});
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'TRIAL_OTP_APPROVED','trialForms',NULL,$2)",[profile.actor,{reviewer,formNos:d.formNos}]);
    return {stage,at,by,rows};});
   if(out.wrong!==undefined)fail(`Wrong OTP (${out.wrong} attempt${out.wrong===1?'':'s'} left).`,400);
   return {approved:true,at:out.at,by:out.by,stage:out.stage.stage,rows:out.rows.map(r=>({formNo:r.formNo,history:r.history})),telegram:{...(await recipientIssues(pool,out.stage.recipients)),message:out.stage.messages.join('\n\n———\n\n')}};
  }
  /* ---- Approval stages: PM → Office HR → Regional HR → Directors; final → joining approved to all ---- */
  if(route==='trial-approval'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const reviewer=String(input.reviewer||'');if(!ROLE_TITLE[reviewer])fail('Unknown reviewer stage');
   if(input.approved&&OTP_ROLES.includes(reviewer))fail(`${ROLE_TITLE[reviewer]} approve by OTP: Office HR requests the OTP and enters it.`,409);
   const decision={approved:!!input.approved,note:String(input.note||'').slice(0,300),at:input.at&&!Number.isNaN(new Date(input.at).valueOf())?input.at:new Date().toISOString(),by:String(input.by||profile.name||profile.actor).slice(0,80),via:'web'};
   const target={site:String(input.site||'').slice(0,80),region:String(input.region||'').slice(0,80),company:String(input.company||'').slice(0,120),group:String(input.group||'').slice(0,80)};
   const batchId=String(input.batchId||'').slice(0,40);
   const rows=(Array.isArray(input.rows)?input.rows:[]).slice(0,100).map(r=>{const formNo=String(r.formNo||'').slice(0,40);if(!formNo)fail('Form number is required');return {formNo,fields:cleanFields(r.fields),attachments:cleanAttachments(r.attachments),history:(Array.isArray(r.history)?r.history:[]).slice(0,40).map(h=>({role:String(h.role||'').slice(0,20),action:String(h.action||'').slice(0,80),by:String(h.by||'').slice(0,80),at:String(h.at||'').slice(0,40),note:String(h.note||'').slice(0,300)})),docs:Object.fromEntries(Object.entries(r.docs&&typeof r.docs==='object'?r.docs:{}).slice(0,10).map(([k,v])=>[String(k).slice(0,20),String(v??'').slice(0,10)])),site:target.site,company:target.company,department:String(input.department||'').slice(0,80),batchId,trialBy:String(r.trialBy||'').slice(0,80)};});
   if(!rows.length)fail('No forms to notify');
   const xlsx=input.xlsx?String(input.xlsx).replace(/^data:[^,]*,/,'').slice(0,8*1024*1024):'';
   const out=await tx(db=>applyTrialStage(pool,db,{rows,reviewer,decision,target,batchId,xlsx,actor:profile.actor,profile}));
   return {saved:true,stage:out.stage,telegram:{...(await recipientIssues(pool,out.recipients)),message:out.messages.join('\n\n———\n\n')}};
  }
  if(route==='trial-review-queue'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const template=trialHierarchySite({site:String(input.site||''),region:String(input.region||''),group:String(input.group||'')});
   if(!template)return {rows:[]};
   const access=await trialAccess(pool,profile,{site:template.code});
   if(!access.overview&&!access.roles.length)return {rows:[]};
   const scope=assignedSites(profile);
   const rows=(await pool.query(`SELECT id,data FROM hr_records t WHERE kind='trialForms' AND status IN ('ACTIVE','REJECTED')
    AND lower(data->>'site')=ANY($1)
    AND ($2::text[] IS NULL OR lower(t.data->>'site')=ANY($2) OR EXISTS(SELECT 1 FROM hr_records s WHERE s.kind='sites'
      AND (lower(s.code)=ANY($2) OR lower(s.name)=ANY($2) OR s.id::text=ANY($2))
      AND (lower(s.name)=lower(t.data->>'site') OR lower(s.code)=lower(t.data->>'site'))))
    ORDER BY updated_at DESC LIMIT 300`,[[template.code,template.name,...(trialSiteAliases[template.code]||[])].map(norm),scope])).rows;
   return {rows:rows.filter(({data})=>canReadTrial(access,data)).map(({id,data})=>{const {attachments,...record}=data;return {...record,id};})};
  }
  /* ---- Browser sync: decisions taken on Telegram since the browser last looked ---- */
  if(route==='trial-sync'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const formNos=(Array.isArray(input.formNos)?input.formNos:[]).slice(0,500).map(f=>String(f).slice(0,40));if(!formNos.length)return {rows:[]};
   const rows=(await pool.query("SELECT code,data FROM hr_records WHERE kind='trialForms' AND code = ANY($1)",[formNos])).rows;
   const visible=[];for(const r of rows)if(canReadTrial(await trialAccess(pool,profile,r.data),r.data))visible.push(r);
   return {rows:visible.map(r=>({formNo:r.code,history:(r.data.history||[]).filter(h=>h&&h.role&&h.at),stage:r.data.stage||'',pendingRole:r.data.pendingRole||'',status:r.data.status||''}))};
  }
  /* ---- Part 2 single result (driver trainer) → PM, with the candidate's attachments ---- */
  if(route==='trial-result'&&method==='POST'){
   if(!grantedMenus(profile).has('Employee Master'))fail('Employee Master permission required',403);
   const formNo=String(input.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');
   const fields=cleanFields(input.fields);if(!['PASS','FAIL'].includes(fields.Result))fail('Result must be PASS or FAIL');if(!fields['Name of candidate']?.trim())fail('Candidate name is required');
   const prev=(await pool.query("SELECT id,data FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0];
   if(prev?.data?.site&&trialSite(prev.data.site)?.code!==trialSite(input.site)?.code)fail('The trial form belongs to another site.',403);
   const attachments=cleanAttachments(input.attachments);
   requireTrialUploads(attachments);
   {const problem=trainerVotesProblem(fields);if(problem)fail(problem);}
   const record={...(prev?.data||{}),formNo,heading:String(input.heading||'').slice(0,120),site:String(input.site||'').slice(0,80),company:String(input.company||'').slice(0,120),department:String(input.department||'').slice(0,80),batchId:String(input.batchId||prev?.data?.batchId||'').slice(0,40),fields:{...(prev?.data?.fields||{}),...fields},attachments:keepTrialDocuments(prev?.data?.attachments,attachments.length?attachments:prev?.data?.attachments||[]),stage:'RESULT',status:'Sent to PM for approval',trialBy:String(input.trialBy||fields['Examiner name']||profile.name||profile.actor).slice(0,80),resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
   Object.assign(record,{pendingRole:'pm',history:[]});
   const message=trialResultMessage(record,profile.name||profile.actor),recipients=(await hierarchyRecipients(pool,'result',{site:record.site,region:String(input.region||'').slice(0,80),company:record.company,group:String(input.group||'').slice(0,80)})).map(recipientActor).filter(notSender(profile.actor));
   await tx(async db=>{let id=prev?.id;
    if(id)await db.query('UPDATE hr_records SET name=$1,data=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[record.fields['Name of candidate'],record,profile.actor,id]);
    else id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[formNo,record.fields['Name of candidate'],record,profile.actor])).rows[0].id;
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIAL_FORM','trialForms',$2,$3)",[profile.actor,id,{formNo,result:fields.Result}]);
    const files=[{name:`${formNo.replace(/\//g,'-')}_Trial_Form.pdf`,mime:'application/pdf',data:trialFormPdf(record,'Trial joining form'),caption:'Trial joining form'}];
    const markup=fields.Result==='PASS'&&recipients.length?await openApprovalGroup(db,{role:'pm',formNos:[formNo],target:{site:record.site,region:String(input.region||'').slice(0,80),company:record.company,group:String(input.group||'').slice(0,80)},batchId:record.batchId||'',actor:profile.actor}):null;
    if(recipients.length)await queueTelegram(db,`trial:${formNo}:${fields.Result}:${Date.now()}`,recipients,message,trialBot(),markup,files);
    await alertOfficeHr(db,{forms:[record],target:{site:record.site,region:String(input.region||'').slice(0,80),company:record.company,group:String(input.group||'').slice(0,80)},trialBy:record.trialBy||profile.name||profile.actor,actor:profile.actor,key:`trial-ohr-alert:${formNo}:${Date.now()}`});});
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
   const recipients=(await hierarchyRecipients(pool,'result',{site:String(input.site||''),region:String(input.region||'').slice(0,80),company:String(input.company||''),group:String(input.group||'').slice(0,80)})).map(recipientActor).filter(notSender(profile.actor));
   let message;const records=[];
   const site=String(input.site||'').slice(0,80),company=String(input.company||'').slice(0,120),department=String(input.department||'').slice(0,80),heading=String(input.heading||'').slice(0,120);
   const given=new Map((Array.isArray(input.rows)?input.rows:[]).slice(0,100).map(r=>[String(r.formNo||'').slice(0,40),{fields:cleanFields(r.fields),attachments:cleanAttachments(r.attachments)}]));
   for(const result of results){const row=given.get(result.formNo);if(!row)fail(`Missing trial files for ${result.formNo}`);requireTrialUploads(row.attachments);}
   await tx(async db=>{const stored=(await db.query("SELECT id,code,data FROM hr_records WHERE kind='trialForms' AND status='ACTIVE' AND data->>'batchId'=$1 FOR UPDATE",[batchId])).rows;
    const rows=[...stored];for(const [formNo,g] of given)if(!stored.some(r=>r.code===formNo))rows.push({id:null,code:formNo,data:{formNo,heading,site,company,department,batchId,fields:g.fields,attachments:g.attachments,stage:'PART1',status:'Sent to driver trainer'}});
    if(!rows.length)fail('Batch not found',404);
    if(rows.some(row=>row.data?.site&&trialSite(row.data.site)?.code!==trialSite(site)?.code))fail('The trial batch belongs to another site.',403);
    for(const row of rows){const res=results.find(r=>r.formNo===row.code);if(!res)fail(`Missing result for ${row.code}`);const g=given.get(row.code);const data={...row.data,fields:{...row.data.fields,...(g?.fields||{}),Result:res.result,'If FAIL – reason':res.result==='FAIL'?res.reason:'', 'Examiner remarks':res.remarks,'Examiner name':trialBy},attachments:keepTrialDocuments(row.data.attachments,g?.attachments?.length?g.attachments:row.data.attachments||[]),stage:'RESULT',pendingRole:res.result==='PASS'?'pm':'',history:[],status:'Sent to PM for approval',trialBy,resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
     if(row.id)await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[data,profile.actor,row.id]);
     else row.id=(await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'trialForms',$1,$2,$3,'ACTIVE',$4,$4) RETURNING id",[row.code,data.fields['Name of candidate']||row.code,data,profile.actor])).rows[0].id;
     await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'SAVE_TRIAL_FORM','trialForms',$2,$3)",[profile.actor,row.id,{formNo:row.code,result:res.result,batchId}]);records.push(data);}
    const files=[];
    /* Two files for PASS and two for FAIL (PDF list + Excel), instead of one file per candidate. */
    const passed=records.filter(r=>r.fields.Result==='PASS'),failed=records.filter(r=>r.fields.Result!=='PASS');
    const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const listPdf=(list,label)=>buildPdf({title:`Vehicle trial – ${label} – Batch ${batchId}`,subtitle:[`Site: ${site||heading||'-'} · Trial date: ${fmtDate(records[0]?.fields['Trial date & time'])||'-'} · Trial by: ${trialBy} · ${list.length} candidate${list.length===1?'':'s'}`],
      columns:[{label:'#',width:20},{label:'Form No',width:85},{label:'Name',width:150},{label:'Post',width:65},{label:'Vehicle',width:95},{label:'Exp (yrs)',width:45},{label:'Referred by',width:85},{label:'Mobile',width:70},{label:label==='PASSED'?'Remarks':'Reason for fail',width:170}],
      rows:list.map((r,i)=>[i+1,r.formNo,r.fields['Name of candidate'],r.fields['If PASS – recommended for']||r.fields['Post applied for']||r.department,r.fields['Machine']||vehicleOf(r.fields),r.fields['Total experience (years)'],r.fields['Referred by'],r.fields['Mobile no.'],label==='PASSED'?r.fields['Examiner remarks']:r.fields['If FAIL – reason']]),footer:'Generated by HR Pulse'});
    const xlsxPass=input.xlsxPass?String(input.xlsxPass).replace(/^data:[^,]*,/,'').slice(0,8*1024*1024):'',xlsxFail=input.xlsxFail?String(input.xlsxFail).replace(/^data:[^,]*,/,'').slice(0,8*1024*1024):'';
    if(passed.length){files.push({name:`Trial_${batchId}_PASS.pdf`,mime:'application/pdf',data:listPdf(passed,'PASSED'),caption:`✅ PASSED – ${passed.length} candidate${passed.length===1?'':'s'} – ${batchId}`});if(xlsxPass)files.push({name:`Trial_${batchId}_PASS.xlsx`,mime:XLSX_MIME,data:xlsxPass,caption:`✅ PASSED list (Excel) – ${batchId}`});}
    if(failed.length){files.push({name:`Trial_${batchId}_FAIL.pdf`,mime:'application/pdf',data:listPdf(failed,'FAILED'),caption:`❌ FAILED – ${failed.length} candidate${failed.length===1?'':'s'} – ${batchId}`});if(xlsxFail)files.push({name:`Trial_${batchId}_FAIL.xlsx`,mime:XLSX_MIME,data:xlsxFail,caption:`❌ FAILED list (Excel) – ${batchId}`});}
    if(xlsx&&!xlsxPass&&!xlsxFail)files.push({name:`Trial_${batchId}.xlsx`,mime:XLSX_MIME,data:xlsx,caption:`Trial result sheet – ${batchId}`});
    const first=records[0];message=trialBatchResultMessage({batchId,site:first.site||first.heading,trialBy,trialDate:first.fields['Trial date & time'],vehicle:vehicleOf(first.fields),post:first.fields['Post applied for']||first.department},records,{passed:passed.length,failed:failed.length});
    const passedNos=records.filter(r=>r.fields.Result==='PASS').map(r=>r.formNo);
    const markup=passedNos.length&&recipients.length?await openApprovalGroup(db,{role:'pm',formNos:passedNos,target:{site,region:String(input.region||'').slice(0,80),company,group:String(input.group||'').slice(0,80)},batchId,actor:profile.actor}):null;
    if(recipients.length)await queueTelegram(db,`trial-batch:${batchId}:${Date.now()}`,recipients,message+(markup?'\n\nPM approval is by OTP: Office HR requests it. Tap Decline below to refuse the PASSED candidates.':''),trialBot(),markup,files);
    await alertOfficeHr(db,{forms:records,target:{site,region:String(input.region||'').slice(0,80),company,group:String(input.group||'').slice(0,80)},trialBy,actor:profile.actor,key:`trial-ohr-alert:${batchId}:${Date.now()}`});});
   return {saved:true,batchId,passed:records.filter(r=>r.fields.Result==='PASS').map(r=>r.formNo),telegram:{...(await recipientIssues(pool,recipients)),message}};
  }
  if(route==='trial-forms'&&method==='POST'){
   const f=input.fields&&typeof input.fields==='object'?input.fields:{},formNo=String(input.formNo||'').trim().slice(0,40);if(!formNo)fail('Form number is required');
   const name=String(f['Name of candidate']||'').trim();if(!name)fail('Candidate name is required.');
   const result=f['Result']==='PASS'?'PASS':f['Result']==='FAIL'?'FAIL':'';if(!result)fail('Select the trial Result (PASS / FAIL) before saving.');
   const prev=(await pool.query("SELECT data FROM hr_records WHERE kind='trialForms' AND code=$1",[formNo])).rows[0]?.data||{};
   if(prev.site&&trialSite(prev.site)?.code!==trialSite(input.site)?.code)fail('The trial form belongs to another site.',403);
   const record={...prev,formNo,heading:String(input.heading||'').slice(0,120),site:String(input.site||'').slice(0,80),company:String(input.company||'').slice(0,120),department:String(input.department||'').slice(0,80),fields:cleanFields(f),stage:'RESULT',status:'Sent to PM for approval',trialBy:String(input.trialBy||f['Examiner name']||profile.name||profile.actor).slice(0,80),resultBy:profile.actor,resultAt:new Date().toISOString(),savedBy:profile.actor,savedAt:new Date().toISOString()};
   const message=trialResultMessage(record,profile.name||profile.actor);
   const recipients=(await hierarchyRecipients(pool,'result',{site:record.site,region:input.region,company:record.company,group:input.group})).map(recipientActor).filter(notSender(profile.actor));
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
    if(recipients.length)await queueTelegram(db,`trial:${formNo}:${result}:${Date.now()}`,recipients,message,trialBot());});
   const connected=(await pool.query(`SELECT actor FROM hr_telegram_accounts WHERE ${trialConnectedSql()} AND actor = ANY($2)`,[mtEnabled(),recipients])).rows.map(r=>r.actor.replace(/^trial:/,''));
   const pendingNote=(await pool.query("SELECT actor,last_error FROM hr_telegram_outbox WHERE bot IN ('trial','trial-status') AND state<>'SENT' AND last_error IS NOT NULL AND actor = ANY($1) ORDER BY id DESC LIMIT 5",[recipients])).rows;
   return {saved:true,id,result,telegram:{recipients:recipients.length,connected,message,bot:trialUsername(),configured:trialConfigured(),issues:pendingNote.map(r=>`${r.actor.replace(/^trial:/,'')}: ${r.last_error}`)}};
  }
  if(route==='disconnect'&&method==='POST'){await tx(async db=>{
   await db.query('DELETE FROM hr_telegram_link_tokens WHERE actor=$1',[profile.actor]);
   await db.query('DELETE FROM hr_telegram_accounts WHERE actor=$1',[profile.actor]);
  });return {disconnected:true};}
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
  if(workflowChatIds.includes(bot)&&bot!=='trial-status'&&bot!=='leave-request'){
   const message=update.message;
   if(message?.chat?.type==='private'&&message.from?.id===message.chat.id&&/^\/(start|help)(?:@\w+)?(?:\s|$)/.test(message.text||'')){
    const {title,workflow}=workflowChats[bot];
    await sendTelegram(message.chat.id,`${title} is available in HRMS. Sign in with your Pulse account to use this workflow.`,bot,{inline_keyboard:[
     [{text:`Open ${title}`,url:workflowUrl(workflow)}],
     [{text:'CMLL HR menu and notifications',url:'https://t.me/CMLLHRBOT?start=menu'}]
    ]});
   }
   return {ok:true};
  }
  const mt=bot==='mt';
  const name=cmllHrEnabled()?'CMLL HR':'MT HR';
  const connectedColumn=mainBotConnectionColumn();
  let callback=null;
  let menu=null,reply=null;
  await tx(async db=>{
   const updates=mt?'hr_telegram_mt_updates':bot==='trial-status'?'hr_telegram_trial_status_updates':bot==='leave-request'?'hr_telegram_leave_request_updates':'hr_telegram_updates';
   if(!(await db.query(`INSERT INTO ${updates}(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id`,[update.update_id])).rowCount)return;
   const cb=update.callback_query;
   const action=String(cb?.data||'');
   if(mt&&cb){
    const linked=cb.from?.id&&(await db.query(`SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 AND ${connectedColumn}`,[String(cb.from.id)])).rowCount;
    if(!linked){callback={bot,id:cb.id,text:'Link your Telegram account in HRMS first.'};return;}
    if(action==='mt:trial'||action==='mt:joining'){
     callback={bot,id:cb.id,text:action==='mt:trial'?'Your assigned vehicle trial results and approvals arrive in this chat.':'Your assigned joining requests and approvals arrive in this chat.'};return;
    }
   }
   if(cb&&(bot==='trial'||bot==='trial-status'||(mt&&action.startsWith('ta:')))){const m=action.match(/^ta:(TA-[0-9A-F]{12}):(a|d)$/);if(!m||!cb.from?.id){callback={bot,id:cb.id,text:'Unknown action'};return;}
    const account=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 AND (trial_connected OR trial_status_connected OR $2)',[String(cb.from.id),mt])).rows[0];const actor=account?.actor?.replace(/^trial:/,'');
    const group=(await db.query("SELECT id,data,status FROM hr_records WHERE kind='trialApprovals' AND code=$1 FOR UPDATE",[m[1]])).rows[0];
    if(!group){callback={bot,id:cb.id,text:'This approval request was not found'};return;}
    if(group.status!=='PENDING'){callback={bot,id:cb.id,text:`Already ${group.data.decision||'handled'}${group.data.decidedBy?' by '+group.data.decidedBy:''}`};return;}
    const g=group.data,role=g.role,target=g.target||{};
    if(m[2]==='a'&&OTP_ROLES.includes(role)){callback={bot,id:cb.id,text:'Approval is by OTP – tell the OTP to Office HR'};return;}
    const allowed=(await hierarchyRecipients(db,ROLE_STEP[role],target)).map(r=>r.actor);
    if(!actor||!allowed.includes(actor)){callback={bot,id:cb.id,text:`Only the ${ROLE_TITLE[role]} for ${target.site||'this site'} can act on this`};return;}
    const approved=m[2]==='a',at=new Date().toISOString(),name=(await db.query("SELECT name FROM hr_records WHERE kind='employees' AND lower(code)=$1",[actor])).rows[0]?.name||cb.from.first_name||actor;
    const stored=(await db.query("SELECT code,data FROM hr_records WHERE kind='trialForms' AND code = ANY($1)",[g.formNos])).rows.filter(r=>r.data.pendingRole===role);
    if(!stored.length){callback={bot,id:cb.id,text:'These forms have already moved on'};return;}
    const rows=stored.map(r=>({formNo:r.code,fields:r.data.fields||{},attachments:r.data.attachments||[],history:[...(r.data.history||[]),historyEntry(role,approved,name,at,approved?'Approved via Telegram':'Declined via Telegram')],docs:r.data.docs||{},site:r.data.site,company:r.data.company,department:r.data.department,batchId:r.data.batchId||'',trialBy:r.data.trialBy||''}));
    await applyTrialStage(pool,db,{rows,reviewer:role,decision:{approved,note:approved?'':'Declined via Telegram',at,by:name,via:'telegram'},target,batchId:g.batchId||'',xlsx:'',actor:actor});
    await db.query("UPDATE hr_records SET status='CLOSED',data=$2,updated_at=now() WHERE id=$1",[group.id,{...g,decision:approved?'approved':'declined',decidedBy:name,decidedAt:at}]);
    if(bot==='trial-status'||!cmllHrEnabled())await queueTelegram(db,`trial-ack:${m[1]}`,[actor],`${approved?'✅':'❌'} ${approved?'Approved':'Declined'} by you (${ROLE_TITLE[role]}) – ${rows.map(r=>r.fields['Name of candidate']||r.formNo).join(', ')}${approved&&NEXT_ROLE[role]!=='done'?'. Sent to '+ROLE_TITLE[NEXT_ROLE[role]]+'.':approved?'. Cleared to join – joining approval sent to all.':'.'}`,trialBot());
    callback={bot,id:cb.id,text:approved?'Approved ✅':'Declined ❌'};return;}
   if(cb&&(bot==='joining'||(mt&&action.startsWith('ja:')))){const m=action.match(/^ja:(JA-[0-9A-F]{12}):(approve|reject)$/);if(!m||!cb.from?.id){callback={bot,id:cb.id,text:'Unknown action'};return;}
    const actor=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 AND (joining_connected OR $2)',[String(cb.from.id),mt])).rows[0]?.actor;
    const row=(await db.query("SELECT data FROM hr_records WHERE kind='joiningApprovals' AND code=$1 FOR UPDATE",[m[1]])).rows[0];
    if(!row){callback={bot,id:cb.id,text:'Request not found'};return;}
    const d=row.data;if(!actor||!(d.approvers||[]).includes(actor)){callback={bot,id:cb.id,text:'You are not an approver for this request'};return;}
    if(d.status!=='PENDING'){callback={bot,id:cb.id,text:`Already ${d.status.toLowerCase()} by ${d.approvedBy||'-'}`};return;}
    if(new Date(d.expires)<new Date()){callback={bot,id:cb.id,text:'Request expired – HR must resend'};return;}
    const approve=m[2]==='approve';Object.assign(d,{status:approve?'APPROVED':'REJECTED',approvedBy:actor,approvedAt:new Date().toISOString(),otpHash:null});
    await db.query("UPDATE hr_records SET data=$2,status=$3,updated_at=now() WHERE kind='joiningApprovals' AND code=$1",[m[1],d,d.status]);
    if(!cmllHrEnabled())await queueTelegram(db,`joining:${m[1]}:done`,d.approvers||[],`${approve?'✅':'❌'} Joining of ${d.candidate||'candidate'} ${approve?'approved':'rejected'} by ${actor}.`,'joining');
    callback={bot,id:cb.id,text:approve?'Approved':'Rejected'};return;}
   const msg=update.message;if(msg?.chat?.type!=='private'||!msg.from?.id||String(msg.chat.id)!==String(msg.from.id))return;
   const token=String(msg.text||'').match(/^\/start(?:@\w+)? ([A-Za-z0-9_-]{32})$/)?.[1];
   if(mt&&!token){
    if(/^\/(start|help)(?:@\w+)?(?: menu)?$/.test(String(msg.text||''))){
     const account=(await db.query(`SELECT ${connectedColumn} AS mt_hr_enabled FROM hr_telegram_accounts WHERE telegram_user_id=$1`,[String(msg.from.id)])).rows[0];
     menu={chat:msg.chat.id,text:account?.mt_hr_enabled?`${name} is connected. Choose a workflow below.`:`Welcome to ${name}. For notifications, open Telegram Hierarchy in HRMS and connect your account.`};
    }
    return;
   }
   if(!token){if(['leave','joining','trial','nagpur','trial-status','leave-request'].includes(bot)&&/^\/start/.test(String(msg.text||''))){const known=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(msg.from.id)])).rows[0];if(known){const column=bot==='leave-request'?'leave_request_connected':bot==='trial-status'?'trial_status_connected':bot==='nagpur'?'nagpur_connected':bot==='trial'?'trial_connected':bot==='joining'?'joining_connected':'leave_connected';await db.query(`UPDATE hr_telegram_accounts SET ${column}=true,linked_at=now() WHERE actor=$1`,[known.actor]);await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot=$2 AND state IN ('PENDING','FAILED')",[known.actor,bot]);await queueTelegram(db,`${bot}-start:`+update.update_id,[known.actor],bot==='leave-request'?LEAVE_REQUEST_CONNECTED:bot==='trial-status'?TRIAL_STATUS_CONNECTED:bot==='trial'?'Connected. Vehicle trial results from Caliber HR will appear here.':bot==='joining'?'Connected. Joining approval requests from Caliber HR will appear here.':bot==='nagpur'?'Connected. Employee addition approvals from Caliber HR will appear here with Approve / Reject buttons.':'Your Telegram account is connected to Caliber HR.',bot);}else if(bot==='trial-status')reply={chat:msg.chat.id,text:TRIAL_STATUS_WELCOME,bot};else if(bot==='leave-request')reply={chat:msg.chat.id,text:LEAVE_REQUEST_WELCOME,bot};}return;}
   const link=(await db.query('DELETE FROM hr_telegram_link_tokens WHERE hash=$1 AND expires_at>now() RETURNING actor,bot',[hash(mt?(cmllHrEnabled()?'cmll:':'mt:')+token:token)])).rows[0];
   if((!link||link.bot!==bot)&&bot==='leave-request'){   /* a used, replaced or old link: a Telegram account HR already knows joins anyway */
    const known=(await db.query('SELECT actor,leave_request_connected FROM hr_telegram_accounts WHERE telegram_user_id=$1',[String(msg.from.id)])).rows[0];
    if(known?.leave_request_connected){reply={chat:msg.chat.id,text:LEAVE_REQUEST_ALREADY,bot};return;}
    if(known){
     await db.query('UPDATE hr_telegram_accounts SET leave_request_connected=true,linked_at=now() WHERE actor=$1',[known.actor]);
     await db.query("DELETE FROM hr_telegram_link_tokens WHERE actor=$1 AND bot='leave-request'",[known.actor]);
     await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot=$2 AND state IN ('PENDING','FAILED')",[known.actor,bot]);
     await queueTelegram(db,'leave-request-start:'+update.update_id,[known.actor],LEAVE_REQUEST_CONNECTED,bot);return;
    }
   }
   if(!link||link.bot!==bot){if(bot==='trial-status'||bot==='leave-request')reply={chat:msg.chat.id,text:`This link has expired or was already used. Ask HR for a new ${bot==='leave-request'?'Leave Request':'Trial Status'} link.`,bot};if(mt)menu={chat:msg.chat.id,text:'This link has expired or was already used. Request a new link in HRMS.'};return;}
   const taken=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE telegram_user_id=$1 OR chat_id=$1',[String(msg.from.id)])).rows[0];
   if(taken&&taken.actor!==link.actor){if(bot==='trial-status'||bot==='leave-request')reply={chat:msg.chat.id,text:'This Telegram account is already linked to another HRMS login.',bot};if(mt)menu={chat:msg.chat.id,text:'This Telegram account is already linked to another HRMS account.'};return;}
   if(mt){
    await db.query(`INSERT INTO hr_telegram_accounts(actor,chat_id,telegram_user_id,leave_connected,${connectedColumn}) VALUES($1,$2,$2,false,true) ON CONFLICT(actor) DO UPDATE SET chat_id=$2,telegram_user_id=$2,linked_at=now(),${connectedColumn}=true`,[link.actor,String(msg.from.id)]);
    await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND (bot IN ('leave','trial','joining','mt') OR ($2 AND bot='nagpur')) AND state IN ('PENDING','FAILED')",[link.actor,cmllHrEnabled()]);
    await queueTelegram(db,'mt-linked:'+update.update_id,[link.actor],`${name} is connected. Your HR notifications will appear here.`,'mt',mtMenu());
    return;
   }
   const flags=[bot==='leave',bot==='trial',bot==='joining',bot==='nagpur',bot==='trial-status',bot==='leave-request'];
   await db.query('INSERT INTO hr_telegram_accounts(actor,chat_id,telegram_user_id,leave_connected,trial_connected,joining_connected,nagpur_connected,trial_status_connected,leave_request_connected) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(actor) DO UPDATE SET chat_id=$2,telegram_user_id=$2,linked_at=now(),leave_request_connected=hr_telegram_accounts.leave_request_connected OR $8,leave_connected=hr_telegram_accounts.leave_connected OR $3,trial_connected=hr_telegram_accounts.trial_connected OR $4,joining_connected=hr_telegram_accounts.joining_connected OR $5,nagpur_connected=hr_telegram_accounts.nagpur_connected OR $6,trial_status_connected=hr_telegram_accounts.trial_status_connected OR $7,mt_hr_enabled=hr_telegram_accounts.telegram_user_id=$2 AND hr_telegram_accounts.mt_hr_enabled,cmll_hr_connected=hr_telegram_accounts.telegram_user_id=$2 AND hr_telegram_accounts.cmll_hr_connected',[link.actor,String(msg.from.id),...flags]);
   await db.query("UPDATE hr_telegram_outbox SET next_attempt=now(),state='PENDING',attempts=0,last_error=NULL WHERE actor=$1 AND bot=$2 AND state IN ('PENDING','FAILED')",[link.actor,bot]);
   if(bot==='leave-request')await db.query("DELETE FROM hr_telegram_link_tokens WHERE actor=$1 AND bot='leave-request'",[link.actor]);   /* joined: the person's other links are done */
   await queueTelegram(db,'linked:'+update.update_id,[link.actor],bot==='leave-request'?LEAVE_REQUEST_CONNECTED:bot==='trial-status'?TRIAL_STATUS_CONNECTED:bot==='trial'?'Connected. Vehicle trial results from Caliber HR will appear here.':bot==='joining'?'Connected. Joining approval requests from Caliber HR will appear here.':'Your Telegram account is connected to Caliber HR. Leave notifications will appear here.',bot);
  });
  if(callback)await answerCallback(callback.bot,callback.id,callback.text);
  if(reply){try{await sendTelegram(reply.chat,reply.text,reply.bot||'trial-status');}catch{/* the person can tap Start again */}}
  if(menu){
   try{await sendTelegram(menu.chat,menu.text,'mt',mtMenu());}
   catch(error){if(error?.code!=='NOT_STARTED'){await pool.query('DELETE FROM hr_telegram_mt_updates WHERE id=$1',[update.update_id]);throw error;}}
  }
  return {ok:true};
 }
 };
}
const telegramError=result=>Object.assign(new Error('Telegram delivery failed'),{code:result.error_code===401?'BAD_TOKEN':result.error_code===403||/chat not found/i.test(result.description||'')?'NOT_STARTED':'FAILED',description:result.description});
async function sendTelegram(chat,text,bot='leave',markup=null,files=[]){
 const token=botToken(bot);if(!token)throw Object.assign(new Error('Bot not configured'),{code:'NO_BOT'});
 for(const part of splitTelegram(text)){const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text:part,...(markup?{reply_markup:markup}:bot==='leave'?{reply_markup:{inline_keyboard:[[{text:'Open HRMS',url:'https://hrpulse.cmll.in/#Employee%20Master'}]]}}:{})}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!result.ok)throw telegramError(result);}
 for(const f of files){const form=new FormData();form.append('chat_id',String(chat));if(f.caption)form.append('caption',String(f.caption).slice(0,1000));form.append('document',new Blob([f.data],{type:f.mime||'application/octet-stream'}),f.name||'file');
  const response=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!result.ok)throw telegramError(result);}
}
/* Each 5-second sweep looks at up to DELIVERY_SCAN due messages and sends at most DELIVERY_SENDS of them.
   Messages for people who have not linked a bot are only pushed back 5 minutes (no network call), so a long list of
   them can no longer hold up a message that can be delivered, such as the PM's trial OTP (20 Nov 2026). */
const DELIVERY_SCAN=100,DELIVERY_SENDS=5;
export async function deliverTelegram(pool,send=sendTelegram){
 if(!Object.keys(botSettings).some(bot=>botToken(bot)))return;
 const db=await pool.connect();try{
  await db.query('BEGIN');
  const connectedColumn=mainBotConnectionColumn();
  const jobs=(await db.query(`SELECT o.*,a.${connectedColumn} AS mt_hr_enabled,CASE WHEN ($1 AND a.${connectedColumn} AND (o.bot IN ('leave','trial','joining','mt') OR ($2 AND o.bot='nagpur'))) OR (o.bot='trial' AND a.trial_connected) OR (o.bot='trial-status' AND a.trial_status_connected) OR (o.bot='leave-request' AND a.leave_request_connected) OR (o.bot='joining' AND a.joining_connected) OR (o.bot='leave' AND a.leave_connected) OR (o.bot='nagpur' AND a.nagpur_connected) THEN a.chat_id END AS chat_id FROM hr_telegram_outbox o LEFT JOIN hr_telegram_accounts a ON a.actor=o.actor WHERE o.state='PENDING' AND o.next_attempt<=now() ORDER BY o.id LIMIT ${DELIVERY_SCAN} FOR UPDATE OF o SKIP LOCKED`,[mtEnabled(),cmllHrEnabled()])).rows;
  let sends=0;
  for(const job of jobs){
   if(!job.chat_id&&job.bot==='nagpur')job.chat_id=nagpurRecipients()[job.actor]||null;
   const bot=job.bot==='trial-status'||job.bot==='leave-request'?job.bot:(job.bot!=='nagpur'||cmllHrEnabled())&&job.mt_hr_enabled&&mtEnabled()?'mt':job.bot||'leave';
   if(!job.chat_id||(cmllHrEnabled()&&bot!=='mt'&&!botToken(bot))){await db.query("UPDATE hr_telegram_outbox SET next_attempt=now()+interval '5 minutes',last_error='Recipient has not connected Telegram' WHERE id=$1",[job.id]);continue;}
   if(sends>=DELIVERY_SENDS)continue;   /* stays due: the next sweep sends it */
   sends++;
   try{const files=job.files?.length?(await db.query('SELECT name,mime,data,caption FROM hr_telegram_files WHERE id = ANY($1) ORDER BY id',[job.files])).rows:[];await send(job.chat_id,job.message,bot,job.markup||(bot==='mt'?mtMenu():null),files);await db.query("UPDATE hr_telegram_outbox SET state='SENT',sent_at=now(),last_error=NULL WHERE id=$1",[job.id]);}
   catch(error){const reason=error?.code==='NO_BOT'?`${botLabel(bot)} is not configured on the server`:error?.code==='BAD_TOKEN'?`${botSettings[bot]||botSettings.leave}_BOT_TOKEN is wrong – Telegram rejected it`:error?.code==='NOT_STARTED'?`Recipient must open @${botUsername(bot)||bot+' bot'} and tap Start`:`Delivery failed${error?.description?': '+error.description:'; recipient may have blocked the bot'}`;
    await db.query("UPDATE hr_telegram_outbox SET attempts=attempts+1,state=CASE WHEN attempts>=9 THEN 'FAILED' ELSE 'PENDING' END,next_attempt=now()+interval '5 minutes',last_error=$2 WHERE id=$1",[job.id,reason]);}
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
