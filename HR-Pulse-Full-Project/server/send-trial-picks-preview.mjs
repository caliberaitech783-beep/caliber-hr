/* One-off: send the TEST batch (new Yes / No buttons) to everyone on the vehicle trial route (Driver Trainer, PM, Office HR,
   Regional HR, Directors). Run on the HR API server: `node send-trial-picks-preview.mjs`; `node send-trial-picks-preview.mjs status <key>`
   shows how the messages were delivered. Nothing is approved or saved apart from the outgoing messages. */
import pg from 'pg';
import {sendTrialPicksPreview} from './telegram.mjs';
const pool=new pg.Pool({ssl:{rejectUnauthorized:true},max:1});
try{
 if(process.argv[2]==='status'){
  const rows=(await pool.query("SELECT o.actor,o.state,o.attempts,o.last_error FROM hr_telegram_outbox o WHERE o.event_key=$1 ORDER BY o.actor",[String(process.argv[3]||'')])).rows;
  console.log(JSON.stringify(rows,null,1));
 }else{
  const db=await pool.connect();
  try{await db.query('BEGIN');const out=await sendTrialPicksPreview(db);await db.query('COMMIT');console.log(JSON.stringify(out));}
  catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
}finally{await pool.end();}
