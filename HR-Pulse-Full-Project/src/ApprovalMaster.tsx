import {useState} from 'react';
import HierarchyMaster from './HierarchyMaster';
import TelegramHierarchy from './TelegramHierarchy';

export default function ApprovalMaster({grant}:{grant:string}){
 const[tab,setTab]=useState('Hierarchy');
 return <>
  <div className="module-tabs" aria-label="Approval Master setup">
   {['Hierarchy','Leave','OD','Employee Transfer'].map(name=><button key={name} type="button" className={tab===name?'selected':''} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}
  </div>
  {tab==='Hierarchy'&&<HierarchyMaster grant={grant}/>}
  {tab==='Leave'&&<section aria-label="Leave approval hierarchy"><h2>Leave Approval Flow</h2><p className="help-text">Two routes: <b>Office</b> – Employee → HOD (concerned) → Directors → Regional HR. <b>Site</b> – HR Manager initiates → HOD (concerned) → PM Sir → Regional HR → Directors.</p><TelegramHierarchy grant={grant} leaveOnly/></section>}
  {tab==='OD'&&<section aria-label="OD approval hierarchy"><h2>OD Approval Flow</h2><p className="help-text">Two routes: <b>Office</b> – Employee initiates → HOD (concerned) → Regional HR. <b>Site</b> – HR Manager (site) initiates → HOD (concerned) → Regional HR.</p><TelegramHierarchy grant={grant} leaveOnly kind="od"/></section>}
  {tab==='Employee Transfer'&&<section className="data-card" aria-label="Employee transfer approval"><h2>Employee Transfer – Approval sequence</h2><ol><li>Site HR (from location)</li><li>PM (from location)</li><li>Office HR</li><li>Regional HR Head</li><li>Director</li></ol><p>Approver usernames must be configured before routing can be enabled. Saving a transfer draft does not change the employee's posting.</p></section>}
 </>;
}
