import type {Session} from './api';

// Caliber One, one sign-in (owner, 28 Nov 2026): a person already signed in to Pulse opens HR Pulse
// without typing the password again. With no saved HR sign-in, HR Pulse asks Pulse once
// (/?hrSignIn=1 with a PKCE challenge). Pulse sends back a one-time code (?hrCode, ?hrState) that
// only this page can swap for the grant, because only it holds the verifier; or ?hrSso=signin /
// noaccess, and HR Pulse shows its own sign-in form as before. HR access is still required.
export const PULSE_ORIGIN = 'https://pulse.cmll.in';
export const HR_SITE_ORIGIN = 'https://hrpulse.cmll.in';
export const SIGN_OUT_MESSAGE = 'caliber-one:sign-out';
const PENDING = 'hrPulseSsoPending';
const TRIED = 'hrPulseSsoTriedAt';
const SIGNED_OUT = 'hrPulseSsoSignedOut';
const RETRY_AFTER_MS = 60_000;
const proof = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export type SsoStep =
  | {kind: 'exchange'; code: string; state: string}
  | {kind: 'start'}
  | {kind: 'form'; reason?: 'signin' | 'noaccess'};

type Place = {origin: string; search: string; embedded: boolean; inPulseII: boolean};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Only HR Pulse on its own address asks Pulse: not inside the Pulse login frame, not under
// Pulse-II's /hr/, not a preview or a test.
export function ssoAllowed(place: Place) {
  return place.origin === HR_SITE_ORIGIN && !place.embedded && !place.inPulseII;
}

export function ssoStep(place: Place, store: Store, now = Date.now()): SsoStep {
  if (!ssoAllowed(place)) return {kind: 'form'};
  const query = new URLSearchParams(place.search);
  const code = query.get('hrCode'), state = query.get('hrState'), back = query.get('hrSso');
  if (proof(code) && proof(state)) return {kind: 'exchange', code, state};
  if (back === 'noaccess') return {kind: 'form', reason: 'noaccess'};
  if (back) return {kind: 'form', reason: 'signin'};
  if (store.getItem(SIGNED_OUT) === '1') return {kind: 'form'};
  // A failed or refused sign-in is not repeated at once, so the page can never bounce in a loop.
  const tried = Number(store.getItem(TRIED) || 0);
  if (tried && now - tried < RETRY_AFTER_MS) return {kind: 'form'};
  return {kind: 'start'};
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function pulseSignInUrl(store: Store, now = Date.now()) {
  const state = random(), verifier = random();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  store.setItem(PENDING, JSON.stringify({state, verifier}));
  store.setItem(TRIED, String(now));
  store.removeItem(SIGNED_OUT);
  const url = new URL('/', PULSE_ORIGIN);
  url.searchParams.set('hrSignIn', '1');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  return url.toString();
}

export async function finishPulseSignIn(code: string, state: string, store: Store, fetcher: typeof fetch = fetch): Promise<Session> {
  let pending: {state?: string; verifier?: string} = {};
  try { pending = JSON.parse(store.getItem(PENDING) || '{}'); } catch { /* damaged */ }
  store.removeItem(PENDING);
  if (pending.state !== state || !proof(pending.verifier)) throw new Error('This HR sign-in was not started here. Sign in below.');
  const response = await fetcher(PULSE_ORIGIN + '/api/integrations/hr/exchange', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, redirect: 'error',
    body: JSON.stringify({code, state, verifier: pending.verifier}), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Pulse could not open HR Pulse. Sign in below.');
  if (!proof(result.grant) || result.profile?.permissions?.application !== 'HR') throw new Error('HR access is not assigned to this account.');
  store.removeItem(TRIED);
  return {grant: result.grant, profile: result.profile};
}

// Takes hrCode / hrState / hrSso out of the address once read.
export function cleanSsoAddress(href: string) {
  const url = new URL(href);
  for (const key of ['hrCode', 'hrState', 'hrSso']) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

// After Sign out (here or Caliber One's Sign out all) HR Pulse waits for the form or the
// "Continue with Pulse" button instead of signing straight back in.
export function markSignedOut(store: Store) { store.setItem(SIGNED_OUT, '1'); store.removeItem(TRIED); }

export function isCaliberOneSignOut(event: Pick<MessageEvent, 'source' | 'origin' | 'data'> | null, self: {parent: unknown} = window) {
  return Boolean(event && self.parent && self.parent !== self && event.source === self.parent &&
    event.origin === PULSE_ORIGIN && event.data?.type === SIGN_OUT_MESSAGE);
}
