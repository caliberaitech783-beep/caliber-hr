import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const memory=vi.hoisted(()=>new Map<string,any>());
vi.mock('./joiningDrafts',async original=>({...await original<typeof import('./joiningDrafts')>(),saveJoiningDraft:vi.fn(async(d:any)=>{memory.set(d.id,d);}),listJoiningDrafts:vi.fn(async(owner:string)=>[...memory.values()].filter(d=>d.owner===owner)),removeJoiningDraft:vi.fn(async(id:string)=>{memory.delete(id);}),discardJoiningDraft:vi.fn(async(id:string,owner:string)=>{if(memory.get(id)?.owner!==owner)throw Error('Wrong account');memory.delete(id);})}));
import EmployeeLocation from './EmployeeLocation';
import {captureJoiningFields,restoreJoiningFields,saveJoiningDraft} from './joiningDrafts';
beforeEach(()=>{memory.clear();vi.mocked(saveJoiningDraft).mockClear();});afterEach(cleanup);
it('autosaves incomplete fields and resumes after unmount without a network call',async()=>{
 const view=render(<EmployeeLocation draftOwner="alice"/>);
 fireEvent.change(screen.getByLabelText('Choose Aadhaar card from gallery'),{target:{files:[new File(['aadhaar'],'aadhaar.pdf',{type:'application/pdf'})]}});
 fireEvent.click(screen.getByRole('button',{name:/Joining & Personal Details/}));
 fireEvent.input(screen.getByLabelText(/^Full Name\s*\*?$/),{target:{value:'Resumable employee'}});
 fireEvent.input(screen.getByLabelText(/^Mobile/),{target:{value:'9876'}});
 await waitFor(()=>expect([...memory.values()][0]?.fields.Mobile[0].value).toBe('9876'));
 view.unmount();render(<EmployeeLocation draftOwner="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'Draft'}));fireEvent.click(await screen.findByRole('button',{name:'Resume'}));
 expect((screen.getByLabelText(/^Full Name\s*\*?$/) as HTMLInputElement).value).toBe('Resumable employee');
 expect((screen.getByLabelText(/^Mobile/) as HTMLInputElement).value).toBe('9876');
 expect(screen.getAllByRole('heading',{name:'Joining & Personal Details'}).length).toBeGreaterThan(0);
});
it('draft list is isolated by signed-in account',async()=>{
 memory.set('one',{id:'one',owner:'alice',group:'Corporate / HO',updatedAt:new Date().toISOString(),fields:{'Full Name':[{value:'Private draft'}]},defaults:{},step:1});
 render(<EmployeeLocation draftOwner="bob"/>);fireEvent.click(screen.getByRole('button',{name:'Draft'}));await waitFor(()=>expect(screen.getByText('No saved drafts yet.')).toBeTruthy());expect(screen.queryByText('Private draft')).toBeNull();
});
it('preserves repeated field names and checkbox state',()=>{
 const form=document.createElement('form');form.innerHTML='<input name="Name" value="one"><input name="Name" value="two"><input type="checkbox" name="checked" checked>';
 const snapshot=captureJoiningFields(form);form.reset();(form.elements[0] as HTMLInputElement).value='';restoreJoiningFields(form,snapshot);expect((form.elements[0] as HTMLInputElement).value).toBe('one');expect(snapshot.Name[1].value).toBe('two');expect((form.elements[2] as HTMLInputElement).checked).toBe(true);
});
it('keeps the draft when employee submission fails offline',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Network unavailable')));
 render(<EmployeeLocation draftOwner="alice" grant="test-grant"/>);
 fireEvent.input(screen.getByLabelText(/^Full Name\s*\*?$/),{target:{value:'Offline employee'}});
 fireEvent.input(screen.getByLabelText(/Employee Code/),{target:{value:'TEMP-9'}});
 fireEvent.submit(document.querySelector('form.joining-form')!);
 await screen.findByRole('alert');
 await waitFor(()=>expect([...memory.values()].some(d=>d.fields['Employee Code'][0].value==='TEMP-9')).toBe(true));
 expect(memory.size).toBe(1);vi.unstubAllGlobals();
});

it('deletes only the confirmed draft and preserves other drafts',async()=>{
 for(const id of ['one','two'])memory.set(id,{id,owner:'alice',group:'Corporate / HO',updatedAt:new Date().toISOString(),fields:{'Full Name':[{value:id}]},defaults:{},step:1});
 const confirmation=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<EmployeeLocation draftOwner="alice"/>);fireEvent.click(screen.getByRole('button',{name:'Draft'}));
 await screen.findAllByRole('button',{name:'Delete'});fireEvent.click(screen.getAllByRole('button',{name:'Delete'})[0]);expect(memory.size).toBe(2);
 confirmation.mockReturnValue(true);fireEvent.click(screen.getAllByRole('button',{name:'Delete'})[0]);await waitFor(()=>expect(screen.getAllByRole('button',{name:'Delete'})).toHaveLength(1));expect(memory.size).toBe(1);confirmation.mockRestore();
});
