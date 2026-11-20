import {hrAsset,inPulseII} from './hr-paths';
import {useState, type FormEvent} from 'react';
import {ArrowRight, Eye, EyeOff, FileBarChart, FileText, LockKeyhole, Moon, ShieldCheck, Sun, TriangleAlert, Truck, User, Users} from 'lucide-react';
import {clearSession, pulse, type Session} from './api';
import './hr-login.css';

const pulsePortal = 'https://pulse.cmll.in';
const standalonePortals = [
  {name: 'Fleet', href: pulsePortal, Icon: Truck},
  {name: 'Accident', href: 'https://bdms.cmll.in', Icon: TriangleAlert},
  {name: 'Tender', href: 'https://tender.cmll.in', Icon: FileText},
  {name: 'MIS', href: inPulseII ? '/' : 'https://pulse-ll.cmll.in/api/mis-credentials/start', Icon: FileBarChart},
];

const portals = inPulseII ? standalonePortals.filter(portal => portal.name === 'MIS') : standalonePortals;

export default function HrLogin({onLogin, preload, embedded, notice}: {onLogin: (session: Session) => void; preload: () => Promise<unknown>; embedded: boolean; notice?: string}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [night, setNight] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    void preload().catch(() => {});
    try {
      const result = await pulse('authenticate', {username: data.get('username'), password: data.get('password')});
      if (!/^[A-Za-z0-9_-]{43}$/.test(result.grant) || result.profile?.permissions?.application !== 'HR') {
        throw new Error('HR access is not assigned to this account');
      }
      clearSession();
      (data.get('remember') ? localStorage : sessionStorage).setItem('hrPulseSession', JSON.stringify(result));
      onLogin(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="hr-login" data-embedded={embedded || undefined} data-theme={night ? 'night' : 'day'}>
    {!embedded && <aside className="hr-login-visual">
      <img className="hr-login-logo" src={hrAsset("pulse-logo.png")} alt="Caliber Pulse"/>
      <nav className="hr-login-portals" aria-label="Caliber Pulse applications">
        {portals.map(({name, href, Icon}) => <a key={name} href={href}><Icon aria-hidden="true"/><span>{name}</span></a>)}
        <span className="hr-login-current" aria-current="page"><Users aria-hidden="true"/><span>HR</span></span>
      </nav>
      <div className="hr-login-message">
        <h1>HR and operations.<br/>One workspace.</h1>
        <p>Employee records, attendance and approvals across sites.</p>
      </div>
    </aside>}
    <main className="hr-login-panel">
      {!embedded && <button type="button" className="hr-login-theme" aria-label="Night theme" aria-pressed={night} onClick={() => setNight(!night)}>
        {night ? <Moon aria-hidden="true"/> : <Sun aria-hidden="true"/>}{night ? 'Night' : 'Day'}
      </button>}
      <form className="login-card hr-login-form" onSubmit={signIn} aria-labelledby="hr-sign-in-heading">
        {!embedded && <nav className="hr-login-options" aria-label="Account access">
          <span aria-current="page"><User aria-hidden="true"/>Sign in</span>
          {!inPulseII && <a href={pulsePortal}><LockKeyhole aria-hidden="true"/><span>Reset password<small>Open Pulse for OTP recovery</small></span></a>}
        </nav>}
        <h2 id="hr-sign-in-heading">HR sign in</h2>
        <p className="muted">Use your existing Caliber Pulse username and password.</p>
        <div className="hr-login-access"><ShieldCheck aria-hidden="true"/>Your administrator assigns HR access.</div>
        {notice && !error && <p role="alert" className="error">{notice}</p>}
        <label htmlFor="username">Pulse username</label>
        <div className="input-wrap"><User aria-hidden="true"/><input id="username" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false}/></div>
        <div className="label-row"><label htmlFor="password">Password</label></div>
        <div className="input-wrap">
          <LockKeyhole aria-hidden="true"/>
          <input id="password" name="password" type={visible ? 'text' : 'password'} required autoComplete="current-password"/>
          <button type="button" aria-label="Toggle password" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff/> : <Eye/>}</button>
        </div>
        <label className="remember"><input type="checkbox" name="remember"/>Remember me</label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="sign-in" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight aria-hidden="true"/></button>
        {inPulseII && <a className="hr-login-back" href="/">Back to MIS</a>}
      </form>
    </main>
  </div>;
}
