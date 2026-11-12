/* Attendance Management.
   The fingerprint machines sit on site networks that Azure cannot reach, so a
   small "bridge" program on a site PC collects punches from the machine and
   uploads them here. Clicking "Fetch attendance" creates a fetch request; the
   bridge polls for it, uploads what it has and marks the request done.
   Bridge routes are authenticated by ATTENDANCE_BRIDGE_KEY, never by Pulse. */
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {assignedSites,siteIds} from './scope.mjs';
import {grantedMenus,canWrite} from './modules.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const SERIAL=/^[A-Za-z0-9_-]{1,40}$/,BIOMETRIC=/^[A-Za-z0-9_.-]{1,24}$/,CODE=/^\d{0,3}$/;
const STAMP=/^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=value=>DAY.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const MAX_PUNCHES_PER_UPLOAD=2000,MAX_RANGE_DAYS=62,MAX_ROWS=5000;
// A request nobody picked up or finished within this window is reported as failed.
const STALE="interval '90 seconds'";
const NO_BRIDGE='The bridge PC did not respond. Check that it is switched on, connected to the internet and running the bridge program.';

export function keyMatches(expected,supplied){
 if(typeof expected!=='string'||expected.length<32||typeof supplied!=='string')return false;
 const digest=value=>createHash('sha256').update(value).digest();
 return timingSafeEqual(digest(expected),digest(supplied));
}

export function validateUpload(input){
 const error=input.error?String(input.error).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,300):'';
 // A failure report may arrive before any machine has ever contacted the bridge.
 const serial=input.device?.serial==null&&error?null:String(input.device?.serial||'');
 if(serial!==null&&!SERIAL.test(serial))fail('A valid device serial number is required');
 const punches=input.punches??[],users=input.users??[];
 if(!Array.isArray(punches)||!Array.isArray(users))fail('Punches and users must be lists');
 if(punches.length>MAX_PUNCHES_PER_UPLOAD||users.length>MAX_PUNCHES_PER_UPLOAD)fail(`Send at most ${MAX_PUNCHES_PER_UPLOAD} rows per upload`,413);
 const clean=punches.map(p=>{
  const biometricId=String(p?.biometricId??'').trim(),punchedAt=String(p?.punchedAt??''),verify=String(p?.verify??''),punchType=String(p?.punchType??'');
  if(!BIOMETRIC.test(biometricId))fail('A punch has an invalid machine user ID');
  if(!STAMP.test(punchedAt)||!validDay(punchedAt.slice(0,10)))fail('A punch has an invalid time. Use YYYY-MM-DD HH:MM:SS');
  if(!CODE.test(verify)||!CODE.test(punchType))fail('A punch has an invalid verify or punch type code');
  return {biometricId,punchedAt,verify,punchType};
 });
 const people=users.map(u=>{
  const biometricId=String(u?.biometricId??'').trim(),name=String(u?.name??'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,100);
  if(!BIOMETRIC.test(biometricId))fail('A user has an invalid machine user ID');
  return {biometricId,name};
 });
 const requestId=input.requestId==null||input.requestId===''?null:String(input.requestId);
 if(requestId&&!uuid(requestId))fail('Invalid fetch request');
 if(serial===null&&(clean.length||people.length))fail('A valid device serial number is required');
 return {serial,name:String(input.device?.name||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80),punches:clean,users:people,requestId,final:input.final===true,error};
}

export function validateRange(params){
 const today=new Date(Date.now()+5.5*3600_000).toISOString().slice(0,10); // India date
 const from=params.get('from')||today,to=params.get('to')||from;
 if(!validDay(from)||!validDay(to))fail('Dates must be in YYYY-MM-DD format');
 if(to<from)fail('The end date must be on or after the start date');
 if((Date.parse(to)-Date.parse(from))/86400000+1>MAX_RANGE_DAYS)fail(`Choose a range of ${MAX_RANGE_DAYS} days or fewer`);
 return {from,to};
}

