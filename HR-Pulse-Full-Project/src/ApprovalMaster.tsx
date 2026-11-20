import {useState} from 'react';
import HierarchyMaster from './HierarchyMaster';
import TransferFlowMaster from './TransferFlowMaster';
import {JoiningApproverMaster} from './JoiningApproval';
import {TrialRecipients} from './TrialForm';
import TelegramHierarchy from './TelegramHierarchy';
import TrialStatusBotLinks from './TrialStatusBotLinks';
import LeaveRequestBotLinks from './LeaveRequestBotLinks';

export default function ApprovalMaster({grant}:{grant:string}){
 const[tab,setTab]=useState('Trial Hierarchy');
 return <>
  <div className="module-tabs" aria-label="Approval Master setup">
   {['Trial Hierarchy','Leave','Leave Request bot','OD','Employee Transfer','Joining Approval','Trial Status bot','Trial Form'].map(name=><button key={name} type="button" className={tab===name?'selected':''} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}
  </div>
  {tab==='Trial Hierarchy'&&<HierarchyMaster grant={grant}/>}
  {tab==='Leave'&&<section aria-label="Leave approval hierarchy"><h2>Leave Approval Flow</h2><p className="help-text">One route for every site and office: <b>Employee raises the leave → HOD (concerned) → Directors (approve by OTP) → Regional HR (final approval)</b>. Messages go out on the CALIBER Leave Request bot, only to the next step.</p><TelegramHierarchy grant={grant} leaveOnly/></section>}
  {tab==='Leave Request bot'&&<LeaveRequestBotLinks grant={grant}/>}
  {tab==='OD'&&<section aria-label="OD approval hierarchy"><h2>OD Approval Flow</h2><p className="help-text">Two routes: <b>Office</b> – Employee initiates → HOD (concerned) → Regional HR. <b>Site</b> – HR Manager (site) initiates → HOD (concerned) → Regional HR.</p><TelegramHierarchy grant={grant} leaveOnly kind="od"/></section>}
  {tab==='Employee Transfer'&&<TransferFlowMaster grant={grant}/>}
  {tab==='Joining Approval'&&<JoiningApproverMaster grant={grant}/>}
  {tab==='Trial Status bot'&&<TrialStatusBotLinks grant={grant}/>}
  {tab==='Trial Form'&&<section className="data-card" aria-label="Trial form Telegram recipients"><h2>Trial Form – Telegram recipients</h2><p className="help-text">Every trial step goes out on the CALIBER Trial Status bot, only to the next person of that site in Approval Master › Trial Hierarchy (Site HR → Driver Trainer → PM → Office HR → Regional HR → Directors). The people listed below get only the final “Cleared to join” message. Connect people on the Trial Status bot tab.</p><TrialRecipients stage="part1"/><TrialRecipients stage="result"/></section>}
 </>;
}
