/* Bridge PCs per site (owner, 22 Nov 2026).
   Each site's bridge PC has its own key, made in Biometric machines › Bridge PCs. HR keeps only the key's SHA-256
   fingerprint and its last 4 letters, so the key is shown once when it is made. A machine belongs to the bridge PC it
   reports to (hr_attendance_devices.bridge_id), and a fetch request is picked up only by that bridge PC.
   The first bridge PC (Nagpur), signed in with ATTENDANCE_BRIDGE_KEY, stays as the "Main bridge PC": bridge_id null. */
import {createHash, randomBytes, randomUUID} from 'node:crypto';

export const SITE_KEY_PREFIX = 'hrb_';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export const keyFingerprint = key => createHash('sha256').update(String(key)).digest('hex');
/** A new site bridge key: "hrb_" and 43 random letters (256 bits). */
export const newBridgeKey = () => SITE_KEY_PREFIX + randomBytes(32).toString('base64url');
/** Only well-formed site keys are looked up, so a wrong or junk key never reaches the database. */
export const looksLikeSiteKey = key => typeof key === 'string' && key.startsWith(SITE_KEY_PREFIX) && /^[A-Za-z0-9_-]{40,80}$/.test(key);
const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function createBridges(pool) {
  /** The site bridge PC a key belongs to, or null. */
  async function findByKey(key) {
    if (!looksLikeSiteKey(key)) return null;
    return (await pool.query('SELECT id,name,site_id FROM hr_attendance_bridges WHERE key_hash=$1 AND removed_at IS NULL', [keyFingerprint(key)])).rows[0] || null;
  }

  async function list(db) {
    const rows = (await db.query(`SELECT b.id,b.name,b.site_id,s.name AS site_name,b.key_hint,b.last_seen,coalesce(b.last_seen>now()-interval '30 seconds',false) AS online,b.created_at,
      coalesce((SELECT array_agg(d.serial ORDER BY d.serial) FROM hr_attendance_devices d WHERE d.bridge_id=b.id),'{}') AS machines
     FROM hr_attendance_bridges b LEFT JOIN hr_records s ON s.id=b.site_id WHERE b.removed_at IS NULL ORDER BY s.name NULLS LAST,b.name`)).rows;
    return rows.map(r => ({id: r.id, name: r.name, siteId: r.site_id, siteName: r.site_name || '', keyHint: r.key_hint, lastSeen: r.last_seen, online: Boolean(r.online),
      createdAt: r.created_at, machines: r.machines || [], main: false}));
  }

  /** Add bridge PC: returns the bridge and its key (the only time the key is shown). */
  async function create(db, actor, input) {
    const siteId = String(input?.siteId || ''), name = cleanName(input?.name);
    if (!uuid(siteId)) fail('Choose a site');
    if (!name) fail('Enter a name for the bridge PC');
    if (!(await db.query("SELECT 1 FROM hr_records WHERE id=$1 AND kind='sites'", [siteId])).rowCount) fail('Site not found', 404);
    const key = newBridgeKey(), id = randomUUID();
    await db.query('INSERT INTO hr_attendance_bridges(id,site_id,name,key_hash,key_hint,created_by) VALUES($1,$2,$3,$4,$5,$6)', [id, siteId, name, keyFingerprint(key), key.slice(-4), actor]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'ADD_ATTENDANCE_BRIDGE','attendance',NULL,$2)", [actor, {id, siteId, name}]);
    return {bridge: {id, name, siteId, keyHint: key.slice(-4)}, key};
  }

  /** New key: the old key stops working at once. */
  async function rekey(db, actor, id) {
    if (!uuid(id)) fail('Bridge PC not found', 404);
    const key = newBridgeKey();
    const row = (await db.query('UPDATE hr_attendance_bridges SET key_hash=$2,key_hint=$3 WHERE id=$1 AND removed_at IS NULL RETURNING id,name,site_id', [id, keyFingerprint(key), key.slice(-4)])).rows[0];
    if (!row) fail('Bridge PC not found', 404);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'NEW_ATTENDANCE_BRIDGE_KEY','attendance',NULL,$2)", [actor, {id}]);
    return {bridge: {id: row.id, name: row.name, siteId: row.site_id, keyHint: key.slice(-4)}, key};
  }

  /** Remove: the key stops working; its machines go back to "no bridge PC" until a bridge PC hears them again. */
  async function remove(db, actor, id) {
    if (!uuid(id)) fail('Bridge PC not found', 404);
    const row = (await db.query('UPDATE hr_attendance_bridges SET removed_at=now() WHERE id=$1 AND removed_at IS NULL RETURNING id,name', [id])).rows[0];
    if (!row) fail('Bridge PC not found', 404);
    await db.query('UPDATE hr_attendance_devices SET bridge_id=NULL WHERE bridge_id=$1', [id]);
    await db.query("UPDATE hr_attendance_fetch_requests SET state='FAILED',error='The bridge PC was removed.',completed_at=now() WHERE bridge_id=$1 AND state IN ('PENDING','RUNNING')", [id]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'REMOVE_ATTENDANCE_BRIDGE','attendance',NULL,$2)", [actor, {id, name: row.name}]);
    return {removed: true};
  }

  return {findByKey, list, create, rekey, remove};
}
