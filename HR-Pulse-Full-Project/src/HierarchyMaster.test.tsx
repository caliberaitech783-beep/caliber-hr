import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import HierarchyMaster from './HierarchyMaster';
afterEach(()=>vi.unstubAllGlobals());
it('shows the assigned trainer name and never keeps a name for a different username',async()=>{
 const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('/trial-trainer')
  ?{actor:'parsuramyadav',name:'Parsuram Yadav'}
  :{canWrite:true,rows:[{code:'NCL-JAYANT',name:'Jayant OB East',group:'NCL',enabled:true,version:1,steps:[{stage:1,label:'Driver Trainer',suggested:'To be confirmed',approvers:['parsuramyadav']}]}]}));
 vi.stubGlobal('fetch',fetcher);render(<HierarchyMaster grant={'a'.repeat(43)}/>);
 await screen.findByText('Parsuram Yadav');
 expect(screen.queryByText('To be confirmed')).toBeNull();
 const input=screen.getByLabelText('Driver Trainer usernames 1');
 fireEvent.change(input,{target:{value:'anothertrainer'}});
 expect(screen.queryByText('Parsuram Yadav')).toBeNull();
 expect(screen.getByText('anothertrainer')).toBeTruthy();
 fireEvent.change(input,{target:{value:''}});
 expect(screen.getByText('No Driver Trainer assigned')).toBeTruthy();
});
it('blocks incomplete enabling and displays persisted status instead of unsaved checkbox state',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({canWrite:true,rows:[{code:'NCL-DUDE',name:'East',group:'NCL',enabled:false,version:0,steps:[{stage:1,label:'HR Manager',suggested:'Manager',approvers:[]}]}]})));
 vi.stubGlobal('fetch',fetcher);render(<HierarchyMaster grant={'a'.repeat(43)}/>);
 await screen.findByText('Saved hierarchy is not enabled');
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByText('Saved hierarchy is not enabled')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Save hierarchy'}));
 expect(screen.getByRole('alert').textContent).toContain('highlighted');
 expect(screen.getByLabelText('HR Manager usernames 1').getAttribute('aria-invalid')).toBe('true');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
