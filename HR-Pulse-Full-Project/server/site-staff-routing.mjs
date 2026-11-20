/* Site staff (office staff at a site) joining route, set by the owner on 20 Nov 2026:
   Site HR initiates → PM / HOD → Office HR → Regional HR → Directors (final) → employee becomes Active.
   Site HR, PM / HOD and Office HR come from Approval Master › Hierarchy › Office staff for the site.
   Regional HR and Directors are fixed here, region-wise, and override whatever is saved for those two steps:
     NCL – Jayant OC, Dudhichua East, Dudhichua West → Vinod Pinjarkar (employee 3399)
     WCL – Sasti OC, Majri OC, Dhuptala OC, Gauri Pauni OC → Virat Singh (employee 18114)
     Directors (any one approves, final)            → Mohit, Manish, Rahul Chadda
   The same people are fixed for vehicle trials (Driver & Operator); keep both tables equal. */
export const SITE_HR_LABEL='HR Manager';
export const PM_LABEL='Project Manager';
export const REGIONAL_HR_LABEL='HR Manager — either one';
export const DIRECTORS_LABEL='Final approval — any one';
export const SITE_STAFF_REGIONAL_HR=[
 {region:'NCL',employeeId:'3399',name:'Vinod Pinjarkar',username:'vinodpinjarkar',sites:['NCL-JAYANT','NCL-JAYANT-W','NCL-DUDE','NCL-DUDW']},
 {region:'WCL',employeeId:'18114',name:'Virat Singh',username:'viratsingh',sites:['WCL-SASTI','WCL-MAJRI','WCL-DHOPTALA','WCL-GAURI']},
];
export const SITE_STAFF_DIRECTORS=[
 {name:'Mohit Chadda',username:'mohitchadda'},
 {name:'Manish Chadda',username:'manishchadda'},
 {name:'Rahul Chadda',username:'rahulchadda'},
];
export const siteStaffRegionalHr=code=>SITE_STAFF_REGIONAL_HR.find(item=>item.sites.includes(code))||null;
const fixSteps=(steps,regional)=>steps.map(step=>step.label===REGIONAL_HR_LABEL
 ?{...step,label:REGIONAL_HR_LABEL,approvers:[regional.username],fixed:true,suggested:`${regional.name} (employee ${regional.employeeId}) — ${regional.region} sites`}
 :step.label===DIRECTORS_LABEL?{...step,approvers:SITE_STAFF_DIRECTORS.map(d=>d.username),fixed:true,suggested:SITE_STAFF_DIRECTORS.map(d=>d.name).join(' / ')}
 :step);
/* Applies the fixed Regional HR and Directors to the Office staff steps of a site hierarchy.
   officeOf derives the office steps when none were saved (the driver steps without Driver Trainer). */
export function withSiteStaffRouting(data,officeOf){
 const regional=siteStaffRegionalHr(data?.code);
 if(!regional||!Array.isArray(data?.steps))return data;
 const office=Array.isArray(data.officeSteps)&&data.officeSteps.length?data.officeSteps:officeOf(data.steps);
 return {...data,officeSteps:fixSteps(office,regional)};
}
/* Site HR initiates: when the site HR Manager of the first step submits the form, that step is their
   initiation, not an approval, so the request goes straight to PM / HOD. Anyone else who submits
   (an HR executive, for example) still needs the site HR Manager's approval first. */
export function initiatedSteps(steps,requester){
 const first=steps?.[0],actor=String(requester||'').trim().toLowerCase();
 if(first?.label===SITE_HR_LABEL&&first.stage===1&&first.approvers?.length===1&&first.approvers[0]===actor&&steps.length>1)return steps.slice(1);
 return steps;
}
/* Short role names for messages and the in-app pop-up. */
export function roleTitle(label){
 if(label===SITE_HR_LABEL)return 'Site HR';
 if(label===PM_LABEL)return 'PM / HOD';
 if(/^Office HR/.test(label||''))return 'Office HR';
 if(label===REGIONAL_HR_LABEL)return 'Regional HR';
 if(label===DIRECTORS_LABEL)return 'Directors (final)';
 return String(label||'').replace(/ — .*/,'');
}
