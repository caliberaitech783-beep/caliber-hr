import {useEffect,useState} from 'react';
import {api,type Module,type RecordRow} from './api';
import {Records,Approvals} from './Modules';
const tabs=[['dashboard','Leave Dashboard'],['leaveTypes','Leave Types'],['leavePeriods','Leave Periods'],['leaveAllocations','Leave Allocation'],['leaveBlocks','Block List'],['holidays','Holidays']];
const cols:Record<string,string[][]>={
 leaveTypes:[['name','Name'],['description','Description'],['code','Code'],['isPaid','Paid'],['maxDaysPerPeriod','Max days'],['carryForwardMax','Carry forward'],['encashable','Encashable']],
 leavePolicies:[['name','Policy'],['leaveTypeId','Leave type'],['accrual','Accrual'],['companyId','Company'],['departmentId','Department'],['category','Group'],['effectiveFrom','Effective from']],
 leavePeriods:[['name','Period'],['fromDate','From'],['toDate','To']],
 leaveAllocations:[['employeeId','Employee'],['name','Name'],['leaveTypeId','Leave type'],['allocated','Allocated'],['used','Used'],['reserved','Pending'],['balance','Balance'],['periodId','Period']],
 leaveRequests:[['fromDate','Date (from)'],['toDate','Date (to)'],['employeeId','Employee ID'],['employeeName','Name'],['companyId','Company'],['name','Reason (write-up)'],['chargeHandedOverTo','Charge handed over to'],['reasonAudio','Reason (audio)'],['days','No. of Days'],['approver','Reporting to'],['attachment','Attachment']],
 leaveEncashments:[['employeeId','Employee'],['leaveTypeId','Type'],['days','Days'],['amount','Amount']],
 leaveBlocks:[['name','Name'],['fromDate','From'],['toDate','To'],['siteId','Location'],['departmentId','Department'],['reason','Reason']],
 holidays:[['name','Name'],['day','DAY'],['date','date'],['siteId','siteId'],['holidayType','holidayType']],
};
const filters:Record<string,{key:string;label:string;reference?:string;type?:string}[]>={
 leaveAllocations:[{key:'departmentId',label:'Department',reference:'departments'},{key:'leaveTypeId',label:'Leave type',reference:'leaveTypes'},{key:'periodId',label:'Period',reference:'leavePeriods'}],
 leaveRequests:[{key:'leaveTypeId',label:'Leave type',reference:'leaveTypes'},{key:'fromDate',label:'From',type:'date'},{key:'toDate',label:'To',type:'date'}],
 holidays:[{key:'year',label:'Year',type:'number'}],
};
export default function LeaveMaster({grant,config,actor,canApprove,notice}:{grant:string;config:Record<string,Module>;actor:string;canApprove:boolean;notice:(s:string)=>void}){
 const[tab,setTab]=useState('dashboard'),[review,setReview]=useState(false);
 return <><div className="page-title"><div><h1>Holiday &amp; Leave Master</h1><p>Configure leave, manage requests and track balances.</p></div></div><div className="module-tabs" aria-label="Leave management tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'selected':''} onClick={()=>{setTab(key);setReview(false);}}>{label}</button>)}</div>
 {tab==='dashboard'?<LeaveDashboard grant={grant}/>:config[tab]?<>
 {tab==='leavePolicies'&&<p className="help-text">Assign policies by company, department and employment group. Accrual rules are recorded here; balances are allocated in Leave Allocation.</p>}
 {tab==='leaveRequests'&&<p className="help-text">Days are calculated from the date range, including weekends and holidays. Half-day requests count as 0.5 day. Save a draft, then submit it for approval.</p>}
 {tab==='leaveEncashments'&&<p className="help-text">Request unused days for encashment. Approval reserves the days for payroll; payment amounts await configured payroll rules.</p>}
 {['leaveRequests','leaveEncashments'].includes(tab)&&canApprove&&<div className="module-tabs"><button className={!review?'selected':''} onClick={()=>setReview(false)}>Requests</button><button className={review?'selected':''} onClick={()=>setReview(true)}>Approve / reject</button></div>}
 {review?<Approvals grant={grant} actor={actor} notice={notice} kind="leaveRequests"/>:<Records key={tab} grant={grant} kind={tab} module={config[tab]} notice={notice} columns={cols[tab]?.map(([key,label])=>({key,label}))} filters={filters[tab]} actionLabel={tab==='leaveRequests'?'Apply leave':tab==='leaveAllocations'?'Allocate':tab==='leaveEncashments'?'Request encashment':tab==='leavePolicies'?'Add / assign policy':undefined}/>}
 </>:<p role="status">This tab is unavailable for your account, or its configuration is still loading.</p>}</>;
}
export function LeaveRequests({grant,module,odModule,actor,canApprove,notice}:{grant:string;module?:Module;odModule?:Module;actor:string;canApprove:boolean;notice:(s:string)=>void}){
 const[tab,setTab]=useState('leave');
 return <><div className="module-tabs" aria-label="Leave forms"><button className={tab==='leave'?'selected':''} onClick={()=>setTab('leave')}>Employee Leave Form</button><button className={tab==='od'?'selected':''} onClick={()=>setTab('od')}>OD Form</button>{canApprove&&<button className={tab==='review'?'selected':''} onClick={()=>setTab('review')}>Approve / reject</button>}{canApprove&&<button className={tab==='od-review'?'selected':''} onClick={()=>setTab('od-review')}>OD approvals</button>}</div>
 {tab==='od-review'?<Approvals grant={grant} actor={actor} notice={notice} kind="outDutyRequests"/>:tab==='review'?<Approvals grant={grant} actor={actor} notice={notice} kind="leaveRequests"/>:tab==='od'?<><p className="help-text">Save a draft, then submit: Employee → HOD (APURVAKOPULWAR) → Regional HR (MAYURIUMATE).</p>{odModule?<Records key="od" grant={grant} kind="outDutyRequests" module={odModule} notice={notice} columns={[{key:'code',label:'OD reference'},{key:'name',label:'Employee name'},{key:'outDutyDate',label:'From date'},{key:'toDate',label:'To date'},{key:'visitLocation',label:'Place to visit'}]} actionLabel="Add OD form"/>:<p role="status">OD Form is unavailable for your account, or its configuration is still loading.</p>}</>:module?<><p className="help-text">Save a draft, then submit it for approval. Days include weekends and holidays; a half day counts as 0.5 day.</p><Records key="leave" grant={grant} kind="leaveRequests" module={module} notice={notice} columns={cols.leaveRequests.map(([key,label])=>({key,label}))} filters={filters.leaveRequests} actionLabel="Apply leave"/></>:<p role="status">Leave Requests is unavailable for your account.</p>}</>;
}

