import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {Approvals} from './Modules';
import LeaveRequestBotLinks from './LeaveRequestBotLinks';
afterEach(()=>{vi.unstubAllGlobals();cleanup();});

/* Owner, 20 Nov 2026: Employee → HOD → Directors (OTP) → Regional HR (final). */
const steps=[{stage:1,label:'HOD (concerned) — any one',approvers:['ops.hod']},{stage:2,label:'Directors — approve by OTP, any one',approvers:['mohitchadda','manishchadda'],otp:true},{stage:3,label:'Regional HR — final approval, any one',approvers:['vinodpinjarkar']}];
const leave={id:'11111111-1111-4111-8111-111111111111',kind:'leaveRequests',code:'LR-1',name:'Family function',state:'PENDING',stage:1,approvers:['ops.hod','mohitchadda','manishchadda','vinodpinjarkar'],approval_steps:steps,telegram_flow:true,requested_by:'ravi.k',version:4,history:[],data:{employeeName:'Ravi Kumar'}};

it('Regional HR requests the Directors\' OTP and enters it at the Directors\' step',async()=>{
 const calls:{url:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{calls.push({url,body:init?.body?JSON.parse(String(init.body)):undefined});
  if(url.endsWith('/otp'))return new Response(JSON.stringify({status:'OTP_SENT',sentTo:['mohitchadda','manishchadda']}));
  if(url.endsWith('/otp-verify'))return new Response(JSON.stringify({status:'APPROVED'}));
  return new Response(JSON.stringify([leave]));});
 const notice=vi.fn();
 render(<Approvals grant="test" actor="vinodpinjarkar" notice={notice}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review'}));
 expect(screen.queryByRole('button',{name:'Approve'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Request OTP from Directors'}));
 expect(await screen.findByText(/OTP sent to the Directors on Telegram \(mohitchadda \/ manishchadda\)/)).toBeTruthy();
 const enter=screen.getByRole('button',{name:'Enter OTP'}) as HTMLButtonElement;expect(enter.disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('OTP from a Director'),{target:{value:'12a3456'}});
 expect(enter.disabled).toBe(false);
 fireEvent.click(enter);
 await waitFor(()=>expect(notice).toHaveBeenCalledWith("Directors' approval recorded. The leave now waits for your final approval."));
 expect(calls.find(c=>c.url.endsWith('/otp-verify'))?.body).toEqual({otp:'123456'});
});

it('a Director sees no Approve button, only the OTP note and Reject',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([leave])));
 render(<Approvals grant="test" actor="mohitchadda" notice={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review'}));
 expect(screen.queryByRole('button',{name:'Approve'})).toBeNull();
 expect(screen.getByRole('button',{name:'Reject'})).toBeTruthy();
 expect(screen.getByText(/tell it to Regional HR to approve/)).toBeTruthy();
 expect(screen.queryByLabelText('OTP from a Director')).toBeNull();
});

it('Regional HR picks who takes charge only at the final step',async()=>{
 vi.stubGlobal('fetch',async(url:string)=>new Response(JSON.stringify(url.includes('lookups')?[]:[{...leave,stage:2}])));
 render(<Approvals grant="test" actor="vinodpinjarkar" notice={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review'}));
 expect(screen.getByLabelText('Charge handed over to (required for approval)')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Approve'})).toBeTruthy();
});

it('Approval Master › Leave Request bot sends join links to everyone not yet joined',async()=>{
 const people=[{actor:'vinodpinjarkar',stage:'Regional HR',roles:['Regional HR · Jayant OB'],connected:true,via:'mt'},{actor:'ravi.k',name:'Ravi Kumar',stage:'Employee',roles:['Employee · Jayant OB'],connected:false,via:'mt',delivery:null},{actor:'new.user',name:'New User',stage:'Employee',roles:['Employee · Sasti OB'],connected:false,via:'',delivery:null}];
 const posts:unknown[]=[];
 vi.stubGlobal('fetch',async(_url:string,init?:RequestInit)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({botUsername:'CMLLLeaveRequestBot',configured:true,people:[{...people[1],status:'sent on CMLL HR'},{...people[2],status:'not on any HR bot – forward this link',url:'https://t.me/CMLLLeaveRequestBot?start=x'}]}));}
  return new Response(JSON.stringify({botUsername:'CMLLLeaveRequestBot',configured:true,people}));});
 render(<LeaveRequestBotLinks grant="test"/>);
 expect(await screen.findByText('Leave Request bot · @CMLLLeaveRequestBot')).toBeTruthy();
 expect(screen.getByRole('status').textContent).toBe('1 of 3 joined · 1 can be sent a link on Telegram · 1 are on no HR bot (copy their link to forward).');
 fireEvent.change(screen.getByLabelText('Search'),{target:{value:'sasti'}});
 expect(screen.queryByText('ravi.k')).toBeNull();expect(screen.getByText('new.user')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Send join links to all users (2)'}));
 fireEvent.click(screen.getByRole('button',{name:'Yes, send'}));
 expect(await screen.findByLabelText('Join link for new.user')).toBeTruthy();
 expect(posts).toEqual([{}]);
});
