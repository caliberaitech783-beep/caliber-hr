import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import App from './App';
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});
it('navigates between assigned menus after restoring a Pulse session',async()=>{
 const profile={name:'Test user',actor:'test',permissions:{application:'HR',hrDesktopAccess:['Dashboard','Administration']}};
 sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43),profile}));
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.endsWith('validate')?{profile}:url.endsWith('config')?{profile,modules:{}}:{counts:[],sites:[]})));
 render(<App/>);await screen.findByRole('heading',{name:'Dashboard'},{timeout:3000});fireEvent.click(screen.getByRole('button',{name:'Administration'}));await screen.findByRole('heading',{name:'Account & access'},{timeout:3000});
});
describe('HR Pulse',()=>{it('shows login',()=>{render(<App/>);expect(screen.getByText('Sign in to your workspace')).not.toBeNull()});it('toggles password visibility',()=>{render(<App/>);const password=screen.getByLabelText('Password');expect(password.getAttribute('type')).toBe('password');fireEvent.click(screen.getByRole('button',{name:'Toggle password'}));expect(password.getAttribute('type')).toBe('text')})});
