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
 fireEvent.click(screen.getByRole('button',{name:/Family Details/}));
 const familyDob=screen.getByLabelText('Date of Birth 1') as HTMLInputElement;
 const readDobDuringInput=vi.fn(() => new FormData(familyDob.form!).get('Date of Birth 1'));
 familyDob.form!.addEventListener('input',readDobDuringInput,{once:true});
 fireEvent.input(familyDob,{target:{value:'15032000'}});
 expect(readDobDuringInput).toHaveReturnedWith('2000-03-15');
 fireEvent.click(screen.getByRole('button',{name:/Previous Work Experience/}));
 await waitFor(()=>{
  const draft=[...memory.values()][0];
  expect(draft?.step).toBe(4);
  expect(draft?.fields.Mobile[0].value).toBe('9876');
  expect(draft?.fields['Date of Birth 1'][0].value).toBe('2000-03-15');
 });
 view.unmount();render(<EmployeeLocation draftOwner="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'Draft'}));fireEvent.click(await screen.findByRole('button',{name:'Resume'}));
 expect((screen.getByLabelText(/^Full Name\s*\*?$/) as HTMLInputElement).value).toBe('Resumable employee');
 expect((screen.getByLabelText(/^Mobile/) as HTMLInputElement).value).toBe('9876');
 expect(screen.getByRole('heading',{name:'Previous Work Experience',level:2})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:/Family Details/}));
 expect(screen.getByLabelText('Date of Birth 1')).toHaveValue('15/03/2000');
 expect(screen.getByLabelText('Age 1').textContent).toMatch(/\d+ years?, \d+ months?, \d+ days?/);
});
it('captures the final edit when the form is closed immediately',async()=>{
 const view=render(<EmployeeLocation draftOwner="alice"/>);
 fireEvent.input(screen.getByLabelText(/^Full Name\s*\*?$/),{target:{value:'Last second edit'}});
 view.unmount();
 await waitFor(()=>expect([...memory.values()][0]?.fields['Full Name'][0].value).toBe('Last second edit'));
 render(<EmployeeLocation draftOwner="alice"/>);
 fireEvent.click(screen.getByRole('button',{name:'Draft'}));
 fireEvent.click(await screen.findByRole('button',{name:'Resume'}));
 expect(screen.getByLabelText(/^Full Name\s*\*?$/)).toHaveValue('Last second edit');
});
it('draft list is isolated by signed-in account',async()=>{
 memory.set('one',{id:'one',owner:'alice',group:'Corporate / HO',updatedAt:new Date().toISOString(),fields:{'Full Name':[{value:'Private draft'}]},defaults:{},step:1});
 render(<EmployeeLocation draftOwner="bob"/>);fireEvent.click(screen.getByRole('button',{name:'Draft'}));await waitFor(()=>expect(screen.getByText('No saved drafts yet.')).toBeTruthy());expect(screen.queryByText('Private draft')).toBeNull();
});
it('preserves repeated field names and checkbox state',()=>{
 const form=document.createElement('form');form.innerHTML='<input name="Name" value="one"><input name="Name" value="two"><input type="checkbox" name="checked" checked>';
 const snapshot=captureJoiningFields(form);form.reset();(form.elements[0] as HTMLInputElement).value='';restoreJoiningFields(form,snapshot);expect((form.elements[0] as HTMLInputElement).value).toBe('one');expect(snapshot.Name[1].value).toBe('two');expect((form.elements[2] as HTMLInputElement).checked).toBe(true);
});
it('keeps an incomplete form as a local draft when final submission is blocked',async()=>{
 const request=vi.fn().mockRejectedValue(new Error('Network unavailable'));
 vi.stubGlobal('fetch',request);
 render(<EmployeeLocation draftOwner="alice" grant="test-grant"/>);
 fireEvent.input(screen.getByLabelText(/^Full Name\s*\*?$/),{target:{value:'Offline employee'}});
 fireEvent.input(screen.getByLabelText(/Employee Code/),{target:{value:'TEMP-9'}});
 fireEvent.click(screen.getByRole('button',{name:/Document Checklist/}));
 fireEvent.click(screen.getByRole('button',{name:'Submit Employee'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Please upload the Aadhaar document');
 expect(request).not.toHaveBeenCalled();
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
