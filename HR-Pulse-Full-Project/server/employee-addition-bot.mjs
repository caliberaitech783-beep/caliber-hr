/* Employee addition approvals on Telegram (@NagpurEmployeeAdditionBot, TELEGRAM_NAGPUR_BOT_TOKEN), owner 20 Nov 2026.
   Every joining form (site staff and Nagpur office) goes through the outbox on this bot:
   - the approvers of the current step get the request with ✅ Approve / ❌ Reject buttons;
   - a tap decides the request through the same engine as the HR app (service.decide), so it moves up one step;
   - the person who submitted it hears about every step, and everyone on the route hears the final result. */
import {roleTitle} from './site-staff-routing.mjs';
export const ADDITION_BOT='nagpur';
const HR_URL='https://hrpulse.cmll.in/#Employee%20Master';
const clean=value=>String(value??'').trim()||'—';
export function nagpurRecipients(value=process.env.TELEGRAM_NAGPUR_RECIPIENTS){
 if(!value)return {};
 try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return Object.fromEntries(Object.entries(parsed).map(([actor,chatId])=>[actor.trim().toLowerCase(),String(chatId).trim()]).filter(([actor,chatId])=>actor&&/^-?\d+$/.test(chatId)));}
 catch{return {};}
}
const details=record=>{const data=record?.data||{},office=data.officeData&&typeof data.officeData==='object'?data.officeData:{};
 return {code:clean(record?.code),name:clean(record?.name||data.employeeName||office['Employee Name *']),department:clean(office['Department *']||data.department),designation:clean(office['Designation *']||data.designationTitle||data.designation)};};
const route=steps=>steps.map(step=>roleTitle(step.label)).join(' → ');
export function additionApprovalMessage({record,siteName,steps,stage,requestedBy,previousApprover,previousRole}){
 const employee=details(record),step=steps[stage]||{};
 const lines=['👤 Employee Addition — approval required',`Step ${stage+1} of ${steps.length}: ${roleTitle(step.label)}`,'',`Employee: ${employee.name} (${employee.code})`,`Site: ${clean(siteName)}`,`Department: ${employee.department}`,`Designation: ${employee.designation}`,`Initiated by: ${clean(requestedBy)}`];
 if(previousApprover)lines.push(`Approved by: ${clean(previousApprover)}${previousRole?` (${previousRole})`:''}`);
 lines.push('',`Route: ${route(steps)}`,stage+1===steps.length?'Your approval is final: the employee becomes Active.':`After you: ${roleTitle(steps[stage+1]?.label)}`,'','Tap Approve or Reject below, or open Caliber HR.');
 return lines.join('\n');
}
export function additionProgressMessage({record,siteName,steps,stage,actor,actorRole}){
 const employee=details(record);
 return [`✅ Employee Addition — ${clean(actorRole)} approved`,'',`Employee: ${employee.name} (${employee.code})`,`Site: ${clean(siteName)}`,`Approved by: ${clean(actor)}`,`⏳ Now with: ${roleTitle(steps[stage]?.label)} (step ${stage+1} of ${steps.length})`].join('\n');
}
export function additionSubmittedMessage({record,siteName,steps}){
 const employee=details(record);
 return ['📩 Employee Addition submitted','',`Employee: ${employee.name} (${employee.code})`,`Site: ${clean(siteName)}`,`Route: ${route(steps)}`,`⏳ Now with: ${roleTitle(steps[0]?.label)}`].join('\n');
}
/* Office staff steps carry their office (office-staff-routing.mjs): a rejected office form goes back to that office's HR, not Site HR. */
const returnsTo=steps=>{const office=(steps||[]).find(step=>step?.office)?.office;return office?`${office} HR`:'Site HR';};
export function additionDecisionMessage({record,siteName,state,actor,actorRole,comments,decidedAt,steps}){
 const employee=details(record),approved=state==='APPROVED';
 const lines=[approved?'✅ Employee Approved — now Active':'❌ Employee Rejected','',`Employee: ${employee.name} (${employee.code})`,`Site: ${clean(siteName)}`,`Department: ${employee.department}`,`Designation: ${employee.designation}`,`${approved?'Final approval':'Rejected'} by: ${clean(actor)}${actorRole?` (${actorRole})`:''}`];
 if(!approved)lines.push(`Reason: ${clean(comments)}`,`The form goes back to ${returnsTo(steps)} for correction.`);
 lines.push(`Date & time: ${clean(decidedAt)}`);
 return lines.join('\n');
}
export const additionMarkup=(approvalId,stage)=>({inline_keyboard:[[{text:'✅ Approve',callback_data:`ea:${approvalId}:${stage}:a`},{text:'❌ Reject',callback_data:`ea:${approvalId}:${stage}:r`}],[{text:'Open Caliber HR',url:HR_URL}]]});
export function parseAdditionCallback(data){
 const m=String(data||'').match(/^ea:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{1,2}):(a|r)$/i);
 return m?{id:m[1].toLowerCase(),stage:Number(m[2]),approve:m[3]==='a'}:null;
}
/* Telegram user id → Pulse username: linked accounts first, then the TELEGRAM_NAGPUR_RECIPIENTS list
   (a private chat id is the user's id). */
export async function additionActor(db,telegramUserId){
 const id=String(telegramUserId||'');if(!id)return '';
 const linked=(await db.query('SELECT actor FROM hr_telegram_accounts WHERE (telegram_user_id=$1 OR chat_id=$1) AND nagpur_connected=true',[id])).rows[0]?.actor;
 if(linked)return linked;
 return Object.entries(nagpurRecipients()).find(([,chat])=>chat===id)?.[0]||'';
}
/* Queues the Telegram messages for one step of an employee approval (inside the caller's transaction). */
export async function queueAdditionStep(db,queue,{approvalId,record,siteName,steps,stage,state,requestedBy,actor,comments,decidedAt,eventKey}){
 const key=eventKey||`ea:${approvalId}:${stage}:${state}`;
 const actorRole=stage>0?roleTitle(steps[Math.min(stage,steps.length)-1]?.label):'';
 if(state==='SUBMITTED'){
  await queue(db,`${key}:ask`,steps[0]?.approvers||[],additionApprovalMessage({record,siteName,steps,stage:0,requestedBy}),ADDITION_BOT,additionMarkup(approvalId,0));
  await queue(db,`${key}:info`,[requestedBy],additionSubmittedMessage({record,siteName,steps}),ADDITION_BOT);
  return;
 }
 if(state==='PENDING'){
  await queue(db,`${key}:ask`,steps[stage]?.approvers||[],additionApprovalMessage({record,siteName,steps,stage,requestedBy,previousApprover:actor,previousRole:actorRole}),ADDITION_BOT,additionMarkup(approvalId,stage));
  await queue(db,`${key}:info`,[requestedBy],additionProgressMessage({record,siteName,steps,stage,actor,actorRole}),ADDITION_BOT);
  return;
 }
 const decidedRole=roleTitle(steps[Math.max(0,stage-1)]?.label);
 await queue(db,`${key}:done`,[requestedBy,...steps.flatMap(step=>step.approvers||[])],additionDecisionMessage({record,siteName,state,actor,actorRole:decidedRole,comments,decidedAt,steps}),ADDITION_BOT);
}
