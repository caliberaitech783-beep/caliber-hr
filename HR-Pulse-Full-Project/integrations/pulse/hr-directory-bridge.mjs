export async function loadHrDirectory({pool,profile,user,masterNames,buildDirectory,mergeSuperiors,viewerContext,forViewer}){
 const access=new Set([...(profile.permissions?.hrDesktopAccess||[]),...(profile.permissions?.hrMobileAccess||[])]);
 if(!['Employee Master','Employee Directory','Reports & MIS'].some(menu=>access.has(menu)))throw Object.assign(new Error('Employee report access is not assigned.'),{status:403});
 const {rows:records}=await pool.query('SELECT id,master_name,record_data FROM master_records WHERE master_name=ANY($1::text[]) ORDER BY created_at ASC,id ASC',[masterNames]);
 const masters=Object.fromEntries(masterNames.map(name=>[name,[]]));
 for(const row of records)masters[row.master_name]?.push({...row.record_data,id:row.id});
 const {rows:users}=await pool.query("SELECT record_data FROM master_records WHERE master_name='Users & employees' ORDER BY created_at ASC");
 const directory=mergeSuperiors(buildDirectory(masters,{generated:new Date().toISOString()}),users.map(row=>row.record_data||{}));
 const viewer=viewerContext({session:{...profile,role:/super/i.test(user.userType||'')?'super':profile.role,permissions:{...profile.permissions,adminLevel:user.adminLevel}},user,sites:directory.sites||[]});
 const visible=forViewer(directory,viewer);
 const sites=(visible.sites||[]).map(site=>({id:site.id,label:site.label,region:site.group||'OTHER'}));
 const byId=new Map(sites.map(site=>[site.id,site]));
 const rows=[];
 for(const [key,people] of Object.entries(visible.matrix||{})){
  const split=key.lastIndexOf('|'),siteId=key.slice(0,split),site=byId.get(siteId);
  if(!site)continue;
  for(const person of people||[]){
   if(!String(person.name||'').trim()||String(person.status||'').toUpperCase()==='VACANT')continue;
   rows.push({employeeId:String(person.empId||''),name:String(person.name||''),category:String(person.cat||key.slice(split+1)),designation:String(person.designation||''),department:String(person.department||''),reportingTo:String(person.reportingTo||''),contact:String(person.contact||''),email:String(person.email||''),status:String(person.status||'ACTIVE'),siteId,site:site.label,region:site.region});
  }
 }
 return {source:'Caliber Pulse C-Directory',fetchedAt:new Date().toISOString(),sites,rows};
}
