/* Police verification and Self declaration form (owner, 21 Nov 2026):
   - WCL sites (Sasti, Majri, Dhoptala, Gauri Pauni …): both are mandatory at joining; the form cannot be submitted without them.
   - NCL sites (Jayant East / West, Dudhichua East / West): both are mandatory but may be uploaded within 20 days of the joining date. */
export const POLICE_VERIFICATION='Police verification';
export const SELF_DECLARATION='Self declaration form';
export const regionalDocuments=[POLICE_VERIFICATION,SELF_DECLARATION];
export const NCL_GRACE_DAYS=20;

const wclSites=/sasti|majri|dhoptala|dhuptala|gauri|pauni|pouni|hindustan|lalpeth/i;
const nclSites=/jayant|dudhichua|dudichua|ncl-/i;
/* Region from the selected region / joining category, else from the site name. */
export function documentRegion(...values:unknown[]):'WCL'|'NCL'|''{
 for(const value of values){const text=String(value??'').trim().toUpperCase();if(text==='WCL'||text==='NCL')return text;}
 for(const value of values){const text=String(value??'');if(wclSites.test(text))return 'WCL';if(nclSites.test(text))return 'NCL';}
 return '';
}
/* Rule text shown in the checklist; a rule starting with "Mandatory" makes the upload required at submit. */
export function regionalDocumentRule(region:string){
 if(region==='WCL')return 'Mandatory at joining (WCL)';
 if(region==='NCL')return `Within ${NCL_GRACE_DAYS} days of joining (NCL)`;
 return 'As per policy';
}
function parseDate(value:unknown){
 const text=String(value??'').trim();let match=/^(\d{4})-(\d{2})-(\d{2})/.exec(text);
 if(match)return new Date(Date.UTC(+match[1],+match[2]-1,+match[3]));
 match=/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
 if(match)return new Date(Date.UTC(+match[3],+match[2]-1,+match[1]));
 return null;
}
const ddmmyyyy=(date:Date)=>`${String(date.getUTCDate()).padStart(2,'0')}/${String(date.getUTCMonth()+1).padStart(2,'0')}/${date.getUTCFullYear()}`;
export type RegionalDocumentStatus={state:'uploaded'|'due'|'overdue'|'missing';label:string;due?:string};
/* Status of one regional document for a saved employee. */
export function regionalDocumentStatus({region,joiningDate,uploaded,today=new Date()}:{region:string;joiningDate:unknown;uploaded:unknown;today?:Date}):RegionalDocumentStatus{
 if(String(uploaded??'').trim())return {state:'uploaded',label:String(uploaded).trim()};
 if(region==='WCL')return {state:'missing',label:'Missing – mandatory at joining (WCL)'};
 if(region!=='NCL')return {state:'missing',label:''};
 const joined=parseDate(joiningDate);
 if(!joined)return {state:'due',label:`Pending – upload within ${NCL_GRACE_DAYS} days of joining`};
 const due=new Date(joined.getTime()+NCL_GRACE_DAYS*86400000),day=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
 const left=Math.round((due.getTime()-day)/86400000);
 return left<0
  ?{state:'overdue',label:`Overdue – was due ${ddmmyyyy(due)}`,due:ddmmyyyy(due)}
  :{state:'due',label:`Pending – due ${ddmmyyyy(due)} (${left} day${left===1?'':'s'} left)`,due:ddmmyyyy(due)};
}
