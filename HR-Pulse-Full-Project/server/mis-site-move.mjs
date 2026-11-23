// A site move made in Pulse-II reaches HR Pulse at once (owner, 23 Nov 2026: "it should be two-way ... anything
// which MIS changes during batch creation should get auto updated in HR employee master also").
//
// In Pulse-II a card of one site can carry a driver of another site; on "Fetch" the Project Manager of the site the
// worker is leaving gives an OTP and the worker's site changes from the card's date. That approval has been given,
// so HR Pulse does not ask again: the Employee Master line (and the joined employee, if there is one) moves to the
// new site, the move is kept as an approved transfer marked "Pulse-II OTP", HR's audit holds it, and the HR people
// of both sites and the Regional HR Head are told on Telegram.
//
// Pulse-II signs with the same key as the copy it reads (MIS_SYNC_KEY in the X-MIS-Sync-Key header). A move is
// taken once (its Pulse-II id); sending it again gives the first answer. Whatever cannot be placed is not guessed:
// it is answered "held" with the reason, and nothing changes.
import {randomUUID} from 'node:crypto';
import {keyMatches} from './attendance.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';
import {employeeNumber,samePerson} from './employee-number.mjs';
import {requestCode} from './request-number.mjs';
import {queueTelegram} from './telegram.mjs';

export const SITE_MOVE_SCHEMA=`CREATE TABLE IF NOT EXISTS hr_mis_site_moves (
 move_id text PRIMARY KEY, payload jsonb NOT NULL, outcome text NOT NULL, detail text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now())`;
export const SITE_MOVE_REASON='Moved in Pulse-II with OTP on a card';
export const SITE_MOVE_SOURCE='Pulse-II OTP';
const SITE_NAMES={'NCL-DUDE':'Dudhichua OB East','NCL-DUDW':'Dudhichua OB West','NCL-JAYANT':'Jayant OB','WCL-DHOPTALA':'Dhoptala OB 2nd','WCL-GAURI':'Gauri Pauni OB 2nd','WCL-MAJRI':'Majri OB','WCL-SASTI':'Sasti OB'};

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=value=>value===null||value===undefined?'':String(value).trim();
const clean=(value,max)=>text(value).replace(/[\u0000-\u001f\u007f]+/g,' ').slice(0,max);
const isDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const ddmmyyyy=value=>`${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}`;

// HR Pulse's site for a site as Pulse-II writes it ("Majri OC", "Dudhichua East OC", "Gauri Pauni OC (2nd)"); '' when it is none of ours.
export function hrSiteCode(site){
 const name=text(site).toLowerCase();
 if(!name)return '';
 if(name.includes('dudhichua'))return name.includes('east')?'NCL-DUDE':'NCL-DUDW';
 if(name.includes('jayant'))return 'NCL-JAYANT';
 if(name.includes('dhoptala'))return 'WCL-DHOPTALA';
 if(name.includes('gauri')||name.includes('gouri'))return 'WCL-GAURI';
 if(name.includes('majri'))return 'WCL-MAJRI';
 if(name.includes('sasti'))return 'WCL-SASTI';
 return '';
}

// What Pulse-II sends. Anything that is not a move is refused before the database is touched.
export function readSiteMove(body){
 if(!body||typeof body!=='object'||Array.isArray(body))fail('A site move is required.');
 const move={moveId:clean(body.moveId,60),employeeId:clean(body.employeeId,40),name:clean(body.name,160),fromSite:clean(body.fromSite,120),toSite:clean(body.toSite,120),
  fromDate:text(body.fromDate).slice(0,10),requestedBy:clean(body.requestedBy,120),requestedName:clean(body.requestedName,160),
  approvedBy:(Array.isArray(body.approvedBy)?body.approvedBy:[]).map(value=>clean(value,120)).filter(Boolean).slice(0,10),
  door:clean(body.card?.door,60),cardNo:clean(body.card?.cardNo,60)};
 if(!/^[A-Za-z0-9:_-]{1,60}$/.test(move.moveId))fail('The move has no usable id.');
 if(!employeeNumber(move.employeeId))fail('The move has no usable Employee ID.');
 if(!isDate(move.fromDate))fail('The move has no date.');
 if(!move.toSite)fail('The move has no site.');
 return move;
}

const REGISTER_SQL=`SELECT id,name,site_id::text AS site_id,site_code,site_name,data->>'employeeId' AS code,data->>'designation' AS designation,data->>'reportingTo' AS manager
 FROM hr_employee_master_register WHERE ${isEmployeeEntry} AND hr_employee_number(data->>'employeeId')=$1 ORDER BY id FOR UPDATE`;
const JOINED_SQL=`SELECT id,code,name,data FROM hr_records WHERE kind='employees' AND status IN ('ACTIVE','APPROVED') AND hr_employee_number(code)=$1 ORDER BY code FOR UPDATE`;

export function siteMoveMessage(move,{from,to,code}){
 return ['Employee site changed in Pulse-II (OTP on a card)',
  `${move.employeeId} ${move.name}`.trim(),
  `${from||move.fromSite||'-'} → ${to}`,
  `From ${ddmmyyyy(move.fromDate)}${move.door?' · vehicle '+move.door:''}`,
  `Asked by ${move.requestedName||move.requestedBy||'-'} · OTP given by ${move.approvedBy.join(', ')||'-'}`,
  `HR Pulse's Employee Master now shows ${to}. Reference ${code}.`,
  'If this is not right, raise an Employee Transfer in HR Pulse.'].join('\n');
}

