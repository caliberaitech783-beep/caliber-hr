const HANDOFF_KEY='hrPulse.trialHandoff';
/* A passed trial candidate waiting to be entered in Employee Management. Fields use the joining-form control names. */
export type TrialHandoff={id:string;formNo:string;name:string;site:string;post:string;fields:Record<string,string>};
let handoffPhotos:{photo?:File;photo2?:File}={};
export function saveTrialHandoff(handoff:TrialHandoff,photos:{photo?:File;photo2?:File}){handoffPhotos=photos;try{sessionStorage.setItem(HANDOFF_KEY,JSON.stringify(handoff));}catch{/* ignore */}}
export function loadTrialHandoff():TrialHandoff|null{try{return JSON.parse(sessionStorage.getItem(HANDOFF_KEY)||'null');}catch{return null;}}
export function trialHandoffPhotos(){return handoffPhotos;}
export function clearTrialHandoff(){handoffPhotos={};try{sessionStorage.removeItem(HANDOFF_KEY);}catch{/* ignore */}}
