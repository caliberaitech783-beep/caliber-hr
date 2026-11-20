import {useEffect,useState} from 'react';
import {api,type Lookup,type RecordRow} from './api';
import {Approvals,Overview} from './Modules';
import {displayDate,employeeLabel,indiaToday,type Punch} from './AttendanceManagement';
import {missingJoiningField} from '../server/joining-required.mjs';

export const dashboardTabs=[
  'Management Dashboard','HR Dashboard','Department-Wise Dashboard','Employee Summary',
  'Today’s Attendance','Pending Approvals','Alerts & Notifications',
] as const;
export type DashboardTab=typeof dashboardTabs[number];

type Employee=Omit<RecordRow,'data'>&{data:Record<string,unknown>;office:Record<string,unknown>};
type EmployeePage={rows:Omit<Employee,'office'>[];total:number;pageSize:number};

function employeeDetails(employee:Employee){
  const {data,office}=employee;
  const missing:string[]=[];
  if(!String(office.UAN||office['UAN No.']||data.uan||'').trim())missing.push('UAN');
  const role=[office['Employee Category'],office['Designation *'],data.designationTitle].join(' ');
  if(/\b(driver|operator)\b/i.test(role)&&!String(office['VT Certificate No.']||data.vtc||'').trim())missing.push('VTC');
  const required=Object.keys(office).length?missingJoiningField(office):undefined;
  if(required)missing.push(required);
  return missing;
}

function EmployeeDashboard({grant,tab}:{grant:string;tab:DashboardTab}){
  const [employees,setEmployees]=useState<Employee[]|null>(null);
  const [departments,setDepartments]=useState<Lookup[]>([]);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const byDepartment=tab==='Department-Wise Dashboard';
  useEffect(()=>{
    let active=true;
    async function load(){
      try{
        const lookup=byDepartment?api<Lookup[]>(grant,'lookups').catch(()=>[]):Promise.resolve([]);
        const first=await api<EmployeePage>(grant,'records/employees?page=1');
        const rows=[...first.rows];
        const pages=Math.ceil(first.total/first.pageSize);
        for(let page=2;active&&page<=pages;page++){
          rows.push(...(await api<EmployeePage>(grant,'records/employees?page='+page)).rows);
        }
        const options=await lookup;
        if(!active)return;
        setDepartments(options.filter(row=>row.kind==='departments'));
        setEmployees([...new Map(rows.map(row=>{
          const fields=row.data.officeData??row.data.fields;
          const office=fields&&typeof fields==='object'&&!Array.isArray(fields)?fields as Record<string,unknown>:{};
          return [row.id,{...row,office}] as const;
        })).values()]);
        setError('');
      }catch(e){if(active)setError((e as Error).message);}
    }
    void load();
    return()=>{active=false;};
  },[grant,byDepartment,refresh]);

  const departmentNames=new Map(departments.map(row=>[row.id,row.name]));
  const departmentCounts=new Map<string,number>();
  const statusCounts=new Map<string,number>();
  const pending=employees?.filter(row=>['ACTIVE','APPROVED','PENDING'].includes(row.status)).map(row=>({row,fields:employeeDetails(row)})).filter(({fields})=>fields.length)||[];
  for(const employee of employees||[]){
    const department=String(employee.office['Department *']||employee.office.Department||departmentNames.get(String(employee.data.departmentId))||employee.data.department||'Unassigned');
    departmentCounts.set(department,(departmentCounts.get(department)||0)+1);
    statusCounts.set(employee.status,(statusCounts.get(employee.status)||0)+1);
  }
  const totals=byDepartment?departmentCounts:statusCounts;

  return <section className="data-card">
    <div className="data-heading"><div><h2>{tab==='Pending Approvals'?'Pending employee entries':tab}</h2>
      {tab==='Pending Approvals'&&<p>Review missing UAN, applicable VTC, and other required joining details.</p>}</div>
      <button type="button" onClick={()=>setRefresh(value=>value+1)}>Refresh</button>
    </div>
    {error?<p role="alert" className="error">{error}</p>:!employees?<p role="status">Loading employee records…</p>:tab==='Pending Approvals'?
      pending.length?<div className="table-scroll"><table><thead><tr><th>Employee code</th><th>Employee</th><th>Pending details</th></tr></thead><tbody>
        {pending.map(({row,fields})=><tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{fields.join(', ')}</td></tr>)}
      </tbody></table></div>:<p>No pending employee details found.</p>:
      totals.size?<div className="table-scroll"><table><thead><tr><th>{byDepartment?'Department':'Status'}</th><th>Employees</th></tr></thead><tbody>
        {[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([name,count])=><tr key={name}><td>{name}</td><td>{count}</td></tr>)}
      </tbody></table></div>:<p>No employee records found.</p>}
  </section>;
}

