import {useState} from 'react';
import HierarchyMaster from './HierarchyMaster';
import TelegramHierarchy from './TelegramHierarchy';

export default function ApprovalMaster({grant}:{grant:string}){
 const[tab,setTab]=useState('Hierarchy');
 return <>
  <div className="module-tabs" aria-label="Approval Master setup">
   {['Hierarchy','Leave','OD'].map(name=><button key={name} type="button" className={tab===name?'selected':''} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}
  </div>
  {tab==='Hierarchy'&&<HierarchyMaster grant={grant}/>}
  {tab==='Leave'&&<section aria-label="Leave approval hierarchy"><h2>Leave Approval Flow</h2><p className="help-text">Two routes: <b>Office</b> – Employee → HOD (concerned) → Directors → Regional HR. <b>Site</b> – HR Manager initiates → HOD (concerned) → PM Sir → Regional HR → Directors.</p><TelegramHierarchy grant={grant} leaveOnly/></section>}
  {tab==='OD'&&<section aria-label="OD approval hierarchy"><h2>OD Approval Flow</h2><p className="help-text">Two routes: <b>Office</b> – Employee initiates → HOD (concerned) → Regional HR. <b>Site</b> – HR Manager (site) initiates → HOD (concerned) → Regional HR.</p><TelegramHierarchy grant={grant} leaveOnly kind="od"/></section>}
 </>;
}