async function all(grant:string,kind:string){const rows:RecordRow[]=[];for(let page=1;page<=200;page++){const result=await api<{rows:RecordRow[];total:number}>(grant,`records/${kind}?page=${page}`);rows.push(...result.rows);if(rows.length>=result.total)return rows;}throw new Error('Dashboard exceeds 10,000 records. Use filtered lists.');}
function LeaveDashboard({grant}:{grant:string}){
 const[data,setData]=useState<{requests:RecordRow[];allocations:RecordRow[];holidays:RecordRow[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;Promise.all([all(grant,'leaveRequests'),all(grant,'leaveAllocations'),all(grant,'holidays')]).then(([requests,allocations,holidays])=>{if(live)setData({requests,allocations,holidays});}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[grant]);
 if(error)return <p className="error" role="alert">{error}</p>;if(!data)return <p role="status">Loading leave overview…</p>;
 const today=new Date().toLocaleDateString('en-CA');const upcoming=data.holidays.filter(r=>r.status==='ACTIVE'&&String(r.data.date)>=today).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date))).slice(0,10);
 const active=data.allocations.filter(r=>r.status==='ACTIVE'&&r.data.__importDraft!=='true');
 return <><div className="kpis">{[['Total requests',data.requests.length],...['PENDING','APPROVED','REJECTED'].map(status=>[status[0]+status.slice(1).toLowerCase(),data.requests.filter(r=>r.status===status).length])].map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><div className="dashboard-grid"><section className="data-card"><h2>Balance summary</h2><dl>{[['Allocated','allocated'],['Used','used'],['Pending','reserved'],['Available','balance']].map(([label,key])=><div key={key}><dt>{label}</dt><dd>{active.reduce((sum,r)=>sum+Number(r.data[key]||0),0)} days</dd></div>)}</dl></section><section className="data-card"><h2>Upcoming holidays</h2>{upcoming.length?<table><thead><tr><th>Date</th><th>Holiday</th></tr></thead><tbody>{upcoming.map(r=><tr key={r.id}><td>{String(r.data.date)}</td><td>{r.name}</td></tr>)}</tbody></table>:<p>No upcoming holidays configured.</p>}</section></div><p className="help-text">Attendance and working-on-holiday requests are not connected yet. This overview shows saved leave records.</p></>;
}
