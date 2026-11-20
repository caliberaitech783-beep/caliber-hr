import {useState} from 'react';
import type {HRConfig} from './api';
import {Audit,Records} from './Modules';
import ApprovalMaster from './ApprovalMaster';
import ShiftMaster from './ShiftMaster';
import LeaveMaster from './LeaveMaster';
import TelegramHierarchy from './TelegramHierarchy';

type Props = HRConfig & {page:string; grant:string; notice:(message:string)=>void};

export default function SettingsRegisters({page,grant,profile,modules,notice}:Props){
  const [choice,setChoice]=useState('');
  const access=new Set(profile.permissions.hrDesktopAccess||[]);
  const compliance=page==='Compliance & Statutory';
  const chips: [string,string,boolean][] = compliance
    ? Object.entries(modules).filter(([,module])=>module.menu===page).map(([kind,module])=>[kind,module.title,true])
    : [
      ['companies','Company master',!!modules.companies],
      ['sites','Location & site master',!!modules.sites],
      ['departments','Department master',!!modules.departments],
      ['designations','Designation master',!!modules.designations],
      ['policy','Shift & leave policy',!!(modules.shifts||modules.leavePolicies)],
      ['approvals','Approval hierarchy',access.has('Approval Master')],
      ['roles','User & role management',true],
      ['access','Access permission',true],
      ['audit','Audit trail',access.has('Audit Logs')],
      ['notifications','Notification setting',true],
      ['telegram','Telegram setting',true]
    ];
  const selected=chips.find(([key,,allowed])=>key===choice&&allowed)??chips.find(([,,allowed])=>allowed);
  const key=selected?.[0];
  return <>
    <section className="data-card" aria-label={page}>
      <div className="payroll-workflows" role="group" aria-label={page+' modules'}>
        {chips.map(([id,title,allowed])=><button key={id} type="button" disabled={!allowed}
          title={allowed?undefined:'Requires additional Pulse access'} aria-pressed={id===key}
          onClick={()=>setChoice(id)}>{title}</button>)}
      </div>
      {!selected&&<p>No modules are available for your account.</p>}
    </section>
    {key&&modules[key]&&<Records key={key} kind={key} grant={grant} module={modules[key]} notice={notice}/>}
    {key==='policy'&&<>
      {modules.shifts&&<ShiftMaster grant={grant} module={modules.shifts}/>}
      {modules.leavePolicies&&<LeaveMaster grant={grant} config={modules} actor={profile.actor||''} canApprove={access.has('Approval Management')} notice={notice}/>}
    </>}
    {key==='approvals'&&<ApprovalMaster grant={grant}/>}
    {key==='roles'&&<section className="data-card"><h2>User &amp; role management</h2>
      <p>Caliber Pulse manages HR user accounts and role assignments.</p>
      <a href="https://pulse.cmll.in" target="_blank" rel="noreferrer">Manage users and roles in Caliber Pulse ↗</a></section>}
    {key==='access'&&<section className="data-card"><h2>Access permission</h2>
      <dl><dt>User</dt><dd>{profile.name}</dd><dt>Assigned role</dt><dd>{profile.assignedRole||'Assigned in Pulse'}</dd>
      <dt>Desktop menus</dt><dd>{profile.permissions.hrDesktopAccess?.join(', ')||'None assigned'}</dd>
      <dt>Mobile menus</dt><dd>{profile.permissions.hrMobileAccess?.join(', ')||'None assigned'}</dd></dl>
      <a href="https://pulse.cmll.in" target="_blank" rel="noreferrer">Manage access in Caliber Pulse ↗</a></section>}
    {key==='audit'&&<Audit grant={grant}/>}
    {key==='notifications'&&<TelegramHierarchy key={key} grant={grant} accountOnly/>}
    {key==='telegram'&&<TelegramHierarchy key={key} grant={grant}/>}
  </>;
}
