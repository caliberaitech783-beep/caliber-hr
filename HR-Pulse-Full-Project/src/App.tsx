import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {api,pulse,clearSession,savedSession,type Session,type HRConfig} from './api';
import HrLogin from './HrLogin';
import {inPulseII} from './hr-paths';
import {cleanSsoAddress,finishPulseSignIn,isCaliberOneSignOut,markSignedOut,pulseSignInUrl,ssoAllowed,ssoStep,type SsoStep} from './pulse-sso';

const loadWorkspace=()=>import('./Workspace');
const Workspace=lazy(loadWorkspace);

const pulseOrigin = 'https://pulse.cmll.in';
const embedded = window.parent !== window && new URLSearchParams(window.location.search).get('embedded') === 'pulse';
const leaveOnly = embedded && new URLSearchParams(window.location.search).get('mode') === 'leave';
// Caliber One, one sign-in: with no saved HR sign-in, HR Pulse first asks Pulse (pulse-sso.ts).
const ssoPlace=()=>({origin:window.location.origin,search:window.location.search,embedded,inPulseII});
const goToPulse=()=>void pulseSignInUrl(sessionStorage).then(url=>window.location.replace(url));

export default function App(){
  const[session,setSession]=useState(savedSession);
  const[sso,setSso]=useState<SsoStep>(()=>savedSession()?.grant?{kind:'form'}:ssoStep(ssoPlace(),sessionStorage));
  const[ssoNotice,setSsoNotice]=useState(()=>sso.kind==='form'&&sso.reason==='noaccess'?'HR access is not assigned to your Pulse account.':'');
  const[config,setConfig]=useState<HRConfig>();
  const[error,setError]=useState('');
  const[attempt,setAttempt]=useState(0);
  const pending=useRef<{grant:string;attempt:number;request:Promise<HRConfig>}|undefined>(undefined);

  useEffect(()=>{
    if(!leaveOnly)return;
    const receive=(event:MessageEvent)=>{
      if(event.origin!==pulseOrigin||event.source!==window.parent||event.data?.type!=='caliber-pulse:hr-session'||event.data?.mode!=='leave')return;
      const next=event.data.session as Session;
      if(!/^[A-Za-z0-9_-]{43}$/.test(next?.grant||'')||next?.profile?.permissions?.application!=='HR'||next?.profile?.permissions?.leaveOnly!==true)return;
      clearSession();sessionStorage.setItem('hrPulseSession',JSON.stringify(next));pending.current=undefined;setError('');setConfig(undefined);setSession(next);
    };
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'caliber-hr:ready',mode:'leave'},pulseOrigin);
    return()=>window.removeEventListener('message',receive);
  },[]);

  useEffect(() => {
    if (embedded) window.parent.postMessage({type: 'caliber-hr:workspace', open: Boolean(session?.grant)}, pulseOrigin);
  }, [session?.grant]);

  useEffect(()=>{
    // An expired HR sign-in asks Pulse again (at most once a minute) before showing the form.
    const expired=()=>{setConfig(undefined);setSession(null);setSso(ssoStep(ssoPlace(),sessionStorage));};
    window.addEventListener('hr-session-expired',expired);
    return()=>window.removeEventListener('hr-session-expired',expired);
  },[]);

  useEffect(()=>{
    if(sso.kind==='start'){goToPulse();return;}
    if(new URLSearchParams(window.location.search).has('hrCode')||new URLSearchParams(window.location.search).has('hrSso'))window.history.replaceState(null,'',cleanSsoAddress(window.location.href));
    if(sso.kind!=='exchange')return;
    let active=true;
    finishPulseSignIn(sso.code,sso.state,sessionStorage).then(next=>{
      if(!active)return;
      clearSession();sessionStorage.setItem('hrPulseSession',JSON.stringify(next));
      pending.current=undefined;setError('');setSsoNotice('');setSession(next);setSso({kind:'form'});
    }).catch(err=>{if(active){setSsoNotice(err instanceof Error?err.message:'Pulse could not open HR Pulse. Sign in below.');setSso({kind:'form'});}});
    return()=>{active=false;};
  },[sso]);

  // Caliber One's "Sign out all" signs this tab out exactly as the Sign out button does.
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{if(isCaliberOneSignOut(event))logout();};
    window.addEventListener('message',receive);
    return()=>window.removeEventListener('message',receive);
  },[session]);

  useEffect(()=>{
    if(!session?.grant)return;
    let active=true;
    const {grant}=session;
    void loadWorkspace().catch(()=>{});
    if(pending.current?.grant!==grant||pending.current.attempt!==attempt){
      pending.current={grant,attempt,request:api<HRConfig>(grant,'config')};
    }
    pending.current.request.then(value=>{
      if(!active)return;
      if(value.profile?.permissions?.application!=='HR')throw new Error('HR access is not assigned to this account.');
      setConfig(value);
    }).catch(err=>{if(active)setError(err instanceof Error?err.message:'Unable to load your HR workspace.');});
    return()=>{active=false;};
  },[session,attempt]);

  function logout(){
    const grant=session?.grant;
    pending.current=undefined;
    clearSession();
    markSignedOut(sessionStorage);
    setSession(null);
    setConfig(undefined);
    setError('');
    if(grant)void pulse('logout',{grant}).catch(()=>{});
  }

  if(!session?.grant&&!leaveOnly&&sso.kind!=='form')return <div className="loading-screen" role="status">Signing in through Pulse…</div>;
  if(!session?.grant)return leaveOnly?<div className="loading-screen" role="status">Opening your HR workspace…</div>:<HrLogin embedded={embedded} preload={loadWorkspace} notice={ssoNotice} onPulse={ssoAllowed(ssoPlace())?goToPulse:undefined} onLogin={next=>{pending.current=undefined;setError('');setSsoNotice('');setSession(next);}}/>;
  const opening=<div className="loading-screen" role="status">Opening your HR workspace…</div>;
  if(error)return <div className="loading-screen"><p role="alert">{error}</p><button onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry connection</button> <button onClick={logout}>Sign out</button></div>;
  return config?<Suspense fallback={opening}><Workspace session={session} initialConfig={config} logout={logout} leaveOnly={leaveOnly}/></Suspense>:opening;
}
