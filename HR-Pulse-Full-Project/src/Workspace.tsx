import ApprovalMaster from './ApprovalMaster';
import TelegramHierarchy from './TelegramHierarchy';
import HRCalendar from './HRCalendar';
import AssetManagement from './AssetManagement';
import HierarchyMaster from './HierarchyMaster';
import SalarySchemeMaster from './SalarySchemeMaster';
import TrialForm,{loadSelection,saveSelection,showsTrialForm,type TrialSelection} from './TrialForm';
import LeaveMaster,{LeaveRequests} from './LeaveMaster';
import ShiftMaster from './ShiftMaster';
import AttendanceManagement from './AttendanceManagement';
import {useEffect,useState} from 'react';
import {Banknote,Boxes,CalendarDays,ChevronDown,FileBarChart,LayoutDashboard,LogOut,Menu,Settings,ShieldCheck,UserPlus,Users,X} from 'lucide-react';
import {api,savedSession,type Session,type HRConfig} from './api';
import Logo from './Logo';
import {Records,Approvals,Overview,Audit,AccessAdministration} from './Modules';
import EmployeeLocation from './EmployeeLocation';
import type {JoiningDraft} from './joiningDrafts';
import './modules.css';
const navItems=[['Dashboard',LayoutDashboard],['Employee Master',Users],['Payroll Management',Banknote],['Asset Management',Boxes],['Calendar',CalendarDays],['Master Configuration',Settings],['Approval Master',ShieldCheck],['Telegram Hierarchy',Settings],['Employee Onboarding',UserPlus],['Employee Directory',Users],['Reports & MIS',FileBarChart],['Audit Logs',FileBarChart]] as const;
const masterGroups=[{name:'B1 · Company & sites',kinds:['companies','clients','regions','sites']},{name:'B2 · Organization',kinds:['departments','grades','designations']},{name:'B3 · Approval workflows',kinds:['workflows']},{name:'B4 · New employee',kinds:['employees']},{name:'B5 · Staff import',kinds:['employees']},{name:'B6 · Shifts',kinds:['shifts']},{name:'B7 · Holiday & leave',kinds:['holidays','leavePolicies','leaveRequests']},{name:'B8 · Approval matrix',kinds:['approvalRules']}];
function HeaderClock(){
  const[now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer);},[]);
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  const date=[String(now.getDate()).padStart(2,'0'),String(now.getMonth()+1).padStart(2,'0'),String(now.getFullYear()).slice(-2)].join('-');
  return <div className="header-clock" aria-label={`${time}, ${date}`}><strong>{time}</strong><CalendarDays/><span>{date}</span></div>;
}
export default function Workspace({session,initialConfig,logout}:{session:Session;initialConfig:HRConfig;logout:()=>void}){
  const[config,setConfig]=useState(initialConfig.modules),[profile,setProfile]=useState(initialConfig.profile),[page,setPage]=useState(()=>decodeURIComponent(window.location.hash.slice(1))),[kind,setKind]=useState('companies'),[group,setGroup]=useState(0),[error,setError]=useState(''),[collapsed,setCollapsed]=useState(true),[notice,setNotice]=useState('');
  const[masterMenu,setMasterMenu]=useState('Shift Master');
  const[expandedMenu,setExpandedMenu]=useState(()=>decodeURIComponent(window.location.hash.slice(1))||'Employee Master');
  const[employeeMenu,setEmployeeMenuState]=useState(()=>{try{return localStorage.getItem('hrPulse.employeeMenu')||'Employee Management';}catch{return 'Employee Management';}});
  const setEmployeeMenu=(menu:string)=>{setEmployeeMenuState(menu);try{localStorage.setItem('hrPulse.employeeMenu',menu);}catch{/* ignore */}};
  const[transferTab,setTransferTab]=useState('requests');
  const[selection,setSelection]=useState<TrialSelection>(loadSelection),trialVisible=showsTrialForm(selection);
  useEffect(()=>{if(employeeMenu==='Trial Form'&&!trialVisible)setEmployeeMenu('Employee Management');},[trialVisible]);const updateSelection=(next:TrialSelection)=>{setSelection(next);saveSelection(next);};
  const[payrollMenu,setPayrollMenu]=useState('Salary Scheme');
  const[employeeGroup,setEmployeeGroup]=useState<'Corporate / HO'|'OB / COAL'>('Corporate / HO');
  const[trialDraft,setTrialDraft]=useState<JoiningDraft>();
  const draftOwner=profile.actor||profile.username||profile.email||'';
  const storedSession=savedSession();
  const originalProfile=storedSession?.grant===session.grant?storedSession.profile:session.profile;
  const legacyTrialOwner=originalProfile.actor||originalProfile.username||originalProfile.email;
  function openTrialJoining(draft: JoiningDraft){
    setEmployeeGroup(draft.group);
    setTrialDraft(draft);
    setEmployeeMenu('Employee Management');
  }
  const access=new Set([...(profile.permissions.hrDesktopAccess||[]),...(profile.permissions.hrMobileAccess||[])]);const permitted=navItems.filter(([name])=>access.has(name)||(name==='Approval Master'&&['Master Configuration','Approval Management','Employee Master'].some(menu=>access.has(menu)))||(name==='Telegram Hierarchy'&&access.size>0)||(['Payroll Management','Asset Management','Calendar'].includes(name)&&access.has('Employee Master')));
  async function refreshConfig(){const started=performance.now();try{const value=await api<HRConfig>(session.grant,'config');setConfig(value.modules);setProfile(value.profile);setError('');setNotice(`Data loaded. Time taken: ${((performance.now()-started)/1000).toFixed(1)} sec.`);}catch(err){setError((err as Error).message);}}
  useEffect(()=>{const timer=setInterval(()=>void refreshConfig(),60000);return()=>clearInterval(timer);},[session.grant]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{const change=()=>{try{setPage(decodeURIComponent(window.location.hash.slice(1)));}catch{setPage('');}};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(permitted.length&&!permitted.some(([name])=>name===page)){const isLegacyMaster=['Shift Management','Holiday & Leave'].includes(page)&&access.has('Master Configuration');if(isLegacyMaster)setMasterMenu(page==='Holiday & Leave'?'Holiday & Leave Master':'Shift Master');const next=isLegacyMaster?'Master Configuration':permitted[0][0];window.location.hash=encodeURIComponent(next);setPage(next);}},[profile,page]);
  function navigate(name:string){window.location.hash=encodeURIComponent(name);setPage(name);setNotice('');if(window.innerWidth<=760)setCollapsed(true);if(name==='Master Configuration'){setGroup(0);setKind('companies');}if(name==='Holiday & Leave')setKind('leaveRequests');}
  const employeePage=['Employee Master','Employee Onboarding','Employee Directory'].includes(page);
  const activeKind=employeePage?'employees':kind;
  const groups=masterGroups[group].kinds.filter(k=>config[k]);
  const initials=profile.name?.split(' ').map(x=>x[0]).slice(0,2).join('')||'HR';
  const employeeManagement=<EmployeeLocation
    canApprove={access.has('Approval Management')}
    draftOwner={draftOwner}
    initialTrialDraft={trialDraft}
    onTrialDraftOpened={()=>setTrialDraft(undefined)}
    grant={session.grant}
    module={config.employees}
    notice={setNotice}
    employeeGroup={employeeGroup}
    onEmployeeGroupChange={setEmployeeGroup}
    onSelectionChange={updateSelection}
  />;
  return <div className={'app '+(collapsed?'collapsed':'')}><aside><div className="side-head"><Logo/><button aria-label="Toggle navigation" onClick={()=>setCollapsed(!collapsed)}><Menu/></button></div><div className="workspace"><small>WORKSPACE</small><strong>Caliber HR</strong><span>Azure HR database</span></div><nav>{permitted.map(([name,Icon])=>{const children=name==='Employee Master'?[...(trialVisible?['Trial Form']:[]),'Employee Management','Leave/OD Management','Employee Transfer','Attendance Management']:name==='Payroll Management'?['Salary Scheme','Payroll Processing','Loan and Advances','Expense Claims']:[];const selected=name==='Employee Master'?employeeMenu:payrollMenu;return <div className="nav-entry" key={name}><button className={page===name?'active':''} title={name} aria-expanded={children.length?expandedMenu===name:undefined} aria-controls={children.length?`submenu-${name.replaceAll(' ','-')}`:undefined} onClick={()=>{if(children.length){setExpandedMenu(expandedMenu===name?'':name);setCollapsed(false);}navigate(name);}}><Icon/><span>{name}</span>{children.length>0&&<ChevronDown className={'chev '+(expandedMenu===name?'expanded':'')}/>}</button>{children.length>0&&expandedMenu===name&&<div id={`submenu-${name.replaceAll(' ','-')}`} className="master-subnav employee-subnav" aria-label={`${name} submenus`}>{children.map(item=><button key={item} className={page===name&&selected===item?'selected':''} aria-pressed={page===name&&selected===item} onClick={()=>{name==='Employee Master'?setEmployeeMenu(item):setPayrollMenu(item);navigate(name);}}>{item}</button>)}</div>}</div>;})}</nav><div className="side-user"><div className="avatar">{initials}</div><div><strong>{profile.name}</strong><small>{profile.assignedRole}</small></div><button aria-label="Sign out" onClick={logout}><LogOut/></button></div></aside><main className="main"><header><button className="mobile-menu" aria-label="Open navigation" onClick={()=>setCollapsed(!collapsed)}><Menu/></button><strong>People & operations</strong><HeaderClock/><div className="header-actions"><div className="header-profile"><div className="avatar">{initials}</div><span><strong>{profile.name}</strong><small>{profile.assignedRole}</small></span></div><button aria-label="Sign out" onClick={logout}><LogOut/></button></div></header><div className="content">{page==='Master Configuration'&&<section className="master-configuration" aria-label="Master Configuration">
      <div className="module-tabs" aria-label="Master configuration menus">
        {['Shift Master','Holiday & Leave Master','Hierarchy','Employee Master'].map(item=><button type="button" key={item} className={masterMenu===item?'selected':''} aria-pressed={masterMenu===item} onClick={()=>setMasterMenu(item)}>{item}</button>)}
      </div>
      {masterMenu==='Shift Master'?<ShiftMaster grant={session.grant} module={config.shifts}/>
        :masterMenu==='Hierarchy'?<HierarchyMaster grant={session.grant}/>
        :masterMenu==='Employee Master'?(access.has('Employee Master')?employeeManagement:<p>Employee Master access is required to manage employees.</p>)
        :<LeaveMaster grant={session.grant} config={config} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={setNotice}/>}
    </section>} {page==='Employee Master'&&<>{employeeMenu==='Leave/OD Management'&&<LeaveRequests grant={session.grant} module={config.leaveRequests} odModule={config.outDutyRequests} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={setNotice}/>} {employeeMenu==='Employee Transfer'&&<section className="transfer-management" aria-labelledby="employee-transfer-title">
      <div className="page-title"><div>
        <h1 id="employee-transfer-title">Employee Transfer</h1>
        <p>Enter the employee's current and destination details, save the draft, then submit it for approval.</p>
      </div></div>
      <p className="help-text">Approval route: Site HR (from location) → PM (from location) → Office HR → Regional HR Head → Director (set up in Approval Master › Employee Transfer). The posting changes only after the Director approves.</p>
      <div className="module-tabs" aria-label="Employee transfer tabs">
        <button type="button" className={transferTab==='requests'?'selected':''} aria-pressed={transferTab==='requests'} onClick={()=>setTransferTab('requests')}>Transfer requests</button>
        {access.has('Approval Management')&&<button type="button" className={transferTab==='review'?'selected':''} aria-pressed={transferTab==='review'} onClick={()=>setTransferTab('review')}>Approve / reject</button>}
      </div>
      {transferTab==='review'
        ?<Approvals grant={session.grant} actor={profile.actor||''} notice={setNotice} kind="employeeTransfers"/>
        :config.employeeTransfers
          ?<Records grant={session.grant} kind="employeeTransfers" module={config.employeeTransfers} notice={setNotice} actionLabel="Create transfer"/>
          :<p role="status">Loading transfer configuration...</p>}
    </section>} {employeeMenu==='Attendance Management'&&<AttendanceManagement grant={session.grant}/>}{employeeMenu==='Employee Management'&&employeeManagement}{employeeMenu==='Trial Form'&&<TrialForm selection={selection} owner={draftOwner} legacyOwner={legacyTrialOwner} onPassed={openTrialJoining}/>}</>} {page!=='Employee Master'&&page!=='Master Configuration'&&<><div className="page-title"><div><p>{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p><h1>{page||'HR workspace'}</h1><small>Records are saved in your separate Azure HR database.</small></div></div>{error&&<div className="error" role="alert">{error} <button onClick={()=>void refreshConfig()}>Retry connection</button></div>}{!permitted.length?<p>No HR menus are assigned. Contact your Pulse administrator.</p>:<>
    {page==='Approval Master'&&<ApprovalMaster grant={session.grant}/>}
    {page==='Telegram Hierarchy'&&<TelegramHierarchy grant={session.grant}/>}
    {(page==='Dashboard'||page==='Reports & MIS')&&<Overview grant={session.grant} report={page==='Reports & MIS'} onEmployees={()=>navigate('Employee Directory')} showEmployees={access.has('Employee Directory')}/>}
    {page==='Master Configuration'&&<><div className="module-tabs master-groups">{masterGroups.map((g,i)=>g.kinds.some(k=>config[k])&&<button key={g.name} className={group===i?'selected':''} onClick={()=>{setGroup(i);setKind(g.kinds.find(k=>config[k])||'');}}>{g.name}</button>)}</div><div className="module-tabs">{groups.map(k=><button key={k} className={kind===k?'selected':''} onClick={()=>setKind(k)}>{config[k].title}</button>)}</div></>}
    {page==='Payroll Management'&&<>{payrollMenu==='Salary Scheme'?<SalarySchemeMaster actor={profile.actor||''} canApprove={access.has('Approval Management')}/>:<ModuleLanding title={payrollMenu}/>}</>}
    {page==='Asset Management'&&<AssetManagement grant={session.grant} config={config} notice={setNotice}/>}
    {page==='Calendar'&&<HRCalendar grant={session.grant} config={config}/>}
    {page==='Holiday & Leave'&&<><p className="help-text">Leave entitlement uses calendar days, including weekends and holidays. Split requests at the calendar-year boundary.</p><div className="module-tabs">{['leaveRequests','holidays','leavePolicies'].filter(k=>config[k]).map(k=><button key={k} className={kind===k?'selected':''} onClick={()=>setKind(k)}>{config[k].title}</button>)}</div></>}
    {(employeePage||['Master Configuration','Holiday & Leave'].includes(page))&&config[activeKind]&&<Records key={page+activeKind+group} grant={session.grant} kind={activeKind} module={config[activeKind]} readOnly={page==='Employee Directory'} allowDelete={page==='Employee Onboarding'||page==='Employee Directory'} importFirst={page==='Master Configuration'&&group===4} notice={setNotice}/>}
    {page==='Approval Management'&&<Approvals grant={session.grant} actor={profile.actor||''} notice={setNotice}/>}
    {page==='Audit Logs'&&<Audit grant={session.grant}/>}
    {page==='Administration'&&<AccessAdministration grant={session.grant} profile={profile} modules={config} notice={setNotice}/>}
    </>}</>}</div>{notice&&(page!=='Master Configuration'||['Holiday & Leave Master','Employee Master'].includes(masterMenu))&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X/></button></div>}</main></div>;
}

function ModuleLanding({title}:{title:string}){return <section className="data-card"><h2>{title}</h2><div className="empty"><h3>Module setup pending</h3><p>This menu is ready. The management workflow is not yet configured.</p></div></section>;}
