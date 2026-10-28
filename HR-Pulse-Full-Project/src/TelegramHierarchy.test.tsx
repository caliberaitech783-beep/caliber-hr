import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import TelegramHierarchy from './TelegramHierarchy';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));
it('loads Jayant routing and saves changes from the website',async()=>{
 const data={sites:[{id:'site',name:'Jayant OB',code:'NCL-JAYANT',version:1,data:{siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true}}],accounts:[],employees:[],deliveries:[]};
 vi.mocked(api).mockImplementation(async(_grant,path)=>path==='telegram/account'?{connected:false,configured:true,botUsername:'LeaveRequestt_Bot'}:path==='telegram/hierarchies'?data:{saved:true});
 render(<TelegramHierarchy grant="test"/>);
 await screen.findByText('Jayant OB');fireEvent.change(screen.getByLabelText('Site'),{target:{value:'site'}});
 expect(screen.getByLabelText('Site HR — Pulse username')).toHaveProperty('value','amitsingh');
 fireEvent.change(screen.getByLabelText('Regional HR — Pulse username'),{target:{value:'newhr'}});
 fireEvent.click(screen.getByRole('button',{name:'Save hierarchy'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('test','telegram/hierarchies','POST',expect.objectContaining({siteId:'site',regionalHr:'newhr',version:1})));
});
