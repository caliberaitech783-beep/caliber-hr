import {canApprove,DOCS,normalizeTrialApproval,type History,type Trial} from './records';

/** Merges a server record into this browser's copy of the same form. The server holds the trainer's result and every
    approval, so a form whose result was entered on another device (the Driver Trainer's phone) still moves on here
    instead of staying "Trial pending" for Site HR. */
export function mergeReviewed(local:Trial,remote:Trial):Trial{
 if(!remote.result||!remote.outcome||local.name!==remote.name||local.mobile!==remote.mobile)return local;
 // Site HR / Driver Trainer steps: the browser's own, else the server's; approvals always from the server.
 const own=local.history.filter(h=>!canApprove(h.role));
 const history=[...own,...remote.history.filter(h=>!canApprove(h.role)&&!own.some(o=>o.role===h.role)),...remote.history.filter(h=>canApprove(h.role))];
 if(local.result!=='PASS'||!local.outcome){
  if(local.stage==='rejected'||local.outcome&&Date.parse(remote.outcome.at)<Date.parse(local.outcome.at))return local;
  return normalizeTrialApproval({...local,result:remote.result,outcome:remote.outcome,stage:remote.stage,history});
 }
 // Keep browser attachments, while the server supplies shared review decisions.
 if(Date.parse(remote.outcome.at)<Date.parse(local.outcome.at||''))return local;
 return normalizeTrialApproval({...local,history});
}

export type ReviewRecord={id:string;formNo:string;site:string;fields:Record<string,string>;history?:History[];resultAt?:string;savedAt?:string;batchId?:string;stage?:string;pendingRole?:string;trialBy?:string;docs?:Record<string,string>};
export function reviewTrial(record:ReviewRecord):Trial|null{
 const f=record.fields||{};
 const result=f.Result==='PASS'?'PASS':f.Result==='FAIL'?'FAIL':'';
 const at=record.resultAt||record.savedAt||'';
 const post=f['If PASS – recommended for']==='Operator'?'Operator':'Driver';
 const machine=f.Machine||f['Vehicle / equipment for trial']||'';
 return normalizeTrialApproval({
  id:record.id,formNo:record.formNo,site:record.site,batch:record.batchId||'',createdAt:at,
  name:f['Name of candidate']||'',father:f["Father's name"]||'',dob:f['Date of birth / Age']||'',
  mobile:f['Mobile no.']||'',aadhaar:f['Aadhaar no.']||'',address:f.Address||'',photo:'',
  post,vehicles:['Other'],otherVehicle:machine,dl:f['Driving licence no.']||'',dlValid:f['DL valid up to dates']||'',
  experience:f['Total experience (years)']||'',employer:f['Previous employer']||'',referredBy:f['Referred by']||'',trialDate:f['Trial date & time']||'',
  docs:Object.fromEntries(DOCS.map(([key])=>[key,{seen:record.docs?.[key]||'',remarks:''}])) as Trial['docs'],
  stage:record.stage==='PART1'?'trainer':record.stage==='REJECTED'?'rejected':result==='FAIL'?'done':'pm',result,history:record.history||[],
  outcome:result?{at,result,post,machine,trainer:f['Trial conducted by']||f['Examiner name']||record.trialBy||'',reason:f['If FAIL – reason']||'',remarks:f['Examiner remarks']||''}:undefined,
 });
}
