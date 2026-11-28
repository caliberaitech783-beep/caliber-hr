import {describe,expect,it} from 'vitest';
import appSource from './App.tsx?raw';
import {cleanSsoAddress,finishPulseSignIn,isCaliberOneSignOut,markSignedOut,pulseSignInUrl,ssoStep,startAsked,HR_SITE_ORIGIN,PULSE_ORIGIN,SIGN_OUT_MESSAGE} from './pulse-sso';

// Caliber One, one sign-in (owner, 28 Nov 2026): HR Pulse opens with the Pulse sign-in already on
// the computer, still needing HR access; HR Pulse's own form stays for everyone else.
const memory=()=>{const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},map};};
const place=(search='',over={})=>({origin:HR_SITE_ORIGIN,search,embedded:false,inPulseII:false,...over});
const code='c'.repeat(43);

describe('when HR Pulse asks Pulse',()=>{
 it('asks Pulse once, only on its own address, and never in a loop',()=>{
  const store=memory();
  expect(ssoStep(place(),store,1000)).toEqual({kind:'start'});
  expect(ssoStep(place('',{origin:'http://localhost:5173'}),store)).toEqual({kind:'form'});
  expect(ssoStep(place('',{embedded:true}),store)).toEqual({kind:'form'});
  expect(ssoStep(place('',{inPulseII:true}),store)).toEqual({kind:'form'});
  store.setItem('hrPulseSsoTriedAt','1000');
  expect(ssoStep(place(),store,30_000)).toEqual({kind:'form'});
  expect(ssoStep(place(),store,70_000)).toEqual({kind:'form'}); // not again within 10 minutes
  expect(ssoStep(place(),store,1000+10*60_000+1)).toEqual({kind:'start'});
 });
 it('reads what Pulse sent back',()=>{
  const store=memory();
  expect(ssoStep(place(`?hrCode=${code}&hrState=${'s'.repeat(43)}`),store)).toEqual({kind:'exchange',code,state:'s'.repeat(43)});
  expect(ssoStep(place('?hrSso=noaccess'),store)).toEqual({kind:'form',reason:'noaccess'});
  expect(ssoStep(place('?hrSso=signin'),store)).toEqual({kind:'form',reason:'signin'});
  expect(cleanSsoAddress(`${HR_SITE_ORIGIN}/?hrCode=${code}&hrState=x&keep=1#Dashboard`)).toBe('/?keep=1#Dashboard');
 });
 // Owner, 28 Nov 2026: after a sign-out and a new sign-in, every Caliber One tab opens again, HR Pulse too.
 it('Caliber One opening the tab with ?hrSso=start signs in through Pulse, also right after a sign-out or a recent try',()=>{
  const store=memory();
  markSignedOut(store);
  store.setItem('hrPulseSsoTriedAt',String(Date.now()));
  expect(ssoStep(place('?hrSso=start'),store)).toEqual({kind:'start'});
  expect(startAsked(place('?hrSso=start'))).toBe(true);
  expect(startAsked(place('?hrSso=signin'))).toBe(false);
  expect(ssoStep(place('?hrSso=start',{embedded:true}),store)).toEqual({kind:'form'});
  expect(startAsked(place('?hrSso=start',{origin:'http://localhost:5173'}))).toBe(false);
  expect(ssoStep(place('?hrSso=signin'),store)).toEqual({kind:'form',reason:'signin'}); // Pulse's answer never starts again
 });
 it('after Sign out it waits for the person instead of signing straight back in',()=>{
  const store=memory();
  markSignedOut(store);
  expect(ssoStep(place(),store)).toEqual({kind:'form'});
 });
});

describe('the one-time code',()=>{
 it('goes to Pulse with a challenge and comes back as a grant only with the matching verifier',async()=>{
  const store=memory();
  const url=new URL(await pulseSignInUrl(store,5));
  expect(url.origin).toBe(PULSE_ORIGIN);
  expect(url.searchParams.get('hrSignIn')).toBe('1');
  const state=url.searchParams.get('state')!;
  const pending=JSON.parse(store.getItem('hrPulseSsoPending')!);
  expect(pending.state).toBe(state);
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  let sent:Record<string,string>={};
  const fetcher=(async(target:string,init:RequestInit)=>{
   expect(target).toBe(PULSE_ORIGIN+'/api/integrations/hr/exchange');
   sent=JSON.parse(String(init.body));
   return Response.json({grant:'g'.repeat(43),profile:{name:'Owner',permissions:{application:'HR'}}});
  }) as unknown as typeof fetch;
  const session=await finishPulseSignIn(code,state,store,fetcher);
  expect(sent).toEqual({code,state,verifier:pending.verifier});
  expect(session.grant).toBe('g'.repeat(43));
  expect(store.getItem('hrPulseSsoPending')).toBeNull();
  expect(ssoStep(place(),store,6)).toEqual({kind:'form'}); // a sign-in that worked still counts for the 10 minutes, so no loop
 });
 it('refuses a code this page did not ask for, and a profile without HR',async()=>{
  const store=memory();
  await expect(finishPulseSignIn(code,'s'.repeat(43),store)).rejects.toThrow(/not started here/);
  const url=new URL(await pulseSignInUrl(store));
  const noHr=(async()=>Response.json({grant:'g'.repeat(43),profile:{permissions:{application:'MIS'}}})) as unknown as typeof fetch;
  await expect(finishPulseSignIn(code,url.searchParams.get('state')!,store,noHr)).rejects.toThrow(/HR access/);
 });
});

it('only Caliber One holding this tab can sign it out by message',()=>{
 const parent={},self={parent};
 expect(isCaliberOneSignOut({source:parent as MessageEventSource,origin:PULSE_ORIGIN,data:{type:SIGN_OUT_MESSAGE}},self)).toBe(true);
 expect(isCaliberOneSignOut({source:parent as MessageEventSource,origin:'https://evil.example',data:{type:SIGN_OUT_MESSAGE}},self)).toBe(false);
 expect(isCaliberOneSignOut({source:{} as MessageEventSource,origin:PULSE_ORIGIN,data:{type:SIGN_OUT_MESSAGE}},self)).toBe(false);
 const alone:{parent:unknown}={parent:null};alone.parent=alone;
 expect(isCaliberOneSignOut({source:alone as MessageEventSource,origin:PULSE_ORIGIN,data:{type:SIGN_OUT_MESSAGE}},alone)).toBe(false);
});

it('the app asks Pulse before the form and signs out on the Caliber One message',()=>{
 expect(appSource).toMatch(/if\(!session\?\.grant&&!leaveOnly&&sso\.kind!=='form'\)return <div className="loading-screen" role="status">Signing in through Pulse…<\/div>;/);
 expect(appSource).toMatch(/const receive=\(event:MessageEvent\)=>\{if\(isCaliberOneSignOut\(event\)\)logout\(\);\};/);
 expect(appSource).toMatch(/clearSession\(\);\r?\n\s+markSignedOut\(sessionStorage\);/);
 // An ended HR sign-in shows the form; it asks Pulse instead only once, when Caliber One opened this page load with ?hrSso=start.
 expect(appSource).toMatch(/const expired=\(\)=>\{setConfig\(undefined\);setSession\(null\);const viaPulse=startPending;startPending=false;setSso\(viaPulse\?\{kind:'start'\}:\{kind:'form'\}\);\};/);
 expect(appSource).toMatch(/let startPending=startAsked\(ssoPlace\(\)\)&&Boolean\(savedSession\(\)\?\.grant\);/);
});
