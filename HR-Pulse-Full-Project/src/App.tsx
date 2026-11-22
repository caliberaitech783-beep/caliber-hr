import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {api,pulse,clearSession,savedSession,type Session,type HRConfig} from './api';
import HrLogin from './HrLogin';
import SiteHRWorkspace,{isSiteHRManager} from './SiteHRWorkspace';

const loadWorkspace=()=>import('./Workspace');
const Workspace=lazy(loadWorkspace);

const pulseOrigin = 'https://pulse.cmll.in';
const embedded = window.parent !== window && new URLSearchParams(window.location.search).get('embedded') === 'pulse';
const leaveOnly = embedded && new URLSearchParams(window.location.search).get('mode') === 'leave';

export default function App(){
  const[session,setSession]=useState(savedSession);
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
    const expired=()=>{setConfig(undefined);setSession(null);};
    window.addEventListener('hr-session-expired',expired);
    return()=>window.removeEventListener('hr-session-expired',expired);
  },[]);

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
    setSession(null);
    setConfig(undefined);
    setError('');
    if(grant)void pulse('logout',{grant}).catch(()=>{});
  }

  if(!session?.grant)return <HrLogin embedded={embedded} preload={loadWorkspace} onLogin={next=>{pending.current=undefined;setError('');setSession(next);}}/>;
  const opening=<div className="loading-screen" role="status">Opening your HR workspace…</div>;
  if(error)return <div className="loading-screen"><p role="alert">{error}</p><button onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry connection</button> <button onClick={logout}>Sign out</button></div>;
  return config?<Suspense fallback={opening}>{!leaveOnly&&isSiteHRManager(config.profile)?<SiteHRWorkspace profile={config.profile} session={session} logout={logout}/>:<Workspace session={session} initialConfig={config} logout={logout} leaveOnly={leaveOnly}/>}</Suspense>:opening;
}
