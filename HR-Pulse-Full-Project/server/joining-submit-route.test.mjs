import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

/* Owner, 21 Nov 2026: Submit Employee (Document Checklist) sends the new employee into the approval route
   (Site HR → Regional HR → Directors) even when the site has no saved Approval Master hierarchy, because the
   region route is fixed. It must never stop as a silent draft. */
const companyId='00000000-0000-4000-8000-000000000001',siteId='00000000-0000-4000-8000-000000000002';
const profile={actor:'sitehr',name:'Site HR',permissions:{application:'HR',hrDesktopAccess:['Employee Master','Approval Management']}};
const officeData={
 'Joining Category *':'NCL','Employee Code':'EMP-9','Full Name as per Aadhar':'Sample Joiner','Full Name *':'Sample Joiner',
 'Father / Spouse Name *':'Sample Parent','Mobile *':'9876543210','Aadhaar No. *':'234500000009',
 'Marital Status':'Single','Identification mark':'Mole on left hand','PAN No.':'ABCDE1234F','Present Address':'Sample Address','Reference Type':'Supervisor','Reference Name':'Sample Referrer',
 'Emergency Contact Name':'Sample Contact','Emergency Contact Number':'9876543211','Department *':'Operations','Sub-department *':'Mining',
 'Designation *':'Supervisor','Employee Category':'Staff','Reporting To':'Site Manager','Joining Date *':'2026-11-21','Shift *':'General',
 'Employment Type':'Permanent','Salary Type':'Monthly','Site / Project':'Jayant OB East','PT State':'Madhya Pradesh','Skill Category':'Skilled',
 'A-Form No.':'A-9','Mess Plan':'NO','Candidate photo':'photo.jpg','Aadhaar (masked display)':'aadhaar.pdf',
};
const employee={code:'EMP-9',name:'Sample Joiner',joiningDate:'2026-11-21',category:'Permanent',companyId,siteId,__officeData:officeData};

function fixture({siteCode,hierarchyActive=false}){
 const approvals=[];let saved;
 const db={release(){},async query(sql,params=[]){
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO hr_records')&&params[1]==='employees'){saved={id:params[0],kind:'employees',code:params[2],name:params[3],data:params[4],status:params[5],version:1};return {rows:[saved],rowCount:1};}
  if(saved&&sql.startsWith('SELECT * FROM hr_records WHERE id=$1')&&params[0]===saved.id)return {rows:[saved],rowCount:1};
  if(sql.startsWith('SELECT * FROM hr_records WHERE id=$1 AND kind=$2'))return {rows:[{id:params[0],kind:params[1],code:params[1]==='sites'?siteCode:'C1',name:'Ref',status:'ACTIVE',data:{}}],rowCount:1};
  if(sql.startsWith('INSERT INTO hr_approvals')){approvals.push({sql,params});return {rows:[{id:params[0]}],rowCount:1};}
  if(sql.includes("kind='joiningHierarchies'"))return hierarchyActive?{rows:[{id:'h1',code:siteCode,status:'ACTIVE',data:{code:siteCode,steps:[{label:'HR Manager',approvers:['sitehr']}]}}],rowCount:1}:{rows:[],rowCount:0};
  if(sql.includes("kind='sites'")&&sql.includes('code'))return {rows:[{code:siteCode,name:'Jayant OB',id:siteId}],rowCount:1};
  if(saved&&/FROM hr_records WHERE id=\$1/.test(sql)&&params[0]===saved.id)return {rows:[saved],rowCount:1};
  if(sql.startsWith('UPDATE hr_records')&&saved){if(/status=/.test(sql))saved={...saved,status:'PENDING',version:saved.version+1};return {rows:[saved],rowCount:1};}
  return {rows:[],rowCount:0};
 }};
 return {service:createService({connect:async()=>db},{telegram:{async send(){}}}),approvals};
}

test('NCL site without a saved hierarchy: Submit Employee goes to Regional HR and the Directors',async()=>{
 const {service,approvals}=fixture({siteCode:'NCL-JAYANT'});
 const result=await service.importEmployees(profile,[employee],true);
 assert.deepEqual(result,{imported:1,submitted:1,status:'PENDING'});
 assert.equal(approvals.length,1,'one approval request is created');
 assert.match(approvals[0].params.join(' '),/vinodpinjarkar/,'NCL Regional HR is on the route');
});

test('WCL site and the offices (started by their office HR) also go into approval without a saved hierarchy',async()=>{
 for(const [siteCode,regional,actor] of [['WCL-SASTI','viratsingh','sitehr'],['CMLL-HO','viratsingh','monikawadhai'],['CMLL-CO','vinodpinjarkar','mayuriumate']]){
  const {service,approvals}=fixture({siteCode});
  assert.equal((await service.importEmployees({...profile,actor},[employee],true)).submitted,1,siteCode);
  assert.match(approvals[0].params.join(' '),new RegExp(regional),siteCode);
 }
});

test('a site outside every region still needs an enabled saved hierarchy',async()=>{
 const {service,approvals}=fixture({siteCode:'OTHER-SITE'});
 assert.deepEqual(await service.importEmployees(profile,[employee],true),{imported:1,submitted:0,status:'DRAFT'});
 assert.equal(approvals.length,0);
});
