/* Machines that talk straight to HR Pulse, without a bridge PC (owner, 22 Nov 2026).
   An eSSL / ZKTeco machine with internet on its own network is pointed at the HR API
   (Menu › Comm. › Cloud Server Setting / ADMS: hr-api-cmll-783.azurewebsites.net) and pushes over the
   ADMS ("iclock") protocol: GET /iclock/cdata is the hand-shake, GET /iclock/getrequest the heartbeat every
   few seconds, POST /iclock/cdata?table=ATTLOG the punches and table=OPERLOG / USERINFO the user names.
   The protocol carries no key, so only a serial number already added to a site in Biometric machines is
   accepted; any other serial gets a plain "OK" and nothing is stored. */

const SERIAL=/^[A-Za-z0-9_-]{1,40}$/,BIOMETRIC=/^[A-Za-z0-9_.-]{1,24}$/,CODE=/^\d{0,3}$/;
const STAMP=/^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const validDay=value=>{const t=Date.parse(value);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;};
export const MAX_MACHINE_BODY=2_000_000,MAX_MACHINE_ROWS=5000;
/** Heartbeats closer together than this do not write to the database again. */
const TOUCH_EVERY="interval '20 seconds'";

/** The reply to the machine's hand-shake, the same as the bridge PC's (hr_pulse_bridge.py): send every stored
    punch once (stamp 0; punches already saved are ignored), then each punch as it happens. */
export const handshake=serial=>[
 `GET OPTION FROM: ${serial}`,
 'ATTLOGStamp=0','OPERLOGStamp=0','ErrorDelay=30','Delay=10','TransTimes=00:00;12:00','TransInterval=1',
 'TransFlag=TransData AttLog OpLog EnrollUser','Realtime=1','Encrypt=None',
].join('\n')+'\n';

/** ATTLOG lines: PIN <tab> YYYY-MM-DD HH:MM:SS <tab> status <tab> verify <tab> ... Unreadable lines are skipped. */
export function parseAttlog(text){
 const punches=[];let skipped=0;
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.trim();if(!line)continue;
  const [id='',at='',status='',verify='']=line.split('\t').map(v=>v.trim());
  if(!BIOMETRIC.test(id)||!STAMP.test(at)||!validDay(at.slice(0,10))){skipped++;continue;}
  punches.push({biometricId:id,punchedAt:at,punchType:CODE.test(status)?status:'',verify:CODE.test(verify)?verify:''});
 }
 return {punches:punches.slice(0,MAX_MACHINE_ROWS),skipped,lines:punches.length+skipped};
}

/** User lines: "USER PIN=1<tab>Name=Ravi<tab>..." (OPERLOG) or "PIN=1<tab>Name=Ravi..." (USERINFO). */
export function parseUsers(text){
 const users=new Map();
 for(const raw of String(text).split(/\r?\n/)){
  const line=raw.trim().replace(/^USER\s+/,'');
  if(!line.startsWith('PIN='))continue;
  const fields=Object.fromEntries(line.split('\t').map(kv=>{const i=kv.indexOf('=');return i<0?[kv,'']:[kv.slice(0,i).trim(),kv.slice(i+1)];}));
  const id=String(fields.PIN||'').trim();
  if(BIOMETRIC.test(id))users.set(id,String(fields.Name||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,100));
 }
 return [...users].slice(0,MAX_MACHINE_ROWS).map(([biometricId,name])=>({biometricId,name}));
}

export function createDirectMachines(pool){
 /** Marks a registered machine as in touch, straight to the cloud. False when the serial is not added to a site. */
 async function touch(serial){
  const row=(await pool.query(`UPDATE hr_attendance_devices SET last_contact=now(),direct_contact=now(),bridge_id=NULL
   WHERE serial=$1 AND site_id IS NOT NULL AND (direct_contact IS NULL OR direct_contact<now()-${TOUCH_EVERY} OR last_contact IS NULL OR last_contact<now()-${TOUCH_EVERY}) RETURNING serial`,[serial])).rows[0];
  if(row)return true;
  return (await pool.query('SELECT 1 FROM hr_attendance_devices WHERE serial=$1 AND site_id IS NOT NULL',[serial])).rowCount>0;
 }

 /** One machine request: {text} is the plain-text reply (always 200, as the machines expect). */
 return async function machine(method,path,params,body=''){
  const serial=String(params.get('SN')||'').trim();
  const action=path.replace(/^\/iclock\//,'').replace(/\.aspx$/,'');
  if(!SERIAL.test(serial)||!['GET','POST'].includes(method))return {text:'OK'};
  const known=await touch(serial);
  if(!known)return {text:'OK'};
  if(action==='cdata'&&method==='GET')return {text:handshake(serial)};
  if(action==='cdata'&&method==='POST'){
   const table=String(params.get('table')||'').toUpperCase();
   if(table==='ATTLOG'){
    const {punches,lines}=parseAttlog(body);
    if(punches.length)await pool.query('INSERT INTO hr_attendance_punches(device_serial,biometric_id,punched_at,verify,punch_type) SELECT $1,x.b,x.t::timestamp,x.v,x.p FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS x(b,t,v,p) ON CONFLICT DO NOTHING',
     [serial,punches.map(p=>p.biometricId),punches.map(p=>p.punchedAt),punches.map(p=>p.verify),punches.map(p=>p.punchType)]);
    await pool.query('UPDATE hr_attendance_devices SET last_seen=now() WHERE serial=$1',[serial]);
    return {text:`OK: ${lines}`};
   }
   if(table==='OPERLOG'||table==='USERINFO'){
    const users=parseUsers(body);
    if(users.length)await pool.query('INSERT INTO hr_attendance_device_users(device_serial,biometric_id,name) SELECT $1,x.b,x.n FROM unnest($2::text[],$3::text[]) AS x(b,n) ON CONFLICT(device_serial,biometric_id) DO UPDATE SET name=EXCLUDED.name',
     [serial,users.map(u=>u.biometricId),users.map(u=>u.name)]);
    return {text:`OK: ${String(body).split(/\r?\n/).filter(l=>l.trim()).length}`};
   }
  }
  return {text:'OK'};
 };
}
