import {listJoiningDrafts,saveJoiningDraft,type JoiningDraft} from './joiningDrafts';
import type {TrialSelection} from './TrialForm';
import {isClearedForJoining,type Trial} from './trial-workflow-preview/records';
import {api,savedSession} from './api';

const HANDOFF_KEY='hrPulse.trialHandoff';
/* A passed trial candidate waiting to be entered in Employee Management. Fields use the joining-form control names. */
export type TrialClearance=Pick<Trial,'id'|'formNo'|'name'|'mobile'|'aadhaar'|'site'|'post'|'stage'|'result'|'history'>;
export type TrialHandoff={id:string;formNo:string;name:string;site:string;post:string;fields:Record<string,string>;photo?:string;owner?:string;clearance?:TrialClearance};
export type TrialChecklistDocuments={aadhaar?:File;drivingLicence?:File};
let handoffPhotos:{photo?:File;photo2?:File}={};
export function saveTrialHandoff(handoff:TrialHandoff,photos:{photo?:File;photo2?:File}){handoffPhotos=photos;try{sessionStorage.setItem(HANDOFF_KEY,JSON.stringify(handoff));}catch{/* ignore */}}
export function loadTrialHandoff():TrialHandoff|null{try{return JSON.parse(sessionStorage.getItem(HANDOFF_KEY)||'null');}catch{return null;}}
export function trialHandoffPhotos(){return handoffPhotos;}
export function clearTrialHandoff(){handoffPhotos={};try{sessionStorage.removeItem(HANDOFF_KEY);}catch{/* ignore */}}

type StoredTrialAttachment={name:string;mime:string;data:string;kind?:string};
function storedFile(attachments:StoredTrialAttachment[],kind:string){
 const attachment=attachments.find(file=>file.kind===kind);
 if(!attachment?.data)return;
 try{return new File([Uint8Array.from(atob(attachment.data),char=>char.charCodeAt(0))],attachment.name||kind,{type:attachment.mime||'application/octet-stream'});}catch{return;}
}
async function storedChecklistDocuments(formNo:string):Promise<TrialChecklistDocuments>{
 const grant=savedSession()?.grant;if(!grant)return {};
 try{const result=await api<{data:{attachments?:StoredTrialAttachment[]}}>(grant,'telegram/trial-form','POST',{formNo}),attachments=result.data?.attachments||[];return {aadhaar:storedFile(attachments,'aadhaar'),drivingLicence:storedFile(attachments,'drivingLicence')};}catch{return {};}
}

export async function prepareTrialJoining(rows: Trial[], selection: TrialSelection, owner: string, documents:TrialChecklistDocuments={}) {
 const existing=await listJoiningDrafts(owner);
 let prepared: JoiningDraft|undefined;
 for (const row of rows) {
  if (!isClearedForJoining(row)) continue;
  const post=row.outcome.post;
  const prior=existing.find(draft=>draft.trialHandoff?.id===row.id);
  if (prior) {prepared??=prior;continue;}
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
  const stored=documents.aadhaar&&documents.drivingLicence?{}:await storedChecklistDocuments(formNo);
  const files:Record<string,File[]>={};
  if(photo)files['Upload Candidate photo']=[new File([Uint8Array.from(atob(photo[1]),char=>char.charCodeAt(0))],'trial-candidate.jpg',{type:'image/jpeg'})];
  const aadhaarDocument=documents.aadhaar||stored.aadhaar,drivingLicenceDocument=documents.drivingLicence||stored.drivingLicence;
  if(aadhaarDocument)files['Upload Aadhaar (masked display)']=[aadhaarDocument];
  if(drivingLicenceDocument)files['Upload Driving licence']=[drivingLicenceDocument];
  const draft:JoiningDraft={id:crypto.randomUUID(),owner,group:selection.employeeGroup,category:post,step:1,defaults,
   updatedAt:new Date().toISOString(),fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,[{value}]])),files:Object.keys(files).length?files:undefined,trialHandoff:handoff};
  await saveJoiningDraft(draft);
  prepared??=draft;
 }
 return prepared;
}
