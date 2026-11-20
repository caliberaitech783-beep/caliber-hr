import {expect,it} from 'vitest';
import {approvalStage,isClearedForJoining,normalizeTrialApproval,type History} from './records';
import {reviewTrial,type ReviewRecord} from './reviewQueue';
const record:ReviewRecord={id:'trial-id',formNo:'TF/2026-27/0001',site:'Jayant OB East',resultAt:'2026-11-19T12:00:00Z',
 fields:{Result:'PASS','Name of candidate':'Vishal','Mobile no.':'9876543210','If PASS – recommended for':'Driver'}};
const history=(roles:string[]):History[]=>roles.map(role=>({role:role as History['role'],action:'Approved',by:'Reviewer',at:'2026-11-19T12:01:00Z'}));
it('keeps a trainer PASS in the PM queue on another browser',()=>{
 const row=reviewTrial(record)!;
 expect(row.stage).toBe('pm');
 expect(row.name).toBe('Vishal');
 expect(isClearedForJoining({...row,stage:'done'})).toBe(false);
 expect(normalizeTrialApproval({...row,stage:'done'}).stage).toBe('pm');
});
it('requires every approval in order before joining',()=>{
 const roles=['pm','ohr','rhr','director'];
 for(let index=0;index<=roles.length;index++){
  const row=reviewTrial({...record,history:history(roles.slice(0,index))})!;
  expect(row.stage).toBe(roles[index]||'done');
  expect(isClearedForJoining(row)).toBe(index===roles.length);
 }
 expect(approvalStage(history(['director','pm','rhr']))).toBe('ohr');
 expect(approvalStage(history(roles),'2026-11-19T13:00:00Z')).toBe('pm');
 expect(approvalStage([...history(['pm']),{role:'ohr',action:'Rejected',by:'Reviewer',at:''}])).toBe('rejected');
});
