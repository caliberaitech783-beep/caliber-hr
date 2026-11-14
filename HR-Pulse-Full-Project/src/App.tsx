import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowRight,Building2,Eye,EyeOff,LockKeyhole,ShieldCheck,Users} from 'lucide-react';
import {api,pulse,clearSession,savedSession,type Session,type HRConfig} from './api';
import Logo from './Logo';

const loadWorkspace=()=>import('./Workspace');
const Workspace=lazy(loadWorkspace);

function Login({onLogin}:{onLogin:(s:Session)=>void}){
  const[show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <div className="login-shell"><section className="login-brand"><Logo/><div className="grid-art"/><div className="brand-copy"><small>CALIBER · PEOPLE & OPERATIONS</small><h1>Your people.<br/><em>One connected workspace.</em></h1><p>Manage employees, approvals and everyday HR with a shared Caliber Pulse account.</p></div><div className="trust-row"><span><ShieldCheck/>Access controlled</span><span><Building2/>Multi-site operations</span></div></section><section className="login-panel"><form className="login-card" onSubmit={async e=>{e.preventDefault();const data=new FormData(e.currentTarget);setBusy(true);setError('');void loadWorkspace().catch(()=>{});try{const result=await pulse('authenticate',{username:data.get('username'),password:data.get('password')});if(!/^[A-Za-z0-9_-]{43}$/.test(result.grant)||result.profile?.permissions?.application!=='HR')throw new Error('HR access is not assigned to this account');clearSession();(data.get('remember')?localStorage:sessionStorage).setItem('hrPulseSession',JSON.stringify(result));onLogin(result);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><div className="mobile-logo"><Logo/></div><span className="overline">WELCOME TO HR</span><h2>Sign in to your workspace</h2><p className="muted">Use your Caliber Pulse credentials.</p><label htmlFor="username">Username</label><div className="input-wrap"><Users/><input id="username" name="username" required autoComplete="username"/></div><div className="label-row"><label htmlFor="password">Password</label></div><div className="input-wrap"><LockKeyhole/><input id="password" name="password" type={show?'text':'password'} required autoComplete="current-password"/><button type="button" aria-label="Toggle password" onClick={()=>setShow(!show)}>{show?<EyeOff/>:<Eye/>}</button></div><label className="remember"><input type="checkbox" name="remember"/>Keep me signed in</label>{error&&<p role="alert" className="error">{error}</p>}<button className="sign-in" disabled={busy}>{busy?'Signing in…':'Sign in'}<ArrowRight/></button><div className="secure-note"><ShieldCheck/>Shared Caliber Pulse authentication</div><footer>HR · Caliber<br/>Contact your Pulse administrator for account access.</footer></form></section></div>;
}

export default function App(){
  const[session,setSession]=useState(savedSession);
  const[config,setConfig]=useState<HRConfig>();
  const[error,setError]=useState('');
  const[attempt,setAttempt]=useState(0);
  const pending=useRef<{grant:string;attempt:number;request:Promise<HRConfig>}|undefined>(undefined);

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

  if(!session?.grant)return <Login onLogin={next=>{pending.current=undefined;setError('');setSession(next);}}/>;
  const opening=<div className="loading-screen" role="status">Opening your HR workspace…</div>;
  if(error)return <div className="loading-screen"><p role="alert">{error}</p><button onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry connection</button> <button onClick={logout}>Sign out</button></div>;
  return config?<Suspense fallback={opening}><Workspace session={session} initialConfig={config} logout={logout}/></Suspense>:opening;
}
