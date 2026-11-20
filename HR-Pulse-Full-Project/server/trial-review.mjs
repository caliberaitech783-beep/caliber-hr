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
