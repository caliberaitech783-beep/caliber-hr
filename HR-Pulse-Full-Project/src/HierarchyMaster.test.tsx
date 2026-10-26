import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import HierarchyMaster from './HierarchyMaster';
afterEach(()=>vi.unstubAllGlobals());
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
