import {it,expect,vi,afterEach} from 'vitest';
import {render,screen} from '@testing-library/react';
import {Approvals} from './Modules';
afterEach(()=>vi.unstubAllGlobals());
it('employee verification excludes leave approvals',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify(['employees','leaveRequests'].map((kind,i)=>({id:String(i),kind,record_code:kind,record_name:kind+' name',state:'PENDING',stage:0,approvers:['reviewer'],requested_by:'maker',history:[],data:{}})))));
 render(<Approvals grant="test" actor="reviewer" kind="employees" notice={()=>{}}/>);
 await screen.findByText('Employee');expect(screen.queryByText('Leave')).toBeNull();expect(screen.getByRole('button',{name:'Review'})).toBeTruthy();
});

