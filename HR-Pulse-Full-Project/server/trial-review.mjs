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
   because the stored history holds only the PM → Directors decisions (owner, 21 Nov 2026). */
export function trialHistoryWithSteps(data={}){
 const history=Array.isArray(data.history)?data.history:[];
 const has=role=>history.some(h=>h?.role===role);
 const f=data.fields||{},steps=[];
 if(!has('hr')&&data.part1At)steps.push({role:'hr',action:'Submitted Part 1',by:String(data.part1Name||data.part1By||''),at:data.part1At});
 if(!has('trainer')&&data.resultAt&&['PASS','FAIL'].includes(f.Result))
  steps.push({role:'trainer',action:'Trial result: '+f.Result,by:String(f['Trial conducted by']||f['Examiner name']||data.trialBy||data.resultBy||''),at:data.resultAt});
 return [...steps,...history];
}
