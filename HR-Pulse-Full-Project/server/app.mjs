import { createServer } from 'node:http';
import { problem } from './service.mjs';
import {sendMail} from './mail.mjs';
import {createAadhaarReader} from './aadhaar-ocr.mjs';
async function body(req,limit=2_000_000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw problem('JSON content type required',415);
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size>limit)throw problem('Request is too large',413); chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString()); if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(); return value; }
  catch { throw problem('A valid JSON object is required'); }
}
export function createApi({ query, service, authenticate=async()=>null, allowedOrigin='https://hrpulse.cmll.in', readAadhaar=createAadhaarReader(), release='2026-10-22-modules-v1' }) {
  return createServer(async(req,res)=>{
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
      if(path==='/api/telegram/trial-webhook'&&req.method==='POST')return send(200,await service.telegramWebhook(req.headers['x-telegram-bot-api-secret-token'],await body(req),'trial'));
      const attendanceRoute=path.startsWith('/api/attendance/')?path.slice('/api/attendance/'.length):null;
      // The site bridge PC is not a Pulse user; it authenticates with its own key.
      if(attendanceRoute?.startsWith('bridge/')){
        if(!service)throw problem('Service unavailable',503);
        if(!['GET','POST'].includes(req.method))throw problem('Method not allowed',405);
        return send(200,await service.attendanceBridge(req.headers['x-bridge-key'],attendanceRoute.slice('bridge/'.length),req.method,req.method==='POST'?await body(req):{}));
      }
      const telegramRoute=path.startsWith('/api/telegram/')?path.slice('/api/telegram/'.length):null;
      const assetRoute=path.startsWith('/api/asset-management/')?path.slice('/api/asset-management/'.length):null;
      const documents=path==='/api/holiday-documents';
      const employeeDocuments=path==='/api/employee-documents';
      const deletion=path.match(/^\/api\/deletion\/([a-zA-Z]+)\/(preview|confirm)$/);
      const record=path.match(/^\/api\/records\/([a-zA-Z]+)(?:\/([a-fA-F0-9-]+))?(?:\/(submit|deactivate|cancel))?$/);
      const masterImport=path.match(/^\/api\/import\/(assets|assetCategories|assetEmployees|assetAllocationLog|assetExitClearances|holidays|leaveTypes|leavePolicies|leavePeriods|leaveAllocations|leaveRequests|leaveEncashments|leaveBlocks)$/);
      const decision=path.match(/^\/api\/approvals\/([a-fA-F0-9-]+)\/decision$/);
      const simple={'/api/holiday-groups':'holidayGroups','/api/hierarchies':'hierarchies','/api/transfer-flows':'transferFlows','/api/config':'config','/api/lookups':'lookups','/api/summary':'summary','/api/audit':'audit','/api/approvals':'approvals'};
      if(!telegramRoute&&!attendanceRoute&&!assetRoute&&!documents&&!employeeDocuments&&!deletion&&!masterImport&&!record&&!decision&&!simple[path]&&!['/api/import/employees','/api/import/trial-employee','/api/aadhaar/scan','/api/letters/email'].includes(path))return send(404,{error:'Not found'});
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const profile=token&&await authenticate(token);
      if(!profile)return send(401,{error:'Sign in with your Caliber Pulse account to continue'});
      if(path==='/api/aadhaar/scan'){
        if(req.method!=='POST')throw problem('Method not allowed',405);
        return send(200,await readAadhaar(profile,await body(req)));
      }
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
      if(telegramRoute&&['GET','POST'].includes(req.method))result=await service.telegramApi(profile,telegramRoute,req.method,req.method==='POST'?await body(req):{});
      else if(attendanceRoute&&['GET','POST'].includes(req.method))result=await service.attendanceApi(profile,attendanceRoute,req.method,req.method==='POST'?await body(req):{},url.searchParams);
      else if(assetRoute&&['GET','POST'].includes(req.method))result=await service.assetApi(profile,assetRoute,req.method,req.method==='POST'?await body(req):{},url.searchParams);
      else if(documents&&['GET','POST'].includes(req.method))result=await service.holidayDocuments(profile,url.searchParams,req.method==='POST'?await body(req):undefined);
      else if(employeeDocuments&&['GET','POST'].includes(req.method))result=await service.employeeDocuments(profile,url.searchParams,req.method==='POST'?await body(req):undefined);
      else if(deletion&&req.method==='POST')result=deletion[2]==='preview'?await service.deletePreview(profile,deletion[1]):await service.deleteRecords(profile,deletion[1],await body(req));
      else if(path==='/api/hierarchies'&&req.method==='POST')result=await service.saveHierarchy(profile,await body(req));
      else if(path==='/api/transfer-flows'&&req.method==='POST')result=await service.saveTransferFlow(profile,await body(req));
      else if(simple[path]&&req.method==='GET')result=await service[simple[path]](profile);
      else if(record){
        const [,kind,id,action]=record;
        if(!id&&req.method==='GET')result=await service.list(profile,kind,url.searchParams);
        else if(!id&&req.method==='POST')result=await service.save(profile,kind,await body(req));
        else if(id&&!action&&req.method==='PUT')result=await service.save(profile,kind,await body(req),id);
        else if(id&&!action&&kind==='employees'&&req.method==='PATCH')result=await service.updateEmployeeDetails(profile,id,await body(req));
        else if(action&&req.method==='POST'){const input=await body(req);result=await service[action](profile,kind,id,input.version);}
        else throw problem('Method not allowed',405);
      }else if(decision&&req.method==='POST')result=await service.decide(profile,decision[1],await body(req));
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
