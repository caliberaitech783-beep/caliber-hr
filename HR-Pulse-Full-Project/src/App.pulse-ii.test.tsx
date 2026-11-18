import {render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import App from './App';

vi.mock('./hr-paths',()=>({
  inPulseII:true,
  hrAsset:(file:string)=>'/hr/'+file,
  hrApiOrigin:'/hr',
  hrSessionEndpoint:'/hr/session/',
}));

afterEach(()=>{
  vi.unstubAllGlobals();
  window.location.hash='';
  sessionStorage.clear();
  localStorage.clear();
});

it('uses the existing Pulse-II sign-in to open HR without storing an HR credential',async()=>{
  window.location.hash='Dashboard';
  const token='browser-session.'+'a'.repeat(16);
  const grant='b'.repeat(43);
  const profile={name:'Test HR',permissions:{application:'HR',hrDesktopAccess:['Dashboard']}};
  sessionStorage.setItem('nerveCenterSession',JSON.stringify({token}));
  const fetcher=vi.fn(async (url:string,request:RequestInit)=>{
    if(url==='/api/hr-workspace/session'){
      expect(request.headers).toEqual({Authorization:'Bearer '+token});
      return Response.json({grant,profile});
    }
    expect(url.startsWith('/hr/api/')).toBe(true);
    if(url.endsWith('/config')){
      expect(request.headers).toEqual({Authorization:'Bearer '+grant});
      return Response.json({profile,modules:{}});
    }
    return Response.json({counts:[],sites:[]});
  });
  vi.stubGlobal('fetch',fetcher);
  render(<App/>);
  await screen.findByRole('heading',{name:'Dashboard'});
  expect(screen.getAllByRole('button',{name:'Back to MIS'})).not.toHaveLength(0);
  expect(sessionStorage.getItem('hrPulseSession')).toBeNull();
  expect(localStorage.getItem('hrPulseSession')).toBeNull();
});

it('shows the HR permission error without opening a separate password form',async()=>{
  sessionStorage.setItem('nerveCenterSession',JSON.stringify({token:'fixture'}));
  const fetcher=vi.fn(async()=>Response.json({error:'HR access is not assigned.'},{status:403}));
  vi.stubGlobal('fetch',fetcher);
  render(<App/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('HR access is not assigned.');
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
