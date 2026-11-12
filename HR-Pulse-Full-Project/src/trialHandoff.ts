import {listJoiningDrafts,saveJoiningDraft,type JoiningDraft} from './joiningDrafts';
import type {TrialSelection} from './TrialForm';
import type {Trial} from './trial-workflow-preview/records';

const HANDOFF_KEY='hrPulse.trialHandoff';
/* A passed trial candidate waiting to be entered in Employee Management. Fields use the joining-form control names. */
export type TrialClearance=Pick<Trial,'id'|'formNo'|'name'|'mobile'|'aadhaar'|'site'|'post'|'stage'|'result'|'history'>;
export type TrialHandoff={id:string;formNo:string;name:string;site:string;post:string;fields:Record<string,string>;photo?:string;owner?:string;clearance?:TrialClearance};
let handoffPhotos:{photo?:File;photo2?:File}={};
export function saveTrialHandoff(handoff:TrialHandoff,photos:{photo?:File;photo2?:File}){handoffPhotos=photos;try{sessionStorage.setItem(HANDOFF_KEY,JSON.stringify(handoff));}catch{/* ignore */}}
export function loadTrialHandoff():TrialHandoff|null{try{return JSON.parse(sessionStorage.getItem(HANDOFF_KEY)||'null');}catch{return null;}}
export function trialHandoffPhotos(){return handoffPhotos;}
export function clearTrialHandoff(){handoffPhotos={};try{sessionStorage.removeItem(HANDOFF_KEY);}catch{/* ignore */}}

export async function prepareTrialJoining(rows: Trial[], selection: TrialSelection, owner: string) {
 const existing=await listJoiningDrafts(owner);
 const prepared: TrialHandoff[]=[];
 for (const row of rows) {
  if (row.stage!=='done'||row.result!=='PASS'||!row.outcome) continue;
  const post=row.outcome.post;
  if (post!=='Driver'&&post!=='Operator') continue;
  const prior=existing.find(draft=>draft.trialHandoff?.id===row.id);
  if (prior?.trialHandoff) {prepared.push(prior.trialHandoff);continue;}
  const {id,formNo,name,site,mobile,aadhaar,stage,result,history}=row;
  const fields={
   'Full Name':name,'Full Name as per Aadhaar':name,'Father / Spouse Name':row.father,
   'Date of Birth':row.dob,Mobile:mobile,'Aadhaar No.':aadhaar,'Permanent Address':row.address,
   'Reference Name':row.referredBy,'Driving Licence No.':row.dl,'DL Valid Upto':row.dlValid,
   'Employer Name 1':row.employer,'Trial Form No.':formNo,'Trial Result':`PASS – ${post}${row.outcome.machine?' · '+row.outcome.machine:''}`,
  };
  const clearance={id,formNo,name,site,mobile,aadhaar,stage,result,history,post};
  const handoff:TrialHandoff={id,formNo,name,site,post,fields,owner,clearance};
  const region=selection.region||(selection.site&&/^(jayant|dudh?ichua)/i.test(site)?'NCL':'');
  const defaults={...selection,site:selection.site,region,joiningCategory:region==='Nagpur Corporate Office'?'CORPORATE':region==='Chandrapur Head Office'?'HO':region,department:post,
   subdepartment:post===selection.department?selection.subdepartment:'',designation:post===selection.department?selection.designation:''};
  const photo=/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(row.photo);
  const files=photo?{'Upload Candidate photo':[new File([Uint8Array.from(atob(photo[1]),char=>char.charCodeAt(0))],'trial-candidate.jpg',{type:'image/jpeg'})]}:undefined;
  const draft:JoiningDraft={id:crypto.randomUUID(),owner,group:selection.employeeGroup,category:post,step:1,defaults,
   updatedAt:new Date().toISOString(),fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,[{value}]])),files,trialHandoff:handoff};
  await saveJoiningDraft(draft);
  prepared.push(handoff);
 }
 return prepared[0];
}
