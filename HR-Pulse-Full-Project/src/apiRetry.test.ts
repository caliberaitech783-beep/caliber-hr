import {afterEach,expect,it,vi} from 'vitest';
import {api,setApiRetryPause} from './api';

afterEach(()=>{vi.unstubAllGlobals();setApiRetryPause(ms=>new Promise(resolve=>setTimeout(resolve,ms)));});

it('automatically retries temporary read failures for every user',async()=>{
 setApiRetryPause(async()=>{});let calls=0;
 vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return calls<3?Response.json({error:'Temporarily unavailable'},{status:503}):Response.json([{id:'s1',kind:'sites',code:'GP',name:'Gauri Pauni OB 2nd'}]);}));
 const result=await api<unknown[]>('a'.repeat(43),'lookups');
 expect(calls).toBe(3);expect(result).toHaveLength(1);
});

it('never retries a write that could create a duplicate action',async()=>{
 setApiRetryPause(async()=>{});const request=vi.fn(async()=>Response.json({error:'Temporarily unavailable'},{status:503}));vi.stubGlobal('fetch',request);
 await expect(api('a'.repeat(43),'attendance/fetch','POST',{deviceSerial:'ABC'})).rejects.toThrow('Temporarily unavailable');
 expect(request).toHaveBeenCalledOnce();
});

it('does not retry an expired session',async()=>{
 setApiRetryPause(async()=>{});const request=vi.fn(async()=>Response.json({error:'Sign in again'},{status:401}));vi.stubGlobal('fetch',request);
 await expect(api('a'.repeat(43),'lookups')).rejects.toThrow('Sign in again');
 expect(request).toHaveBeenCalledOnce();
});
