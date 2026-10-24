import { createServer } from 'node:http';
import { problem } from './service.mjs';
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw problem('JSON content type required',415);
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size>2_000_000)throw problem('Request is too large',413); chunks.push(chunk); }
  try { const value=JSON.parse(Buffer.concat(chunks).toString()); if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(); return value; }
  catch { throw problem('A valid JSON object is required'); }
}
export function createApi({ query, service, authenticate=async()=>null, allowedOrigin='https://hrpulse.cmll.in' }) {
  return createServer(async(req,res)=>{
    const send=(status,data)=>res.writeHead(status).end(JSON.stringify(data));
    res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Vary','Origin');
    if(req.headers.origin&&req.headers.origin!==allowedOrigin)return send(403,{error:'Origin not allowed'});
    if(req.headers.origin)res.setHeader('Access-Control-Allow-Origin',allowedOrigin);
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age','600');return res.writeHead(204).end();
    }
    const url=new URL(req.url,'http://localhost');const path=url.pathname;
    try {
      if(['/api/health','/api/ready'].includes(path)){
        if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{error:'Method not allowed'});}
        if(path==='/api/health')return send(200,{status:'ok',service:'hr-api',release:'2026-10-22-modules-v1'});
        try{await query('SELECT 1');return send(200,{status:'ready',database:'connected'});}
        catch{return send(503,{status:'unavailable',database:'unavailable'});}
      }
      const documents=path==='/api/holiday-documents';
      const deletion=path.match(/^\/api\/deletion\/([a-zA-Z]+)\/(preview|confirm)$/);
      const record=path.match(/^\/api\/records\/([a-zA-Z]+)(?:\/([a-fA-F0-9-]+))?(?:\/(submit|deactivate|cancel))?$/);
      const masterImport=path.match(/^\/api\/import\/(holidays|leaveTypes|leavePolicies|leavePeriods|leaveAllocations|leaveRequests|leaveEncashments|leaveBlocks)$/);
      const decision=path.match(/^\/api\/approvals\/([a-fA-F0-9-]+)\/decision$/);
      const simple={'/api/holiday-groups':'holidayGroups','/api/hierarchies':'hierarchies','/api/config':'config','/api/lookups':'lookups','/api/summary':'summary','/api/audit':'audit','/api/approvals':'approvals'};
      if(!documents&&!deletion&&!masterImport&&!record&&!decision&&!simple[path]&&path!=='/api/import/employees')return send(404,{error:'Not found'});
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const profile=token&&await authenticate(token);
      if(!profile)return send(401,{error:'Sign in with your Caliber Pulse account to continue'});
      if(!service)throw problem('Service unavailable',503);
      let result;
      if(documents&&['GET','POST'].includes(req.method))result=await service.holidayDocuments(profile,url.searchParams,req.method==='POST'?await body(req):undefined);
      else if(deletion&&req.method==='POST')result=deletion[2]==='preview'?await service.deletePreview(profile,deletion[1]):await service.deleteRecords(profile,deletion[1],await body(req));
      else if(path==='/api/hierarchies'&&req.method==='POST')result=await service.saveHierarchy(profile,await body(req));
      else if(simple[path]&&req.method==='GET')result=await service[simple[path]](profile);
      else if(record){
        const [,kind,id,action]=record;
        if(!id&&req.method==='GET')result=await service.list(profile,kind,url.searchParams);
        else if(!id&&req.method==='POST')result=await service.save(profile,kind,await body(req));
        else if(id&&!action&&req.method==='PUT')result=await service.save(profile,kind,await body(req),id);
        else if(action&&req.method==='POST'){const input=await body(req);result=await service[action](profile,kind,id,input.version);}
        else throw problem('Method not allowed',405);
      }else if(decision&&req.method==='POST')result=await service.decide(profile,decision[1],await body(req));
      else if(masterImport&&req.method==='POST')result=await service.importMasters(profile,masterImport[1],(await body(req)).records);
      else if(path==='/api/import/employees'&&req.method==='POST'){const input=await body(req);result=await service.importEmployees(profile,input.records,input.submitForApproval===true);}
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
