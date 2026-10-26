import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {Approvals} from './Modules';
afterEach(()=>{vi.unstubAllGlobals();cleanup();});
for(const actor of ['reviewer','viewer'])it(`readable employee details and approval permission for ${actor}`,async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([{id:'1',kind:'employees',code:'E1',name:'Test Employee',state:'PENDING',stage:0,approvers:['reviewer'],requested_by:'maker',history:[],data:{officeData:{'Full Name *':'Test Person','Department *':'HR'}}}])));
 render(<Approvals grant="test" actor={actor} kind="employees" notice={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review'}));
 expect(screen.getByText('Employee joining details')).toBeTruthy();expect(screen.getByText('Test Person')).toBeTruthy();expect(screen.queryByText('officeData')).toBeNull();
 expect((screen.getByRole('button',{name:'Approve'}) as HTMLButtonElement).disabled).toBe(actor!=='reviewer');
});
