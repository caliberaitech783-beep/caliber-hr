/* Deleting a biometric machine needs the owner's approval on Telegram (owner, 23 Nov 2026).
   An HR administrator presses Delete on a machine in Biometric machines. HR Pulse sends the approvers
   (Azure setting MACHINE_DELETE_APPROVERS: HR logins, comma separated) a Telegram message naming the machine
   and who asked, with ✅ Approve delete / ❌ Reject buttons and a six-digit OTP.
   - Approve on Telegram deletes the machine at once; Reject stops it.
   - The OTP is the backup: the approver tells it to the requester, who enters it in the Delete window.
   - 15 minutes, single use, five wrong tries. Whoever asks never gets the message (notSender); a requester who is
     the only approver is refused.
   Deleting removes the machine from the list and cancels its open fetches. The punches it already sent, the names on
   it and the employee links are kept, so attendance already recorded never changes. */
import {createHash,randomBytes,randomInt} from 'node:crypto';

export const MACHINE_DELETE_MINUTES=15,MACHINE_DELETE_ATTEMPTS=5;
export const MACHINE_DELETE_KIND='machineDeletions';
const SERIAL=/^[A-Za-z0-9_-]{1,40}$/,CODE=/^MD-[0-9A-F]{12}$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const login=value=>String(value||'').trim().replace(/^@/,'').toLowerCase();

/** The HR logins that approve a machine deletion (Azure setting MACHINE_DELETE_APPROVERS). */
export const machineDeleteApprovers=(env=process.env)=>[...new Set(String(env.MACHINE_DELETE_APPROVERS||'').split(',').map(login).filter(Boolean))];
export const validCode=code=>CODE.test(String(code||''));
export const newCode=()=>'MD-'+randomBytes(6).toString('hex').toUpperCase();
export const newOtp=()=>String(randomInt(100000,1000000));
export const otpHash=(code,otp)=>hash(code+':'+otp);

const stamp=value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(new Date(value));
const dash=value=>String(value??'').trim()||'—';

/** The Telegram message the approvers get. */
export function machineDeleteMessage(d,otp){
 const m=d.machine||{};
 return ['🗑️ HR PULSE · DELETE BIOMETRIC MACHINE',`Approval required · valid for ${MACHINE_DELETE_MINUTES} minutes`,'',
  '📋 Machine',
  `Site: ${dash(m.siteName)}`,`Location: ${dash(m.location)}`,`Name: ${dash(m.name)}`,`Serial no.: ${dash(m.serial)}`,`IP address: ${dash(m.ipAddress)}`,
  `Bridge PC: ${dash(m.bridgeName)}`,`Punches saved: ${Number(m.punches)||0}${m.lastPunch?` · last ${m.lastPunch}`:''}`,'',
  '👤 Requested by',`${dash(d.requestedByName)} (${d.requestedBy})`,`${stamp(d.requestedAt)} IST`,'',
  `🔐 OTP: ${otp}`,'Tap a button below, or tell this OTP to the requester to enter in HR Pulse.','',
  '⚠️ Approve = remove this machine from Biometric machines. The punches it already sent are kept.'].join('\n');
}
export const machineDeleteMarkup=code=>({inline_keyboard:[[{text:'✅ Approve delete',callback_data:`md:${code}:a`},{text:'❌ Reject',callback_data:`md:${code}:r`}]]});
/** md:<code>:a (approve) or md:<code>:r (reject). */
export function parseMachineDeleteCallback(data){const m=String(data||'').match(/^md:(MD-[0-9A-F]{12}):(a|r)$/);return m?{code:m[1],approve:m[2]==='a'}:null;}

/** What the screen sees of a request. */
export const requestView=(code,d)=>({code,serial:d.machine?.serial||'',status:d.status,expires:d.expires,approvers:d.approverNames||[],
 attemptsLeft:Math.max(0,MACHINE_DELETE_ATTEMPTS-(d.attempts||0)),decidedBy:d.decidedBy||'',decidedAt:d.decidedAt||null,via:d.via||''});

