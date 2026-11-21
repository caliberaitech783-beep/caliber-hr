import {expect,it} from 'vitest';
import {approvalStage,isClearedForJoining,normalizeTrialApproval,type History} from './records';
import {mergeReviewed,reviewTrial,type ReviewRecord} from './reviewQueue';
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
it('names the Site HR and Driver Trainer in the approvals of a form from the server',async()=>{
 const {detailView}=await import('./views');
 const row=reviewTrial({...record,fields:{...record.fields,'Trial conducted by':'SANTOSH KUMAR MOHANTA'},
  history:[{role:'hr',action:'Submitted Part 1',by:'AMIT SINGH',at:'2026-11-19T05:00:00Z'},...history(['pm'])]})!;
 const box=document.createElement('div');box.innerHTML=detailView(row,'observer');
 const sigs=box.querySelector('.sigs')!.textContent!;
 expect(sigs).toContain('Site HRSubmitted Part 1AMIT SINGH19-11-2026');
 expect(sigs).toContain('Driver TrainerPASSSANTOSH KUMAR MOHANTA19-11-2026');
});
it('clears a form for Site HR when the trainer entered PASS on another device',()=>{
 const remote=reviewTrial({...record,history:history(['pm','ohr','rhr','director'])})!;
 const local={...reviewTrial({...record,stage:'PART1',fields:{...record.fields,Result:''}})!,photo:'local-photo',
  history:[{role:'hr' as const,action:'Submitted',by:'Site HR',at:'2026-11-19T11:00:00Z'}]};
 expect(local.stage).toBe('trainer');
 const merged=mergeReviewed(local,remote);
 expect(merged.stage).toBe('done');
 expect(merged.result).toBe('PASS');
 expect(merged.photo).toBe('local-photo');
 expect(merged.history.map(h=>h.role)).toEqual(['hr','pm','ohr','rhr','director']);
 expect(isClearedForJoining(merged)).toBe(true);
 expect(mergeReviewed(local,reviewTrial({...record,stage:'PART1',fields:{...record.fields,Result:''}})!)).toBe(local);
 expect(mergeReviewed({...local,stage:'rejected'},remote).stage).toBe('rejected');
});
