import {randomUUID} from 'node:crypto';
import {grantedMenus} from './modules.mjs';
import {assignedSites} from './scope.mjs';
const step=(stage,label,suggested)=>({stage,label,suggested,approvers:[]});
const driverTrainer=()=>step(1,'Driver Trainer','To be confirmed');
const wclSite=(code,name)=>({code,name,group:'WCL',steps:[step(1,'HR Manager','To be confirmed'),step(1,'Project Manager','To be confirmed'),driverTrainer(),step(2,'HR Manager — either one','To be confirmed'),step(2,'Final approval — any one','CMD / Director / VP')]});
export const hierarchyTemplates=[
 {code:'NCL-DUDE',name:'Dudhichua OB East',group:'NCL',steps:[step(1,'HR Manager','Ankit Tiwari'),step(1,'Project Manager','Ranjit Das'),driverTrainer(),step(2,'HR Manager — either one','Vinod Dhoke / Vinod Pinjarkar'),step(2,'Final approval — any one','CMD / Director / VP')]},
 {code:'NCL-DUDW',name:'Dudhichua OB West',group:'NCL',steps:[step(1,'HR Manager','Yogesh Laxman Sathe'),step(1,'Project Manager','Arun Kumar Soni'),driverTrainer(),step(2,'HR Manager — either one','Vinod Dhoke / Vinod Pinjarkar'),step(2,'Final approval — any one','CMD / Director / VP')]},
 {code:'NCL-JAYANT',name:'Jayant OB',group:'NCL',steps:[step(1,'HR Manager','Amit Singh'),step(1,'Project Manager','Md. Gulnawaz'),driverTrainer(),step(2,'HR Manager — either one','Vinod — to be confirmed'),step(2,'Final approval — any one','CMD / Director / VP')]},
 wclSite('WCL-SASTI','Sasti OB'),
 wclSite('WCL-DHOPTALA','Dhoptala OB'),
 wclSite('WCL-GAURI','Gauri Pauni OB'),
 wclSite('WCL-MAJRI','Majri OB'),
 {code:'CMLL-CO',name:'Nagpur Office',group:'CO/HO',steps:[step(1,'HR Executive','Mayuri Umate'),step(1,'HR Manager','Vinod Pinjarkar'),step(2,'Final approval — any one','Mohit Chadda / Manish Chadda / Rahul Chadda / Honey Sir — CMD / Director / VP')]}
];
export const currentHierarchy=data=>data?.code==='NCL-JAYANT'&&data.steps?.[0]?.label==='HR Executive'?{...data,steps:data.steps.slice(1)}:data?.code==='CMLL-CO'&&data.steps?.some(s=>s.label==='HOD')?{...data,steps:data.steps.filter(s=>s.label!=='HOD')}:data;
// Saved NCL hierarchies predate Driver Trainer. The editor shows the new step after Project Manager;
// approvals keep the saved steps until a Driver Trainer is assigned and saved.
export const withDriverTrainer=data=>{const steps=data?.steps;if(!['NCL','WCL'].includes(data?.group)||!Array.isArray(steps)||steps.some(s=>s.label==='Driver Trainer'))return data;const index=steps.findIndex(s=>s.label==='Project Manager')+1;return index?{...data,steps:[...steps.slice(0,index),driverTrainer(),...steps.slice(index)]}:data;};
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
export function validateHierarchy(input){
 const template=hierarchyTemplates.find(t=>t.code===input.code);if(!template)fail('Choose a supported joining site');
 if(!Array.isArray(input.steps)||input.steps.length!==template.steps.length)fail('Keep all required approval steps');
 const seen=new Set();const steps=input.steps.map((s,i)=>{if(!Array.isArray(s.approvers)||s.approvers.length>10)fail('Provide up to 10 usernames per step');const approvers=s.approvers.map(v=>String(v).trim().toLowerCase()).filter(Boolean);if(approvers.some(a=>!/^[-a-z0-9_.@]{1,100}$/.test(a)))fail('Enter valid Pulse usernames');for(const a of approvers){if(seen.has(a))fail('Each approver must occur in only one step');seen.add(a);}if(input.enabled&&(!approvers.length||(template.steps[i].stage===1&&approvers.length!==1)))fail(`Step ${i+1} (${template.steps[i].label}): ${!approvers.length?'Assign at least one Pulse username':'Assign exactly one Pulse username for this site approval step'}`);return {...template.steps[i],approvers};});
 return {...template,steps,enabled:input.enabled===true};
}
export const approvalSteps=a=>a.approval_steps?.length?a.approval_steps:a.approvers.map(actor=>({stage:1,label:'Approval',approvers:[actor]}));
export function nextApproval(approval,actor,decision){const steps=approvalSteps(approval);if(approval.requested_by===actor||!steps[approval.stage]?.approvers.includes(actor))fail('Only a current assigned approver may decide; self-approval is prohibited',403);const stage=approval.stage+1;return {stage,state:decision==='REJECTED'?'REJECTED':stage===steps.length?'APPROVED':'PENDING'};}
export async function employeeHierarchy(db,siteId){if(!siteId)return null;const site=(await db.query("SELECT code FROM hr_records WHERE id::text=$1 AND kind='sites'",[siteId])).rows[0];if(!hierarchyTemplates.some(t=>t.code===site?.code))return null;const row=(await db.query("SELECT * FROM hr_records WHERE kind='joiningHierarchies' AND code=$1 AND status='ACTIVE'",[site.code])).rows[0];if(!row){if(site.code.startsWith('WCL-'))return null;fail('Assign approver usernames and enable this site hierarchy before submitting',409);}return {...row,data:currentHierarchy(row.data)};}
export function createHierarchies(pool){
 function access(profile,write=false){if(!grantedMenus(profile).has('Master Configuration'))fail('Master Configuration permission required',403);if(write&&assignedSites(profile)!==null)fail('Hierarchy editing requires unrestricted site access',403);}
 return {
 async hierarchies(profile){access(profile);const rows=(await pool.query("SELECT * FROM hr_records WHERE kind='joiningHierarchies'")).rows;return {canWrite:assignedSites(profile)===null,rows:hierarchyTemplates.map(t=>{const r=rows.find(r=>r.code===t.code);return {...t,...withDriverTrainer(currentHierarchy(r?.data)),id:r?.id,version:r?.version||0,enabled:r?.status==='ACTIVE'};})};},
 async saveHierarchy(profile,input){access(profile,true);const data=validateHierarchy(input);const db=await pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['joining-hierarchy:'+data.code]);const old=(await db.query("SELECT * FROM hr_records WHERE kind='joiningHierarchies' AND code=$1 FOR UPDATE",[data.code])).rows[0];if((old?.version||0)!==Number(input.version||0))fail('Hierarchy changed. Reload before saving.',409);if(data.enabled){const site=await db.query("SELECT id FROM hr_records WHERE kind='sites' AND code=$1 AND status='ACTIVE'",[data.code]);if(site.rowCount!==1)fail('Configure an active site master before enabling its hierarchy');}
 const id=old?.id||randomUUID();if(old)await db.query('UPDATE hr_records SET data=$1,status=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$4',[data,data.enabled?'ACTIVE':'DRAFT',profile.actor,id]);else await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'joiningHierarchies',$2,$3,$4,$5,$6,$6)",[id,data.code,data.name,data,data.enabled?'ACTIVE':'DRAFT',profile.actor]);await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'CONFIGURE_HIERARCHY','joiningHierarchies',$2,$3)",[profile.actor,id,{site:data.code,enabled:data.enabled,steps:data.steps}]);await db.query('COMMIT');return {saved:true};}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 };
}
