/* Vehicle trial approval route (owner, 20 Nov 2026):
   Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors (final) → cleared to join, employee becomes Active.
   Site HR, Driver Trainer, PM and Office HR come from Approval Master › Hierarchy › Driver & Operator for the site.
   Regional HR and Directors are fixed here, region-wise, and override whatever is saved for those two steps:
     NCL – Jayant, Dudhichua East, Dudhichua West → Vinod Pinjarkar (CMPL3399)
     WCL – Sasti, Majri, Dhuptala, Gauri Pauni     → Virat Singh (CMPL18114)
     Directors (any one approves)                  → Mohit, Manish, Rahul Chadda
   Only vehicle trials use this (trial-access.mjs and the Vehicle Trial Result bot recipients in telegram.mjs);
   leave and joining approvals keep the saved hierarchy.
   src/trial-workflow-preview/routing.ts shows the same table in the browser; trial-routing.test.mjs keeps both equal. */
export const REGIONAL_HR_LABEL='HR Manager — either one';
export const DIRECTORS_LABEL='Final approval — any one';
export const TRIAL_REGIONAL_HR=[
 {region:'NCL',employeeId:'CMPL3399',name:'Vinod Pinjarkar',username:'vinodpinjarkar',sites:['NCL-JAYANT','NCL-JAYANT-W','NCL-DUDE','NCL-DUDW']},
 {region:'WCL',employeeId:'CMPL18114',name:'Virat Singh',username:'viratsingh',sites:['WCL-SASTI','WCL-MAJRI','WCL-DHOPTALA','WCL-GAURI']},
];
export const TRIAL_DIRECTORS=[
 {name:'Mohit Chadda',username:'mohitchadda'},
 {name:'Manish Chadda',username:'manishchadda'},
 {name:'Rahul Chadda',username:'rahulchadda'},
];
export const regionalHrFor=code=>TRIAL_REGIONAL_HR.find(item=>item.sites.includes(code))||null;
/* Applies the fixed Regional HR and Directors to the Driver & Operator steps of a site hierarchy. */
export function withTrialRouting(data){
 const regional=regionalHrFor(data?.code);
 if(!regional||!Array.isArray(data?.steps))return data;
 const steps=data.steps.map(step=>step.label===REGIONAL_HR_LABEL?{...step,approvers:[regional.username],fixed:true,suggested:`${regional.name} (${regional.employeeId})`}
  :step.label===DIRECTORS_LABEL?{...step,approvers:TRIAL_DIRECTORS.map(d=>d.username),fixed:true,suggested:TRIAL_DIRECTORS.map(d=>d.name).join(' / ')}:step);
 return {...data,steps};
}