export function createAttendance(pool,{bridgeKey=process.env.ATTENDANCE_BRIDGE_KEY}={}){
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const out=await fn(db);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 const audit=(db,actor,action,detail)=>db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)",[actor,action,detail]);
 const permit=profile=>{if(!grantedMenus(profile).has('Employee Master'))fail('Attendance Management is not assigned to your account',403);};
 const view=row=>row&&{id:row.id,state:row.state,punchesReceived:row.punches_received,newPunches:row.new_punches,error:row.error||'',requestedBy:row.requested_by,requestedAt:row.requested_at,completedAt:row.completed_at};
 const expire=db=>db.query(`UPDATE hr_attendance_fetch_requests SET state='FAILED',error=$1,completed_at=now() WHERE state IN ('PENDING','RUNNING') AND requested_at<now()-${STALE}`,[NO_BRIDGE]);

 async function bridge(key,route,method,input){
  if(typeof bridgeKey!=='string'||bridgeKey.length<32)fail('The attendance bridge is not configured',503);
  if(!keyMatches(bridgeKey,key))fail('Invalid bridge key',401);
  if(route==='next'&&method==='GET')return tx(async db=>{
   await db.query('INSERT INTO hr_attendance_bridge(id,last_seen) VALUES(true,now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()');
   await expire(db);
   const row=(await db.query("UPDATE hr_attendance_fetch_requests SET state='RUNNING' WHERE id=(SELECT id FROM hr_attendance_fetch_requests WHERE state='PENDING' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id")).rows[0];
   return {request:row?{id:row.id}:null};
  });
  if(route==='punches'&&method==='POST'){
   const upload=validateUpload(input);
   return tx(async db=>{
    if(upload.serial)await db.query('INSERT INTO hr_attendance_devices(serial,name,last_seen) VALUES($1,$2,now()) ON CONFLICT(serial) DO UPDATE SET last_seen=now(),name=CASE WHEN hr_attendance_devices.name=\'\' THEN EXCLUDED.name ELSE hr_attendance_devices.name END',[upload.serial,upload.name]);
    let added=0;
    if(upload.punches.length)added=(await db.query('INSERT INTO hr_attendance_punches(device_serial,biometric_id,punched_at,verify,punch_type) SELECT $1,x.b,x.t::timestamp,x.v,x.p FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS x(b,t,v,p) ON CONFLICT DO NOTHING',[upload.serial,upload.punches.map(p=>p.biometricId),upload.punches.map(p=>p.punchedAt),upload.punches.map(p=>p.verify),upload.punches.map(p=>p.punchType)])).rowCount;
    if(upload.users.length)await db.query('INSERT INTO hr_attendance_device_users(device_serial,biometric_id,name) SELECT DISTINCT ON (x.b) $1,x.b,x.n FROM unnest($2::text[],$3::text[]) AS x(b,n) ON CONFLICT(device_serial,biometric_id) DO UPDATE SET name=EXCLUDED.name',[upload.serial,upload.users.map(u=>u.biometricId),upload.users.map(u=>u.name)]);
    if(upload.requestId){
     const done=upload.error?'FAILED':upload.final?'DONE':null;
     await db.query("UPDATE hr_attendance_fetch_requests SET punches_received=punches_received+$2,new_punches=new_punches+$3,state=COALESCE($4,state),error=NULLIF($5,''),completed_at=CASE WHEN $4::text IS NULL THEN completed_at ELSE now() END WHERE id=$1 AND state IN ('PENDING','RUNNING')",[upload.requestId,upload.punches.length,added,done,upload.error]);
    }
    return {received:upload.punches.length,added};
   });
  }
  fail('Not found',404);
 }

 async function api(profile,route,method,input,params){
  permit(profile);
  const fetchId=route.match(/^fetch\/([0-9a-fA-F-]{36})$/)?.[1];
  if(route==='fetch'&&method==='POST')return tx(async db=>{
   await expire(db);
   const open=(await db.query("SELECT * FROM hr_attendance_fetch_requests WHERE state IN ('PENDING','RUNNING') ORDER BY requested_at DESC LIMIT 1")).rows[0];
   if(open)return view(open); // one fetch at a time; everyone waits on the same request
   const row=(await db.query('INSERT INTO hr_attendance_fetch_requests(id,requested_by) VALUES($1,$2) RETURNING *',[randomUUID(),profile.actor])).rows[0];
   await audit(db,profile.actor,'FETCH_ATTENDANCE',{requestId:row.id});
   return view(row);
  });
  if(fetchId&&method==='GET'){
   if(!uuid(fetchId))fail('Invalid fetch request');
   await expire(pool);
   return view((await pool.query('SELECT * FROM hr_attendance_fetch_requests WHERE id=$1',[fetchId])).rows[0])||fail('Fetch request not found',404);
  }
  const sites=await siteIds(pool,profile); // null = all sites
  if(route==='status'&&method==='GET'){
   const seen=(await pool.query("SELECT last_seen,last_seen>now()-interval '30 seconds' AS online FROM hr_attendance_bridge")).rows[0];
   const devices=(await pool.query('SELECT d.serial,d.name,d.site_id,s.name AS site_name,d.last_seen FROM hr_attendance_devices d LEFT JOIN hr_records s ON s.id=d.site_id WHERE $1::text[] IS NULL OR d.site_id::text=ANY($1) ORDER BY d.serial',[sites])).rows;
   const last=(await pool.query('SELECT * FROM hr_attendance_fetch_requests ORDER BY requested_at DESC LIMIT 1')).rows[0];
   return {configured:typeof bridgeKey==='string'&&bridgeKey.length>=32,bridgeOnline:Boolean(seen?.online),bridgeLastSeen:seen?.last_seen||null,
    devices:devices.map(d=>({serial:d.serial,name:d.name,siteId:d.site_id,siteName:d.site_name||'',lastSeen:d.last_seen})),lastFetch:view(last)||null,
    canLink:canWrite(profile,'employees'),canManageDevices:assignedSites(profile)===null&&canWrite(profile,'employees')};
  }
  if(route==='punches'&&method==='GET'){
   const {from,to}=validateRange(params);
   const rows=(await pool.query(`SELECT p.id,p.device_serial,p.biometric_id,to_char(p.punched_at,'YYYY-MM-DD') AS date,to_char(p.punched_at,'HH24:MI:SS') AS time,p.verify,p.punch_type,
    d.name AS device_name,s.name AS site_name,e.id AS employee_id,e.code AS employee_code,e.name AS employee_name,u.name AS machine_name
    FROM hr_attendance_punches p
    LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
    LEFT JOIN hr_records s ON s.id=d.site_id
    LEFT JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
    LEFT JOIN hr_records e ON e.id=l.employee_id AND e.kind='employees'
    LEFT JOIN hr_attendance_device_users u ON u.device_serial=p.device_serial AND u.biometric_id=p.biometric_id
    WHERE p.punched_at>=$1::date AND p.punched_at<$2::date+1 AND ($3::text[] IS NULL OR d.site_id::text=ANY($3) OR e.data->>'siteId'=ANY($3))
    ORDER BY p.punched_at DESC,p.id DESC LIMIT ${MAX_ROWS+1}`,[from,to,sites])).rows;
   return {from,to,truncated:rows.length>MAX_ROWS,rows:rows.slice(0,MAX_ROWS).map(r=>({id:String(r.id),deviceSerial:r.device_serial,deviceName:r.device_name||'',siteName:r.site_name||'',biometricId:r.biometric_id,date:r.date,time:r.time,verify:r.verify,punchType:r.punch_type,employeeId:r.employee_id||'',employeeCode:r.employee_code||'',employeeName:r.employee_name||'',machineName:r.machine_name||''}))};
  }
  if(route==='unlinked'&&method==='GET'){
   const rows=(await pool.query(`SELECT p.device_serial,p.biometric_id,count(*)::int AS punches,to_char(max(p.punched_at),'YYYY-MM-DD HH24:MI') AS last_punch,max(u.name) AS machine_name,max(s.name) AS site_name
    FROM hr_attendance_punches p
    LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
    LEFT JOIN hr_records s ON s.id=d.site_id
    LEFT JOIN hr_attendance_device_users u ON u.device_serial=p.device_serial AND u.biometric_id=p.biometric_id
    WHERE NOT EXISTS(SELECT 1 FROM hr_attendance_links l WHERE l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id)
    AND ($1::text[] IS NULL OR d.site_id::text=ANY($1))
    GROUP BY p.device_serial,p.biometric_id ORDER BY max(p.punched_at) DESC LIMIT 1000`,[sites])).rows;
   return rows.map(r=>({deviceSerial:r.device_serial,biometricId:r.biometric_id,punches:r.punches,lastPunch:r.last_punch,machineName:r.machine_name||'',siteName:r.site_name||''}));
  }
  if(route==='link'&&method==='POST'){
   if(!canWrite(profile,'employees'))fail('You do not have permission to link employees',403);
   const serial=String(input.deviceSerial||''),biometricId=String(input.biometricId||''),employeeId=String(input.employeeId||'');
   if(!SERIAL.test(serial)||!BIOMETRIC.test(biometricId))fail('Invalid machine user');
   return tx(async db=>{
    const device=(await db.query('SELECT site_id FROM hr_attendance_devices WHERE serial=$1',[serial])).rows[0];
    if(!device)fail('Device not found',404);
    if(sites&&!sites.includes(device.site_id))fail('This device is outside your sites',403);
    if(!employeeId){
     await db.query('DELETE FROM hr_attendance_links WHERE device_serial=$1 AND biometric_id=$2',[serial,biometricId]);
     await audit(db,profile.actor,'UNLINK_ATTENDANCE_ID',{serial,biometricId});
     return {linked:false};
    }
    if(!uuid(employeeId))fail('Choose an employee');
    const employee=(await db.query("SELECT id,code,name,data FROM hr_records WHERE id=$1 AND kind='employees'",[employeeId])).rows[0];
    if(!employee)fail('Employee not found',404);
    if(sites&&!sites.includes(employee.data.siteId))fail('This employee is outside your sites',403);
    await db.query('INSERT INTO hr_attendance_links(device_serial,biometric_id,employee_id,linked_by) VALUES($1,$2,$3,$4) ON CONFLICT(device_serial,biometric_id) DO UPDATE SET employee_id=EXCLUDED.employee_id,linked_by=EXCLUDED.linked_by,linked_at=now()',[serial,biometricId,employeeId,profile.actor]);
    await audit(db,profile.actor,'LINK_ATTENDANCE_ID',{serial,biometricId,employeeId,employeeCode:employee.code});
    return {linked:true,employeeCode:employee.code,employeeName:employee.name};
   });
  }
  if(route==='devices'&&method==='POST'){
   if(assignedSites(profile)!==null||!canWrite(profile,'employees'))fail('Only an HR administrator without site restrictions can assign devices',403);
   const serial=String(input.serial||''),siteId=String(input.siteId||''),name=String(input.name||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,80);
   if(!SERIAL.test(serial))fail('Invalid device');
   if(siteId&&!uuid(siteId))fail('Choose a site');
   return tx(async db=>{
    if(siteId&&!(await db.query("SELECT 1 FROM hr_records WHERE id=$1 AND kind='sites'",[siteId])).rowCount)fail('Site not found',404);
    const row=(await db.query('UPDATE hr_attendance_devices SET site_id=$2,name=$3 WHERE serial=$1 RETURNING serial',[serial,siteId||null,name])).rows[0];
    if(!row)fail('Device not found',404);
    await audit(db,profile.actor,'ASSIGN_ATTENDANCE_DEVICE',{serial,siteId,name});
    return {serial,siteId,name};
   });
  }
  fail('Not found',404);
 }
 return {attendanceBridge:bridge,attendanceApi:api};
}
