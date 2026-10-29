const nagpurSiteCode='CMLL-CO';
const employeeMasterUrl='https://hrpulse.cmll.in/#Employee%20Master';

function recipientsFrom(value){
 if(!value)return {};
 try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return Object.fromEntries(Object.entries(parsed).map(([actor,chatId])=>[actor.trim().toLowerCase(),String(chatId).trim()]).filter(([actor,chatId])=>actor&&/^-?\d+$/.test(chatId)));}
 catch{return {};}
}
const clean=value=>String(value??'').trim()||'—';
const details=record=>{const data=record?.data||{},office=data.officeData&&typeof data.officeData==='object'?data.officeData:{};return {code:clean(record?.code),name:clean(record?.name),department:clean(office['Department *']||data.department),designation:clean(office['Designation *']||data.designation)};};

export function nagpurApprovalMessage({record,step,stage,total,requestedBy,previousApprover}){
 const employee=details(record),lines=['👤 Nagpur Employee Addition',`Approval required — Stage ${stage} of ${total}`,'',`Employee: ${employee.name} (${employee.code})`,'Site: Nagpur Office',`Department: ${employee.department}`,`Designation: ${employee.designation}`,`Submitted by: ${clean(requestedBy)}`];
 if(previousApprover)lines.push(`Previous stage approved by: ${clean(previousApprover)}`);
 lines.push(`Current stage: ${clean(step?.label)}`,`Approver: ${(step?.approvers||[]).map(clean).join(' / ')||'—'}`,'','Open Caliber HR:',employeeMasterUrl);
 return lines.join('\n');
}
export function nagpurDecisionMessage({record,state,approver,comments,decidedAt}){
 const employee=details(record),approved=state==='APPROVED',lines=[approved?'✅ Employee Approved':'❌ Employee Rejected',`Employee: ${employee.name}`,`Employee Code: ${employee.code}`,'Office: Nagpur CO',`Department: ${employee.department}`,`Designation: ${employee.designation}`,approved?`Final approval completed by: ${clean(approver)}`:`Rejected by: ${clean(approver)}`];
 if(!approved)lines.push(`Reason: ${clean(comments)}`);
 lines.push(`Date & Time: ${clean(decidedAt)}`,`Status: ${approved?'APPROVED':'REJECTED'}`);
 return lines.join('\n');
}
export function createTelegramNotifier({token=process.env.TELEGRAM_NAGPUR_BOT_TOKEN,recipients=recipientsFrom(process.env.TELEGRAM_NAGPUR_RECIPIENTS),fetchImpl=fetch,logger=console}={}){
 async function send(actors,message){
  let sent=0;
  for(const actor of [...new Set(actors.map(value=>String(value).trim().toLowerCase()).filter(Boolean))]){
   const chatId=recipients[actor];
   if(!chatId){logger.warn?.(`Telegram recipient is not configured for Pulse username ${actor}`);continue;}
   const response=await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true})});
   if(!response.ok){logger.error?.(`Telegram notification failed for ${actor}: ${response.status}`);continue;}
   sent++;
  }
  return sent;
 }
 async function approvalRequested(input){
  if(input.siteCode!==nagpurSiteCode||!token)return {sent:0,skipped:true};
  const sent=await send(input.step?.approvers||[],nagpurApprovalMessage(input));
  return {sent,skipped:false};
 }
 async function finalDecision(input){
  if(input.siteCode!==nagpurSiteCode||!token||!['APPROVED','REJECTED'].includes(input.state))return {sent:0,skipped:true};
  const sent=await send(input.recipients||[],nagpurDecisionMessage(input));
  return {sent,skipped:false};
 }
 return {approvalRequested,finalDecision};
}
