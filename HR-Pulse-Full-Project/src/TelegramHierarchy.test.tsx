import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import TelegramHierarchy from './TelegramHierarchy';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));
it('Telegram Hierarchy page keeps the original Site HR → Regional HR route',async()=>{
 const data={sites:[{id:'site',name:'Jayant OB',code:'NCL-JAYANT',version:1,data:{siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda','mohitchadda','rahulchadda'],enabled:true}}],accounts:[],employees:[],deliveries:[]};
 vi.mocked(api).mockImplementation(async(_grant,path)=>path==='telegram/account'?{connected:false,configured:true,botUsername:'LeaveRequestt_Bot'}:path==='telegram/hierarchies'?data:{saved:true});
 render(<TelegramHierarchy grant="test"/>);
 await screen.findByText('Jayant OB');fireEvent.change(screen.getByLabelText('Site'),{target:{value:'site'}});
 expect(screen.getByLabelText('Site HR — comma-separated Pulse usernames')).toHaveProperty('value','amitsingh');
 fireEvent.change(screen.getByLabelText('Regional HR — comma-separated Pulse usernames'),{target:{value:'newhr'}});
 fireEvent.click(screen.getByRole('button',{name:'Save hierarchy'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('test','telegram/hierarchies','POST',expect.objectContaining({siteId:'site',regionalHr:'newhr',version:1})));
});

it('Approval Master leave editor saves the Office / Site flow',async()=>{
 const data={sites:[{id:'site',name:'Jayant OB',code:'NCL-JAYANT',version:1,data:{siteHr:'amitsingh',regionalHr:'vinodpinjarkar',directors:['manishchadda'],enabled:true}}],accounts:[],employees:[],deliveries:[],departments:['Operations']};
 vi.mocked(api).mockImplementation(async(_grant,path)=>path==='telegram/account'?{connected:false,configured:true,botUsername:'LeaveRequestt_Bot'}:path==='telegram/hierarchies'?data:{saved:true});
 render(<TelegramHierarchy grant="test" leaveOnly/>);
 await screen.findByText('Jayant OB');fireEvent.change(screen.getByLabelText('Site / office'),{target:{value:'site'}});
 fireEvent.change(screen.getByLabelText('HR Manager — initiates leave requests (one Pulse username)'),{target:{value:'amitsingh'}});
 fireEvent.change(screen.getByLabelText('PM Sir — comma-separated Pulse usernames'),{target:{value:'gulnawaz'}});
 fireEvent.change(screen.getByLabelText('HOD for Operations'),{target:{value:'ops.hod'}});
 fireEvent.click(screen.getByRole('button',{name:'Save leave flow'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('test','telegram/hierarchies','POST',expect.objectContaining({siteId:'site',type:'site',hrManager:'amitsingh',pm:'gulnawaz',hods:{Operations:'ops.hod'},version:1})));
 fireEvent.click(screen.getByRole('button',{name:/1\. Office flow/}));
 expect(screen.queryByLabelText('PM Sir — comma-separated Pulse usernames')).toBeNull();
});
