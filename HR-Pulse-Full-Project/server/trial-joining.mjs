const invalid = message => Object.assign(new Error(message),{status:400});
const clean = value => String(value??'').trim();
const digits = value => clean(value).replace(/\D/g,'');
const approvalRoles = ['pm','rhr','director'];

export function validateTrialJoining(trial, employee, office) {
  if (!trial || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(trial.id)
      || !/^TF\/\d{4}-\d{2}\/\d{4,}$/.test(trial.formNo)
      || trial.stage!=='done' || trial.result!=='PASS' || !['Driver','Operator'].includes(trial.post)
      || !Array.isArray(trial.history) || !approvalRoles.every(role=>
        [...trial.history].reverse().find(entry=>entry?.role===role)?.action==='Approved')) {
    throw invalid('A completed Driver or Operator trial with a PASS result is required.');
  }
  if (office?.['Employee Category']!==trial.post || office['Department *']!==trial.post || office['Trial Form No.']!==trial.formNo) {
    throw invalid('The joining form must match the trial form and recommended Driver or Operator post.');
  }
  const site = clean(trial.site);
  const aadhaar = digits(trial.aadhaar);
  if (aadhaar ? !/^\d{12}$/.test(aadhaar)||aadhaar!==digits(office['Aadhaar No. *'])
    : clean(trial.name).toLowerCase()!==clean(employee.name).toLowerCase()||digits(trial.mobile)!==digits(employee.mobile)||!/^\d{10}$/.test(digits(trial.mobile))) {
    throw invalid('The joining details must match the candidate on the passed trial.');
  }
  return {id:trial.id.toLowerCase(),formNo:trial.formNo,post:trial.post,site};
}
