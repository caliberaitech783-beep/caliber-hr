import {leaveModules,requestFields,policyFields,prepareLeave,validateLeave} from './leave.mjs';
const text = (key, label, required = false) => ({ key, label, type: 'text', required });
const ref = (key, label, reference, required = false) => ({ key, label, type: 'reference', reference, required });
const date = (key, label, required = false) => ({ key, label, type: 'date', required });
const select = (key, label, options, required = false) => ({ key, label, type: 'select', options, required });
const module = (title, menu, fields) => ({ title, menu, fields });
export const modules = {
  calendarEvents: module('Calendar events','Calendar',[text('code','Event reference',true),text('name','Event title',true),date('date','Date',true),select('eventType','Type',['Birthday','Work anniversary','Meeting','Event','Training','Holiday'],true),ref('siteId','Location','sites',true),text('details','Details')]),
  assetCategories: module('Category Master','Asset Management',[text('code','Tag Prefix',true),text('name','Category',true),text('group','Group'),text('extraDetails','Extra details to capture'),{key:'activeAssets',label:'Assets (active)',type:'number',min:0}]),
  assetEmployees: module('Employee Master','Asset Management',[text('code','Record reference',true),ref('employeeId','Emp Code','employees',true),text('name','Employee Name',true),text('department','Department'),text('designation','Designation'),ref('siteId','Location','sites',true),text('email','Work Email'),text('employmentStatus','Employment Status'),date('lastWorkingDay','Last Working Day'),{key:'assetsHeld',label:'Assets Held',type:'number',min:0},text('remarks','Remarks')]),
  assetAllocationLog: module('Allocation Log','Asset Management',[text('code','Log reference',true),date('date','Date',true),ref('assetId','Asset Tag','assets',true),text('name','Asset Name',true),text('action','Action',true),ref('employeeId','Emp Code','employees',true),text('employeeName','Employee Name',true),ref('fromEmployeeId','From Emp Code (transfer)','employees'),text('condition','Condition'),text('vendorMethod','Vendor / Method'),text('remarks','Remarks')]),
  assetExitClearances: module('Exit Clearance','Asset Management',[text('code','Clearance reference',true),ref('employeeId','Emp Code','employees',true),text('name','Employee Name',true),text('department','Department'),text('employmentStatus','Employment Status'),date('lastWorkingDay','Last Working Day'),{key:'assetsHeld',label:'Assets Held',type:'number',min:0},text('valueHeld','Value Held (₹)'),text('assetTagsHeld','Asset Tags Held'),text('clearance','Clearance')]),
  assets: module('Assets','Asset Management',[text('code','Asset code',true),text('name','Asset name',true),ref('siteId','Locations','sites',true),text('department','Departments'),text('vendor','Vendors'),text('condition','Conditions'),text('assetStatus','Asset Status'),text('employeeStatus','Employee Status'),text('movementAction','Movement Action'),text('assetGroup','Asset Group'),text('depreciationMethod','Dep. Method'),text('disposalMethod','Disposal Method')]),
  outDutyRequests: module('Out Duty Form','Employee Master',[text('code','OD reference',true),text('name','Employee name',true),ref('employeeId','Employee ID','employees',true),text('designation','Designation',true),text('department','Department',true),ref('siteId','Site / Location','sites',true),date('outDutyDate','From date',true),date('toDate','To date',true),text('purpose','Purpose of out duty',true),text('visitLocation','Location / Place to visit',true),text('authorityName','Authority name'),text('authoritySignature','Reporting to'),text('employeeSignature','Employee signature (typed name)'),date('signatureDate','Signature date')]),
  employeeTransfers: module('Employee transfers','Employee Master',[text('code','Transfer reference',true),text('name','Transfer title',true),ref('employeeId','Employee','employees',true),date('transferDate','Transfer date',true),ref('fromSiteId','From location','sites',true),ref('toSiteId','To location','sites',true),ref('fromCompanyId','From company','companies',true),ref('toCompanyId','To company','companies',true),text('fromDesignation','From designation',true),text('toDesignation','To designation',true),text('fromManager','From reporting manager',true),text('toManager','To reporting manager',true)]),
  companies: module('Companies', 'Master Configuration', [text('code','Company code',true),text('name','Company name',true),text('address','Registered address'),text('email','Company email')]),
  clients: module('Clients','Master Configuration',[text('code','Client code',true),text('name','Client name',true),text('contact','Contact details')]),
  regions: module('Regions','Master Configuration',[text('code','Region code',true),text('name','Region name',true),text('state','State',true)]),
  sites: module('Sites','Master Configuration',[text('code','Site code',true),text('name','Site name',true),ref('companyId','Company','companies',true),ref('clientId','Client','clients'),ref('regionId','Region','regions',true),text('state','State',true),text('district','District'),text('address','Site address'),select('siteType','Site type',['Mine','Project','Office','Plant','Warehouse','Other'],true)]),
  departments: module('Departments','Master Configuration',[text('code','Department code',true),text('name','Department name',true),ref('companyId','Company','companies',true)]),
  grades: module('Grades','Master Configuration',[text('code','Grade code',true),text('name','Grade name',true),{key:'rank',label:'Rank',type:'number',required:true,min:1}]),
  designations: module('Designations','Master Configuration',[text('code','Designation code',true),text('name','Designation name',true),ref('gradeId','Grade','grades',true),ref('departmentId','Department','departments')]),
  shifts: module('Shifts','Shift Management',[text('code','Shift code',true),text('name','Shift name',true),ref('siteId','Site','sites',true),{key:'startTime',label:'Start time',type:'time',required:true},{key:'endTime',label:'End time',type:'time',required:true},text('weeklyOff','Weekly off'),text('shiftCode','Display code'),{key:'graceMinutes',label:'Grace (minutes)',type:'number',min:0},{key:'halfDayHours',label:'Half day below (hours)',type:'number',min:0},{key:'fullDayHours',label:'Full day (hours)',type:'number',min:0.25},{key:'overtimeAfterHours',label:'OT after (hours)',type:'number',min:0},select('nightShift','Night shift',['No','Yes'])]),
  holidays: module('Holidays','Holiday & Leave',[text('code','Holiday code',true),text('name','Holiday name',true),date('date','Date',true),text('siteId','Site ID (CSV value; blank = all sites)')]),
  leavePolicies: module('Leave policies','Holiday & Leave',[text('code','Policy code',true),text('name','Leave type',true),{key:'annualDays',label:'Annual entitlement (days)',type:'number',required:true,min:0},ref('companyId','Company','companies',true)]),
  employees: module('Employees','Employee Master',[text('code','Employee number',true),text('name','Full name',true),text('email','Work email'),text('mobile','Mobile'),date('dateOfBirth','Date of birth'),date('joiningDate','Joining date',true),select('category','Employment category',['Permanent','Contract','Trainee','Consultant'],true),ref('companyId','Company','companies',true),ref('siteId','Site','sites'),ref('departmentId','Department','departments'),ref('designationId','Designation','designations'),ref('gradeId','Grade','grades'),ref('shiftId','Shift','shifts'),ref('managerId','Reporting manager','employees')]),
  leaveRequests: module('Leave requests','Holiday & Leave',[text('code','Request number',true),text('name','Reason',true),ref('employeeId','Employee','employees',true),ref('policyId','Leave policy','leavePolicies',true),date('fromDate','From date',true),date('toDate','To date',true)]),
  workflows: module('Onboarding workflows','Master Configuration',[text('code','Workflow code',true),text('name','Workflow name',true),text('approvers','Approver Pulse usernames, in order (comma separated)',true)]),
  approvalRules: module('Approval matrix','Master Configuration',[text('code','Rule code',true),text('name','Rule name',true),select('target','Module',['employees','leaveRequests'],true),ref('workflowId','Workflow','workflows',true),ref('companyId','Company (blank = all)','companies'),ref('siteId','Site (blank = all)','sites')]),
};
Object.assign(modules,leaveModules);
modules.outDutyRequests.autoCode=true;
modules.leaveRequests.fields=requestFields;modules.leaveRequests.autoCode=true;
modules.leavePolicies.fields=policyFields;
modules.holidays.fields.push(select('holidayType','Holiday type',['Public','Company','Optional','National','Government','Festival','Declared','Gazetted','Gazetted (General)','Paid (PH)']));
modules.approvalRules.fields.find(f=>f.key==='target').options.push('leaveEncashments');
export const menus = ['Calendar','Asset Management','Dashboard','Employee Master','Master Configuration','Employee Onboarding','Employee Directory','Approval Management','Shift Management','Holiday & Leave','Reports & MIS','Administration','Audit Logs'];
export function grantedMenus(profile) { return new Set([...(profile.permissions?.hrDesktopAccess || []),...(profile.permissions?.hrMobileAccess || [])].filter(x => menus.includes(x))); }
export function canRead(profile, kind) {
  const granted = grantedMenus(profile);
  if(kind==='calendarEvents')return ['Calendar','Employee Master','Master Configuration'].some(menu=>granted.has(menu));
  if(['assets','assetCategories','assetEmployees','assetAllocationLog','assetExitClearances'].includes(kind))return ['Asset Management','Employee Master','Master Configuration'].some(menu=>granted.has(menu));
  if (kind === 'employees') return ['Employee Master','Employee Onboarding','Employee Directory','Reports & MIS'].some(x=>granted.has(x));
  if (['workflows','approvalRules'].includes(kind) && granted.has('Administration')) return true;
  return modules[kind] && (granted.has(modules[kind].menu) || granted.has('Master Configuration'));
}
export function canWrite(profile, kind) {
  const granted = grantedMenus(profile);
  if(kind==='calendarEvents')return ['Calendar','Employee Master','Master Configuration'].some(menu=>granted.has(menu));
  if(['assets','assetCategories','assetEmployees','assetAllocationLog','assetExitClearances'].includes(kind))return ['Asset Management','Employee Master','Master Configuration'].some(menu=>granted.has(menu));
  if (kind === 'employees') return granted.has('Employee Master') || granted.has('Employee Onboarding');
  if (['workflows','approvalRules'].includes(kind) && granted.has('Administration')) return true;
  return modules[kind] && (granted.has(modules[kind].menu) || granted.has('Master Configuration'));
}
export function validate(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('A record object is required'),{status:400});
  input=prepareLeave(kind,input);
  const data = {};
  for (const field of modules[kind].fields) {
    const raw = input[field.key];
    if(field.type==='audio'){
      if(!raw){data[field.key]='';continue;}
      if(typeof raw!=='string'||!/^data:audio\/(mpeg|mp3|mp4|wav|x-wav|webm|ogg)(;codecs=[a-z0-9-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length>690000)throw Object.assign(new Error('Use an MP3, M4A, WAV, WebM or OGG audio file up to 500 KB'),{status:400});
      data[field.key]=raw;continue;
    }
    if(field.type==='attachment'){
      if(!raw){data[field.key]='';continue;}
      if(typeof raw!=='string'||!/^data:(application\/pdf|image\/png|image\/jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)||raw.length>690000)throw Object.assign(new Error('Use a PDF, PNG or JPEG attachment up to 500 KB'),{status:400});
      data[field.key]=raw;continue;
    }
    const value = raw == null ? '' : String(raw).trim();
    if (field.required && !value) throw Object.assign(new Error(`${field.label} is required`),{status:400});
    if (!value) { data[field.key] = ''; continue; }
    if (value.length > (field.key === 'address' || field.key === 'approvers' ? 2000 : 300)) throw Object.assign(new Error(`${field.label} is too long`),{status:400});
    if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) throw Object.assign(new Error(`${field.label} must be a valid date`),{status:400});
    if (field.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Object.assign(new Error(`${field.label} must be a valid time`),{status:400});
    if (field.type === 'number' && (!Number.isFinite(Number(value)) || Number(value)<field.min || Number(value)>100000)) throw Object.assign(new Error(`${field.label} is invalid`),{status:400});
    if (field.type === 'select' && !field.options.includes(value)) throw Object.assign(new Error(`${field.label} is invalid`),{status:400});
    if (field.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw Object.assign(new Error('Email is invalid'),{status:400});
    data[field.key] = field.type === 'number' ? Number(value) : value;
  }
  if (kind==='outDutyRequests' && data.outDutyDate > data.toDate) throw Object.assign(new Error('To date must be on or after from date'),{status:400});
  if (data.fromDate && data.toDate && data.fromDate > data.toDate) throw Object.assign(new Error('End date must be on or after start date'),{status:400});
  if (data.dateOfBirth && data.dateOfBirth >= new Date().toISOString().slice(0,10)) throw Object.assign(new Error('Date of birth must be in the past'),{status:400});
  if (kind === 'workflows') {
    const users = data.approvers.split(',').map(x=>x.trim().toLowerCase());
    if (users.length>10 || users.some(x=>!/^[-a-z0-9_.@]{1,100}$/.test(x)) || new Set(users).size!==users.length) throw Object.assign(new Error('Provide 1–10 distinct Pulse usernames for approval stages'),{status:400});
    data.approvers = users.join(',');
  }
  if (kind === 'shifts') {
    const fail = message => { throw Object.assign(new Error(message), {status:400}); };
    if (data.startTime === data.endTime) fail('Start and end times must differ');
    if (data.graceMinutes !== '' && (!Number.isInteger(data.graceMinutes) || data.graceMinutes > 240)) fail('Grace must be a whole number from 0 to 240 minutes');
    for (const key of ['halfDayHours','fullDayHours','overtimeAfterHours']) if (data[key] !== '' && data[key] > 24) fail('Day and overtime thresholds cannot exceed 24 hours');
    if (data.halfDayHours !== '' && data.fullDayHours !== '' && data.halfDayHours > data.fullDayHours) fail('Half-day threshold cannot exceed full-day hours');
  }
  validateLeave(kind,data);
  return data;
}