/** Removes the machine: the row, its open fetches; punches, names on the machine and employee links stay. */
export async function removeMachine(db,actor,serial,detail={}){
 const row=(await db.query('DELETE FROM hr_attendance_devices WHERE serial=$1 RETURNING serial,name,location,site_id,ip_address',[serial])).rows[0];
 if(!row)return false;
 await db.query("UPDATE hr_attendance_fetch_requests SET state='FAILED',error='The machine was deleted.',completed_at=now() WHERE device_serial=$1 AND state IN ('PENDING','RUNNING')",[serial]);
 await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'DELETE_ATTENDANCE_DEVICE','attendance',NULL,$2)",[actor,{serial,name:row.name,location:row.location,siteId:row.site_id,ipAddress:row.ip_address,...detail}]);
 return true;
}

/** Approve or reject a request (Telegram button, or the OTP for approve). Returns the text to show. */
export async function decideMachineDelete(db,code,{actor,name,approve,via}){
 const row=(await db.query('SELECT data FROM hr_records WHERE kind=$1 AND code=$2 FOR UPDATE',[MACHINE_DELETE_KIND,code])).rows[0];
 if(!row)return {ok:false,text:'This delete request was not found.'};
 const d=row.data;
 if(via==='telegram'&&!(d.approvers||[]).includes(actor))return {ok:false,text:'You are not an approver for deleting machines.'};
 if(d.status!=='PENDING')return {ok:false,done:true,text:`Already ${String(d.status).toLowerCase()}${d.decidedBy?' by '+d.decidedBy:''}.`};
 if(new Date(d.expires)<new Date())return {ok:false,done:true,text:'This request has expired. HR must send it again.'};
 const at=new Date().toISOString(),serial=d.machine?.serial;
 let status=approve?'APPROVED':'REJECTED';
 if(approve&&!(await removeMachine(db,d.requestedBy,serial,{approvedBy:name||actor,via,request:code})))status='GONE';
 Object.assign(d,{status,decidedBy:name||actor,decidedByLogin:actor,decidedAt:at,via,otpHash:null});
 await db.query('UPDATE hr_records SET data=$3,status=$4,updated_by=$5,updated_at=now() WHERE kind=$1 AND code=$2',[MACHINE_DELETE_KIND,code,d,status,actor]);
 if(!approve)await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'REJECT_DELETE_ATTENDANCE_DEVICE','attendance',NULL,$2)",[actor,{serial,request:code,via}]);
 return {ok:true,done:true,status,text:status==='APPROVED'?`Machine ${serial} deleted ✅`:status==='GONE'?`Machine ${serial} was already removed.`:`Delete of ${serial} rejected ❌`};
}

