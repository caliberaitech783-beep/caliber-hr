import TrialForm,{loadSelection,pulseTrialSites} from './TrialForm';
import type {Profile,Session} from './api';
import AdditionApprovalPopup from './AdditionApprovalPopup';

export function isSiteHRManager(profile:Profile){
 const role=String(profile.assignedRole||'').toLowerCase().replace(/[^a-z]+/g,' ').trim();
 return /\bhr\b/.test(role)&&/\bmanager\b/.test(role)&&pulseTrialSites(profile.permissions.site,profile.permissions.adminLevel)!==null;
}

export default function SiteHRWorkspace({profile,session,logout}:{profile:Profile;session:Session;logout:()=>void}){
 const selection={...loadSelection(),employeeGroup:'OB / COAL' as const,company:loadSelection().company||'Caliber Mining And Logistics Ltd'};
 const owner=profile.actor||profile.username||profile.email||'';
 const legacyOwner=session.profile.actor||session.profile.username||session.profile.email;
 return <main className="site-hr-workspace" style={{padding:20}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><strong>{profile.name}</strong><button onClick={logout}>Sign out</button></div>
  <TrialForm selection={selection} profile={profile} owner={owner} legacyOwner={legacyOwner}/>
  {[...(profile.permissions.hrDesktopAccess||[]),...(profile.permissions.hrMobileAccess||[])].includes('Approval Management')&&<AdditionApprovalPopup grant={session.grant} actor={profile.actor||''}/>}
 </main>;
}
