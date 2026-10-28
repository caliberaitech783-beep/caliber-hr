import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {LeaveRequests} from './LeaveMaster';
vi.mock('./Modules',()=>({Records:({kind}:{kind:string})=><div>{kind}</div>,Approvals:()=>null}));
it('shows OD beside leave for users without approval permission and switches records',()=>{
 const module={title:'Form',menu:'Employee Master',fields:[],canWrite:true};
 render(<LeaveRequests grant="test" module={module} odModule={module} actor="hr" canApprove={false} notice={()=>{}}/>);
 expect(screen.getByText('leaveRequests')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'OD Form'}));
 expect(screen.getByText('outDutyRequests')).toBeTruthy();
 expect(screen.queryByText('leaveRequests')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Employee Leave Form'}));
 expect(screen.getByText('leaveRequests')).toBeTruthy();
});