/** The Delete window's routes, called from attendance.mjs for an HR administrator without a site restriction. */
export function createMachineDelete({queue,env=process.env}){
 /** Delete pressed: one pending request per machine; asking again sends a new OTP and cancels the old one. */
 async function request(db,profile,input){
  const serial=String(input?.serial||'').trim();
  if(!SERIAL.test(serial))fail('Choose a machine to delete');
  const approvers=machineDeleteApprovers(env).filter(a=>a!==login(profile.actor));
  if(!approvers.length)fail(machineDeleteApprovers(env).length?'You cannot approve your own delete request, and no other approver is set.':'No approver is set for deleting machines (Azure setting MACHINE_DELETE_APPROVERS).',409);
  const m=(await db.query(`SELECT d.serial,d.name,d.location,d.ip_address,s.name AS site_name,b.name AS bridge_name,
    (SELECT count(*) FROM hr_attendance_punches p WHERE p.device_serial=d.serial)::int AS punches,
    (SELECT to_char(max(punched_at),'DD-MM-YYYY HH24:MI') FROM hr_attendance_punches p WHERE p.device_serial=d.serial) AS last_punch
   FROM hr_attendance_devices d LEFT JOIN hr_records s ON s.id=d.site_id LEFT JOIN hr_attendance_bridges b ON b.id=d.bridge_id AND b.removed_at IS NULL
   WHERE d.serial=$1 FOR UPDATE OF d`,[serial])).rows[0];
  if(!m)fail('Machine not found',404);
  await db.query("UPDATE hr_records SET status='CANCELLED',data=data||'{\"status\":\"CANCELLED\",\"otpHash\":null}'::jsonb,updated_at=now() WHERE kind=$1 AND status='PENDING' AND data->'machine'->>'serial'=$2",[MACHINE_DELETE_KIND,serial]);
  const names=(await db.query("SELECT lower(code) AS login,name FROM hr_records WHERE kind='employees' AND lower(code)=ANY($1)",[[login(profile.actor),...approvers]])).rows;
  const nameOf=a=>names.find(n=>n.login===a)?.name||a;
  const code=newCode(),otp=newOtp(),requestedAt=new Date().toISOString();
  const d={status:'PENDING',machine:{serial:m.serial,name:m.name,location:m.location,ipAddress:m.ip_address,siteName:m.site_name||'',bridgeName:m.bridge_name||'',punches:m.punches,lastPunch:m.last_punch||''},
   requestedBy:login(profile.actor),requestedByName:nameOf(login(profile.actor)),requestedAt,expires:new Date(Date.parse(requestedAt)+MACHINE_DELETE_MINUTES*60000).toISOString(),
   otpHash:otpHash(code,otp),attempts:0,approvers,approverNames:approvers.map(nameOf)};
  await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES(gen_random_uuid(),$1,$2,$3,$4,'PENDING',$5,$5)",[MACHINE_DELETE_KIND,code,'Delete machine '+serial,d,d.requestedBy]);
  await queue(db,`machine-delete:${code}`,approvers,machineDeleteMessage(d,otp),machineDeleteMarkup(code));
  await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'REQUEST_DELETE_ATTENDANCE_DEVICE','attendance',NULL,$2)",[d.requestedBy,{serial,request:code,approvers}]);
  return requestView(code,d);
 }
 async function status(db,code){
  if(!validCode(code))fail('Delete request not found',404);
  const row=(await db.query('SELECT data FROM hr_records WHERE kind=$1 AND code=$2',[MACHINE_DELETE_KIND,code])).rows[0];
  if(!row)fail('Delete request not found',404);
  const d=row.data;
  return requestView(code,d.status==='PENDING'&&new Date(d.expires)<new Date()?{...d,status:'EXPIRED'}:d);
 }
 /** The requester enters the OTP the approver told them, or cancels. */
 async function confirm(db,profile,code,input){
  if(!validCode(code))fail('Delete request not found',404);
  const row=(await db.query('SELECT data FROM hr_records WHERE kind=$1 AND code=$2 FOR UPDATE',[MACHINE_DELETE_KIND,code])).rows[0];
  if(!row)fail('Delete request not found',404);
  const d=row.data;
  if(d.status!=='PENDING')return requestView(code,d);
  if(input?.cancel===true){
   Object.assign(d,{status:'CANCELLED',otpHash:null,decidedBy:login(profile.actor),decidedAt:new Date().toISOString()});
   await db.query("UPDATE hr_records SET data=$3,status='CANCELLED',updated_at=now() WHERE kind=$1 AND code=$2",[MACHINE_DELETE_KIND,code,d]);
   return requestView(code,d);
  }
  if(new Date(d.expires)<new Date())fail('The OTP has expired. Close this window and press Delete again.',410);
  if((d.attempts||0)>=MACHINE_DELETE_ATTEMPTS)fail('Too many wrong OTPs. Close this window and press Delete again.',429);
  const otp=String(input?.otp||'').trim();
  if(!/^\d{6}$/.test(otp)||otpHash(code,otp)!==d.otpHash){
   d.attempts=(d.attempts||0)+1;
   await db.query('UPDATE hr_records SET data=$3,updated_at=now() WHERE kind=$1 AND code=$2',[MACHINE_DELETE_KIND,code,d]);
   const left=MACHINE_DELETE_ATTEMPTS-d.attempts;
   fail(left?`Wrong OTP (${left} attempt${left===1?'':'s'} left).`:'Wrong OTP. No attempts left: press Delete again for a new OTP.',400);
  }
  await decideMachineDelete(db,code,{actor:login(profile.actor),name:`OTP entered by ${d.requestedByName||profile.actor}`,approve:true,via:'otp'});
  return status(db,code);
 }
 return {request,status,confirm};
}
