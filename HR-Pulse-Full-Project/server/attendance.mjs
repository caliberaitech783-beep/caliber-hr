/* Attendance Management.
   The fingerprint machines sit on site networks that Azure cannot reach, so a
   small "bridge" program on a site PC collects punches from the machine and
   uploads them here. Clicking "Fetch attendance" creates a fetch request; the
   bridge polls for it, uploads what it has and marks the request done.
   Bridge routes are authenticated by ATTENDANCE_BRIDGE_KEY, never by Pulse. */
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {assignedSites,siteAccessMessage,siteIds} from './scope.mjs';
import {grantedMenus,canWrite} from './modules.mjs';
import {createMisAttendance} from './mis-attendance.mjs';
import {createTripCardStore} from './trip-card-store.mjs';
import {createBiometricDayStore} from './biometric-day-store.mjs';
import {createBridges,looksLikeSiteKey} from './attendance-bridges.mjs';
import {createDirectMachines} from './attendance-direct.mjs';
import {loadRegister,loadSiteRegister,readPolicy,savePolicy} from './attendance-register.mjs';
import {removeMachine} from './machine-delete.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value||'');
const SERIAL=/^[A-Za-z0-9_-]{1,40}$/,BIOMETRIC=/^[A-Za-z0-9_.-]{1,24}$/,CODE=/^\d{0,3}$/;
const STAMP=/^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=value=>DAY.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const MAX_PUNCHES_PER_UPLOAD=2000,MAX_RANGE_DAYS=62,MAX_ROWS=5000,MAX_IMPORT_IDS=5000;
// A request nobody picked up or finished within this window is reported as failed.
const STALE="interval '90 seconds'";
/** A machine pushing straight to HR Pulse (attendance-direct.mjs): its latest contact came without a bridge PC. */
const DIRECT="(direct_contact IS NOT NULL AND direct_contact>=coalesce(last_contact,direct_contact)-interval '5 minutes')";
export const DIRECT_NAME='Direct to HR Pulse';
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

/** Machine name or location as typed: one line, at most 80 characters. */
export const cleanText=value=>String(value??'').replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
/** IPv4 address as typed ('' when left empty): four numbers 0-255 without leading zeros. */
export function cleanIp(value){
 const ip=String(value??'').trim();
 if(!ip)return '';
 const parts=ip.split('.');
 if(parts.length!==4||!parts.every(p=>/^(0|[1-9]\d{0,2})$/.test(p)&&Number(p)<=255))fail('Enter a valid IP address, e.g. 192.168.1.201');
 return ip;
}
/** The machine no. (Device ID) set on the machine: 1–999, or '' when not entered. */
export function cleanMachineNo(value){
 const no=String(value??'').trim().replace(/^0+(?=\d)/,'');
 if(no&&!/^[1-9]\d{0,2}$/.test(no))fail('Machine no. is the Device ID on the machine: a number from 1 to 999');
 return no;
}
/** A biometric machine added to a site (register) or changed (site, name, location, IP address; machine master: machine no., make, model).
    A field left out of an update keeps the value already saved (null). */
export function validateDevice(input,register){
 const serial=String(input?.serial||'').trim(),siteId=String(input?.siteId||'');
 if(register&&!siteId)fail('Choose a site');
 if(!SERIAL.test(serial))fail('Enter a valid machine serial number (letters, numbers, - or _)');
 if(siteId&&!uuid(siteId))fail('Choose a site');
 const kept=(field,clean)=>input?.[field]===undefined?null:clean(input[field]);
 return {serial,siteId,name:cleanText(input?.name),location:kept('location',cleanText),ipAddress:kept('ipAddress',cleanIp),
  machineNo:kept('machineNo',cleanMachineNo),make:kept('make',cleanText),model:kept('model',cleanText)};
}

const indiaDay=()=>new Date(Date.now()+5.5*3600_000).toISOString().slice(0,10);
export function validateRange(params){
 const today=indiaDay(); // India date
 const from=params.get('from')||today,to=params.get('to')||from;
 if(!validDay(from)||!validDay(to))fail('Dates must be in YYYY-MM-DD format');
 if(to<from)fail('The end date must be on or after the start date');
 if((Date.parse(to)-Date.parse(from))/86400000+1>MAX_RANGE_DAYS)fail(`Choose a range of ${MAX_RANGE_DAYS} days or fewer`);
 return {from,to};
}

