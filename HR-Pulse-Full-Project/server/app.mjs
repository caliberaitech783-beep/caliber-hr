import { createServer } from 'node:http';
import { problem } from './service.mjs';
import {sendMail} from './mail.mjs';
import {createAadhaarReader} from './aadhaar-ocr.mjs';
import {workflowChatIds} from './telegram.mjs';
const MACHINE_BODY_LIMIT=2_000_000; // biometric machine uploads (attendance-direct.mjs)
async function body(req,limit=2_000_000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw problem('JSON content type required',415);
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size>limit)throw problem('Request is too large',413); chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString()); if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(); return value; }
  catch { throw problem('A valid JSON object is required'); }
}
export function createApi({ query, service, authenticate=async()=>null, allowedOrigin='https://hrpulse.cmll.in', readAadhaar=createAadhaarReader(), release='2026-10-22-modules-v1', behindAzure=Boolean(process.env.WEBSITE_SITE_NAME) }) {
  return createServer(async(req,res)=>{
    // Biometric machines pushing straight to HR Pulse (attendance-direct.mjs): plain text, no sign-in, and plain
    // HTTP allowed because many machines cannot do HTTPS. Everything else must arrive over HTTPS.
    if(/^\/iclock\//.test(req.url||'')){
      const reply=(status,text)=>res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end(text);
      try{
        const url=new URL(req.url,'http://localhost');
        if(!service?.attendanceMachine)return reply(503,'Unavailable');
        let size=0;const chunks=[];
        if(req.method==='POST')for await(const chunk of req){size+=chunk.length;if(size>MACHINE_BODY_LIMIT)return reply(413,'Too large');chunks.push(chunk);}
        const out=await service.attendanceMachine(req.method,url.pathname,url.searchParams,Buffer.concat(chunks).toString('utf8'));
        return reply(200,out.text);
      }catch(error){console.error('biometric machine request failed',error?.message);return reply(500,'ERROR');}
    }
    // Azure App Service overwrites X-Forwarded-Proto with "https" on every HTTPS call but sends plain-HTTP calls
    // with no such header (seen 22 Nov 2026 once "HTTPS Only" was turned off for the machines). So behind Azure
    // anything not marked https is plain HTTP, except Azure's own health probe, which comes from inside.
    const proto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();
    const healthProbe=!proto&&req.method==='GET'&&(req.url||'').split('?')[0]==='/api/health';
    if(proto==='http'||(behindAzure&&proto!=='https'&&!healthProbe)){
      const host=String(req.headers.host||'').replace(/[^A-Za-z0-9.:-]/g,'');
      return res.writeHead(301,{Location:`https://${host}${req.url}`}).end();
    }
    const send=(status,data)=>res.writeHead(status).end(JSON.stringify(data));
    res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Vary','Origin');
    if(req.headers.origin&&req.headers.origin!==allowedOrigin)return send(403,{error:'Origin not allowed'});
    if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age','600');return res.writeHead(204).end();
    }
    const url=new URL(req.url,'http://localhost');const path=url.pathname;
    try {
      if(['/api/health','/api/ready'].includes(path)){
        if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'Method not allowed'});}
        if(path==='/api/health')return send(200,{status:'ok',service:'hr-api',release});
        try{await query('SELECT 1');return send(200,{status:'ready',database:'connected'});}
        catch{return send(503,{status:'unavailable',database:'unavailable'});}
      }
      if(path==='/api/telegram/webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req)));
      if(path==='/api/telegram/joining-webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),'joining'));
      if(path==='/api/telegram/nagpur-webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),'nagpur'));
      if(path==='/api/telegram/trial-webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),'trial'));
      if(path==='/api/telegram/mt-webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),'mt'));
      if(req.method==='POST'){
        const workflowBot=workflowChatIds.find(bot=>path===`/api/telegram/${bot}-webhook`);
        if(workflowBot)return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),workflowBot));
      }
      const attendanceRoute=path.startsWith('/api/attendance/')?path.slice('/api/attendance/'.length):null;
      // The site bridge PC is not a Pulse user; it authenticates with its own key.
      if(attendanceRoute?.startsWith('bridge/')){
        if(!service)throw problem('Service unavailable',503);
        if(!['GET','POST'].includes(req.method))throw problem('Method not allowed',405);
        return send(200,await service.attendanceBridge(req.headers['x-bridge-key'],attendanceRoute.slice('bridge/'.length),req.method,req.method==='POST'?await body(req):{}));
      }
      // A site move made in Pulse-II with an OTP on a card corrects the Employee Master here (mis-site-move.mjs): Pulse-II's own key.
      if(path==='/api/integrations/mis/site-move'){
        if(!service?.misSiteMove)throw problem('Service unavailable',503);
        if(req.method!=='POST'){res.setHeader('Allow','POST');throw problem('Method not allowed',405);}
        return send(200,await service.misSiteMove(req.headers['x-mis-sync-key'],await body(req,16_000)));
      }
      // Pulse-II reading the site machines' punches for its Attendance Sheet Mismatch (mis-biometric-punches.mjs): its own key, read only.
      if(path==='/api/integrations/mis/biometric-punches'){
        if(!service?.misBiometricPunches)throw problem('Service unavailable',503);
        if(req.method!=='GET'){res.setHeader('Allow','GET');throw problem('Method not allowed',405);}
        return send(200,await service.misBiometricPunches(req.headers['x-mis-sync-key'],{from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
      }
      // Pulse-II copying the Employee Master, what changed in it, and the approved transfers (mis-employee-sync.mjs): its own key, read only.
      const misSync=path.match(/^\/api\/integrations\/mis\/(employees|employee-changes|transfers)$/);
      if(misSync){
        if(!service?.misEmployeeSync)throw problem('Service unavailable',503);
        if(req.method!=='GET'){res.setHeader('Allow','GET');throw problem('Method not allowed',405);}
        return send(200,await service.misEmployeeSync(req.headers['x-mis-sync-key'],misSync[1],{after:url.searchParams.get('after')}));
      }
      const telegramRoute=path.startsWith('/api/telegram/')?path.slice('/api/telegram/'.length):null;
      const assetRoute=path.startsWith('/api/asset-management/')?path.slice('/api/asset-management/'.length):null;
      const documents=path==='/api/holiday-documents';
      const employeeDocuments=path==='/api/employee-documents';
      const employeeMasterRegister=path.match(/^\/api\/employee-master-register(?:\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?$/i);
      const employeeBankDetails=path==='/api/employee-master-bank-details';
      const employeeBankDetailsDeleteAll=path==='/api/employee-master-bank-details/delete-all';
      // Remove a line of Employee Master (a POST: the browser is not allowed to send DELETE to this API).
      const registerRemove=path.match(/^\/api\/employee-master-register\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/remove$/i);
      const deletion=path.match(/^\/api\/deletion\/([a-zA-Z]+)\/(preview|confirm)$/);
      const record=path.match(/^\/api\/records\/([a-zA-Z]+)(?:\/([a-fA-F0-9-]+))?(?:\/(submit|deactivate|cancel))?$/);
      const masterImport=path.match(/^\/api\/import\/(assets|assetCategories|assetEmployees|assetAllocationLog|assetExitClearances|holidays|leaveTypes|leavePolicies|leavePeriods|leaveAllocations|leaveRequests|leaveEncashments|leaveBlocks)$/);
      const decision=path.match(/^\/api\/approvals\/([a-fA-F0-9-]+)\/decision$/);
      const completedEmployeeDelete=path.match(/^\/api\/approvals\/completed-employees\/([a-fA-F0-9-]+)\/permanent-delete$/);
      const leaveOtp=path.match(/^\/api\/approvals\/([a-fA-F0-9-]+)\/(otp|otp-verify)$/);
      const simple={'/api/holiday-groups':'holidayGroups','/api/hierarchies':'hierarchies','/api/transfer-flows':'transferFlows','/api/config':'config','/api/lookups':'lookups','/api/summary':'summary','/api/audit':'audit','/api/approvals':'approvals','/api/approvals/employees':'employeeApprovals','/api/approvals/completed-employees':'completedEmployees','/api/reporting-managers':'reportingManagers','/api/request-preview':'requestPreview','/api/transfer-options':'transferOptions'};
      if(path!=='/api/payroll'&&!telegramRoute&&!attendanceRoute&&!assetRoute&&!documents&&!employeeDocuments&&!employeeMasterRegister&&!employeeBankDetails&&!employeeBankDetailsDeleteAll&&!registerRemove&&!deletion&&!masterImport&&!record&&!decision&&!completedEmployeeDelete&&!leaveOtp&&!simple[path]&&!['/api/import/employees','/api/import/trial-employee','/api/aadhaar/scan','/api/letters/email','/api/employee-code/next'].includes(path))return send(404,{error:'Not found'});
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const profile=token&&await authenticate(token);
      if(!profile)return send(401,{error:'Sign in with your Caliber Pulse account to continue'});
      if(path==='/api/aadhaar/scan'){
        if(req.method!=='POST')throw problem('Method not allowed',405);
        return send(200,await readAadhaar(profile,await body(req)));
      }
      if(path==='/api/employee-code/next'){if(req.method!=='POST')throw problem('Method not allowed',405);return send(200,await service.nextEmployeeCode(profile,await body(req)));}
      if(path==='/api/letters/email'){
        if(req.method!=='POST')throw problem('Method not allowed',405);
        const letter=await body(req,12_000_000),to=String(letter.to||'').trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw problem('A valid candidate e-mail is required');
        if(typeof letter.pdfBase64!=='string'||!letter.pdfBase64||!/^[A-Za-z0-9+/=\r\n]+$/.test(letter.pdfBase64))throw problem('Letter PDF is required');
        const name=String(letter.fileName||'letter.pdf').replace(/[^A-Za-z0-9._-]/g,'_');
        await sendMail({to,subject:String(letter.subject||'Letter from Caliber Mining And Logistics Ltd').slice(0,200),text:String(letter.text||'').slice(0,5000),attachment:{name,type:'application/pdf',base64:letter.pdfBase64}});
        return send(200,{ok:true,to});
      }
      if(!service)throw problem('Service unavailable',503);
      let result;
      if(path==='/api/payroll'&&['GET','POST'].includes(req.method))result=await service.payroll(profile,req.method,url.searchParams,req.method==='POST'?await body(req):{});
      else if(telegramRoute&&['GET','POST'].includes(req.method))result=await service.telegramApi(profile,telegramRoute,req.method,req.method==='POST'?await body(req,12_000_000):{});
      else if(attendanceRoute&&['GET','POST'].includes(req.method))result=await service.attendanceApi(profile,attendanceRoute,req.method,req.method==='POST'?await body(req):{},url.searchParams,token);
      else if(assetRoute&&['GET','POST'].includes(req.method))result=await service.assetApi(profile,assetRoute,req.method,req.method==='POST'?await body(req):{},url.searchParams);
      else if(documents&&['GET','POST'].includes(req.method))result=await service.holidayDocuments(profile,url.searchParams,req.method==='POST'?await body(req):undefined);
      else if(employeeDocuments&&['GET','POST'].includes(req.method))result=await service.employeeDocuments(profile,url.searchParams,req.method==='POST'?await body(req):undefined);
      else if(employeeMasterRegister&&req.method==='GET')result=employeeMasterRegister[1]
        ?await service.employeeMasterRegisterDetails(profile,employeeMasterRegister[1],url.searchParams.get('edit')==='1')
        :await service.employeeMasterRegister(profile,url.searchParams);
      else if(employeeMasterRegister?.[1]&&req.method==='PATCH')result=await service.updateEmployeeMasterRegister(profile,employeeMasterRegister[1],await body(req,64_000));
      else if(employeeMasterRegister&&!employeeMasterRegister[1]&&req.method==='POST')result=await service.importEmployeeMasterRegister(profile,(await body(req,36_000_000)).rows);
      else if(employeeBankDetails&&req.method==='POST')result=await service.importEmployeeBankDetails(profile,(await body(req,12_000_000)).rows);
      else if(employeeBankDetailsDeleteAll&&req.method==='POST')result=await service.deleteAllEmployeeMasterBankDetails(profile,await body(req,8_000));
      else if(registerRemove&&req.method==='POST')result=await service.removeEmployeeMasterRegister(profile,registerRemove[1],await body(req,8_000));
      else if(deletion&&req.method==='POST')result=deletion[2]==='preview'?await service.deletePreview(profile,deletion[1]):await service.deleteRecords(profile,deletion[1],await body(req));
      else if(path==='/api/hierarchies'&&req.method==='POST')result=await service.saveHierarchy(profile,await body(req));
      else if(path==='/api/transfer-flows'&&req.method==='POST')result=await service.saveTransferFlow(profile,await body(req));
      else if(path==='/api/request-preview'&&req.method==='GET')result=await service.requestPreview(profile,url.searchParams);
      else if(path==='/api/transfer-options'&&req.method==='GET')result=await service.transferOptions(profile,url.searchParams);
      else if(path==='/api/reporting-managers'&&req.method==='GET')result=await service.reportingManagers(profile,url.searchParams);
      else if(simple[path]&&req.method==='GET')result=await service[simple[path]](profile);
      else if(record){
        const [,kind,id,action]=record;
        if(!id&&req.method==='GET')result=await service.list(profile,kind,url.searchParams);
        else if(!id&&req.method==='POST')result=await service.save(profile,kind,await body(req));
        else if(id&&!action&&req.method==='PUT')result=await service.save(profile,kind,await body(req),id);
        else if(id&&!action&&kind==='employees'&&req.method==='PATCH')result=await service.updateEmployeeDetails(profile,id,await body(req));
        else if(action&&req.method==='POST'){const input=await body(req);result=await service[action](profile,kind,id,input.version);}
        else throw problem('Method not allowed',405);
      }else if(completedEmployeeDelete&&req.method==='POST')result=await service.permanentDeleteCompletedEmployee(profile,completedEmployeeDelete[1]);
      else if(decision&&req.method==='POST')result=await service.decide(profile,decision[1],await body(req));
      else if(leaveOtp&&req.method==='POST')result=await service.leaveOtp(profile,leaveOtp[1],await body(req),leaveOtp[2]==='otp-verify');
      else if(masterImport&&req.method==='POST')result=await service.importMasters(profile,masterImport[1],(await body(req)).records);
      else if(path==='/api/import/employees'&&req.method==='POST'){const input=await body(req);result=await service.importEmployees(profile,input.records,input.submitForApproval===true);}
      else if(path==='/api/import/trial-employee'&&req.method==='POST'){const input=await body(req);result=await service.saveTrialEmployee(profile,input);}
      else throw problem('Method not allowed',405);
      return send(200,result);
    }catch(error){
      if(error.code==='23505')return send(409,{error:'This code already exists. Use a unique code.'});
      if(error.code==='22P02')return send(400,{error:'Invalid value'});
      const status=Number.isInteger(error.status)?error.status:500;
      return send(status,{error:status===500?'Unable to complete the request. Try again.':error.message});
    }
  });
}
