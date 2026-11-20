import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import AdditionApprovalPopup,{myTurn,type AdditionApproval} from './AdditionApprovalPopup';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));
const steps=[{stage:1,label:'Project Manager',approvers:['pm']},{stage:2,label:'Office HR — either one',approvers:['ohr']},{stage:2,label:'HR Manager — either one',approvers:['vinodpinjarkar']},{stage:2,label:'Final approval — any one',approvers:['mohitchadda','manishchadda','rahulchadda']}];
const row:AdditionApproval={id:'a1',code:'EMP-9',name:'Ravi Kumar',kind:'employees',state:'PENDING',stage:2,version:3,approvers:[],requested_by:'sitehr',approval_steps:steps,data:{siteId:'NCL-DUDE · Dudhichua OB East'}};
beforeEach(()=>{sessionStorage.clear();vi.mocked(api).mockReset();});

it('only the approver of the current step sees the request',()=>{
 expect(myTurn(row,'vinodpinjarkar')).toBe(true);
 expect(myTurn(row,'ohr')).toBe(false);
 expect(myTurn({...row,kind:'leaveRequests'},'vinodpinjarkar')).toBe(false);
 expect(myTurn({...row,state:'APPROVED'},'vinodpinjarkar')).toBe(false);
});

it('pops up for Regional HR, approves and passes it to the Directors',async()=>{
 vi.mocked(api).mockImplementation(async(_g,path)=>path==='approvals'?[row]:path==='telegram/addition-bot'?{connected:false,configured:true,botUsername:'NagpurEmployeeAdditionBot'}:{state:'PENDING'});
 render(<AdditionApprovalPopup grant="g" actor="vinodpinjarkar"/>);
 expect(await screen.findByRole('dialog')).toBeTruthy();
 expect(screen.getByText(/Step 3 of 4:/)).toBeTruthy();
 expect(await screen.findByRole('button',{name:/@NagpurEmployeeAdditionBot/})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'✅ Approve'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','approvals/a1/decision','POST',{version:3,decision:'APPROVED',comments:''}));
 expect(await screen.findByText(/sent to Directors \(final\)/)).toBeTruthy();
});

it('needs a reason before rejecting',async()=>{
 vi.mocked(api).mockImplementation(async(_g,path)=>path==='approvals'?[row]:{connected:true,configured:true,botUsername:'b'});
 render(<AdditionApprovalPopup grant="g" actor="vinodpinjarkar"/>);
 await screen.findByRole('dialog');
 fireEvent.click(screen.getByRole('button',{name:'❌ Reject'}));
 fireEvent.change(screen.getByLabelText('Reason for rejecting'),{target:{value:'Wrong documents'}});
 fireEvent.click(screen.getByRole('button',{name:'❌ Reject'}));
 await waitFor(()=>expect(api).toHaveBeenCalledWith('g','approvals/a1/decision','POST',{version:3,decision:'REJECTED',comments:'Wrong documents'}));
});

it('shows nothing to someone with no approval waiting',async()=>{
 vi.mocked(api).mockResolvedValue([row]);
 const {container}=render(<AdditionApprovalPopup grant="g" actor="pm"/>);
 await waitFor(()=>expect(api).toHaveBeenCalled());
 expect(container.innerHTML).toBe('');
});