export function createAttendance(pool,{bridgeKey=process.env.ATTENDANCE_BRIDGE_KEY}={}){
 const misAttendance=createMisAttendance(pool);
 const bridges=createBridges(pool);
 const tripCards=createTripCardStore(pool);
 const biometricDays=createBiometricDayStore(pool,{load:(site,from,to)=>loadSiteRegister(pool,site,from,to,indiaDay()),today:indiaDay});
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const out=await fn(db);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 const audit=(db,actor,action,detail)=>db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'attendance',NULL,$3)",[actor,action,detail]);
 const permit=profile=>{if(!grantedMenus(profile).has('Attendance Management'))fail('Attendance Management is not assigned to your account',403);};
 const view=row=>row&&{id:row.id,state:row.state,punchesReceived:row.punches_received,newPunches:row.new_punches,error:row.error||'',requestedBy:row.requested_by,requestedAt:row.requested_at,completedAt:row.completed_at};
 const expire=db=>db.query(`UPDATE hr_attendance_fetch_requests SET state='FAILED',error=$1,completed_at=now() WHERE state IN ('PENDING','RUNNING') AND requested_at<now()-${STALE}`,[NO_BRIDGE]);

 const mainConfigured=typeof bridgeKey==='string'&&bridgeKey.length>=32;
 /** The bridge PC signing in: null for the main bridge PC (ATTENDANCE_BRIDGE_KEY), else the site bridge PC's id. */
 async function signedInBridge(key){
  if(mainConfigured&&keyMatches(bridgeKey,key))return null;
  const site=looksLikeSiteKey(key)?await bridges.findByKey(key):null;
  if(site)return site.id;
  if(!mainConfigured&&!looksLikeSiteKey(key))fail('The attendance bridge is not configured',503);
  fail('Invalid bridge key',401);
 }

 async function bridge(key,route,method,input){
  const bridgeId=await signedInBridge(key);
  if(route==='next'&&['GET','POST'].includes(method))return tx(async db=>{
   if(bridgeId)await db.query('UPDATE hr_attendance_bridges SET last_seen=now() WHERE id=$1',[bridgeId]);
   else await db.query('INSERT INTO hr_attendance_bridge(id,last_seen) VALUES(true,now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()');
   if(method==='POST'){
    const contacts=input.contacts;
    if(!Array.isArray(contacts)||contacts.length>1000)fail('Invalid device contacts');
    for(const {serial,age} of contacts){
     if(!SERIAL.test(serial)||!Number.isSafeInteger(age)||age<0||age>86400)fail('Invalid device contact');
     // A machine belongs to the bridge PC it reports to.
     await db.query("INSERT INTO hr_attendance_devices(serial,last_contact,bridge_id) VALUES($1,now()-$2::int*interval '1 second',$3) ON CONFLICT(serial) DO UPDATE SET last_contact=greatest(hr_attendance_devices.last_contact,excluded.last_contact),bridge_id=excluded.bridge_id",[serial,age,bridgeId]);
    }
   }
   await expire(db);
   // Each bridge PC picks up only its own fetch requests.
   const row=(await db.query("UPDATE hr_attendance_fetch_requests SET state='RUNNING' WHERE id=(SELECT id FROM hr_attendance_fetch_requests WHERE state='PENDING' AND bridge_id IS NOT DISTINCT FROM $1 ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,device_serial",[bridgeId])).rows[0];
   return {request:row?{id:row.id,deviceSerial:row.device_serial}:null};
  });
  if(route==='punches'&&method==='POST'){
   const upload=validateUpload(input);
   return tx(async db=>{
    if(upload.requestId && upload.serial){
     const request=(await db.query("SELECT device_serial,bridge_id FROM hr_attendance_fetch_requests WHERE id=$1",[upload.requestId])).rows[0];
     const target=request?.device_serial;
     if(target && target!==upload.serial)fail("Restart the updated attendance bridge for machine-specific fetches.",409);
     if(request&&(request.bridge_id||null)!==bridgeId)fail('This fetch request belongs to another bridge PC.',409);
    }
    if(upload.serial)await db.query('INSERT INTO hr_attendance_devices(serial,name,last_seen,bridge_id) VALUES($1,$2,now(),$3) ON CONFLICT(serial) DO UPDATE SET last_seen=now(),bridge_id=EXCLUDED.bridge_id,name=CASE WHEN hr_attendance_devices.name=\'\' THEN EXCLUDED.name ELSE hr_attendance_devices.name END',[upload.serial,upload.name,bridgeId]);
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

 async function api(profile,route,method,input,params,grant){
  permit(profile);
  if(route==='mis'||route==='mis/correction')return misAttendance(profile,grant,route,method,input,params);
  if(route==='trip-cards')return tripCards(profile,method,input,params);
  const fetchId=route.match(/^fetch\/([0-9a-fA-F-]{36})$/)?.[1];
  if(route==='fetch'&&method==='POST')return tx(async db=>{
   await expire(db);
   const serial=input.deviceSerial||null;
   const allowed=await siteIds(db,profile);
   // The bridge PCs that must pick this up: a machine's own bridge PC, or for "all machines" the main bridge PC and
   // every site bridge PC of the user's sites (owner, 22 Nov 2026: one bridge PC per site).
   let targets=[null];
   if(serial){
    const device=SERIAL.test(serial)?(await db.query(`SELECT bridge_id,${DIRECT} AS direct FROM hr_attendance_devices WHERE serial=$1 AND ($2::text[] IS NULL OR site_id::text=ANY($2))`,[serial,allowed])).rows[0]:null;
    if(!device)fail("Machine not available",404);
    targets=device.direct?[]:[device.bridge_id||null];
   }else{
    const scoped=(await db.query("SELECT id FROM hr_attendance_bridges WHERE removed_at IS NULL AND ($1::text[] IS NULL OR site_id::text=ANY($1)) ORDER BY created_at",[allowed])).rows.map(r=>r.id);
    const direct=!mainConfigured&&!scoped.length&&(await db.query(`SELECT 1 FROM hr_attendance_devices WHERE ${DIRECT} AND ($1::text[] IS NULL OR site_id::text=ANY($1)) LIMIT 1`,[allowed])).rowCount>0;
    targets=[...(mainConfigured||(!scoped.length&&!direct)?[null]:[]),...scoped];
   }
   // A machine that pushes straight to HR Pulse has already sent its punches: nothing to wait for.
   if(!targets.length){
    const row=(await db.query("INSERT INTO hr_attendance_fetch_requests(id,requested_by,device_serial,bridge_id,state,completed_at) VALUES($1,$2,$3,NULL,'DONE',now()) RETURNING *",[randomUUID(),profile.actor,serial])).rows[0];
    await audit(db,profile.actor,'FETCH_ATTENDANCE',{requestId:row.id,direct:true});
    return view(row);
   }
   const views=[];
   for(const target of targets){
    const open=(await db.query("SELECT * FROM hr_attendance_fetch_requests WHERE state IN ('PENDING','RUNNING') AND device_serial IS NOT DISTINCT FROM $1 AND bridge_id IS NOT DISTINCT FROM $2 ORDER BY requested_at DESC LIMIT 1",[serial,target])).rows[0];
    if(open){views.push(view(open));continue;} // one fetch at a time per bridge PC; everyone waits on the same request
    const row=(await db.query('INSERT INTO hr_attendance_fetch_requests(id,requested_by,device_serial,bridge_id) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),profile.actor,serial,target])).rows[0];
    await audit(db,profile.actor,'FETCH_ATTENDANCE',{requestId:row.id,bridgeId:target});
    views.push(view(row));
   }
   return views[0];
  });
  if(fetchId&&method==='GET'){
   if(!uuid(fetchId))fail('Invalid fetch request');
   await expire(pool);
   return view((await pool.query('SELECT * FROM hr_attendance_fetch_requests WHERE id=$1',[fetchId])).rows[0])||fail('Fetch request not found',404);
  }
  const sites=await siteIds(pool,profile); // null = all sites
  if(route==='biometric-days')return biometricDays(profile,method,input,params,sites);
  const findSite=async(db,siteName)=>{
   const site=(await db.query("SELECT id FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($1),'[[:space:]]+',' ','g')) AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) LIMIT 1",[siteName,sites])).rows[0];
   return site||fail(siteAccessMessage(profile),403);
  };
  // Before a machine log (.dat) is imported: the site's machines and, for the machine user IDs in the file,
  // which ones each machine already knows (linked to an employee, named on the machine, or punched there before).
  // The upload screen picks the machine whose IDs match best, and shows who each ID is.
  if(route==='punches/import/check'&&method==='POST'){
   const siteName=String(input?.site||'').trim(),ids=input?.ids;
   if(!siteName)fail('Choose a site before importing biometric punches.');
   if(!Array.isArray(ids)||ids.length>MAX_IMPORT_IDS)fail(`Check up to ${MAX_IMPORT_IDS} machine user IDs at a time.`);
   const clean=[...new Set(ids.map(id=>String(id??'').trim()))].filter(id=>BIOMETRIC.test(id));
   const site=await findSite(pool,siteName);
   const machines=(await pool.query('SELECT serial,name,location,machine_no FROM hr_attendance_devices WHERE site_id=$1 ORDER BY location,name,serial',[site.id])).rows;
   const known=clean.length&&machines.length?(await pool.query(`SELECT d.serial,x.b AS biometric_id,e.code AS employee_code,e.name AS employee_name,u.name AS machine_name
    FROM hr_attendance_devices d CROSS JOIN unnest($2::text[]) AS x(b)
    LEFT JOIN hr_attendance_links l ON l.device_serial=d.serial AND l.biometric_id=x.b
    LEFT JOIN hr_records e ON e.id=l.employee_id AND e.kind='employees'
    LEFT JOIN hr_attendance_device_users u ON u.device_serial=d.serial AND u.biometric_id=x.b
    WHERE d.site_id=$1 AND (l.employee_id IS NOT NULL OR u.biometric_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM hr_attendance_punches p WHERE p.device_serial=d.serial AND p.biometric_id=x.b))`,[site.id,clean])).rows:[];
   return {machines:machines.map(m=>({serial:m.serial,name:m.name||'',location:m.location||'',machineNo:m.machine_no||'',
    ids:known.filter(k=>k.serial===m.serial).map(k=>({biometricId:k.biometric_id,employeeCode:k.employee_code||'',employeeName:k.employee_name||'',machineName:k.machine_name||''}))}))};
  }
  if(route==='punches/import'&&method==='POST')return tx(async db=>{
   const siteName=String(input?.site||'').trim(),rows=input?.rows;
   if(!siteName)fail('Choose a site before importing biometric punches.');
   if(!Array.isArray(rows)||!rows.length||rows.length>MAX_PUNCHES_PER_UPLOAD)fail(`Import 1–${MAX_PUNCHES_PER_UPLOAD} biometric punches at a time.`);
   const site=await findSite(db,siteName);
   const clean=rows.map(row=>{
    const serial=String(row?.serial||'').trim();
    const upload=validateUpload({device:{serial},punches:[{biometricId:row?.biometricId,punchedAt:row?.punchedAt,verify:row?.verify,punchType:row?.punchType}],users:row?.name?[{biometricId:row.biometricId,name:row.name}]:[]});
    return {serial,punch:upload.punches[0],name:upload.users[0]?.name||''};
   });
   const serials=[...new Set(clean.map(row=>row.serial))];
   const devices=(await db.query('SELECT serial FROM hr_attendance_devices WHERE site_id=$1 AND serial=ANY($2::text[])',[site.id,serials])).rows.map(row=>row.serial);
   const missing=serials.filter(serial=>!devices.includes(serial));
   if(missing.length)fail(`Machine Serial is not registered at ${siteName}: ${missing.join(', ')}`);
   const added=(await db.query('INSERT INTO hr_attendance_punches(device_serial,biometric_id,punched_at,verify,punch_type) SELECT x.s,x.b,x.t::timestamp,x.v,x.p FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[]) AS x(s,b,t,v,p) ON CONFLICT DO NOTHING',[clean.map(row=>row.serial),clean.map(row=>row.punch.biometricId),clean.map(row=>row.punch.punchedAt),clean.map(row=>row.punch.verify),clean.map(row=>row.punch.punchType)])).rowCount;
   const named=clean.filter(row=>row.name);
   if(named.length)await db.query('INSERT INTO hr_attendance_device_users(device_serial,biometric_id,name) SELECT DISTINCT ON (x.s,x.b) x.s,x.b,x.n FROM unnest($1::text[],$2::text[],$3::text[]) AS x(s,b,n) ON CONFLICT(device_serial,biometric_id) DO UPDATE SET name=EXCLUDED.name',[named.map(row=>row.serial),named.map(row=>row.punch.biometricId),named.map(row=>row.name)]);
   await audit(db,profile.actor,'IMPORT_BIOMETRIC_PUNCHES',{site:siteName,received:clean.length,added});
   return {received:clean.length,added};
  });
  if(route==='manual-biometric/import'&&method==='POST')return tx(async db=>{
   const siteName=String(input?.site||'').trim(),rows=input?.rows;
   if(!siteName)fail('Choose a site before importing biometric punches.');
   if(!Array.isArray(rows)||!rows.length||rows.length>MAX_PUNCHES_PER_UPLOAD)fail(`Import 1–${MAX_PUNCHES_PER_UPLOAD} biometric punches at a time.`);
   const site=await findSite(db,siteName);
   const clean=rows.map(row=>{const serial=String(row?.serial||'').trim();const upload=validateUpload({device:{serial},punches:[{biometricId:row?.biometricId,punchedAt:row?.punchedAt,verify:row?.verify,punchType:row?.punchType}],users:[]});return {serial,punch:upload.punches[0]};});
   const serials=[...new Set(clean.map(row=>row.serial))];
   const devices=(await db.query('SELECT serial FROM hr_attendance_devices WHERE site_id=$1 AND serial=ANY($2::text[])',[site.id,serials])).rows.map(row=>row.serial);
   const missing=serials.filter(serial=>!devices.includes(serial));
   if(missing.length)fail(`Machine Serial is not registered at ${siteName}: ${missing.join(', ')}`);
   const added=(await db.query('INSERT INTO hr_manual_biometric_punches(device_serial,biometric_id,punched_at,verify,punch_type,imported_by) SELECT x.s,x.b,x.t::timestamp,x.v,x.p,$6 FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[]) AS x(s,b,t,v,p) ON CONFLICT DO NOTHING',[clean.map(row=>row.serial),clean.map(row=>row.punch.biometricId),clean.map(row=>row.punch.punchedAt),clean.map(row=>row.punch.verify),clean.map(row=>row.punch.punchType),profile.actor])).rowCount;
   await audit(db,profile.actor,'IMPORT_MANUAL_BIOMETRIC_PUNCHES',{site:siteName,received:clean.length,added});
   return {received:clean.length,added};
  });
  if(route==='status'&&method==='GET'){
   const seen=(await pool.query("SELECT last_seen,last_seen>now()-interval '30 seconds' AS online FROM hr_attendance_bridge")).rows[0];
   // Active logs: punches the machine recorded today (India date) and its latest
   // punch in the last 31 days, both read through the punched_at index.
   const devices=(await pool.query(`SELECT d.serial,d.name,d.location,d.site_id,s.name AS site_name,d.last_seen,d.last_contact,d.last_contact>now()-interval '2 minutes' AS online,
    coalesce(a.today,0)::int AS logs_today,to_char(a.last_punch,'YYYY-MM-DD HH24:MI') AS last_punch,d.ip_address,d.machine_no,d.make,d.model,d.bridge_id,b.name AS bridge_name,
    (d.direct_contact IS NOT NULL AND d.direct_contact>=coalesce(d.last_contact,d.direct_contact)-interval '5 minutes') AS direct
    FROM hr_attendance_devices d LEFT JOIN hr_records s ON s.id=d.site_id LEFT JOIN hr_attendance_bridges b ON b.id=d.bridge_id AND b.removed_at IS NULL
    LEFT JOIN (SELECT device_serial,count(*) FILTER (WHERE punched_at>=$2::date) AS today,max(punched_at) AS last_punch FROM hr_attendance_punches WHERE punched_at>=$2::date-30 GROUP BY device_serial) a ON a.device_serial=d.serial
    WHERE $1::text[] IS NULL OR d.site_id::text=ANY($1) ORDER BY s.name NULLS LAST,d.location,d.serial`,[sites,indiaDay()])).rows;
   const last=(await pool.query('SELECT * FROM hr_attendance_fetch_requests ORDER BY requested_at DESC LIMIT 1')).rows[0];
   const siteBridges=await bridges.list(pool);
   const scope=sites?new Set(sites.map(String)):null;
   const listed=d=>({serial:d.serial,name:d.name,location:d.location||'',siteId:d.site_id,siteName:d.site_name||'',lastContact:d.last_contact,online:Boolean(d.online),lastSeen:d.last_seen,logsToday:Number(d.logs_today)||0,lastPunch:d.last_punch||null,
    ipAddress:d.ip_address||'',machineNo:d.machine_no||'',make:d.make||'',model:d.model||'',bridgeId:d.direct?null:d.bridge_id||null,direct:Boolean(d.direct),
    bridgeName:d.direct?DIRECT_NAME:d.bridge_name||(d.bridge_id||!(d.last_contact||d.last_seen)?'':'Main bridge PC')});
   const shown=devices.map(listed);
   // Bridge PCs: the main one (ATTENDANCE_BRIDGE_KEY) and one per site (attendance-bridges.mjs); site users see their sites'.
   const bridgeList=[...(mainConfigured?[{id:'main',name:'Main bridge PC',siteId:null,siteName:'',keyHint:'',lastSeen:seen?.last_seen||null,online:Boolean(seen?.online),main:true,
    machines:shown.filter(d=>!d.bridgeId&&!d.direct&&d.bridgeName).map(d=>d.serial)}]:[]),...siteBridges.filter(b=>!scope||scope.has(String(b.siteId)))];
   return {configured:mainConfigured||siteBridges.length>0||shown.some(d=>d.direct),directMachines:shown.filter(d=>d.direct).length,bridgeOnline:Boolean(seen?.online)||siteBridges.some(b=>b.online),bridgeLastSeen:seen?.last_seen||null,
    bridges:bridgeList,devices:shown,lastFetch:view(last)||null,
    canLink:canWrite(profile,'employees'),canManageDevices:assignedSites(profile)===null&&canWrite(profile,'employees')};
  }
  if(route==='policy'&&method==='GET')return {...await readPolicy(pool),canEdit:assignedSites(profile)===null&&canWrite(profile,'employees')};
  if(route==='policy'&&method==='POST'){
   if(assignedSites(profile)!==null||!canWrite(profile,'employees'))fail('Only an HR administrator without a site restriction can change the attendance policy',403);
   return tx(db=>savePolicy(db,profile.actor,input||{}));
  }
  if(route==='register'&&method==='GET'){
   const {from,to}=validateRange(params);
   return loadRegister(pool,sites,from,to,indiaDay());
  }
  if(route==='site-register'&&method==='GET'){
   // Attendance roster › Biometric: one site's machines, whoever punched on them (loadSiteRegister).
   const {from,to}=validateRange(params);
   const site=(await pool.query("SELECT id,name,data->>'siteType' AS site_type FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($1),'[[:space:]]+',' ','g')) AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) LIMIT 1",[String(params.get('site')||''),sites])).rows[0];
   if(!site)fail(siteAccessMessage(profile),403);
   return loadSiteRegister(pool,{id:site.id,name:site.name,siteType:site.site_type||''},from,to,indiaDay());
  }
  if(route==='manual-biometric'&&method==='GET'){
   const {from,to}=validateRange(params);
   const site=(await pool.query("SELECT id,name,data->>'siteType' AS site_type FROM hr_records WHERE kind='sites' AND status IN ('ACTIVE','APPROVED') AND lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($1),'[[:space:]]+',' ','g')) AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) LIMIT 1",[String(params.get('site')||''),sites])).rows[0];
   if(!site)fail(siteAccessMessage(profile),403);
   return loadSiteRegister(pool,{id:site.id,name:site.name,siteType:site.site_type||''},from,to,indiaDay(),{manual:true});
  }
  if(route==='punctuality'&&method==='GET'){
   // Late come / early going come from the same day calculation as the register.
   const {from,to}=validateRange(params);
   const register=await loadRegister(pool,sites,from,to,indiaDay());
   const rows=register.rows.flatMap(e=>e.days.filter(d=>d.late||d.early).map(d=>({id:e.id,code:e.code,name:e.name,site:e.site,shift:e.shift,date:d.date,late:d.late,early:d.early,in:d.in,out:d.out})));
   const summary=register.rows.filter(e=>e.summary.lateEarly>0).map(e=>({id:e.id,code:e.code,name:e.name,site:e.site,shift:e.shift,late:e.summary.late,early:e.summary.early,halfDutyCuts:e.summary.halfDutyCuts}));
   return {from,to,policy:register.policy,rows,summary};
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
    WHERE ($4::text IS NULL OR p.device_serial=$4) AND p.punched_at>=$1::date AND p.punched_at<$2::date+1 AND ($3::text[] IS NULL OR d.site_id::text=ANY($3))
    ORDER BY p.punched_at DESC,p.id DESC LIMIT ${MAX_ROWS+1}`,[from,to,sites,params.get("deviceSerial")||null])).rows;
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
  if((route==='devices'||route==='devices/register')&&method==='POST'){
   if(assignedSites(profile)!==null||!canWrite(profile,'employees'))fail('Only an HR administrator without site restrictions can assign devices',403);
   const register=route==='devices/register';
   const {serial,siteId,name,location,ipAddress,machineNo,make,model}=validateDevice(input,register);
   return tx(async db=>{
    if(siteId&&!(await db.query("SELECT 1 FROM hr_records WHERE id=$1 AND kind='sites'",[siteId])).rowCount)fail('Site not found',404);
    // One machine no. per site: an uploaded <no.>_attlog.dat must point at one machine.
    if(machineNo&&siteId){
     const taken=(await db.query("SELECT serial,name FROM hr_attendance_devices WHERE site_id=$1 AND machine_no=$2 AND serial<>$3 LIMIT 1",[siteId,machineNo,serial])).rows[0];
     if(taken)fail(`Machine no. ${machineNo} is already given to ${taken.name||taken.serial} at this site. Set a different Device ID on this machine and enter it here.`,409);
    }
    // An update that leaves out a field (location, IP address, machine no., make, model) keeps the one already saved.
    const statement=register
     ? "INSERT INTO hr_attendance_devices(serial,site_id,name,location,ip_address,machine_no,make,model) VALUES($1,$2,$3,coalesce($4,''),coalesce($5,''),coalesce($6,''),coalesce($7,''),coalesce($8,'')) ON CONFLICT(serial) DO NOTHING RETURNING serial,location,ip_address,machine_no,make,model"
     : 'UPDATE hr_attendance_devices SET site_id=$2,name=$3,location=coalesce($4,location),ip_address=coalesce($5,ip_address),machine_no=coalesce($6,machine_no),make=coalesce($7,make),model=coalesce($8,model) WHERE serial=$1 RETURNING serial,location,ip_address,machine_no,make,model';
    const row=(await db.query(statement,[serial,siteId||null,name,location,ipAddress,machineNo,make,model])).rows[0];
    if(!row&&register)fail('This serial number is already listed. Use its existing row to assign the site.',409);
    if(!row)fail('Device not found',404);
    const saved={serial,siteId,name,location:row.location,ipAddress:row.ip_address||'',machineNo:row.machine_no||'',make:row.make||'',model:row.model||''};
    await audit(db,profile.actor,register?'REGISTER_ATTENDANCE_DEVICE':'ASSIGN_ATTENDANCE_DEVICE',saved);
    return saved;
   });
  }
  // Delete a machine (machine-delete.mjs, owner 23 Nov 2026): no approval, removed at once. HR administrators only.
  if(route==='devices/delete'&&method==='POST'){
   if(assignedSites(profile)!==null||!canWrite(profile,'employees'))fail('Only an HR administrator without site restrictions can delete machines',403);
   return tx(db=>removeMachine(db,profile.actor,input));
  }
  // Bridge PCs per site (attendance-bridges.mjs): list, add (key shown once), new key, remove. HR administrators only.
  const bridgeRoute=route.match(/^bridges(?:\/([0-9a-fA-F-]{36})\/(key|remove))?$/);
  if(bridgeRoute){
   if(method==='GET')return {bridges:(await bridges.list(pool)).filter(b=>!sites||sites.map(String).includes(String(b.siteId)))};
   if(method!=='POST')fail('Not found',404);
   if(assignedSites(profile)!==null||!canWrite(profile,'employees'))fail('Only an HR administrator without site restrictions can manage bridge PCs',403);
   const [,id,action]=bridgeRoute;
   return tx(db=>!id?bridges.create(db,profile.actor,input):action==='key'?bridges.rekey(db,profile.actor,id):bridges.remove(db,profile.actor,id));
  }
  fail('Not found',404);
 }
 return {attendanceBridge:bridge,attendanceApi:api,attendanceMachine:createDirectMachines(pool)};
}
