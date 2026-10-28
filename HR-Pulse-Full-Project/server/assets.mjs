import {randomUUID} from 'node:crypto';
import {siteIds} from './scope.mjs';
import {permit,role,fail,bookValue,transition,date,categoryData,customData,nextTag,seeds} from './asset-domain.mjs';
export async function seedAssets(pool){
 for(const [name,prefix,group,rate,method='WDV'] of seeds){const fields=name==='Vehicle'?[{key:'registration',label:'Registration number',type:'text',required:true},{key:'insuranceExpiry',label:'Insurance expiry',type:'date',required:true},{key:'pucExpiry',label:'PUC expiry',type:'date',required:true}]:[];
 await pool.query('INSERT INTO hr_asset_categories(id,name,prefix,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),name,prefix,{group,rate,method,serialMandatory:['Laptop','Desktop','Monitor','Mobile'].includes(name),fields}]);}
 for(const name of ['New','Good','Fair','Poor','Damaged'])await pool.query("INSERT INTO hr_asset_lookups(id,kind,name) VALUES($1,'condition',$2) ON CONFLICT DO NOTHING",[randomUUID(),name]);
}
export async function assetReminders(pool){
 // Durable, deduplicated daily inbox. Re-run safely after restarts and on multiple instances.
 await pool.query(`INSERT INTO hr_asset_reminders(day,asset_id,kind,data)
 SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date,a.id,dates.kind,jsonb_build_object('date',dates.value,'tag',a.tag)
 FROM hr_asset_register a CROSS JOIN LATERAL (VALUES
 ('Overdue return',CASE WHEN a.status='Assigned' THEN a.data->>'expectedReturn' END),
 ('Warranty expiry',a.data->>'warrantyExpiry'),('Insurance expiry',a.data->'custom'->>'insuranceExpiry'),('PUC expiry',a.data->'custom'->>'pucExpiry')) dates(kind,value)
 WHERE a.status NOT IN ('Lost','Disposed') AND dates.value ~ '^\\d{4}-\\d{2}-\\d{2}$'
 AND ((dates.kind='Overdue return' AND dates.value::date<(now() AT TIME ZONE 'Asia/Kolkata')::date)
 OR (dates.kind<>'Overdue return' AND dates.value::date BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date+30)) ON CONFLICT DO NOTHING`);
}
export function createAssets(pool){
 const tx=async fn=>{const db=await pool.connect();try{await db.query('BEGIN');const out=await fn(db);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}};
 const audit=(db,p,action,id,data)=>db.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'assetRegister',$3,$4)",[p.actor,action,id,data]);
 async function context(db,p){
  permit(p,'read');const sites=await siteIds(db,p);const r=role(p);let self=null;
  if(r==='Employee'){const matches=await db.query("SELECT id FROM hr_records WHERE kind='employees' AND (lower(data->>'pulseUsername')=$1 OR lower(data->>'username')=$1 OR (id::text=$2 AND $2<>''))",[p.actor,String(p.employeeId||'')]);if(matches.rows.length!==1)fail('Your Pulse account must be linked to one employee record before viewing assets',403);self=matches.rows[0].id;}
  return {sites,self,role:r};
 }
 async function asset(db,p,id,lock=false){const ctx=await context(db,p);const row=(await db.query('SELECT * FROM hr_asset_register WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)fail('Asset not found',404);if(ctx.sites&&!ctx.sites.includes(row.site_id)||ctx.self&&ctx.self!==row.employee_id&&ctx.self!==row.data.lostEmployeeId)fail('Asset is outside your access',403);return row;}
 async function employee(db,p,id){const ctx=await context(db,p);const row=(await db.query("SELECT * FROM hr_records WHERE id=$1 AND kind='employees' FOR UPDATE",[id])).rows[0];if(!row)fail('Employee not found',404);if(ctx.sites&&!ctx.sites.includes(row.data.siteId)||ctx.self&&ctx.self!==id)fail('Employee is outside your access',403);return row;}
 async function clearance(db,id){const rows=(await db.query("SELECT id,tag,status,data FROM hr_asset_register WHERE employee_id=$1 OR (data->>'lostEmployeeId'=$1::text AND COALESCE(data->>'recoveryCleared','false')<>'true')",[id])).rows;return {employeeId:id,pending:rows.length,label:rows.length?rows.length+' pending':'No dues',assets:rows};}
 return {async assetApi(p,path,method,input={},params=new URLSearchParams()){
 if(path==='bootstrap'&&method==='GET'){
  const ctx=await context(pool,p);const categories=(await pool.query('SELECT * FROM hr_asset_categories ORDER BY name')).rows;
  const employees=(await pool.query("SELECT id,code,name,status,data->>'siteId' AS site_id,COALESCE(data->>'employmentStatus',data->'officeData'->>'Employment Status',data->'officeData'->>'Status','') AS employment_status FROM hr_records WHERE kind='employees' AND ($1::text[] IS NULL OR data->>'siteId'=ANY($1)) AND ($2::uuid IS NULL OR id=$2) ORDER BY name",[ctx.sites,ctx.self])).rows;
  const locations=(await pool.query("SELECT id,code,name FROM hr_records WHERE kind='sites' AND status='ACTIVE' AND ($1::text[] IS NULL OR id::text=ANY($1)) ORDER BY name",[ctx.sites])).rows;
  const lookups=(await pool.query('SELECT * FROM hr_asset_lookups ORDER BY kind,name')).rows;
  const settings=(await pool.query('SELECT * FROM hr_asset_settings WHERE id=1')).rows[0];return {...ctx,categories,employees,locations,lookups,settings};
 }
 if(path==='register'&&method==='GET'){
  const ctx=await context(pool,p);const rows=(await pool.query(`SELECT a.*,c.name AS category,c.data AS category_data,e.name AS employee FROM hr_asset_register a JOIN hr_asset_categories c ON c.id=a.category_id LEFT JOIN hr_records e ON e.id=a.employee_id WHERE ($1::text[] IS NULL OR a.site_id::text=ANY($1)) AND ($2::uuid IS NULL OR (a.employee_id=$2 OR a.data->>'lostEmployeeId'=$2::text)) ORDER BY a.created_at DESC`,[ctx.sites,ctx.self])).rows;
  return rows.map(a=>({...a,bookValue:bookValue({...a.data,status:a.status},a.data.depreciation||a.category_data)}));
 }
 if(path==='reminders'&&method==='GET'){const ctx=await context(pool,p);return (await pool.query("SELECT r.* FROM hr_asset_reminders r JOIN hr_asset_register a ON a.id=r.asset_id WHERE day=(now() AT TIME ZONE 'Asia/Kolkata')::date AND ($1::text[] IS NULL OR a.site_id::text=ANY($1)) AND ($2::uuid IS NULL OR (a.employee_id=$2 OR a.data->>'lostEmployeeId'=$2::text)) ORDER BY kind",[ctx.sites,ctx.self])).rows;}
 if(path==='category'&&method==='POST'){
  permit(p,'admin');if((await siteIds(pool,p))!==null)fail('Category changes require access to all sites',403);const data=categoryData(input);
  return tx(async db=>{const id=input.id||randomUUID();if(input.id){const old=(await db.query('SELECT * FROM hr_asset_categories WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)fail('Category not found',404);if(old.prefix!==data.prefix)fail('Tag prefix cannot change after creation');await db.query('UPDATE hr_asset_categories SET name=$2,data=$3,updated_at=now() WHERE id=$1',[id,data.name,data]);}else await db.query('INSERT INTO hr_asset_categories(id,name,prefix,data) VALUES($1,$2,$3,$4)',[id,data.name,data.prefix,data]);await audit(db,p,'ASSET_CATEGORY',id,data);return {id};});
 }
 if(path==='lookup'&&method==='POST'){permit(p,'write');const ctx=await context(pool,p);const name=String(input.name||'').trim();if(!name||name.length>120)fail('Enter a name');if(input.kind==='location'){if(ctx.sites!==null)fail('New locations require all-site access',403);return tx(async db=>{const id=randomUUID(),code='LOC-'+id.slice(0,8);await db.query("INSERT INTO hr_records(id,kind,code,name,data,status,created_by,updated_by) VALUES($1,'sites',$2,$3,$4,'ACTIVE',$5,$5)",[id,code,name,{code,name},p.actor]);await audit(db,p,'ASSET_LOCATION',id,{name});return {id};});}if(!['vendor','condition'].includes(input.kind))fail('Invalid lookup');if(ctx.sites!==null)fail('Global lookup changes require all-site access',403);return tx(async db=>{const id=randomUUID();await db.query('INSERT INTO hr_asset_lookups(id,kind,name) VALUES($1,$2,$3)',[id,input.kind,name]);await audit(db,p,'ASSET_LOOKUP',id,input);return {id};});}
 if(path==='settings'&&method==='POST'){permit(p,'admin');if((await siteIds(pool,p))!==null)fail('Settings require all-site access',403);if(typeof input.blockFNF!=='boolean')fail('Invalid setting');return tx(async db=>{await db.query('UPDATE hr_asset_settings SET block_fnf=$1 WHERE id=1',[input.blockFNF]);await audit(db,p,'ASSET_SETTINGS',null,input);return {ok:true};});}
 if(path==='register'&&method==='POST'){
  permit(p,'write');return tx(async db=>{const ctx=await context(db,p);const c=(await db.query('SELECT * FROM hr_asset_categories WHERE id=$1 FOR SHARE',[input.categoryId])).rows[0];if(!c)fail('Choose a category');const site=(await db.query("SELECT id FROM hr_records WHERE id=$1 AND kind='sites' AND status='ACTIVE'",[input.siteId])).rows[0];if(!site||ctx.sites&&!ctx.sites.includes(site.id))fail('Choose an accessible location',403);
  const name=String(input.name||'').trim(),serial=String(input.serial||'').trim();if(!name||name.length>200||serial.length>200||c.data.serialMandatory&&!serial)fail('Name and required serial must be supplied');const cost=Number(input.purchaseCost);if(input.purchaseCost==null||input.purchaseCost===''||!Number.isFinite(cost)||cost<0)fail('Enter a valid purchase cost');
  const condition=(await db.query("SELECT name FROM hr_asset_lookups WHERE kind='condition' AND name=$1",[input.condition])).rows[0];if(!condition)fail('Choose a condition');if(input.vendor&&!(await db.query("SELECT id FROM hr_asset_lookups WHERE kind='vendor' AND name=$1",[input.vendor])).rowCount)fail('Choose a vendor');
  const data={name,makeModel:String(input.makeModel||'').slice(0,200),purchaseCost:cost,purchaseDate:date(input.purchaseDate,'Purchase date',true),warrantyExpiry:date(input.warrantyExpiry,'Warranty expiry'),condition:input.condition,vendor:input.vendor||'',invoice:String(input.invoice||'').slice(0,300),custom:customData(c.data.fields||[],input.custom||{}),depreciation:{rate:c.data.rate,method:c.data.method}};
  const tag=await nextTag(db,c.prefix),id=randomUUID();await db.query("INSERT INTO hr_asset_register(id,tag,category_id,serial,site_id,status,data) VALUES($1,$2,$3,$4,$5,'Available',$6)",[id,tag,c.id,serial||null,site.id,data]);await db.query("INSERT INTO hr_asset_movements(id,asset_id,action,actor,data) VALUES($1,$2,'Created',$3,$4)",[randomUUID(),id,p.actor,{to:'Available'}]);await audit(db,p,'ASSET_CREATED',id,{tag});return {id,tag};});
 }
 const detail=path.match(/^detail\/([a-f0-9-]{36})$/i);if(detail&&method==='GET'){const a=await asset(pool,p,detail[1]);return {...a,history:(await pool.query('SELECT * FROM hr_asset_movements WHERE asset_id=$1 ORDER BY occurred_at,id',[a.id])).rows};}
 const move=path.match(/^move\/([a-f0-9-]{36})$/i);if(move&&method==='POST'){
  permit(p,'move');return tx(async db=>{const a=await asset(db,p,move[1],true);if(input.version!==a.version)fail('Asset changed; refresh and try again',409);
  const target=['Issue','Transfer'].includes(input.action)?await employee(db,p,input.employeeId):null;const next=transition(a,input,target);const data={...a.data};
  if(['Issue','Transfer'].includes(input.action))data.expectedReturn=date(input.expectedReturn,'Expected return');else delete data.expectedReturn;
  if(input.condition){if(!(await db.query("SELECT id FROM hr_asset_lookups WHERE kind='condition' AND name=$1",[input.condition])).rowCount)fail('Choose a valid condition');data.condition=input.condition;}
  if(input.action==='Mark lost'){data.lostEmployeeId=a.employee_id||'';data.recoveryAmount=Number(input.amount);data.recoveryCleared=false;}
  if(input.action==='Found'){delete data.lostEmployeeId;delete data.recoveryAmount;delete data.recoveryCleared;}
  if(input.action==='Dispose'){data.disposalMethod=String(input.method).slice(0,120);data.disposalAmount=Number(input.amount);}
  await db.query('UPDATE hr_asset_register SET status=$2,employee_id=$3,data=$4,version=version+1,updated_at=now() WHERE id=$1',[a.id,next.status,next.employee_id,data]);
  await db.query('INSERT INTO hr_asset_movements(id,asset_id,action,actor,data) VALUES($1,$2,$3,$4,$5)',[randomUUID(),a.id,input.action,p.actor,{from:a.status,to:next.status,fromEmployee:a.employee_id,toEmployee:next.employee_id,amount:input.amount,method:input.method,notes:String(input.notes||'').slice(0,2000),condition:data.condition,expectedReturn:data.expectedReturn}]);await audit(db,p,'ASSET_MOVEMENT',a.id,{action:input.action});return {ok:true};});
 }
 const clear=path.match(/^employee\/([a-f0-9-]{36})$/i);if(clear&&method==='GET'){await employee(pool,p,clear[1]);return clearance(pool,clear[1]);}
 if(path==='link-employee'&&method==='POST'){permit(p,'admin');return tx(async db=>{const e=await employee(db,p,input.employeeId);const username=String(input.username||'').trim().toLowerCase();if(!/^[a-z0-9_.@-]{2,120}$/.test(username))fail('Enter the exact Pulse username');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['asset-user-'+username]);if((await db.query("SELECT id FROM hr_records WHERE kind='employees' AND lower(data->>'pulseUsername')=$1 AND id<>$2",[username,e.id])).rowCount)fail('Username already linked',409);await db.query("UPDATE hr_records SET data=jsonb_set(data,'{pulseUsername}',to_jsonb($2::text)),version=version+1 WHERE id=$1",[e.id,username]);await audit(db,p,'ASSET_EMPLOYEE_LINK',e.id,{username});return {ok:true};});}
 if(path==='fnf-check'&&method==='POST'){permit(p,'write');return tx(async db=>{await employee(db,p,input.employeeId);const result=await clearance(db,input.employeeId);const setting=(await db.query('SELECT block_fnf FROM hr_asset_settings WHERE id=1')).rows[0];if(setting.block_fnf&&result.pending)fail('F&F blocked: '+result.label);const id=randomUUID();await db.query('INSERT INTO hr_asset_fnf_checks(id,employee_id,actor,data) VALUES($1,$2,$3,$4)',[id,input.employeeId,p.actor,result]);return {...result,eligible:true};});}
 fail('Asset endpoint not found',404);
 }};
}
