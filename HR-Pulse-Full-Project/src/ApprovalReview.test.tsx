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
for(const completed of [true,false])it(`separates completed forms: ${completed}`,async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify(['PENDING','APPROVED'].map((state,i)=>({id:String(i),kind:'employees',code:state+'-code',name:state,state,stage:0,approvers:['reviewer'],requested_by:'maker',history:[],data:{}})))));
 render(<Approvals grant="test" actor="reviewer" kind="employees" completed={completed} notice={()=>{}}/>);
 await screen.findByText(completed?/APPROVED-code/:/PENDING-code/);
 expect(screen.queryByText(completed?/PENDING-code/:/APPROVED-code/)).toBeNull();
 if(completed){expect(screen.getByRole('button',{name:'View Offer Letter'})).toBeTruthy();expect(screen.getByRole('button',{name:'View Appointment Letter'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'View Offer Letter'}));expect(screen.getByRole('dialog',{name:/Offer Letter/})).toBeTruthy();}
});

