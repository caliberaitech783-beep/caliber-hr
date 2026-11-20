import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import AdditionBotLinks from './AdditionBotLinks';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));

it('shows who is connected, asks once, then lists the results with links to forward',async()=>{
 const people=[{actor:'mohitchadda',roles:['Directors (final)'],connected:true,via:'leave'},{actor:'vinodpinjarkar',roles:['Regional HR · Dudhichua OB East'],connected:false,via:'leave'},{actor:'pm1',roles:['PM / HOD · Dudhichua OB East'],connected:false,via:''}];
 vi.mocked(api).mockImplementation(async(_g,path,method)=>method==='POST'?{botUsername:'NagpurEmployeeAdditionBot',people:[{...people[0],status:'already connected'},{...people[1],status:'sent on HR Pulse leave bot'},{...people[2],status:'not on any HR bot – forward this link',url:'https://t.me/NagpurEmployeeAdditionBot?start=abc'}]}:{botUsername:'NagpurEmployeeAdditionBot',configured:true,people});
 render(<AdditionBotLinks grant="g"/>);
 expect(await screen.findByText('No HR bot')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Send connect links (2)'}));
 expect(api).not.toHaveBeenCalledWith('g','telegram/addition-links','POST',{});
 fireEvent.click(screen.getByRole('button',{name:'Yes, send'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','telegram/addition-links','POST',{}));
 expect(await screen.findByText('sent on HR Pulse leave bot')).toBeTruthy();
 expect((screen.getByLabelText('Connect link for pm1') as HTMLInputElement).value).toBe('https://t.me/NagpurEmployeeAdditionBot?start=abc');
});
