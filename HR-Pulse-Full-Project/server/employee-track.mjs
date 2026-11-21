/* CALIBER Employee Track bot (@ its TELEGRAM_EMPLOYEE_TRACK_BOT_USERNAME), owner, 21 Nov 2026.
   One route for every newly added employee (site staff, drivers / operators, Nagpur office and Chandrapur HO):
     Site HR initiates the form → Regional HR → Directors (approve by OTP) → the employee becomes Active.
   - Site HR is the site's "HR Manager" step in Approval Master › Hierarchy (office HR for the two offices).
     When that Site HR submits, the submission is their step. Anyone else who submits still needs Site HR's approval.
   - Regional HR is fixed per region (site-staff-routing.mjs); for the offices it is that office's HR Manager.
   - Directors approve by OTP only: when Regional HR approves, the OTP goes to the Directors on this bot;
     any one Director tells it to Regional HR, who enters it in HRMS. 15 minutes, single use, five wrong tries.
     Directors can still reject (HRMS or the Reject button on the bot).
   - Each message goes only to the people of the next step, never to the sender; Site HR hears the final result. */
import {SITE_HR_LABEL,REGIONAL_HR_LABEL,SITE_STAFF_DIRECTORS,siteStaffRegionalHr,roleTitle} from './site-staff-routing.mjs';
import {OFFICE_SITES} from './office-staff-routing.mjs';

export const EMPLOYEE_TRACK_ROUTE=['Site HR','Regional HR','Directors (OTP)'];
export const DIRECTORS_OTP_LABEL='Directors — approve by OTP, any one';
export const EMPLOYEE_TRACK_BOT='employee-track';
const HR_URL='https://hrpulse.cmll.in/#Employee%20Master';
const users=list=>[...new Set((list||[]).map(v=>String(v).trim().toLowerCase()).filter(Boolean))];
const clean=value=>String(value??'').trim()||'—';

/* The steps of one new employee. code = the site code; steps = the saved Approval Master › Hierarchy steps of that site,
   used only to find Site HR ("HR Manager") and, for an office, its HR Manager. Returns null for a site outside every region. */
export function employeeTrackSteps({code,steps=[],requester=''}){
 const me=String(requester||'').trim().toLowerCase();
 const office=OFFICE_SITES[code];
 const regionalFixed=siteStaffRegionalHr(code);
 if(!office&&!regionalFixed)return null;
 const siteHr=office?[]:users(steps.find(step=>step.label===SITE_HR_LABEL)?.approvers);
 const regional=office
  ?(users(steps.find(step=>step.label===SITE_HR_LABEL)?.approvers).length?users(steps.find(step=>step.label===SITE_HR_LABEL).approvers):users(office.defaultHrManager))
  :[regionalFixed.username];
 const directors=SITE_STAFF_DIRECTORS.map(d=>d.username);
 const extra=office?{office:office.office}:{};
 const route=[
  /* Site HR initiating: their submission is the Site HR step. */
  ...(siteHr.length&&!siteHr.includes(me)?[{label:SITE_HR_LABEL,approvers:siteHr,...extra}]:[]),
  {label:REGIONAL_HR_LABEL,approvers:regional.filter(a=>a!==me),
   suggested:office?`${office.office} HR Manager`:`${regionalFixed.name} (employee ${regionalFixed.employeeId}) — ${regionalFixed.region} sites`,fixed:true,...extra},
  {label:DIRECTORS_OTP_LABEL,approvers:directors.filter(a=>a!==me),otp:true,otpBy:regional,
   suggested:SITE_STAFF_DIRECTORS.map(d=>d.name).join(' / '),fixed:true,...extra},
 ].filter(step=>step.approvers.length);
 return route.map((step,index)=>{const {otp,otpBy,...rest}=step;
  return {...rest,stage:index+1,...(otp&&otpBy.length?{otp:true,otpBy}:{})};});
}
/* Who enters the Directors' OTP for a step: the step's otpBy (employees), else the next step's approvers (leave). */
export const otpEnterers=(steps,stage)=>steps[stage]?.otpBy||steps[stage+1]?.approvers||[];
export const isEmployeeTrack=steps=>(steps||[]).some(step=>step?.label===DIRECTORS_OTP_LABEL);

