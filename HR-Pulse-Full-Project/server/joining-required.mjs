// Office field names used by the joining form after export aliases are applied.
const requiredDetails = new Set([
  'Joining Category *','Employee Code','Full Name as per Aadhar','Full Name *','Father / Spouse Name *',
  'Marital Status','Mobile *','Aadhaar No. *','PAN No.','Present Address','Reference Type','Reference Name',
  'Emergency Contact Name','Emergency Contact Number','Department *','Sub-department *','Designation *',
  'Employee Category','Reporting To','Joining Date *','Shift *','Employment Type','Salary Type','Site / Project','PT State',
]);
const messPlanSites = new Set(['Jayant OB East','Jayant OB West','Dhudhichua OB West','Dhudhichua OB East']);
const filled = value => typeof value==='string'&&Boolean(value.trim());

// Legacy employee editors can update other fields even if a required field was already empty.
export const requiredEmployeeDetail = label => requiredDetails.has(label);

export function missingJoiningField(office = {}) {
  if(!['Single','Unmarried','Married','Divorced'].includes(office['Marital Status']))return 'Marital Status';
  const required = [...requiredDetails,'Candidate photo','Aadhaar (masked display)'];
  const siteJoining = ['WCL','NCL'].includes(office['Joining Category *']);
  const driverOrOperator = ['Driver','Operator'].includes(office['Employee Category']);
  const salaryType = office['Salary Type'];
  const standard = ['STD','STDW','WC'].includes(salaryType);

  for(let index=0;index<5;index++){
    const entered=['Family Member Name','Relationship','Family Date of Birth','Contact No.','Occupation','Dependent? (Y/N)'].some(key=>String(office[key]||'').split('|')[index]?.trim());
    const aadhaar=String(office['Aadhaar Number']||'').split('|')[index]?.trim()||'';
    if(entered&&!/^\d{12}$/.test(aadhaar))return `Aadhaar Number ${index+1}`;
  }
  if(siteJoining)required.push('Identification mark');
  if(driverOrOperator){
    required.push('Driving licence');
    if(siteJoining)required.push('Driving Licence No.','DL Issue Date','DL Valid Upto');
  }
  if(!standard){
    required.push('Skill Category');
    required.push(messPlanSites.has(office['Site / Project'])?'Mess Plan':'Accommodation Category');
  }
  if(standard||salaryType==='NON')required.push('Monthly Gross Salary');
  return required.find(label=>!filled(office[label]));
}

// Owner, 21 Nov 2026: the employee's own Date of Birth must give an age of at least 18 years as of today's date in India.
export const MINIMUM_EMPLOYEE_AGE = 18;
const indiaDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
export const todayInIndia = (now = new Date()) => indiaDate.format(now);
function birthParts(value) {
  const text=String(value||'').trim(),iso=text.match(/^(\d{4})-(\d{2})-(\d{2})/),local=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const [y,m,d]=iso?[+iso[1],+iso[2],+iso[3]]:local?[+local[3],+local[2],+local[1]]:[];
  if(!y)return null;
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?[y,m,d]:null;
}
// Returns the problem with an entered DOB, or '' when it is empty or old enough.
export function underageBirthDate(value, asOf = todayInIndia(), minYears = MINIMUM_EMPLOYEE_AGE) {
  const birth=birthParts(value);
  if(!birth)return '';
  const [ty,tm,td]=asOf.split('-').map(Number),last=new Date(Date.UTC(ty-minYears,tm,0)).getUTCDate();
  const latest=[ty-minYears,tm,Math.min(td,last)];
  const tooYoung=birth[0]!==latest[0]?birth[0]>latest[0]:birth[1]!==latest[1]?birth[1]>latest[1]:birth[2]>latest[2];
  if(!tooYoung)return '';
  return `Date of Birth: age must be at least ${minYears} years as of today (born on or before ${String(latest[2]).padStart(2,'0')}/${String(latest[1]).padStart(2,'0')}/${latest[0]})`;
}
