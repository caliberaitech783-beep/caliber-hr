// Saved trip card days, kept in step with Pulse-II (owner, 28 Nov 2026).
// "either re-read by itself, or any change made by MIS department, then upon update by them should auto update the hr
//  saved days also", and, on a push and a nightly check: "now build the MIS push and nightly check also".
//
// Why: on 28 Nov 2026 the Trip card tab of Majri OC showed 781 employees from a copy saved on 22 Nov and 749 after a
// fresh read. Pulse-II had corrected cards after the save; the saved copy stayed as it was.
//
// A saved day (hr_trip_card_days, trip-card-store.mjs) is only a faster way to open the roster; Pulse-II is the master.
// Pulse-II now tells HR Pulse which site-days changed (a card saved, corrected, deleted or moved, a batch reopened or
// locked again, a Present entry, a change made with an OTP), and once a night it checks every saved day against what it
// holds. A day Pulse-II names is marked (mis_changed_at); a marked day is no longer handed to the roster, so the roster
// reads it from Pulse-II like a day that was never saved, and "Save trip cards" stores the new copy and clears the mark.
// The old rows stay in the table until then. Nothing here reads Pulse-II, and nothing is deleted.
//
// Pulse-II signs with the key of its other calls (MIS_SYNC_KEY in the X-MIS-Sync-Key header):
//   GET  /api/integrations/mis/trip-card-days?from=YYYY-MM-DD&to=YYYY-MM-DD   (up to 62 days, no cards)
//        → {from,to,days:[{site,day,signature,duties,savedAt,changedAt}],hrOnlyCorrections}
//   POST /api/integrations/mis/trip-card-days/changed  {days:[{siteKey,date}],reason}   (up to 2,000 site-days)
//        → {marked,days:[{site,day}]}
// siteKey is Pulse-II's own key of the site ("majri ob"). A saved day carries the keys it was read from in its signature
// ("majri ob:3f2a…"), so a signed day is found by that key. A day saved before days were signed has none and is found
// by the site rule the roster uses (site-match.mjs).
import {keyMatches} from './attendance.mjs';
import {sameSite} from './site-match.mjs';

export const MIS_DAYS_MAX_SPAN=62,MIS_DAYS_MAX_CHANGED=2000;
const DAY=86_400_000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString().slice(0,10)===value;

// The Pulse-II site keys a saved day was read from, out of its signature ("key:signature,key:signature"; 'none' and '' have none).
export function signedSiteKeys(signature){
 return text(signature).split(',').map(part=>part.includes(':')?part.slice(0,part.lastIndexOf(':')).trim():'').filter(Boolean);
}
// Is this saved day (HR site name, signature) a day of that Pulse-II site?
export function savedDayOfSite(saved,siteKey){
 const keys=signedSiteKeys(saved.signature);
 return keys.length?keys.includes(siteKey):sameSite(saved.site,siteKey);
}

export function createMisTripCardDays(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 const check=key=>{
  if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
  if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
 };
 return {
  async misTripCardDays(key,method,query,input){
   check(key);
   if(method==='GET'){
    const from=query?.from,to=query?.to;
    if(!validDay(from)||!validDay(to)||to<from)fail('Send from and to as YYYY-MM-DD.');
    if((Date.parse(to)-Date.parse(from))/DAY+1>MIS_DAYS_MAX_SPAN)fail(`Ask for up to ${MIS_DAYS_MAX_SPAN} days.`);
    const [{rows},old]=await Promise.all([
     pool.query(`SELECT site,to_char(day,'YYYY-MM-DD') AS day,COALESCE(mis_signature,'') AS signature,duties,saved_at,mis_changed_at FROM hr_trip_card_days
      WHERE day BETWEEN $1::date AND $2::date ORDER BY day,site`,[from,to]),
     // Corrections kept only in HR Pulse from before 27 and 28 Nov 2026: shown on the duty, never applied.
     pool.query("SELECT count(*)::int AS n FROM hr_mis_attendance_corrections WHERE status<>'mis'")
    ]);
    return {from,to,days:rows.map(r=>({site:r.site,day:r.day,signature:r.signature,duties:r.duties,savedAt:r.saved_at,changedAt:r.mis_changed_at||null})),
     hrOnlyCorrections:Number(old.rows[0]?.n||0)};
   }
   if(method==='POST'){
    const list=Array.isArray(input?.days)?input.days:null;
    if(!list||list.length>MIS_DAYS_MAX_CHANGED)fail(`Send up to ${MIS_DAYS_MAX_CHANGED} site-days.`);
    const wanted=[];
    for(const item of list){
     const siteKey=text(item?.siteKey).toLowerCase(),date=item?.date;
     if(!siteKey||siteKey.length>200||!validDay(date))fail('Each changed day needs siteKey and date (YYYY-MM-DD).');
     wanted.push({siteKey,date});
    }
    const reason=text(input?.reason).replace(/[\u0000-\u001f\u007f]+/g,' ').slice(0,200)||'Changed in Pulse-II';
    if(!wanted.length)return {marked:0,days:[]};
    const dates=[...new Set(wanted.map(d=>d.date))];
    const {rows}=await pool.query(`SELECT site,to_char(day,'YYYY-MM-DD') AS day,COALESCE(mis_signature,'') AS signature FROM hr_trip_card_days
     WHERE day=ANY($1::date[]) AND mis_changed_at IS NULL`,[dates]);
    const hit=rows.filter(saved=>wanted.some(d=>d.date===saved.day&&savedDayOfSite(saved,d.siteKey)));
    if(!hit.length)return {marked:0,days:[]};
    const done=(await pool.query(`UPDATE hr_trip_card_days t SET mis_changed_at=now(),mis_changed_note=$3
     FROM unnest($1::text[],$2::date[]) AS want(site,day) WHERE t.site=want.site AND t.day=want.day AND t.mis_changed_at IS NULL
     RETURNING t.site,to_char(t.day,'YYYY-MM-DD') AS day`,[hit.map(d=>d.site),hit.map(d=>d.day),reason])).rows;
    if(done.length)await pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES('pulse-ii','MIS_TRIP_CARD_DAYS_CHANGED','attendance',NULL,$1)",
     [{reason,marked:done.length,days:done.slice(0,200)}]);
    return {marked:done.length,days:done};
   }
   fail('Method not allowed',405);
  }
 };
}
