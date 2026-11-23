import '@testing-library/jest-dom/vitest';
import {render,screen,cleanup,fireEvent,act} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import UpdateBanner from './UpdateBanner';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});

// Owner, 23 Nov 2026: an open page offers a reload when a new release is live, and never reloads by itself.
it('offers a reload only after the live release changes',async()=>{
 let commit='aaa';
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{expect(String(url)).toMatch(/release\.json$/);return Response.json({commit});}));
 vi.useFakeTimers();
 render(<UpdateBanner every={1000}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(1100);});
 expect(screen.queryByRole('status')).toBeNull();
 commit='bbb';
 await act(async()=>{await vi.advanceTimersByTimeAsync(1100);});
 expect(screen.getByRole('status')).toHaveTextContent('A new version of HR Pulse is ready.');
 fireEvent.click(screen.getByRole('button',{name:'Later'}));
 expect(screen.queryByRole('status')).toBeNull();
});

it('stays quiet when release.json is missing',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:404})));
 vi.useFakeTimers();
 render(<UpdateBanner every={1000}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(3100);});
 expect(screen.queryByRole('status')).toBeNull();
});
