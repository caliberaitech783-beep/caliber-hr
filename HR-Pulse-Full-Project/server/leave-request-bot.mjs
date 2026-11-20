/* CALIBER Leave Request bot (@CMLLLeaveRequestBot, owner, 20 Nov 2026).
   One leave route for every site and office:
     Employee raises the leave → HOD (concerned) → Directors (by OTP) → Regional HR (final approval).
   Directors approve by OTP: Regional HR requests it, any one Director gets it on this bot and tells it to Regional HR,
   who enters it in HRMS. Each message goes only to the people of the next step (never to the sender).
   Everyone with a Pulse login connects once with a personal link (Approval Master › Leave Request bot). */
export const LEAVE_ROUTE=['Employee','HOD','Directors (OTP)','Regional HR'];
export const LEAVE_OTP_MINUTES=15,LEAVE_OTP_ATTEMPTS=5;
const users=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(x=>String(x||'').trim().toLowerCase()).filter(Boolean))];

/* The approval steps of one leave request. The person who raises it is never an approver of their own leave:
   an HOD raising their own leave skips the HOD step; a Director's leave goes to the other Directors. */
export function leaveSteps(config,hod,requester=''){
 const me=String(requester||'').trim().toLowerCase();
 const steps=[
  {label:'HOD (concerned) — any one',approvers:users(hod)},
  {label:'Directors — approve by OTP, any one',approvers:users(config.directors),otp:true},
  {label:'Regional HR — final approval, any one',approvers:users(config.regionalHr)},
 ].map(step=>({...step,approvers:step.approvers.filter(actor=>actor!==me)})).filter(step=>step.approvers.length);
 /* The OTP is entered by the next step (Regional HR). If Regional HR raised the leave, the other Directors approve it directly. */
 return steps.map((step,index)=>{const {otp,...rest}=step;return {...rest,stage:index+1,...(otp&&index<steps.length-1?{otp:true}:{})};});
}
export const otpStep=steps=>steps.findIndex(step=>step.otp);

/* recipients for the roster: employees with a Pulse login and every approver on the saved leave routes. */
export function leaveRequestRoster({employees=[],flows=[]}){
 const people=new Map();
 const add=(actor,role,site)=>{actor=String(actor||'').trim().toLowerCase();if(!/^[-a-z0-9_.@]{1,100}$/.test(actor))return;
  const person=people.get(actor)||{actor,name:'',steps:new Map()};const sites=person.steps.get(role)||new Set();if(site)sites.add(site);person.steps.set(role,sites);people.set(actor,person);return person;};
 for(const flow of flows){
  if(!flow?.data?.enabled)continue;const site=flow.name,d=flow.data;
  for(const hod of Object.values(d.hods||{}))for(const actor of users(hod))add(actor,'HOD',site);
  for(const actor of users(d.directors))add(actor,'Directors (OTP)',site);
  for(const actor of users(d.regionalHr))add(actor,'Regional HR',site);
 }
 for(const e of employees){const person=add(e.actor,'Employee',e.site);if(person&&!person.name)person.name=e.name||'';}
 const allSites=role=>new Set([...people.values()].flatMap(p=>[...(p.steps.get(role)||[])]));
 const rank=p=>Math.max(...[...p.steps.keys()].map(role=>LEAVE_ROUTE.indexOf(role)));   /* approvers first, then employees */
 return [...people.values()].sort((a,b)=>rank(b)-rank(a)||a.actor.localeCompare(b.actor)).map(p=>({
  actor:p.actor,name:p.name,
  stage:LEAVE_ROUTE[rank(p)],
  roles:LEAVE_ROUTE.filter(role=>p.steps.has(role)).map(role=>{const list=[...p.steps.get(role)];
   return `${role} · ${list.length>1&&list.length===allSites(role).size&&role!=='Employee'?'all sites':list.join(', ')||'—'}`;}),
 }));
}
export function leaveRequestInvite({roles,url,botUsername}){
 return ['🔗 Join CALIBER Leave Request','',
  `Leave requests now come on @${botUsername}: your own leave status, and leave waiting for your approval.`,
  'Route: Employee → HOD → Directors (OTP) → Regional HR (final)',
  `You: ${roles.join('; ')}`,'',
  'Tap this link and press Start (valid 7 days):',url].join('\n');
}
export const LEAVE_REQUEST_CONNECTED='Connected to CALIBER Leave Request. Your leave status, and leave waiting for your approval, will arrive here.';
export const LEAVE_REQUEST_WELCOME='Welcome to CALIBER Leave Request. Ask HR for your personal join link (Approval Master › Leave Request bot), open it and tap Start. Raise leave in HRMS › Leave.';

const fmt=value=>value?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(value)):'–';
const leaveLines=(record,siteName)=>[`🏢 Site: ${siteName||'–'}`,`🆔 Request ID: ${record.code}`,`👤 Employee: ${record.data?.employeeName||record.name||'–'}`,`📅 Leave: ${fmt(record.data?.fromDate)} to ${fmt(record.data?.toDate)} (${record.data?.days??'–'} day${Number(record.data?.days)===1?'':'s'})`,`📝 Reason: ${record.data?.name||record.name||'–'}`];
/* To Regional HR when the HOD approves: request the Directors' OTP. */
export function leaveOtpNeededMessage({record,siteName,hod}){
 return ['🔔 DIRECTORS\' OTP NEEDED – LEAVE REQUEST','',...leaveLines(record,siteName),`✅ Approved by HOD: ${hod||'–'}`,'',
  'Open HRMS › Approvals, open this leave and press "Request OTP from Directors". A Director gets the OTP on this bot; ask for it and enter it in HRMS, then give final approval.'].join('\n');
}
/* To the Directors when Regional HR requests the OTP. */
export function leaveOtpMessage({record,siteName,otp,requestedBy}){
 return ['🔐 OTP FOR LEAVE APPROVAL – DIRECTORS','',...leaveLines(record,siteName),`Requested by: ${requestedBy||'Regional HR'} (Regional HR)`,'',
  `OTP: ${otp} (valid ${LEAVE_OTP_MINUTES} min)`,'Tell this OTP to Regional HR to approve the leave. To refuse, decline it in HRMS › Approvals.'].join('\n');
}
