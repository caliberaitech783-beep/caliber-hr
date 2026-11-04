import {grantedMenus} from './modules.mjs';
import {assignedSites} from './scope.mjs';
/* Employee transfer approval flow:
   Site HR (from location) → PM (from location) → Office HR → Regional HR Head → Director (any one).
   Site HR and PM are configured per site; Office HR, Regional HR Head and Directors are common. Stored as hr_records kind='transferFlows':
   code 'COMMON' → {officeHr,regionalHrHead,directors,enabled}; code '<site code>' → {siteHr,pm}. */
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const users=value=>String(Array.isArray(value)?value.join(','):value||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
const valid=x=>/^[-a-z0-9_.@]{1,100}$/.test(x);
const list=(label,value,required=true)=>{const u=users(value);if(required&&!u.length)fail(`Enter at least one Pulse username for ${label}.`);if(u.length>20||!u.every(valid))fail(`Enter 1–20 valid comma-separated Pulse usernames for ${label}.`);return u.join(',');};
export function validateTransferCommon(input){return {officeHr:list('Office HR',input.officeHr),regionalHrHead:list('Regional HR Head',input.regionalHrHead),directors:list('Directors',input.directors),enabled:input.enabled===true};}
export function validateTransferSite(input){return {siteHr:list('Site HR',input.siteHr),pm:list('PM',input.pm)};}
export function transferSteps(common,site){
 if(!common?.enabled)return null;
 if(!site?.siteHr||!site?.pm)fail('Configure Site HR and PM for the employee\'s current location in Approval Master › Employee Transfer before submitting.',409);
 return [{stage:1,label:'Site HR (from location) — any one',approvers:users(site.siteHr)},{stage:2,label:'PM (from location) — any one',approvers:users(site.pm)},{stage:3,label:'Office HR — any one',approvers:users(common.officeHr)},{stage:4,label:'Regional HR Head — any one',approvers:users(common.regionalHrHead)},{stage:5,label:'Director — final approval, any one',approvers:users(common.directors)}];
}
export async function transferWorkflow(db,fromSiteId){
 const common=(await db.query("SELECT data FROM hr_records WHERE kind='transferFlows' AND code='COMMON'")).rows[0]?.data;
 if(!common?.enabled)return null;
 const site=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='sites'",[String(fromSiteId||'')])).rows[0];
 const siteFlow=site?(await db.query("SELECT data FROM hr_records WHERE kind='transferFlows' AND code=$1",[site.code])).rows[0]?.data:null;
 return {id:null,data:{steps:transferSteps(common,siteFlow)}};
}
/* On final approval the employee's posting moves to the destination. */
export async function applyTransfer(db,record,actor){
 const d=record.data,employee=(await db.query("SELECT data FROM hr_records WHERE id=$1 AND kind='employees'",[d.employeeId])).rows[0];
 if(!employee)return;
 const next={...employee.data,siteId:d.toSiteId||employee.data.siteId,companyId:d.toCompanyId||employee.data.companyId,transferredFromSiteId:d.fromSiteId,lastTransferId:record.id,lastTransferDate:d.transferDate};
 if(d.toDesignation)next.designationTitle=d.toDesignation;
 if(d.toManager)next.reportingManagerName=d.toManager;
 await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',[next,actor,d.employeeId]);
}
export function createTransferFlows(pool){
 function access(profile,write=false){if(!grantedMenus(profile).has('Master Configuration')&&!grantedMenus(profile).has('Approval Management'))fail('Approval Master permission required',403);if(write&&assignedSites(profile)!==null)fail('Editing the transfer flow requires unrestricted site access',403);}
 return {
  async transferFlows(profile){access(profile);const rows=(await pool.query("SELECT code,data,version FROM hr_records WHERE kind='transferFlows'")).rows;const sites=(await pool.query("SELECT id,code,name FROM hr_records WHERE kind='sites' AND status='ACTIVE' ORDER BY name")).rows;
   const common=rows.find(r=>r.code==='COMMON');return {canWrite:assignedSites(profile)===null,common:common?{...common.data,version:common.version}:{officeHr:'',regionalHrHead:'',directors:'',enabled:false,version:0},sites:sites.map(s=>{const r=rows.find(x=>x.code===s.code);return {id:s.id,code:s.code,name:s.name,siteHr:r?.data.siteHr||'',pm:r?.data.pm||''};})};},
  async saveTransferFlow(profile,input){access(profile,true);const code=input.scope==='site'?String(input.code||'').trim():'COMMON';if(!code)fail('Choose a site');
   const data=code==='COMMON'?validateTransferCommon(input):validateTransferSite(input);
   const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['transfer-flow:'+code]);
    const old=(await db.query("SELECT id FROM hr_records WHERE kind='transferFlows' AND code=$1 FOR UPDATE",[code])).rows[0];
    if(old)await db.query('UPDATE hr_records SET data=$1,status=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[data,'ACTIVE',profile.actor,old.id]);
    else await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),'transferFlows',$1,$2,$3,'ACTIVE',$4,$4)",[code,code==='COMMON'?'Transfer approval flow':'Transfer approvers – '+code,data,profile.actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'CONFIGURE_TRANSFER_FLOW','transferFlows',NULL,$2)",[profile.actor,{code,...data}]);
    await db.query('COMMIT');return {saved:true};}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 };
}