/* ---- Messages ---- */
const details=record=>{const data=record?.data||{},office=data.officeData&&typeof data.officeData==='object'?data.officeData:{};
 return {code:clean(record?.code),name:clean(record?.name||data.employeeName||office['Employee Name *']),department:clean(office['Department *']||data.department),designation:clean(office['Designation *']||data.designationTitle||data.designation)};};
const head=(record,siteName)=>{const e=details(record);return [`👤 Employee: ${e.name} (${e.code})`,`🏢 Site: ${clean(siteName)}`,`🧾 Department: ${e.department}`,`🪪 Designation: ${e.designation}`];};
const routeLine=steps=>`Route: ${['Site HR',...steps.map(step=>roleTitle(step.label))].filter((role,i,all)=>all.indexOf(role)===i).join(' → ')}`;
export function trackApprovalMessage({record,siteName,steps,stage,requestedBy,previous}){
 const step=steps[stage]||{};
 return ['🆕 NEW EMPLOYEE — APPROVAL REQUIRED',`Step ${stage+1} of ${steps.length}: ${roleTitle(step.label)}`,'',...head(record,siteName),`✍️ Initiated by: ${clean(requestedBy)}`,
  ...(previous?[`✅ Approved by: ${previous}`]:[]),'',routeLine(steps),
  steps[stage+1]?.otp?"After you approve, the Directors get an OTP on this bot. Ask any one Director for it and enter it in HRMS › Approvals: that makes the employee Active.":'',
  'Tap Approve or Reject below, or open Caliber HR.'].filter(line=>line!=='').join('\n');
}
export function trackOtpMessage({record,siteName,otp,requestedBy,minutes}){
 return ["🔐 OTP FOR NEW EMPLOYEE — DIRECTORS",'',...head(record,siteName),`✅ Approved by Regional HR: ${clean(requestedBy)}`,'',
  `OTP: ${otp} (valid ${minutes} min)`,'Tell this OTP to Regional HR to approve: the employee becomes Active. To refuse, tap Reject below or reject in HRMS.'].join('\n');
}
export function trackResultMessage({record,siteName,state,actor,comments,steps,at}){
 const approved=state==='APPROVED',office=(steps||[]).find(step=>step?.office)?.office;
 const lines=[approved?'✅ NEW EMPLOYEE APPROVED — NOW ACTIVE':'❌ NEW EMPLOYEE REJECTED','',...head(record,siteName),
  `${approved?"Directors' OTP entered by":'Rejected by'}: ${clean(actor)}`];
 if(!approved)lines.push(`📝 Reason: ${clean(comments)}`,`The form goes back to ${office?office+' HR':'Site HR'} for correction.`);
 lines.push(`📅 ${clean(at)}`);
 return lines.join('\n');
}
/* Approve / Reject at an ordinary step; at the Directors' OTP step only Reject (approval is by OTP). */
export const trackMarkup=(approvalId,stage,otp=false)=>({inline_keyboard:[
 otp?[{text:'❌ Reject',callback_data:`ea:${approvalId}:${stage}:r`}]
  :[{text:'✅ Approve',callback_data:`ea:${approvalId}:${stage}:a`},{text:'❌ Reject',callback_data:`ea:${approvalId}:${stage}:r`}],
 [{text:'Open Caliber HR',url:HR_URL}]]});

