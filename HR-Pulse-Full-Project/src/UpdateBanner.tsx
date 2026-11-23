import {useEffect,useState} from 'react';

/* Owner, 23 Nov 2026: a page left open kept running the old code after a release, so fixes looked missing.
   The page remembers the release it loaded (release.json, written by the deploy) and checks again every
   two minutes and whenever the tab comes back into view. When a new release is live it offers a reload;
   it never reloads by itself, so a half-filled form is not lost. */
const CHECK_EVERY=120_000;

export async function liveRelease(fetcher:typeof fetch=fetch):Promise<string>{
  try{
    const response=await fetcher(new URL('release.json',document.baseURI).href,{cache:'no-store'});
    if(!response.ok)return '';
    const body=await response.json().catch(()=>null);
    return typeof body?.commit==='string'?body.commit:'';
  }catch{return '';}
}

export default function UpdateBanner({every=CHECK_EVERY}:{every?:number}){
  const[ready,setReady]=useState(false);
  useEffect(()=>{
    let loaded='',live=true;
    const check=async()=>{const now=await liveRelease();if(!live||!now)return;if(!loaded)loaded=now;else if(now!==loaded)setReady(true);};
    void check();
    const timer=window.setInterval(()=>void check(),every);
    const onShow=()=>{if(document.visibilityState==='visible')void check();};
    document.addEventListener('visibilitychange',onShow);window.addEventListener('focus',onShow);
    return()=>{live=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',onShow);window.removeEventListener('focus',onShow);};
  },[every]);
  if(!ready)return null;
  return <div className="update-banner" role="status">
    <span>A new version of HR Pulse is ready.</span>
    <button type="button" onClick={()=>window.location.reload()}>Reload</button>
    <button type="button" className="update-banner-later" onClick={()=>setReady(false)}>Later</button>
  </div>;
}
