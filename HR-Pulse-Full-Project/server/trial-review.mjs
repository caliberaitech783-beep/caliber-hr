export const trialReviewRoles=['pm','ohr','rhr','director'];
export function trialReviewStage(history=[],resultAt=''){
 let index=0;const started=Date.parse(resultAt);
 for(const entry of history){
  if(entry.role!==trialReviewRoles[index]||Number.isFinite(started)&&Date.parse(entry.at)<started)continue;
  if(entry.action==='Rejected')return 'rejected';
  if(entry.action==='Approved')index++;
 }
 return trialReviewRoles[index]||'done';
}
/* Site HR and Driver Trainer sign the form too: their steps are rebuilt from the saved Part 1 and result,
   because the stored history holds only the PM → Directors decisions (owner, 21 Nov 2026).
   names: Pulse login → employee full name, for forms saved before the Site HR's name was stored. */
export function trialHistoryWithSteps(data={},names=new Map()){
 const who=login=>names.get(String(login||'').toLowerCase())||login||'';
 const history=Array.isArray(data.history)?data.history:[];
 const has=role=>history.some(h=>h?.role===role);
 const f=data.fields||{},steps=[];
 if(!has('hr')&&data.part1At)steps.push({role:'hr',action:'Submitted Part 1',by:String(data.part1Name||who(data.part1By)),at:data.part1At});
 if(!has('trainer')&&data.resultAt&&['PASS','FAIL'].includes(f.Result))
  steps.push({role:'trainer',action:'Trial result: '+f.Result,by:String(f['Trial conducted by']||f['Examiner name']||data.trialBy||who(data.resultBy)),at:data.resultAt});
 return [...steps,...history];
}
/* Full names for the logins on older trial forms (employee records linked by Pulse username). */
export async function trialStepNames(db,rows){
 const logins=[...new Set(rows.flatMap(d=>[!d?.part1Name&&d?.part1By,d?.resultBy]).filter(Boolean).map(a=>String(a).toLowerCase()))];
 if(!logins.length)return new Map();
 const found=(await db.query("SELECT lower(COALESCE(NULLIF(data->>'pulseUsername',''),data->>'username')) AS actor,name FROM hr_records WHERE kind='employees' AND lower(COALESCE(NULLIF(data->>'pulseUsername',''),data->>'username')) = ANY($1) ORDER BY updated_at",[logins])).rows;
 return new Map(found.filter(r=>r.name).map(r=>[r.actor,r.name]));
}
/* Once a Director gives the final decision (cleared to join, or rejected) the form is closed for good:
   nobody may change it, enter a new result or send it for approval again (owner, 21 Nov 2026). */
export const DIRECTOR_FINAL_MESSAGE='The Directors have already given the final decision on this candidate. The form cannot be changed or sent for approval again.';
export const DIRECTOR_REJECTED_MESSAGE='The Directors rejected this candidate. A new trial cannot be sent for approval.';
export const directorDecided=data=>!!data&&(data.stage==='CLEARED'
 ||Array.isArray(data.history)&&data.history.some(h=>h?.role==='director'&&['Approved','Rejected'].includes(h.action))
 ||data.stage==='REJECTED'&&data.lastDecision?.reviewer==='director');