/* Queues the next step's message (inside the caller's transaction). The OTP step's message is sent by the OTP issuer. */
export async function queueTrackStep(db,queue,bot,{approvalId,record,siteName,steps,stage,state,requestedBy,sender,actor,comments,decidedAt,key}){
 const notSender=list=>users(list).filter(person=>person!==sender);
 if(state==='SUBMITTED'||state==='PENDING'){
  const step=steps[stage];if(!step||step.otp)return [];
  const to=notSender(step.approvers);
  await queue(db,`${key}:ask`,to,trackApprovalMessage({record,siteName,steps,stage,requestedBy,previous:state==='PENDING'?actor:''}),bot,trackMarkup(approvalId,stage));
  return to;
 }
 /* Final: Site HR (who initiated) hears the result; a rejection also tells the earlier approvers it went back. */
 const earlier=state==='REJECTED'?steps.slice(0,Math.max(0,stage-1)).flatMap(step=>step.approvers):[];
 const to=notSender([requestedBy,...earlier]);
 await queue(db,`${key}:done`,to,trackResultMessage({record,siteName,state,actor,comments,steps,at:decidedAt}),bot);
 return to;
}

/* ---- Approval Master › Employee Track bot: everyone on the route, with a personal join link ---- */
export function employeeTrackRoster({sites=[],saved=[]}){
 const people=new Map();
 const add=(actor,role,place)=>{const a=String(actor||'').trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(a))return;
  const p=people.get(a)||{actor:a,steps:new Map()};const list=p.steps.get(role)||new Set();if(place)list.add(place);p.steps.set(role,list);people.set(a,p);};
 for(const site of sites){
  const row=saved.find(r=>r.code===site.code);
  const office=OFFICE_SITES[site.code];
  if(office){
   const steps=row?.data?.steps||[];
   const officeHr=users(steps.find(s=>s.label==='HR Executive')?.approvers);
   for(const a of officeHr.length?officeHr:office.defaultOfficeHr||[])add(a,'Site HR',office.office);
   const managers=users(steps.find(s=>s.label==='HR Manager')?.approvers);
   for(const a of managers.length?managers:office.defaultHrManager)add(a,'Regional HR',office.office);
   continue;
  }
  const regional=siteStaffRegionalHr(site.code);if(!regional)continue;
  add(regional.username,'Regional HR',site.name);
  if(row&&row.status==='ACTIVE')for(const a of users((row.data?.steps||[]).find(s=>s.label===SITE_HR_LABEL)?.approvers))add(a,'Site HR',site.name);
 }
 for(const d of SITE_STAFF_DIRECTORS)add(d.username,'Directors (OTP)','');
 const rank=p=>Math.max(...[...p.steps.keys()].map(role=>EMPLOYEE_TRACK_ROUTE.indexOf(role)));
 return [...people.values()].sort((a,b)=>rank(b)-rank(a)||a.actor.localeCompare(b.actor)).map(p=>({actor:p.actor,stage:EMPLOYEE_TRACK_ROUTE[rank(p)],
  roles:EMPLOYEE_TRACK_ROUTE.filter(role=>p.steps.has(role)).map(role=>{const list=[...p.steps.get(role)];return list.length?`${role} · ${list.join(', ')}`:`${role} · all sites`;})}));
}
export function employeeTrackInvite({roles,url,botUsername}){
 return ['🔗 Join CALIBER Employee Track','',
  `New employee approvals now come on @${botUsername}: forms waiting for you, with ✅ Approve / ❌ Reject buttons.`,
  `Route: ${EMPLOYEE_TRACK_ROUTE.join(' → ')}`,
  `You: ${roles.join('; ')}`,'',
  'Tap this link and press Start (valid 7 days):',url].join('\n');
}
export const EMPLOYEE_TRACK_CONNECTED='Connected to CALIBER Employee Track. New employee forms waiting for your approval, and the result of the ones you started, will arrive here.';
export const EMPLOYEE_TRACK_ALREADY="You're already connected to CALIBER Employee Track. New employee forms waiting for your approval will arrive here.";
export const EMPLOYEE_TRACK_WELCOME='Welcome to CALIBER Employee Track. Ask HR for your personal join link (Approval Master › Employee Track bot), open it and tap Start. Site HR starts a new employee in HRMS › Employee Management.';
