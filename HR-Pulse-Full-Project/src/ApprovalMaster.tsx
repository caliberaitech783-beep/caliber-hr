import {useState} from 'react';
import HierarchyMaster from './HierarchyMaster';
import TelegramHierarchy from './TelegramHierarchy';
import {ODApprovalHierarchy} from './LeaveMaster';

export default function ApprovalMaster({grant}:{grant:string}){
 const[tab,setTab]=useState('Hierarchy');
 return <>
  <div className="module-tabs" aria-label="Approval Master setup">
   {['Hierarchy','Leave','OD'].map(name=><button key={name} type="button" className={tab===name?'selected':''} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}
  </div>
  {tab==='Hierarchy'&&<HierarchyMaster grant={grant}/>}
  {tab==='Leave'&&<section aria-label="Leave approval hierarchy"><h2>Leave Approval Hierarchy</h2><TelegramHierarchy grant={grant}/></section>}
  {tab==='OD'&&<section className="data-card"><h2>OD Approval Hierarchy</h2><ODApprovalHierarchy/><p>This is the existing OD approval route. It applies when an OD form is submitted.</p></section>}
 </>;
}