export function createMisSiteMove(pool,{syncKey=process.env.MIS_SYNC_KEY}={}){
 let schema=null;
 const ensure=()=>schema??=pool.query(SITE_MOVE_SCHEMA).catch(error=>{schema=null;throw error;});
 return {
  async misSiteMove(key,body){
   if(typeof syncKey!=='string'||syncKey.length<32)fail('The Pulse-II sync is not configured in HR',503);
   if(!keyMatches(syncKey,key))fail('Invalid Pulse-II sync key',401);
   const move=readSiteMove(body);
   await ensure();
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mis-site-move:'+move.moveId]);
    const before=(await db.query('SELECT outcome,detail FROM hr_mis_site_moves WHERE move_id=$1',[move.moveId])).rows[0];
    if(before){await db.query('COMMIT');return {received:true,again:true,outcome:before.outcome,detail:before.detail};}
    const answer=async(outcome,detail)=>{
     await db.query('INSERT INTO hr_mis_site_moves(move_id,payload,outcome,detail) VALUES($1,$2,$3,$4)',[move.moveId,JSON.stringify(move),outcome,detail]);
     await db.query('COMMIT');
     return {received:true,again:false,outcome,detail};
    };
    const number=employeeNumber(move.employeeId),siteCode=hrSiteCode(move.toSite);
    if(!siteCode)return await answer('held',`${move.toSite} is not a site of HR Pulse's Employee Master.`);
    const site=(await db.query("SELECT id::text AS id,code FROM hr_records WHERE kind='sites' AND code=$1 AND status='ACTIVE'",[siteCode])).rows[0];
    if(!site)return await answer('held',`${SITE_NAMES[siteCode]} is not an active site in HR Pulse.`);
    const lines=(await db.query(REGISTER_SQL,[number])).rows,joined=(await db.query(JOINED_SQL,[number])).rows;
    if(!lines.length&&!joined.length)return await answer('held',`${move.employeeId} is not in HR Pulse's Employee Master.`);
    if(lines.length>1)return await answer('held',`${move.employeeId} is on ${lines.length} lines in HR Pulse's Employee Master. Keep one line, then raise the transfer in HR Pulse.`);
    const other=[...lines,...joined].find(person=>move.name&&!samePerson(person.name,move.name));
    if(other)return await answer('held',`${move.employeeId} is ${other.name} in HR Pulse, and ${move.name} in Pulse-II. Nobody was moved.`);
    const line=lines[0],form=joined[0],toName=SITE_NAMES[siteCode],fromId=line?.site_id||text(form?.data?.siteId),fromName=line?.site_name||move.fromSite,fromCode=line?.site_code||'';
    if(line&&line.site_code===siteCode&&(!form||text(form.data?.siteId)===site.id))return await answer('applied',`HR Pulse already shows ${toName}.`);
    if(line)await db.query('UPDATE hr_employee_master_register SET site_id=$1,site_code=$2,site_name=$3,version=version+1 WHERE id=$4',[site.id,siteCode,toName,line.id]);
    if(form)await db.query('UPDATE hr_records SET data=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=$3',
     [{...form.data,siteId:site.id,transferredFromSiteId:text(form.data?.siteId),lastTransferDate:move.fromDate},'pulse-ii',form.id]);
    // The move as an approved transfer, so HR's own list of transfers is complete.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['hr-transfer-serial']);
    const serial=Number((await db.query("SELECT COALESCE(MAX((substring(code from '^TR([0-9]+)/'))::int),0)+1 AS next FROM hr_records WHERE kind='employeeTransfers'")).rows[0]?.next)||1;
    const empCode=form?.code||line?.code||move.employeeId,code=requestCode('employeeTransfers',serial,move.fromDate,empCode),transferId=randomUUID();
    const data={code,name:SITE_MOVE_REASON,employeeId:form?String(form.id):'',registerId:form?'':String(line.id),empCode,employeeName:form?.name||line?.name||move.name,transferDate:move.fromDate,
     fromSiteId:fromId,toSiteId:site.id,fromDesignation:text(line?.designation),toDesignation:text(line?.designation),fromManager:text(line?.manager),toManager:text(line?.manager),
     source:SITE_MOVE_SOURCE,misMoveId:move.moveId,requestedBy:move.requestedName||move.requestedBy,approvedBy:move.approvedBy.join(', '),door:move.door,cardNo:move.cardNo};
    await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'employeeTransfers',$2,$3,$4,'APPROVED','pulse-ii','pulse-ii')",[transferId,code,SITE_MOVE_REASON,data]);
    await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES('pulse-ii','SITE_MOVE_FROM_PULSE_II','employeeTransfers',$1,$2)",
     [transferId,{code,employee:empCode,from:fromName,to:toName,fromDate:move.fromDate,misMoveId:move.moveId,requestedBy:move.requestedBy,approvedBy:move.approvedBy}]);
    // The HR people of both sites and the Regional HR Head are told; nobody is asked to approve.
    const flows=(await db.query("SELECT code,data FROM hr_records WHERE kind='transferFlows' AND code=ANY($1)",[['COMMON',siteCode,fromCode].filter(Boolean)])).rows;
    const people=[...new Set(flows.flatMap(flow=>flow.code==='COMMON'?[flow.data?.regionalHrHead]:[flow.data?.siteHr]).flatMap(value=>text(value).split(',')).map(value=>value.trim().toLowerCase()).filter(Boolean))];
    if(people.length)await queueTelegram(db,'mis-site-move:'+move.moveId,people,siteMoveMessage(move,{from:fromName,to:toName,code}));
    return await answer('applied',`HR Pulse's Employee Master now shows ${toName}. Transfer ${code}. ${people.length?people.length+' HR '+(people.length===1?'person':'people')+' told on Telegram.':'Nobody is set to be told (Approval Master › Employee Transfer).'}`);
   }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
   finally{db.release();}
  }
 };
}
