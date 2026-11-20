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

it('Link delivery column says what happened to each link',async()=>{
 const {deliveryText}=await import('./AdditionBotLinks');
 const name=(v:string)=>v==='leave'?'Leave bot':v;
 expect(deliveryText({state:'DELIVERED',bot:'leave',at:'2026-11-20T08:00:00Z',error:''},name)).toMatch(/^✅ Delivered on Leave bot · 20 Nov/);
 expect(deliveryText({state:'WAITING',bot:'leave',at:'',error:'Recipient has not connected Telegram'},name)).toBe('⏳ Waiting on Leave bot – Recipient has not connected Telegram');
 expect(deliveryText({state:'FAILED',bot:'leave',at:'',error:'blocked'},name)).toBe('❌ Failed on Leave bot – blocked');
 expect(deliveryText({state:'FORWARD',bot:'',at:'2026-11-27T08:00:00Z',error:''},name)).toMatch(/^🔗 Link given to forward · valid till 27 Nov/);
 expect(deliveryText(null,name)).toBe('No link sent');
 vi.mocked(api).mockResolvedValue({botUsername:'b',configured:true,people:[{actor:'vinodpinjarkar',roles:['Regional HR'],connected:false,via:'leave',delivery:{state:'FAILED',bot:'leave',at:'',error:'blocked'}}]});
 render(<AdditionBotLinks grant="g"/>);
 expect(await screen.findByText('❌ Failed on Leave bot – blocked')).toBeTruthy();
 expect(screen.getByRole('columnheader',{name:'Link delivery'})).toBeTruthy();
});

it('Copy link to forward makes a link only for Waiting / Failed people and copies it with a note',async()=>{
 const writeText=vi.fn(async()=>{});Object.assign(navigator,{clipboard:{writeText}});
 vi.mocked(api).mockReset();
 vi.mocked(api).mockImplementation(async(_g,path,method)=>path==='telegram/addition-link'&&method==='POST'?{url:'https://t.me/NagpurEmployeeAdditionBot?start=new',message:'note https://t.me/NagpurEmployeeAdditionBot?start=new'}:{botUsername:'b',configured:true,people:[
  {actor:'vinodpinjarkar',roles:['Regional HR'],connected:false,via:'leave',delivery:{state:'WAITING',bot:'leave',at:'',error:'must tap Start'}},
  {actor:'mohitchadda',roles:['Directors'],connected:false,via:'leave',delivery:{state:'DELIVERED',bot:'leave',at:'2026-11-20T08:00:00Z',error:''}}]});
 render(<AdditionBotLinks grant="g"/>);
 const buttons=await screen.findAllByRole('button',{name:'Copy link to forward'});
 expect(buttons).toHaveLength(1);
 fireEvent.click(buttons[0]);
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','telegram/addition-link','POST',{actor:'vinodpinjarkar'}));
 expect(((await screen.findByLabelText('Forward link for vinodpinjarkar')) as HTMLInputElement).value).toBe('https://t.me/NagpurEmployeeAdditionBot?start=new');
 expect(writeText).toHaveBeenCalledWith('note https://t.me/NagpurEmployeeAdditionBot?start=new');
});
