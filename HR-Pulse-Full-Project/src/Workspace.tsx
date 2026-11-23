import Dashboard,{dashboardTabs,type DashboardTab} from './Dashboard';
import ManagementModules, {managementSections, isManagementSection} from './ManagementModules';
import ApprovalMaster from './ApprovalMaster';
import TelegramHierarchy from './TelegramHierarchy';
import HRCalendar from './HRCalendar';
import AssetManagement from './AssetManagement';
import HierarchyMaster from './HierarchyMaster';
import SalarySchemeMaster from './SalarySchemeMaster';
import SettingsRegisters from './SettingsRegisters';
import PayrollProcessing from './PayrollProcessing';
import TrialForm,{loadSelection,saveSelection,showsTrialForm,type TrialSelection} from './TrialForm';
import LeaveMaster,{LeaveRequests} from './LeaveMaster';
import ShiftMaster from './ShiftMaster';
import AttendanceManagement,{attendanceGroup,attendanceViews} from './AttendanceManagement';
import {Fragment,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Banknote,Bell,Boxes,CalendarDays,ChevronDown,Clock,FileBarChart,Folder,LayoutDashboard,LogOut,Menu,Moon,PanelLeftClose,Search,Settings,ShieldCheck,Sun,UserPlus,Users,X} from 'lucide-react';
import {api,savedSession,type Session,type HRConfig} from './api';
import Logo from './Logo';
import {Records,Approvals,Overview,Audit,AccessAdministration} from './Modules';
import EmployeeLocation from './EmployeeLocation';
import AdditionApprovalPopup from './AdditionApprovalPopup';
import EmployeeMasterRegister from './EmployeeMasterRegister';
import {PM_APPROVALS_PAGE,pmApprovalMenus,isProjectManager,type PmApprovalMenu} from './pmAccess';
import type {JoiningDraft} from './joiningDrafts';
import './modules.css';
import './pulse-leave-workspace.css';
const navItems=[['Dashboard',LayoutDashboard],['Employee Master',Users],['Attendance Management',Clock],['Payroll Management',Banknote],['Asset Management',Boxes],['Calendar',CalendarDays],['Master Configuration',Settings],['Approval Master',ShieldCheck],...managementSections,['Telegram Hierarchy',Settings],['Employee Onboarding',UserPlus],['Employee Directory',Users],['Compliance & Statutory',ShieldCheck],['Reports & MIS',FileBarChart],['Audit Logs',FileBarChart],['Administration & Settings',Settings],['Others',Folder]] as const;
const masterGroups=[{name:'B1 · Company & sites',kinds:['companies','clients','regions','sites']},{name:'B2 · Organization',kinds:['departments','grades','designations']},{name:'B3 · Approval workflows',kinds:['workflows']},{name:'B4 · New employee',kinds:['employees']},{name:'B5 · Staff import',kinds:['employees']},{name:'B6 · Shifts',kinds:['shifts']},{name:'B7 · Holiday & leave',kinds:['holidays','leavePolicies','leaveRequests']},{name:'B8 · Approval matrix',kinds:['approvalRules']}];
function HeaderClock(){
  const[now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer);},[]);
  const time=now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
  const date=[String(now.getDate()).padStart(2,'0'),String(now.getMonth()+1).padStart(2,'0'),String(now.getFullYear()).slice(-2)].join('-');
  return <div className="header-clock" aria-label={`${time}, ${date}`}><strong>{time}</strong><CalendarDays/><span>{date}</span></div>;
}
export default function Workspace({session,initialConfig,logout,leaveOnly=false}:{session:Session;initialConfig:HRConfig;logout:()=>void;leaveOnly?:boolean}){
  const[config,setConfig]=useState(initialConfig.modules),[profile,setProfile]=useState(initialConfig.profile),[page,setPage]=useState(()=>decodeURIComponent(window.location.hash.slice(1))),[kind,setKind]=useState('companies'),[group,setGroup]=useState(0),[error,setError]=useState(''),[collapsed,setCollapsed]=useState(()=>window.innerWidth<=760),[notice,setNotice]=useState('');
  const[autoHide,setAutoHide]=useState(false),[navQuery,setNavQuery]=useState(''),[dayMode,setDayMode]=useState(true);
  const navSearch=useRef<HTMLInputElement>(null);
  const[dashboardTab,setDashboardTab]=useState<DashboardTab>('HR Dashboard');
  const[masterMenu,setMasterMenu]=useState('Shift Master');
  const[expandedMenu,setExpandedMenu]=useState(()=>isProjectManager(initialConfig.profile)?PM_APPROVALS_PAGE:decodeURIComponent(window.location.hash.slice(1))||'Employee Master');
  const workflow=new URLSearchParams(window.location.search).get('hrWorkflow');
  const[employeeMenu,setEmployeeMenuState]=useState(()=>{
    if(workflow==='trial')return 'Trial Form';
    if(workflow==='employee')return 'Employee Management';
    if(workflow==='leave')return 'Leave / OD / Gatepass';
    try{const saved=localStorage.getItem('hrPulse.employeeMenu');return saved==='Leave/OD Management'?'Leave / OD / Gatepass':saved==='Attendance Management'?'Employee Management':saved||'Employee Management';}catch{return 'Employee Management';}
  });
  const setEmployeeMenu=(menu:string)=>{if(menu==='Corporate / HO'||menu==='OB / COAL'){const nextGroup=menu as 'Corporate / HO'|'OB / COAL';setEmployeeGroup(nextGroup);setSelection(current=>{const next={...current,employeeGroup:nextGroup,...(nextGroup==='Corporate / HO'?{site:'',region:''}:{})};saveSelection(next);return next;});return;}setEmployeeMenuState(menu);try{localStorage.setItem('hrPulse.employeeMenu',menu);}catch{/* ignore */}};
  const[attendanceMenu,setAttendanceMenuState]=useState(()=>{try{const saved=localStorage.getItem('hrPulse.attendanceMenu')||'';return attendanceViews.includes(saved)?saved:'Biometric integration';}catch{return 'Biometric integration';}});
  const setAttendanceMenu=(menu:string)=>{setAttendanceMenuState(menu);try{localStorage.setItem('hrPulse.attendanceMenu',menu);}catch{/* ignore */}};
  const[transferTab,setTransferTab]=useState('requests');
  const[selection,setSelection]=useState<TrialSelection>(()=>workflow==='trial'?{...loadSelection(),employeeGroup:'OB / COAL'}:loadSelection()),trialVisible=showsTrialForm(selection);
  useEffect(()=>{if(employeeMenu==='Trial Form'&&!trialVisible)setEmployeeMenu('Employee Management');},[trialVisible]);const updateSelection=(next:TrialSelection)=>{setSelection(next);saveSelection(next);};
  const[payrollMenu,setPayrollMenu]=useState('Salary Scheme');
  const[approvalMenu,setApprovalMenu]=useState<PmApprovalMenu>('Trial Approvals');
  const[employeeGroup,setEmployeeGroup]=useState<'Corporate / HO'|'OB / COAL'>(workflow==='trial'?'OB / COAL':'Corporate / HO');
  /* Owner, 22 Nov 2026 (latest): every HR login (site HR, office HR, regional HR) sees every HRMS menu and sub menu,
     Corporate / HO included, while the HRMS is still being built. Only PM logins keep their approvals-only menu. */
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
  const pmOnly=isProjectManager(profile);const access=new Set(profile.permissions.hrDesktopAccess||[]);const permitted=(pmOnly?[[PM_APPROVALS_PAGE,ShieldCheck] as const]:navItems.filter(([name])=>access.has(name))) as readonly (readonly [string,typeof ShieldCheck])[];
  async function refreshConfig(){const started=performance.now();try{const value=await api<HRConfig>(session.grant,'config');setConfig(value.modules);setProfile(value.profile);setError('');setNotice(`Data loaded. Time taken: ${((performance.now()-started)/1000).toFixed(1)} sec.`);}catch(err){setError((err as Error).message);}}
  useEffect(()=>{const timer=setInterval(()=>void refreshConfig(),60000);return()=>clearInterval(timer);},[session.grant]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{const change=()=>{try{setPage(decodeURIComponent(window.location.hash.slice(1)));}catch{setPage('');}};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{const shortcut=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setCollapsed(false);requestAnimationFrame(()=>navSearch.current?.focus());}};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[]);
  useEffect(()=>{if(permitted.length&&!permitted.some(([name])=>name===page)){const isLegacyMaster=['Shift Management','Holiday & Leave'].includes(page)&&access.has('Master Configuration');if(isLegacyMaster)setMasterMenu(page==='Holiday & Leave'?'Holiday & Leave Master':'Shift Master');const next=isLegacyMaster?'Master Configuration':permitted[0][0];window.location.hash=encodeURIComponent(next);setPage(next);}},[profile,page]);
  function navigate(name:string){window.location.hash=encodeURIComponent(name);setPage(name);setNotice('');if(window.innerWidth<=760)setCollapsed(true);if(name==='Master Configuration'){setGroup(0);setKind('companies');}if(name==='Holiday & Leave')setKind('leaveRequests');}
  const employeePage=['Employee Master','Employee Onboarding','Employee Directory'].includes(page);
  const activeKind=employeePage?'employees':kind;
  const groups=masterGroups[group].kinds.filter(k=>config[k]);
  const initials=profile.name?.split(' ').map(x=>x[0]).slice(0,2).join('')||'HR';
  const registerVisible=access.has('Master Configuration')&&access.has('Employee Master');useEffect(()=>{if(employeeMenu==='Employee Master'&&!registerVisible)setEmployeeMenuState('Employee Management');},[registerVisible,employeeMenu]);
  const childrenFor=(name:string):string[]=>pmOnly?(name===PM_APPROVALS_PAGE?[...pmApprovalMenus]:[]):name==='Dashboard'?[...dashboardTabs]:name==='Employee Master'?['Corporate / HO','OB / COAL',...(trialVisible?['Trial Form']:[]),'Employee Management','Leave / OD / Gatepass','Employee Transfer',...(registerVisible?['Employee Master']:[])]:name==='Attendance Management'?attendanceViews:name==='Payroll Management'?['Salary Scheme','Payroll Processing','Loan and Advances','Expense Claims']:[];
  const query=navQuery.trim().toLowerCase(),visibleMenus=permitted.filter(([name])=>!query||name.toLowerCase().includes(query)||childrenFor(name).some(item=>item.toLowerCase().includes(query)));
  const currentArea=pmOnly?approvalMenu:page==='Employee Master'?employeeMenu:page==='Attendance Management'?attendanceMenu:page||'Dashboard';
  /* PM logins (owner, 21 Nov 2026): approvals only. Trial approvals, new employees waiting at the Site PM step, transfers waiting at the PM step, and the full inbox. */
  const actor=profile.actor||'';
  const pmContent=approvalMenu==='Trial Approvals'?<TrialForm selection={{...selection,employeeGroup:'OB / COAL'}} profile={profile} owner={draftOwner} legacyOwner={legacyTrialOwner}/>
    :approvalMenu==='Employee Verify'?<Approvals key="employees" grant={session.grant} actor={actor} notice={setNotice} kind="employees"/>
    :approvalMenu==='Transfer Approvals'?<Approvals key="transfers" grant={session.grant} actor={actor} notice={setNotice} kind="employeeTransfers"/>
    :<Approvals key="all" grant={session.grant} actor={actor} notice={setNotice}/>;
  if(leaveOnly)return <main className="pulse-leave-workspace"><LeaveRequests grant={session.grant} module={config.leaveRequests} odModule={config.outDutyRequests} gateModule={config.gatePasses} actor={profile.actor||''} canApprove={false} notice={setNotice}/>{notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X/></button></div>}</main>;
  return <div className={'app '+(collapsed?'collapsed ':'')+(autoHide?'auto-hide ':'')+(dayMode?'':'night-mode')}>
   <aside>
    <div className="side-head"><Logo/><button aria-label="Toggle navigation" onClick={()=>setCollapsed(!collapsed)}><Menu/></button></div>
    <div className="sidebar-tools" aria-label="Sidebar controls">
     <div className="sidebar-tool-row">
      <button type="button" onClick={()=>setCollapsed(true)}><PanelLeftClose/>Hide sidebar</button>
      <button type="button" role="switch" aria-checked={autoHide} onClick={()=>setAutoHide(value=>{const next=!value;if(next)setCollapsed(true);return next;})}><span className={'sidebar-switch '+(autoHide?'on':'')}><i/></span>Auto-hide {autoHide?'On':'Off'}</button>
     </div>
     <label className="sidebar-search"><Search/><input ref={navSearch} value={navQuery} onChange={event=>setNavQuery(event.target.value)} placeholder="Smart search…" aria-label="Smart search navigation"/><kbd>Ctrl K</kbd></label>
    </div>
    <nav>{visibleMenus.map(([name,Icon])=>{const children=childrenFor(name),selected=name===PM_APPROVALS_PAGE&&pmOnly?approvalMenu:name==='Dashboard'?dashboardTab:name==='Employee Master'?employeeMenu:name==='Attendance Management'?attendanceMenu:name==='Master Configuration'?masterMenu:payrollMenu,showChildren=children.length>0&&(expandedMenu===name||Boolean(query));return <div className="nav-entry" key={name}><button className={page===name?'active':''} title={name} aria-expanded={children.length?showChildren:undefined} aria-controls={children.length?`submenu-${name.replaceAll(' ','-')}`:undefined} onClick={()=>{if(children.length){setExpandedMenu(expandedMenu===name?'':name);setCollapsed(false);}navigate(name);}}><Icon/><span>{name}</span>{children.length>0&&<ChevronDown className={'chev '+(showChildren?'expanded':'')}/>}</button>{showChildren&&<div id={`submenu-${name.replaceAll(' ','-')}`} className={"master-subnav "+(name==="Attendance Management"?"attendance-subnav":"employee-subnav")} aria-label={`${name} submenus`}>{children.filter(item=>!query||item.toLowerCase().includes(query)||name.toLowerCase().includes(query)).map((item,index,shown)=><Fragment key={item}>{name==='Attendance Management'&&attendanceGroup(item)!==attendanceGroup(shown[index-1]||'')&&<span className="subnav-group" role="presentation">{attendanceGroup(item)}</span>}<button className={page===name&&selected===item?'selected':''} aria-pressed={page===name&&selected===item} onClick={()=>{if(name===PM_APPROVALS_PAGE&&pmOnly)setApprovalMenu(item as PmApprovalMenu);else if(name==='Dashboard')setDashboardTab(item as DashboardTab);else if(name==='Employee Master')setEmployeeMenu(item);else if(name==='Attendance Management')setAttendanceMenu(item);else if(name==='Master Configuration')setMasterMenu(item);else setPayrollMenu(item);setNavQuery('');navigate(name);}}>{item}</button></Fragment>)}</div>}</div>;})}{query&&!visibleMenus.length&&<p className="sidebar-no-results">No matching menu</p>}</nav>
    <div className="side-user"><div className="avatar">{initials}</div><div><strong>{profile.name}</strong><small>{profile.assignedRole}</small></div><button aria-label="Sign out" onClick={logout}><LogOut/></button></div>
   </aside>
   <main className="main">
    <header className="workspace-header">
     {/* The bar measures its own width (styles.css, "Top bar"), so this row can drop words or move the clock down instead of overlapping. */}
     <div className="header-row">
     <div className="header-left">
      <button className="header-menu" aria-label={collapsed?'Show menu':'Hide menu'} title={collapsed?'Show menu':'Hide menu'} onClick={()=>setCollapsed(!collapsed)}><Menu/><span>{collapsed?'Show menu':'Hide menu'}</span></button>
      <button className="header-back" aria-label="Go back" onClick={()=>window.history.back()}><ArrowLeft/></button>
      <div className="header-breadcrumbs"><span>Operations</span><ChevronDown/><strong title={currentArea}>{currentArea}</strong></div>
      <button className="header-signout" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut/><span>Sign out</span></button>
     </div>
     <HeaderClock/>
     <div className="header-utilities">
      <button className="day-toggle" type="button" aria-pressed={!dayMode} onClick={()=>setDayMode(value=>!value)}><span className="day-scene" aria-hidden="true">{dayMode?<Sun/>:<Moon/>}<i/></span><span>{dayMode?'Day':'Night'}</span></button>
      <button type="button" aria-label="Search menus" onClick={()=>{setCollapsed(false);requestAnimationFrame(()=>navSearch.current?.focus());}}><Search/></button>
      <button type="button" aria-label="Open employee directory" onClick={()=>access.has('Employee Directory')?navigate('Employee Directory'):setNotice('Employee Directory access is not assigned.')}><Folder/></button>
      <button type="button" aria-label="Notifications" onClick={()=>setNotice('No new notifications.')}><Bell/></button>
     </div>
     </div>
    </header>
    <div className="content">{pmOnly?pmContent:<>{page==='Master Configuration'&&<section className="master-configuration" aria-label="Master Configuration">
      <div className="module-tabs" aria-label="Master configuration menus">
        {['Shift Master','Holiday & Leave Master','Trial Hierarchy'].map(item=><button type="button" key={item} className={masterMenu===item?'selected':''} aria-pressed={masterMenu===item} onClick={()=>setMasterMenu(item)}>{item}</button>)}
      </div>
      {masterMenu==='Shift Master'?<ShiftMaster grant={session.grant} module={config.shifts}/>
        :masterMenu==='Trial Hierarchy'?<HierarchyMaster grant={session.grant}/>
        :masterMenu==='Holiday & Leave Master'?<LeaveMaster grant={session.grant} config={config} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={setNotice}/>
        :null}
    </section>} {page==='Employee Master'&&<>{employeeMenu==='Employee Master'&&registerVisible&&<EmployeeMasterRegister grant={session.grant}/>}{employeeMenu==='Leave / OD / Gatepass'&&<LeaveRequests grant={session.grant} module={config.leaveRequests} odModule={config.outDutyRequests} gateModule={config.gatePasses} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={setNotice}/>} {employeeMenu==='Employee Transfer'&&<section className="transfer-management" aria-labelledby="employee-transfer-title">
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
    </section>}{employeeMenu==='Employee Management'&&<EmployeeLocation canApprove={access.has('Approval Management')} draftOwner={draftOwner} initialTrialDraft={trialDraft} onTrialDraftOpened={()=>setTrialDraft(undefined)} grant={session.grant} module={config.employees} notice={setNotice} employeeGroup={employeeGroup} onEmployeeGroupChange={setEmployeeGroup} onSelectionChange={updateSelection}/>}{employeeMenu==='Trial Form'&&<TrialForm selection={selection} owner={draftOwner} legacyOwner={legacyTrialOwner} onPassed={openTrialJoining}/>}</>} {page==='Attendance Management'&&permitted.some(([name])=>name===page)&&<AttendanceManagement grant={session.grant} view={attendanceMenu} onNavigate={setAttendanceMenu} shiftModule={config.shifts} config={config} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={setNotice}/>}{page!=='Employee Master'&&page!=='Master Configuration'&&page!=='Attendance Management'&&<><div className="page-title"><div><p>{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p><h1>{page||'HR workspace'}</h1>{!isManagementSection(page)&&<small>View employee records and pending approvals.</small>}</div></div>{error&&<div className="error" role="alert">{error} <button onClick={()=>void refreshConfig()}>Retry connection</button></div>}{!permitted.length?<p>No HR menus are assigned. Contact your Pulse administrator.</p>:<>
    {page==='Approval Master'&&<ApprovalMaster grant={session.grant}/>}
    {isManagementSection(page)&&permitted.some(([name])=>name===page)&&<ManagementModules key={page} section={page} config={config} grant={session.grant} notice={setNotice}/>}
    {page==='Telegram Hierarchy'&&<TelegramHierarchy grant={session.grant}/>}
    {page==='Dashboard'&&<Dashboard tab={dashboardTab} select={setDashboardTab} grant={session.grant} actor={profile.actor||''} notice={setNotice} canSeeEmployees={Boolean(config.employees)} canSeeAttendance={access.has('Employee Master')} canApprove={access.has('Approval Management')} onEmployees={()=>navigate('Employee Directory')} showEmployees={access.has('Employee Directory')}/>}
    {page==='Reports & MIS'&&<Overview grant={session.grant} report onEmployees={()=>navigate('Employee Directory')} showEmployees={access.has('Employee Directory')}/>}
    {page==='Master Configuration'&&<><div className="module-tabs master-groups">{masterGroups.map((g,i)=>g.kinds.some(k=>config[k])&&<button key={g.name} className={group===i?'selected':''} onClick={()=>{setGroup(i);setKind(g.kinds.find(k=>config[k])||'');}}>{g.name}</button>)}</div><div className="module-tabs">{groups.map(k=><button key={k} className={kind===k?'selected':''} onClick={()=>setKind(k)}>{config[k].title}</button>)}</div></>}
    {page==='Payroll Management'&&<>{payrollMenu==='Salary Scheme'?<SalarySchemeMaster actor={profile.actor||''} canApprove={access.has('Approval Management')}/>:payrollMenu==='Payroll Processing'?<PayrollProcessing grant={session.grant}/>:<ModuleLanding title={payrollMenu}/>}</>}
    {page==='Asset Management'&&<AssetManagement grant={session.grant} config={config} notice={setNotice}/>}
    {page==='Calendar'&&<HRCalendar grant={session.grant} config={config}/>}
    {page==='Holiday & Leave'&&<><p className="help-text">Leave entitlement uses calendar days, including weekends and holidays. Split requests at the calendar-year boundary.</p><div className="module-tabs">{['leaveRequests','holidays','leavePolicies'].filter(k=>config[k]).map(k=><button key={k} className={kind===k?'selected':''} onClick={()=>setKind(k)}>{config[k].title}</button>)}</div></>}
    {(employeePage||['Master Configuration','Holiday & Leave'].includes(page))&&config[activeKind]&&<Records key={page+activeKind+group} grant={session.grant} kind={activeKind} module={config[activeKind]} readOnly={page==='Employee Directory'} allowDelete={page==='Employee Onboarding'||page==='Employee Directory'} importFirst={page==='Master Configuration'&&group===4} notice={setNotice}/>}
    {page==='Approval Management'&&<Approvals grant={session.grant} actor={profile.actor||''} notice={setNotice}/>}
    {(page==='Administration & Settings'||page==='Compliance & Statutory')&&permitted.some(([name])=>name===page)&&
      <SettingsRegisters key={page} page={page} grant={session.grant} profile={profile} modules={config} notice={setNotice}/>}
    {page==='Audit Logs'&&<Audit grant={session.grant}/>}
    {page==='Administration'&&<AccessAdministration grant={session.grant} profile={profile} modules={config} notice={setNotice}/>}
    </>}</>}</>}</div>{access.has('Approval Management')&&<AdditionApprovalPopup grant={session.grant} actor={profile.actor||''} onOpenApprovals={()=>{if(pmOnly)setApprovalMenu('Employee Verify');navigate('Approval Management');}}/>}{notice&&(page!=='Master Configuration'||masterMenu==='Holiday & Leave Master')&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><X/></button></div>}</main></div>;
}

function ModuleLanding({title}:{title:string}){return <section className="data-card"><h2>{title}</h2><div className="empty"><h3>Module setup pending</h3><p>This menu is ready. The management workflow is not yet configured.</p></div></section>;}
