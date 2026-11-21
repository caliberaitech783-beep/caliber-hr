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
  if(siteJoining)required.push('A-Form No.');
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
