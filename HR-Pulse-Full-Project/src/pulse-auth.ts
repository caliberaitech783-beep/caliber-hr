export type HrProfile={name:string;login:string;role:string;assignedRole:string;permissions:{application:string;adminLevel?:string;site?:string;hrDesktopAccess?:string[];hrMobileAccess?:string[]}};
export type HrSession={grant:string;profile:HrProfile};
const endpoint='https://pulse.cmll.in/api/integrations/hr/';
async function request(action:string,body:unknown){
 const response=await fetch(endpoint+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error'});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Pulse sign-in is unavailable. Please retry.');
 return data;
}
export async function authenticate(username:string,password:string):Promise<HrSession>{
 const result=await request('authenticate',{username,password});
 if(!/^[A-Za-z0-9_-]{43}$/.test(result.grant||'')||result.profile?.permissions?.application!=='HR')throw new Error('Pulse did not authorize HR access.');
 return result;
}
export async function validate(session:HrSession):Promise<HrSession>{
 const result=await request('validate',{grant:session.grant});
 if(result.profile?.permissions?.application!=='HR')throw new Error('HR access is no longer assigned.');
 return {grant:session.grant,profile:result.profile};
}
export async function revoke(session:HrSession){await request('logout',{grant:session.grant});}
export function clearSession(){sessionStorage.removeItem('hrPulseSession');localStorage.removeItem('hrPulseSession');}
export function readSession():HrSession|null{try{return JSON.parse(sessionStorage.getItem('hrPulseSession')||localStorage.getItem('hrPulseSession')||'null');}catch{return null;}}
export function saveSession(session:HrSession,remember:boolean){clearSession();(remember?localStorage:sessionStorage).setItem('hrPulseSession',JSON.stringify(session));}
