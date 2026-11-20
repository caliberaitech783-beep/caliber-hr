import {inPulseII} from './hr-paths';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {api,pulse,clearSession,savedSession,type Session,type HRConfig} from './api';
import HrLogin from './HrLogin';
import SiteHRWorkspace,{isSiteHRManager} from './SiteHRWorkspace';

const loadWorkspace=()=>import('./Workspace');
const Workspace=lazy(loadWorkspace);

const pulseOrigin = 'https://pulse.cmll.in';
const embedded = window.parent !== window && new URLSearchParams(window.location.search).get('embedded') === 'pulse';

function startPulseSignIn(){
  sessionStorage.setItem('pulseIIOpenHr','1');
  window.location.assign('/api/mis-credentials/start');
}

async function openSharedHr():Promise<Session|null>{
  const stored=localStorage.getItem('nerveCenterSession')||sessionStorage.getItem('nerveCenterSession')||'null';
  let token:string|undefined;
  try{token=JSON.parse(stored)?.token;}catch{return null;}
  if(!token)return null;
  const headers:Record<string,string>={Authorization:'Bearer '+token};
  const context=/^browser-session\.([A-Za-z0-9_-]{16})$/.exec(token)?.[1];
  const csrfPrefix='__Host-mis_csrf'+(context?'_'+context:'')+'=';
  const csrf=document.cookie.split(';').map(cookie=>cookie.trim()).find(cookie=>cookie.startsWith(csrfPrefix));
  if(csrf)headers['X-CSRF-Token']=csrf.slice(csrfPrefix.length);
  const response=await fetch('/api/hr-workspace/session',{method:'POST',headers,cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(response.status===401)return null;
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'HR sign-in is temporarily unavailable.');
  if(!/^[A-Za-z0-9_-]{43}$/.test(data.grant)||data.profile?.permissions?.application!=='HR')throw Error('Pulse did not authorize HR access.');
  return data;
}

export default function App(){
  const[session,setSession]=useState(()=>inPulseII?null:savedSession());
  const[config,setConfig]=useState<HRConfig>();
  const[error,setError]=useState('');
  const[attempt,setAttempt]=useState(0);
  const pending=useRef<{grant:string;attempt:number;request:Promise<HRConfig>}|undefined>(undefined);

  const [openingShared,setOpeningShared]=useState(inPulseII);
  const sharedRequest=useRef<{attempt:number;request:Promise<Session|null>}|undefined>(undefined);

  useEffect(()=>{
    if(!inPulseII||session)return;
    let active=true;
    setOpeningShared(true);
    if(sharedRequest.current?.attempt!==attempt)sharedRequest.current={attempt,request:openSharedHr()};
    sharedRequest.current.request.then(next=>{
      if(!active)return;
      if(next){setError('');setSession(next);}
      else if(new URLSearchParams(window.location.search).get('signin')==='1')startPulseSignIn();
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to open HR.');})
      .finally(()=>{if(active)setOpeningShared(false);});
    return()=>{active=false;};
  },[session,attempt]);

  useEffect(() => {
    if (embedded) window.parent.postMessage({type: 'caliber-hr:workspace', open: Boolean(session?.grant)}, pulseOrigin);
  }, [session?.grant]);

  useEffect(()=>{
    const expired=()=>{setConfig(undefined);setSession(null);if(inPulseII)setAttempt(value=>value+1);};
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
    if(inPulseII){window.location.assign('/');return;}
    if(grant)void pulse('logout',{grant}).catch(()=>{});
  }

  if(inPulseII&&!session?.grant){
    if(openingShared)return <main className="loading-screen" role="status">Opening HR in Pulse-II…</main>;
    return <main className="loading-screen"><div>
      <h1>HR · Caliber Pulse-II</h1>
      {error&&<p role="alert">{error}</p>}
      {error?<button onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry connection</button>:
        <button onClick={startPulseSignIn}>Sign in with Pulse</button>}
      {' '}<a href="/">Back to MIS</a>
    </div></main>;
  }
  if(!session?.grant)return <HrLogin embedded={embedded} preload={loadWorkspace} onLogin={next=>{pending.current=undefined;setError('');setSession(next);}}/>;
  const opening=<div className="loading-screen" role="status">Opening your HR workspace…</div>;
  if(error)return <div className="loading-screen"><p role="alert">{error}</p><button onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry connection</button> <button onClick={logout}>Sign out</button></div>;
  return config?<Suspense fallback={opening}>{isSiteHRManager(config.profile)?<SiteHRWorkspace profile={config.profile} session={session} logout={logout}/>:<Workspace session={session} initialConfig={config} logout={logout}/>}</Suspense>:opening;
}
