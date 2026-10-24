import {randomUUID} from 'node:crypto';
import {canRead,canWrite} from './modules.mjs';
import {siteIds} from './scope.mjs';
export const holidayGroups=[
 {name:'NCL',sites:[{name:'DCH-E',aliases:['DCH-E','NCL-DCH E','NCL-DUDE']},{name:'DCH W',aliases:['DCH W','NCL-DCH W','NCL-DUDW']},{name:'Jayant OB',aliases:['Jayant OB','NCL-JAYANT']}]},
 {name:'WCL',sites:[{name:'Sasti',aliases:['Sasti','Sasti OC','WCL-SASTI']},{name:'Majri',aliases:['Majri','Majri OC','WCL-MAJRI']},{name:'Dhoptala',aliases:['Dhoptala','Dhoptala OC','WCL-DHOPTALA']}]},
 {name:'CO/HO',sites:[{name:'CHP',aliases:['CHP','CHO','CMLL-HO','Chandrapur HO']},{name:'NGP',aliases:['NGP','CMLL-CO','Nagpur CO']},{name:'KSR',aliases:['KSR']}]}
];
export function holidayAliases(site,group){return holidayGroups.filter(g=>!group||g.name===group).flatMap(g=>g.sites).filter(s=>!site||s.name===site).flatMap(s=>s.aliases);}
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export function validateDocument(input){
 const types={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
 const name=String(input.name||'');const ext=name.split('.').pop().toLowerCase();
 if(!name||name.length>200||/[\\/\x00-\x1f]/.test(name)||!types[ext])fail('Choose a PDF, Word document, PNG or JPEG');
 if(typeof input.content!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.content))fail('Invalid document');
 const bytes=Buffer.from(input.content,'base64');if(!bytes.length||bytes.length>1_000_000)fail('Choose a document up to 1 MB');
 const valid=ext==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='docx'?bytes.subarray(0,2).toString()==='PK':ext==='doc'?bytes.subarray(0,4).toString('hex')==='d0cf11e0':ext==='png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':bytes.subarray(0,3).toString('hex')==='ffd8ff';
 if(!valid)fail('The document content does not match its file extension');return {name,mime:types[ext],content:input.content,size:bytes.length};
}
export function createHolidayDocuments(pool){
 async function access(profile,site,write=false){
 if(!(write?canWrite:canRead)(profile,'holidays'))fail('Holiday access is required',403);
 const aliases=holidayAliases(site);if(!site||!aliases.length)fail('Choose a holiday site');
 const ids=await siteIds(pool,profile);if(ids===null)return;
 const rows=(await pool.query("SELECT code,name FROM hr_records WHERE kind='sites' AND id::text=ANY($1)",[ids])).rows;
 if(!rows.some(r=>aliases.some(a=>[r.code,r.name].some(v=>v.toLowerCase()===a.toLowerCase()))))fail('This site is outside your assigned Pulse site',403);
 }
 return {
 async holidayDocuments(profile,params,input){
 const site=params.get('site');await access(profile,site,!!input);
 if(input){const data={...validateDocument(input),siteId:site};const id=randomUUID();const db=await pool.connect();try{await db.query('BEGIN');await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1::uuid,'holidayDocuments',$1::text,$2,$3,'ACTIVE',$4,$4)",[id,data.name,data,profile.actor]);await db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,'UPLOAD','holidayDocuments',$2,$3)",[profile.actor,id,{site,name:data.name}]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}return {id};}
 const id=params.get('id');if(id){const row=(await pool.query("SELECT data FROM hr_records WHERE kind='holidayDocuments' AND id::text=$1 AND data->>'siteId'=$2",[id,site])).rows[0];if(!row)fail('Document not found',404);return row.data;}
 return (await pool.query("SELECT id,name,updated_at,data->>'mime' AS mime,data->>'size' AS size FROM hr_records WHERE kind='holidayDocuments' AND data->>'siteId'=$1 ORDER BY updated_at DESC",[site])).rows;
 },
 async holidayGroups(profile){if(!canRead(profile,'holidays'))fail('Holiday access is required',403);const groups=[];for(const g of holidayGroups){const sites=[];for(const s of g.sites){try{await access(profile,s.name);sites.push(s);}catch(e){if(e.status!==403)throw e;}}if(sites.length)groups.push({...g,sites});}return groups;}
 };
}
