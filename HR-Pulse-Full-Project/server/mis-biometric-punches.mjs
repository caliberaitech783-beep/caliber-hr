// Biometric punches for Pulse-II (owner, 23 Nov 2026): Pulse-II's Reports > Manpower & OT > Attendance Sheet Mismatch
// sets the punches of drivers and operators beside their log books (trip cards). The site machines push their punches
// straight to HR Pulse (attendance-direct.mjs); this hands Pulse-II the punches of a date range. Read only.
// Pulse-II signs in with the same key as the Employee Master copy (MIS_SYNC_KEY in the X-MIS-Sync-Key header).
//
// GET /api/integrations/mis/biometric-punches?from=YYYY-MM-DD&to=YYYY-MM-DD   (up to 31 days)
// The punches of from up to the morning after to (a night duty ends after midnight), compact:
//   {from,to,sites:[name…],punches:[[employee code or '', machine user ID, 'YYYY-MM-DD HH:MM', site index, punch type]…]}
// The employee code is the one the machine ID is linked to in Attendance (hr_attendance_links); '' when not linked, and
// Pulse-II then reads the machine user ID as the employee number. The site is the site the machine stands at.
import {keyMatches} from './attendance.mjs';

export const MIS_PUNCH_MAX_DAYS=31;
export const MIS_PUNCH_MAX_ROWS=400_000;
const DAY=86_400_000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString().slice(0,10)===value;

export const MIS_PUNCHES_SQL=`SELECT coalesce(e.code,'') AS code,p.biometric_id,to_char(p.punched_at,'YYYY-MM-DD HH24:MI') AS at,
  coalesce(s.name,'') AS site,p.punch_type
 FROM hr_attendance_punches p
 LEFT JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
 LEFT JOIN hr_records e ON e.id=l.employee_id AND e.kind='employees'
 LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
 LEFT JOIN hr_records s ON s.id=d.site_id AND s.kind='sites'
 WHERE p.punched_at>=$1::date AND p.punched_at<$2::date+2
 ORDER BY p.punched_at
 LIMIT ${MIS_PUNCH_MAX_ROWS+1}`;

export function readPunchRange({from,to}={}){
 if(!validDay(from)||!validDay(to)||to<from)fail('Give a valid from and to date (YYYY-MM-DD).');
 if((Date.parse(to)-Date.parse(from))/DAY>=MIS_PUNCH_MAX_DAYS)fail(`Ask for up to ${MIS_PUNCH_MAX_DAYS} days.`);
 return {from,to};
}

export function packPunches(rows){
 const sites=[],at=new Map();
 const siteIndex=name=>{if(!at.has(name)){at.set(name,sites.length);sites.push(name);}return at.get(name);};
 const punches=rows.map(row=>[text(row.code),text(row.biometric_id),text(row.at),siteIndex(text(row.site)),text(row.punch_type)]);
 return {sites,punches};
}

export function createMisBiometricPunches(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 return {
  async misBiometricPunches(key,query){
   if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
   if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
   const {from,to}=readPunchRange(query);
   const {rows}=await pool.query(MIS_PUNCHES_SQL,[from,to]);
   if(rows.length>MIS_PUNCH_MAX_ROWS)fail('Too many punches in these dates. Ask for fewer days.',413);
   return {generatedAt:new Date().toISOString(),from,to,...packPunches(rows)};
  }
 };
}
