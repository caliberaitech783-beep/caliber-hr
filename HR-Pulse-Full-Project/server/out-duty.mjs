/* OD route. Office: Employee → HOD (concerned) → Regional HR. Site: HR Manager initiates → HOD (concerned) → Regional HR.
   HOD and Regional HR come from the site's leave approval flow (Approval Master › Leave); without one, the original fixed route applies. */
export function odApprovalWorkflow(flow,department=''){
 if(!flow?.hods||!Object.keys(flow.hods).length)return {id:null,data:{steps:[{stage:1,label:'HOD',approvers:['apurvakopulwar']},{stage:2,label:'Regional HR',approvers:['mayuriumate']}]}};
 const key=Object.keys(flow.hods).find(k=>k.toLowerCase()===String(department||'').trim().toLowerCase()),hod=key?flow.hods[key]:flow.hods['*'];
 if(!hod)throw Object.assign(new Error(`Configure the HOD (concerned) for the ${department||"employee's"} department in Approval Master › Leave before submitting an OD request.`),{status:409});
 const users=v=>String(v||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 return {id:null,data:{steps:[{stage:1,label:'HOD (concerned) — any one',approvers:users(hod)},{stage:2,label:'Regional HR — final approval, any one',approvers:users(flow.regionalHr)}]}};
}
