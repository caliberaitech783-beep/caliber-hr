import {canRead} from './modules.mjs';
import {siteIds,scopeSql} from './scope.mjs';
import {REGISTER_AT_SITE,JOINED_AT_SITE} from './transfer-options.mjs';
import {isEmployeeEntry} from './employee-master-register.mjs';
import {nextRequestCode} from './request-number.mjs';
import {odSiteFlow} from './telegram.mjs';
import {odApprovalWorkflow} from './out-duty.mjs';
import {stepLabel} from './request-progress.mjs';
import {createMisVtc,isVtcTrade,misMessage,vtcBody} from './vtc.mjs';

/* VTC requests (vtc.mjs): the employee of a request, the Pulse-II check before submit and the last approval, the send to
   Pulse-II after the final approval, and the list of approved requests not yet in Pulse-II with Retry.
   Pulse-II is called only outside a database transaction (never hold a pooled connection across a call to another server). */
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const leftStatus=/\b(left|inactive|resign|resigned|exit|exited|terminated|absconding|dead|expired)\b/i;
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const key=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const RETRY_LIMIT=20;

export function createVtc(pool,{fetchMis=fetch}={}){
  const mis=createMisVtc(fetchMis);
  const siteArgs=async(db,siteId)=>{const site=(await db.query("SELECT code,name FROM hr_records WHERE kind='sites' AND id::text=$1",[String(siteId||'')])).rows[0];return [String(siteId||''),key(site?.code),key(site?.name)];};
  const siteName=async(db,siteId)=>(await db.query("SELECT name FROM hr_records WHERE kind='sites' AND id::text=$1",[String(siteId||'')])).rows[0]?.name||'';
  const audit=(actor,action,id,detail)=>pool.query("INSERT INTO hr_audit(actor,action,kind,record_id,detail) VALUES($1,$2,'vtcRequests',$3,$4)",[actor,action,id,detail]);

  /* The employee chosen on the form: an Employee Master register line ("reg:<id>") or an HR-joined employee (<id>), who works
     at the chosen site, has not left and is a driver or operator. ID, name, department and designation come from that line. */
  async function employee(db,picked,siteId){
    picked=String(picked||'');
    const args=await siteArgs(db,siteId);
    let found;
    if(picked.startsWith('reg:')&&uuid(picked.slice(4))){
      const r=(await db.query(`SELECT r.id,r.name,r.data->>'employeeId' AS code,r.data->>'designation' AS designation,r.data->>'department' AS department,r.data->>'status' AS status FROM hr_employee_master_register r WHERE r.id=$4 AND ${REGISTER_AT_SITE}`,[...args,picked.slice(4)])).rows[0];
      if(r)found={registerId:r.id,employeeId:'reg:'+r.id,...r};
    }else if(uuid(picked)){
      const e=(await db.query(`SELECT e.id,e.code,e.name,e.data FROM hr_records e WHERE e.id=$4 AND e.kind='employees' AND e.status IN ('ACTIVE','APPROVED') AND ${JOINED_AT_SITE}`,[...args,picked])).rows[0];
      if(e){const d=e.data||{},f=d.officeData||d.fields||{};found={registerId:'',employeeId:e.id,code:e.code,name:e.name,designation:d.designationTitle||f['Designation *']||f['Designation']||d.designation||'',department:f['Department']||d.department||'',status:d.employmentStatus||f.Status||''};}
    }else fail('Employee: choose the driver or operator from the list');
    if(!found)fail('This employee is not in Employee Master at the chosen site',404);
    if(!clean(found.code))fail('This employee has no Caliber ID in Employee Master');
    if(leftStatus.test(String(found.status||'')))fail(clean(found.name)+' has left. VTC is for working drivers and operators.',409);
    if(!isVtcTrade(found.designation))fail(`VTC is for drivers and operators; ${clean(found.name)} is ${clean(found.designation)||'without a designation'} in Employee Master.`,409);
    return found;
  }

  return {
    /* Before validation on save: who the request is for (never typed) and its running number VTC0001/<from date>/<Caliber ID>. */
    async prepareVtc(db,input,existing){
      const e=await employee(db,input.employeeId,input.siteId);
      const next={...input,employeeId:e.employeeId,registerId:e.registerId,empCode:clean(e.code),name:clean(e.name),department:clean(e.department),designation:clean(e.designation)};
      return {...next,code:await nextRequestCode(db,'vtcRequests',existing?.code,next)};
    },
    /* Pulse-II's check of the request (site, Employee Master, clash with another VTC / OD, fields). Throws its own words. */
    async checkVtc(grant,record){
      const answer=await mis.check(grant,vtcBody(record,await siteName(pool,record.data.siteId)));
      // Pulse-II's own refusal keeps its status (403 site, 404 not in Employee Master, 409 clash, 400 field); anything else is 503.
      const refused=answer.status>=400&&answer.status<500&&(answer.result?.error||answer.status===401);
      if(!answer.ok)fail('Pulse-II: '+misMessage(answer,'Pulse-II refused this VTC request.'),refused?answer.status:503);
    },
    /* After the final approval: send the course to Pulse-II. When it is refused or not answered the request stays APPROVED and
       is marked "not yet in Pulse-II" with the reason, for Retry. Idempotent at Pulse-II per request code. */
    async pushVtc(grant,id,actor){
      const row=(await pool.query("SELECT * FROM hr_records WHERE id=$1 AND kind='vtcRequests'",[id])).rows[0];
      if(!row||row.status!=='APPROVED')return {state:'skipped'};
      const answer=await mis.put(grant,vtcBody(row,await siteName(pool,row.data.siteId)));
      const at=new Date().toISOString(),old=row.data.pulse||{};
      const pulse=answer.ok?{state:'sent',at,id:answer.result?.id??null}:{state:'failed',at,error:misMessage(answer),tries:(Number(old.tries)||0)+1};
      await pool.query("UPDATE hr_records SET data=jsonb_set(data,'{pulse}',$2::jsonb),updated_at=now() WHERE id=$1 AND kind='vtcRequests' AND status='APPROVED'",[id,JSON.stringify(pulse)]);
      await audit(actor||'system',answer.ok?'VTC_TO_PULSE_II':'VTC_TO_PULSE_II_FAILED',id,{code:row.code,...(answer.ok?{}:{error:pulse.error,status:answer.status})});
      return pulse;
    },
    /* An approved request that is cancelled is taken out of Pulse-II first; while Pulse-II has it and cannot be told, it stays. */
    async removeVtc(grant,record,reason){
      const answer=await mis.remove(grant,{request:record.code,reason});
      if(answer.ok||record.data.pulse?.state!=='sent')return;
      if(answer.status===404&&answer.result?.error)return; // Pulse-II does not hold it.
      fail('Pulse-II could not remove this VTC: '+misMessage(answer)+' The request stays approved.',503);
    },
    /* The route a request would take and the employee's details, for the form. Nothing is saved. */
    async vtcPreview(profile,params){
      if(!canRead(profile,'vtcRequests'))fail('Your Pulse HR permissions do not allow this operation',403);
      const siteId=params.get('siteId')||'',ids=await siteIds(pool,profile);
      if(!uuid(siteId)||(ids!==null&&!ids.map(String).includes(siteId)))fail('Choose a site of your login first',403);
      const e=await employee(pool,params.get('employeeId'),siteId);
      let route=null,routeNote='';
      try{route=odApprovalWorkflow(await odSiteFlow(pool,siteId),clean(e.department)).data.steps.map(s=>stepLabel(s.label));}catch(error){routeNote=error.message||'The approval route is not configured for this site yet.';}
      return {employee:{name:clean(e.name),companyId:'',siteId,department:clean(e.department),designation:clean(e.designation),code:clean(e.code)},route,routeNote,missing:[]};
    },
    async vtcApi(profile,route,method,input,params,grant){
      if(!canRead(profile,'vtcRequests'))fail('Your Pulse HR permissions do not allow this operation',403);
      const ids=await siteIds(pool,profile);
      /* The drivers and operators of a site of this login, as "Caliber ID · name – designation". */
      if(route==='options'&&method==='GET'){
        const siteId=params.get('siteId')||'';
        if(!uuid(siteId)||(ids!==null&&!ids.map(String).includes(siteId)))return {employees:[],inScope:false};
        const args=await siteArgs(pool,siteId);
        const [reg,joined]=await Promise.all([
          pool.query(`SELECT r.id,r.name,r.data->>'employeeId' AS code,r.data->>'designation' AS designation,r.data->>'status' AS status FROM hr_employee_master_register r WHERE ${REGISTER_AT_SITE} AND ${isEmployeeEntry}`,args),
          pool.query(`SELECT e.id,e.code,e.name,COALESCE(e.data->>'designationTitle',e.data->'officeData'->>'Designation *',e.data->'officeData'->>'Designation',e.data->>'designation') AS designation FROM hr_records e WHERE e.kind='employees' AND e.status IN ('ACTIVE','APPROVED') AND ${JOINED_AT_SITE}`,args)]);
        const seen=new Set(),employees=[];
        for(const [rows,prefix] of [[joined.rows,''],[reg.rows,'reg:']])for(const row of rows){
          const code=clean(row.code),name=clean(row.name),designation=clean(row.designation);
          if(!code||!name||leftStatus.test(String(row.status||''))||!isVtcTrade(designation)||seen.has(key(code)))continue;
          seen.add(key(code));employees.push({value:prefix+row.id,code,name,label:`${code} · ${name} – ${designation}`});
        }
        employees.sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true}));
        return {employees,inScope:true};
      }
      if(route==='preview'&&method==='GET')return this.vtcPreview(profile,params);
      const pending=async()=>(await pool.query("SELECT r.id,r.code,r.name,r.data,r.updated_at FROM hr_records r WHERE r.kind='vtcRequests' AND r.status='APPROVED' AND COALESCE(r.data->'pulse'->>'state','')<>'sent' AND "+scopeSql('r','$1')+" ORDER BY r.updated_at LIMIT 200",[ids])).rows;
      /* Approved requests that are not in Pulse-II yet, with the reason. */
      if(route==='pending'&&method==='GET')return {rows:(await pending()).map(r=>({id:r.id,code:r.code,name:r.name,empCode:r.data.empCode,fromDate:r.data.fromDate,toDate:r.data.toDate,error:r.data.pulse?.error||'Not sent to Pulse-II yet.',tries:Number(r.data.pulse?.tries)||0,at:r.data.pulse?.at||null}))};
      /* Retry one ({id}) or every pending request of this login's sites (at most RETRY_LIMIT at a time), with this user's grant. */
      if(route==='retry'&&method==='POST'){
        const rows=(await pending()).filter(r=>!input?.id||r.id===input.id).slice(0,RETRY_LIMIT);
        if(input?.id&&!rows.length)fail('This VTC request is already in Pulse-II, or is not approved.',409);
        const results=[];
        for(const row of rows)results.push({id:row.id,code:row.code,...await this.pushVtc(grant,row.id,profile.actor)});
        return {sent:results.filter(r=>r.state==='sent').length,failed:results.filter(r=>r.state==='failed').length,results};
      }
      fail('Not found',404);
    },
  };
}
