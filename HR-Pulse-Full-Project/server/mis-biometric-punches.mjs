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
// Owner, 25 Nov 2026: the days an HR administrator corrected on Attendance roster › Manual Biometric
// (hr_manual_attendance_corrections) go along, so Pulse-II's Biometric vs trip card mismatch shows the corrected day:
//   corrections:[[site index, 'YYYY-MM-DD', employee code or machine ID, code ('' or P, HD, A, WO, H, CO, L, OD), In 'HH:MM', Out 'HH:MM', reason, by]…]
// An Out not after the In is the next morning. The punches themselves are still sent as imported.
import {keyMatches} from './attendance.mjs';

export const MIS_PUNCH_MAX_DAYS=31;
// Raised from 400,000 (24 Nov 2026): with the Manual Biometric logs of every site, 20 days can pass 400,000 punches.
export const MIS_PUNCH_MAX_ROWS=1_000_000;
const DAY=86_400_000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString().slice(0,10)===value;

// Owner, 24 Nov 2026: the Manual Biometric logs HR imports for a site (Attendance roster › Manual Biometric,
// hr_manual_biometric_punches) are sent too, so Pulse-II's Caliber Punch Re-check sees the attendance of every site whose
// logs reach HR, not only the machines that push live. HR's own Manual Biometric roster reads the machine user ID there
// as the employee number, so its code is '' and Pulse-II does the same. A punch in both tables comes twice and Pulse-II
// reads the repeat as one punch.
export const MIS_PUNCHES_SQL=`SELECT code,biometric_id,at,site,punch_type FROM (
 SELECT coalesce(e.code,'') AS code,p.biometric_id,p.punched_at,to_char(p.punched_at,'YYYY-MM-DD HH24:MI') AS at,
  coalesce(s.name,'') AS site,p.punch_type
 FROM hr_attendance_punches p
 LEFT JOIN hr_attendance_links l ON l.device_serial=p.device_serial AND l.biometric_id=p.biometric_id
 LEFT JOIN hr_records e ON e.id=l.employee_id AND e.kind='employees'
 LEFT JOIN hr_attendance_devices d ON d.serial=p.device_serial
 LEFT JOIN hr_records s ON s.id=d.site_id AND s.kind='sites'
 WHERE p.punched_at>=$1::date AND p.punched_at<$2::date+2
 UNION ALL
 SELECT '' AS code,m.biometric_id,m.punched_at,to_char(m.punched_at,'YYYY-MM-DD HH24:MI') AS at,
  coalesce(s.name,'') AS site,m.punch_type
 FROM hr_manual_biometric_punches m
 LEFT JOIN hr_attendance_devices d ON d.serial=m.device_serial
 LEFT JOIN hr_records s ON s.id=d.site_id AND s.kind='sites'
 WHERE m.punched_at>=$1::date AND m.punched_at<$2::date+2
) punches
 ORDER BY punched_at
 LIMIT ${MIS_PUNCH_MAX_ROWS+1}`;

export const MIS_CORRECTIONS_SQL=`SELECT site,to_char(day,'YYYY-MM-DD') AS day,employee_code,status,in_time,out_time,reason,corrected_by
 FROM hr_manual_attendance_corrections WHERE day BETWEEN $1::date AND $2::date ORDER BY day,employee_code`;

export function readPunchRange({from,to}={}){
 if(!validDay(from)||!validDay(to)||to<from)fail('Give a valid from and to date (YYYY-MM-DD).');
 if((Date.parse(to)-Date.parse(from))/DAY>=MIS_PUNCH_MAX_DAYS)fail(`Ask for up to ${MIS_PUNCH_MAX_DAYS} days.`);
 return {from,to};
}

export function packPunches(rows,corrected=[]){
 const sites=[],at=new Map();
 const siteIndex=name=>{if(!at.has(name)){at.set(name,sites.length);sites.push(name);}return at.get(name);};
 const punches=rows.map(row=>[text(row.code),text(row.biometric_id),text(row.at),siteIndex(text(row.site)),text(row.punch_type)]);
 const corrections=corrected.map(row=>[siteIndex(text(row.site)),text(row.day),text(row.employee_code),text(row.status),text(row.in_time),text(row.out_time),text(row.reason),text(row.corrected_by)]);
 return {sites,punches,corrections};
}
// A database with no corrections table yet sends none.
const readCorrections=(pool,from,to)=>pool.query(MIS_CORRECTIONS_SQL,[from,to]).then(r=>r.rows,error=>{if(error?.code==='42P01')return [];throw error;});

export function createMisBiometricPunches(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 return {
  async misBiometricPunches(key,query){
   if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
   if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
   const {from,to}=readPunchRange(query);
   const [{rows},corrected]=await Promise.all([pool.query(MIS_PUNCHES_SQL,[from,to]),readCorrections(pool,from,to)]);
   if(rows.length>MIS_PUNCH_MAX_ROWS)fail('Too many punches in these dates. Ask for fewer days.',413);
   return {generatedAt:new Date().toISOString(),from,to,...packPunches(rows,corrected)};
  }
 };
}
