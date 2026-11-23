/* Deleting a biometric machine (owner, 23 Nov 2026): every saved machine in Biometric machines has Delete.
   The owner removed the Telegram approval / OTP the same day ("No approval at all"): an HR administrator
   without a site restriction confirms once and the machine is removed at once.
   Deleting removes the machine and cancels its open fetches. The punches it already sent, the names on it and the
   employee links are kept, so attendance already recorded never changes. Every delete goes into the audit log. */

const SERIAL=/^[A-Za-z0-9_-]{1,40}$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};

/** Removes the machine: the row and its open fetches; punches, names on the machine and employee links stay. */
export async function removeMachine(db,actor,input){
 const serial=String(input?.serial||'').trim();
 if(!SERIAL.test(serial))fail('Choose a machine to delete');
 const row=(await db.query('DELETE FROM hr_attendance_devices WHERE serial=$1 RETURNING serial,name,location,site_id,ip_address',[serial])).rows[0];
 if(!row)fail('Machine not found',404);
 await db.query("UPDATE hr_attendance_fetch_requests SET state='FAILED',error='The machine was deleted.',completed_at=now() WHERE device_serial=$1 AND state IN ('PENDING','RUNNING')",[serial]);
 await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'DELETE_ATTENDANCE_DEVICE','attendance',NULL,$2)",[actor,{serial,name:row.name,location:row.location,siteId:row.site_id,ipAddress:row.ip_address}]);
 return {deleted:true,serial};
}
