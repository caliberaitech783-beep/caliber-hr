import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createService} from './service.mjs';

/* Owner, 21 Nov 2026: Submit Employee (Document Checklist) sends the new employee into the approval route and never
   stops as a silent draft. OB / COAL sites (owner, 21 Nov 2026, evening): Site HR → Site PM → Office HR → Regional HR
   → Directors; Site PM and Office HR come from the site hierarchy, and a clear message asks for them when not set.
   The two offices keep office HR → office HR Manager → Directors without a saved hierarchy. */
const companyId='00000000-0000-4000-8000-000000000001',siteId='00000000-0000-4000-8000-000000000002';
const profile={actor:'sitehr',name:'Site HR',permissions:{application:'HR',hrDesktopAccess:['Employee Master','Approval Management']}};
const officeData={
 'Joining Category *':'NCL','Employee Code':'EMP-9','Full Name as per Aadhar':'Sample Joiner','Full Name *':'Sample Joiner',
 'Father / Spouse Name *':'Sample Parent','Mobile *':'9876543210','Aadhaar No. *':'234500000009',
 'Marital Status':'Single','Identification mark':'Mole on left hand','PAN No.':'ABCDE1234F','Present Address':'Sample Address','Reference Type':'Supervisor','Reference Name':'Sample Referrer',
 'Emergency Contact Name':'Sample Contact','Emergency Contact Number':'9876543211','Department *':'Operations','Sub-department *':'Mining',
 'Designation *':'Supervisor','Employee Category':'Staff','Reporting To':'Site Manager','Joining Date *':'2026-11-21','Shift *':'General','Working Hours *':'9 hours',
 'Employment Type':'Permanent','Salary Type':'Monthly','Site / Project':'Jayant OB East','PT State':'Madhya Pradesh','Skill Category':'Skilled',
 'A-Form No.':'A-9','Mess Plan':'NO','Candidate photo':'photo.jpg','Aadhaar (masked display)':'aadhaar.pdf',
};
const employee={code:'EMP-9',name:'Sample Joiner',joiningDate:'2026-11-21',category:'Permanent',companyId,siteId,__officeData:officeData};

const obSteps=[{label:'HR Manager',approvers:['sitehr']},{label:'Project Manager',approvers:['site.pm']},{label:'Office HR — either one',approvers:['office.hr']}];
function fixture({siteCode,hierarchyActive=false,steps=obSteps}){
 const approvals=[];let saved;
 const db={release(){},async query(sql,params=[]){
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO hr_records')&&params[1]==='employees'){saved={id:params[0],kind:'employees',code:params[2],name:params[3],data:params[4],status:params[5],version:1};return {rows:[saved],rowCount:1};}
  if(saved&&sql.startsWith('SELECT * FROM hr_records WHERE id=$1')&&params[0]===saved.id)return {rows:[saved],rowCount:1};
  if(sql.startsWith('SELECT * FROM hr_records WHERE id=$1 AND kind=$2'))return {rows:[{id:params[0],kind:params[1],code:params[1]==='sites'?siteCode:'C1',name:'Ref',status:'ACTIVE',data:{}}],rowCount:1};
  if(sql.startsWith('INSERT INTO hr_approvals')){approvals.push({sql,params});return {rows:[{id:params[0]}],rowCount:1};}
  if(sql.includes("kind='joiningHierarchies'"))return hierarchyActive?{rows:[{id:'h1',code:siteCode,status:'ACTIVE',data:{code:siteCode,steps}}],rowCount:1}:{rows:[],rowCount:0};
  if(sql.includes("kind='sites'")&&(sql.includes('code')||sql.startsWith('SELECT name')))return {rows:[{code:siteCode,name:'Jayant OB',id:siteId}],rowCount:1};
  if(saved&&/FROM hr_records WHERE id=\$1/.test(sql)&&params[0]===saved.id)return {rows:[saved],rowCount:1};
  if(sql.startsWith('UPDATE hr_records')&&saved){if(/status=/.test(sql))saved={...saved,status:'PENDING',version:saved.version+1};return {rows:[saved],rowCount:1};}
  return {rows:[],rowCount:0};
 }};
 return {service:createService({connect:async()=>db},{telegram:{async send(){}}}),approvals};
}

const routeOf=approval=>JSON.parse(approval.params.find(p=>typeof p==='string'&&p.startsWith('[{'))||'[]').map(step=>step.approvers.join(','));

test('OB / COAL site: Submit Employee goes Site PM → Office HR → Regional HR → Directors',async()=>{
 for(const [siteCode,regional] of [['NCL-JAYANT','vinodpinjarkar'],['WCL-MAJRI','viratsingh']]){
  const {service,approvals}=fixture({siteCode,hierarchyActive:true});
  assert.deepEqual(await service.importEmployees(profile,[employee],true),{imported:1,submitted:1,status:'PENDING'},siteCode);
  assert.equal(approvals.length,1,'one approval request is created');
  assert.deepEqual(routeOf(approvals[0]),['site.pm','office.hr',regional,'mohitchadda,manishchadda,rahulchadda'],siteCode);
 }
});

test('OB / COAL site without Site PM or Office HR: a clear message, never a silent draft',async()=>{
 const {service,approvals}=fixture({siteCode:'WCL-MAJRI'});
 await assert.rejects(service.importEmployees(profile,[employee],true),e=>e.status===409&&/Set the Site PM \(Project Manager\) and Office HR for Jayant OB in Approval Master › Hierarchy/.test(e.message));
 const partial=fixture({siteCode:'NCL-JAYANT',hierarchyActive:true,steps:obSteps.slice(0,2)});
 await assert.rejects(partial.service.importEmployees(profile,[employee],true),/Set the Office HR for/);
 assert.equal(approvals.length+partial.approvals.length,0);
});

test('the offices (started by their office HR) still go into approval without a saved hierarchy',async()=>{
 for(const [siteCode,regional,actor] of [['CMLL-HO','viratsingh','monikawadhai'],['CMLL-CO','vinodpinjarkar','mayuriumate']]){
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
