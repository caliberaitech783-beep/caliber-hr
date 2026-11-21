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

it('shows permanent deletion only for all-sites access and deletes the selected employee',async()=>{
 const urls:string[]=[];
 const employee={id:'11111111-1111-4111-8111-111111111111',kind:'employees',code:'CMLL001',name:'Selected Employee',state:'APPROVED',stage:0,approvers:[],requested_by:'maker',history:[],data:{},can_permanent_delete:true};
 vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input);urls.push(`${init?.method||'GET'} ${url}`);return new Response(JSON.stringify(init?.method==='POST'?{deleted:1}:urls.filter(value=>value.startsWith('GET')).length===1?[employee]:[]));});
 const notice=vi.fn();render(<Approvals grant="test" actor="admin" kind="employees" completed notice={notice}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Delete Permanently'}));
 expect(screen.getByRole('dialog',{name:'Delete employee permanently?'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Type DELETE to confirm'),{target:{value:'DELETE'}});
 fireEvent.click(screen.getByRole('dialog',{name:'Delete employee permanently?'}).querySelector<HTMLButtonElement>('button.danger')!);
 await vi.waitFor(()=>expect(urls.some(url=>url.includes(`/api/approvals/completed-employees/${employee.id}/permanent-delete`))).toBe(true));
 await vi.waitFor(()=>expect(notice).toHaveBeenCalledWith('CMLL001 · Selected Employee deleted permanently'));
});

it('does not show permanent deletion for site-restricted users',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify([{id:'1',kind:'employees',code:'E1',name:'Site Employee',state:'APPROVED',stage:0,approvers:[],requested_by:'maker',history:[],data:{},can_permanent_delete:false}])));
 render(<Approvals grant="test" actor="sitehr" kind="employees" completed notice={()=>{}}/>);
 await screen.findByText('Site Employee');
 expect(screen.queryByRole('columnheader',{name:'Delete Permanently'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Delete Permanently'})).toBeNull();
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
