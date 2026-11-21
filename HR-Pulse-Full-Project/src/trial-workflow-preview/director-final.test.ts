import {describe,expect,it} from 'vitest';
import {candidateProblem,directorDecided,type Candidate,type Trial} from './records';

/* Owner, 21 Nov 2026: a Director's decision is final; a rejected candidate cannot be sent through a fresh trial. */
const candidate={name:'Vishal',mobile:'1234567894',aadhaar:'123412341234',vehicles:['Dumper/Tipper'],otherVehicle:'',trialDate:'2026-11-21T10:00',
 docs:{dl:{seen:'Yes',remarks:''},medical:{seen:'Yes',remarks:''}}} as unknown as Candidate;
const trial=(stage:string,history:Trial['history'])=>({aadhaar:'123412341234',stage,result:'PASS',history} as unknown as Trial);
const at='2026-11-21T10:00:00Z';

describe('Director final decision',()=>{
 it('blocks a fresh trial for a candidate the Directors rejected',()=>{
  const rejected=trial('rejected',[{role:'director',action:'Rejected',by:'Mohit',at,note:'x'}]);
  expect(directorDecided(rejected)).toBe(true);
  expect(candidateProblem(candidate,[rejected])).toMatch(/Directors rejected/);
 });
 it('still allows a new trial after an earlier step rejected the candidate',()=>{
  const rejected=trial('rejected',[{role:'pm',action:'Rejected',by:'PM',at,note:'x'}]);
  expect(directorDecided(rejected)).toBe(false);
  expect(candidateProblem(candidate,[rejected])).not.toMatch(/Directors rejected/);
 });
});
