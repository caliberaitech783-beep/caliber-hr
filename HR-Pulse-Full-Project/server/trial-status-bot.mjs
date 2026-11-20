/* CALIBER Trial Status bot (@CMLLTrialStatusBot, owner, 20 Nov 2026).
   Every vehicle trial message goes out on this bot, one stage at a time, only to the people of that stage for the form's site:
     Site HR starts the form → Driver Trainer (trial pass / fail) → PM → Office HR → Regional HR → Directors (final).
   Each person on the route connects once with a personal link (Approval Master › Trial Status bot). */
export const TRIAL_ROUTE_TITLES={
 'HR Manager':'Site HR',
 'Driver Trainer':'Driver Trainer',
 'Project Manager':'PM',
 'Office HR — either one':'Office HR',
 'HR Manager — either one':'Regional HR',
 'Final approval — any one':'Director',
};
const ORDER=Object.keys(TRIAL_ROUTE_TITLES);
/* recipients: hierarchyRecipients(db,'all') – one entry per person, step and site. sites: the trial site names. */
export function trialStatusRoster(recipients,sites){
 const people=new Map(),roleSites=new Map();
 for(const r of recipients){
  if(!sites.includes(r.site)||!TRIAL_ROUTE_TITLES[r.role])continue;
  const actor=String(r.actor||'').trim().toLowerCase();
  if(!/^[-a-z0-9_.@]{1,100}$/.test(actor))continue;
  const person=people.get(actor)||{actor,steps:new Map()};
  const step=person.steps.get(r.role)||new Set();step.add(r.site);person.steps.set(r.role,step);
  people.set(actor,person);
  const all=roleSites.get(r.role)||new Set();all.add(r.site);roleSites.set(r.role,all);
 }
 const rank=p=>Math.min(...[...p.steps.keys()].map(role=>ORDER.indexOf(role)));
 return [...people.values()].sort((a,b)=>rank(a)-rank(b)||a.actor.localeCompare(b.actor)).map(p=>({
  actor:p.actor,
  stage:TRIAL_ROUTE_TITLES[ORDER[rank(p)]],
  roles:ORDER.filter(role=>p.steps.has(role)).map(role=>{const list=[...p.steps.get(role)];return `${TRIAL_ROUTE_TITLES[role]} · ${list.length>1&&list.length===roleSites.get(role).size?'all sites':list.join(', ')}`;}),
 }));
}
export function trialStatusInvite({roles,url,botUsername}){
 return ['🔗 Connect to CALIBER Trial Status','',
  `Vehicle trial forms now come on @${botUsername}, only when it is your turn to act.`,
  'Route: Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors',
  `Your step: ${roles.join('; ')}`,'',
  'Tap this link and press Start (valid 7 days):',url].join('\n');
}
export const TRIAL_STATUS_CONNECTED='Connected to CALIBER Trial Status. Trial forms for your site will arrive here when it is your turn, with ✅ Approve / ❌ Decline buttons where you approve.';
export const TRIAL_STATUS_WELCOME='Welcome to CALIBER Trial Status. Ask HR for your personal connect link (Approval Master › Trial Status bot), open it and tap Start.';