function TodayAttendance({grant}:{grant:string}){
  const day=indiaToday();
  const [data,setData]=useState<{rows:Punch[];truncated:boolean}|null>(null);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;
    api<{rows:Punch[];truncated:boolean}>(grant,`attendance/punches?from=${day}&to=${day}`).then(result=>{
      if(active){setData(result);setError('');}
    }).catch((e:Error)=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[grant,day,refresh]);
  return <section className="data-card">
    <div className="data-heading"><div><h2>Today’s Attendance</h2><p>Machine punches for {displayDate(day)} (IST)</p></div><button type="button" onClick={()=>setRefresh(value=>value+1)}>Refresh</button></div>
    {error?<p role="alert" className="error">{error}</p>:!data?<p role="status">Loading attendance…</p>:data.rows.length?<><div className="table-scroll"><table><thead><tr><th>Employee</th><th>Site</th><th>Time</th></tr></thead><tbody>
      {data.rows.map(punch=><tr key={punch.id}><td>{employeeLabel(punch)}</td><td>{punch.siteName||'—'}</td><td>{punch.time}</td></tr>)}
    </tbody></table></div>{data.truncated&&<p>More punches are available in Attendance Management.</p>}</>:<p>No machine punches recorded today.</p>}
  </section>;
}

export default function Dashboard({tab,select,grant,actor,notice,canSeeEmployees,canSeeAttendance,canApprove,onEmployees,showEmployees}:{
  tab:DashboardTab;select:(tab:DashboardTab)=>void;grant:string;actor:string;notice:(message:string)=>void;
  canSeeEmployees:boolean;canSeeAttendance:boolean;canApprove:boolean;onEmployees:()=>void;showEmployees:boolean;
}){
  return <>
    <div className="module-tabs" role="group" aria-label="Dashboard views">
      {dashboardTabs.map(label=><button key={label} type="button" className={tab===label?'selected':''} aria-pressed={tab===label} onClick={()=>select(label)}>{label}</button>)}
    </div>
    {(tab==='Management Dashboard'||tab==='HR Dashboard')&&<Overview grant={grant} report={tab==='Management Dashboard'} onEmployees={onEmployees} showEmployees={showEmployees}/>}
    {(tab==='Employee Summary'||tab==='Department-Wise Dashboard'||tab==='Pending Approvals')&&(canSeeEmployees?
      <EmployeeDashboard key={grant+tab} grant={grant} tab={tab}/>:<p>Employee record access is required for this view.</p>)}
    {tab==='Today’s Attendance'&&(canSeeAttendance?<TodayAttendance key={grant} grant={grant}/>:<p>Attendance Management access is required for this view.</p>)}
    {tab==='Pending Approvals'&&(canApprove?<Approvals grant={grant} actor={actor} notice={notice}/>:<p>Approval Management access is required to review approvals.</p>)}
    {tab==='Alerts & Notifications'&&<section className="data-card"><h2>Alerts & Notifications</h2><p>Review employee details and approval requests that need attention.</p><button type="button" onClick={()=>select('Pending Approvals')}>Open Pending Approvals</button></section>}
  </>;
}
