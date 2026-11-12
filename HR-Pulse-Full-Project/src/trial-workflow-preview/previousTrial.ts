import {api} from '../api';
import type {TrialMatch} from '../TrialAadhaarHistory';
import {equipment,type Trial} from './records';

export type PreviousTrial = {match?:TrialMatch;unavailable:boolean};

function fromBrowser(row:Trial,aadhaar:string):TrialMatch[] {
  if (row.aadhaar?.replace(/\D/g,'')!==aadhaar || row.stage==='rejected' || (row.result!=='PASS'&&row.result!=='FAIL')) return [];
  return [{
    formNo:row.formNo,result:row.result,site:row.site,trialDate:row.trialDate,savedAt:row.outcome?.at||row.createdAt,
    equipment:row.outcome?.machine||equipment(row),failureReason:row.outcome?.reason,
  }];
}

function dateValue(match:TrialMatch) {
  return Date.parse(match.trialDate)||Date.parse(match.savedAt)||0;
}

export async function findPreviousTrial(aadhaar:string,rows:Trial[],grant:string):Promise<PreviousTrial> {
  const matches=rows.flatMap(row=>fromBrowser(row,aadhaar));
  let unavailable=false;
  try {
    const result=await api<{matches:TrialMatch[]}>(grant,'telegram/trial-history','POST',{aadhaar});
    matches.push(...result.matches.filter(match=>match.result==='PASS'||match.result==='FAIL'));
  } catch {
    unavailable=true;
  }
  // A recorded pass takes priority, as in the existing duplicate-trial check.
  matches.sort((left,right)=>Number(right.result==='PASS')-Number(left.result==='PASS')||dateValue(right)-dateValue(left));
  return {match:matches[0],unavailable};
}
