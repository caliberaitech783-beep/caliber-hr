import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {Approvals} from './Modules';
afterEach(()=>{vi.unstubAllGlobals();cleanup();});
for(const actor of ['reviewer','viewer'])it(`readable employee details and approval permission for ${actor}`,async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([{id:'1',kind:'employees',code:'E1',name:'Test Employee',state:'PENDING',stage:0,approvers:['reviewer'],requested_by:'maker',history:[],data:{officeData:{'Full Name *':'Test Person','Department *':'HR'}}}])));
 render(<Approvals grant="test" actor={actor} kind="employees" notice={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review'}));
 expect(screen.getByRole('form',{name:'Editable joining review form'})).toBeTruthy();expect((screen.getByLabelText('Full Name *') as HTMLInputElement).value).toBe('Test Person');expect(screen.queryByText('officeData')).toBeNull();
 expect((screen.getByRole('button',{name:'Approve'}) as HTMLButtonElement).disabled).toBe(actor!=='reviewer');
});
for(const completed of [true,false])it(`separates completed forms: ${completed}`,async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify(['PENDING','APPROVED'].map((state,i)=>({id:String(i),kind:'employees',code:state+'-code',name:state,state,stage:0,approvers:['reviewer'],requested_by:'maker',history:[],data:{}})))));
 render(<Approvals grant="test" actor="reviewer" kind="employees" completed={completed} notice={()=>{}}/>);
 await screen.findByText(completed?/APPROVED-code/:/PENDING-code/);
 expect(screen.queryByText(completed?/PENDING-code/:/APPROVED-code/)).toBeNull();
 if(completed){expect(screen.queryByRole('columnheader',{name:'Offer Letter'})).toBeNull();expect(screen.queryByRole('button',{name:'View Offer Letter'})).toBeNull();expect(screen.getByRole('columnheader',{name:'Confirmation Letter'})).toBeTruthy();expect(screen.getByRole('button',{name:'View Appointment Letter'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'View Appointment Letter'}));expect(document.querySelectorAll('.employee-letter-page')).toHaveLength(3);expect(screen.queryByRole('menuitem',{name:/Download as Excel/})).toBeNull();}
});


/* Owner, 21 Nov 2026: Completed Form asks for every approved employee in the user's sites; Employee Verify asks
   only for employee forms, so other requests never hide them. */
for(const [completed,path] of [[true,'/api/approvals/completed-employees'],[false,'/api/approvals/employees'],[undefined,'/api/approvals']] as const)it(`employee list ${String(completed)} reads ${path}`,async()=>{
 const urls:string[]=[];
 vi.stubGlobal('fetch',async(url:string)=>{urls.push(String(url));return new Response('[]');});
 render(<Approvals grant="test" actor="reviewer" kind="employees" completed={completed} notice={()=>{}}/>);
 await screen.findByRole('button',{name:/Refresh/});
 await vi.waitFor(()=>expect(urls.length).toBeGreaterThan(0));
 expect(new URL(urls[0],'http://x').pathname).toBe(path);
 if(completed)expect(screen.getByText(/Every fully approved employee in your sites/)).toBeTruthy();
});
