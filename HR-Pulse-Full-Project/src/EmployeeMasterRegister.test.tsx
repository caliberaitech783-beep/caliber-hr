import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EmployeeMasterRegister from './EmployeeMasterRegister';

afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('saves changes for the selected employee and refreshes the register',async()=>{
  let name = 'Before edit';
  const fetchMock = vi.fn(async(url:string,options?:RequestInit)=>{
    if (options?.method==='PATCH') {
      const input = JSON.parse(String(options.body));
      expect(url).toMatch(/\/employee-master-register\/employee-1$/);
      expect(input).toEqual({version:4,changes:{name:'After edit'}});
      name = input.changes.name;
      return Response.json({saved:true});
    }
    const sites = [{code:'WCL-SASTI',label:'Sasti OB'}];
    if (url.endsWith('?edit=1')) return Response.json({name,version:4,siteCode:'WCL-SASTI',sites,fields:{employeeId:'CMLL001'}});
    return Response.json({rows:[{id:'employee-1',name,employeeId:'CMLL001',site:'Sasti OB'}],total:1,pageSize:50,sites,canImport:false});
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit details for Before edit'}));
  const dialog = screen.getByRole('dialog',{name:'Edit employee details'});
  const input = await within(dialog).findByLabelText('Name');
  expect(input).toHaveValue('Before edit');
  fireEvent.change(input,{target:{value:'After edit'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}));
  expect(await screen.findByText('Employee details saved.')).toBeVisible();
  expect(await screen.findByRole('button',{name:'Edit details for After edit'})).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Owner, 23 Nov 2026: an employee is created, edited and deleted only in HR Pulse.
it('removes a line only after a reason and a second yes',async()=>{
  let removed = false;
  const sites = [{code:'WCL-SASTI',label:'Sasti OB'}];
  const fetchMock = vi.fn(async(url:string,options?:RequestInit)=>{
    if (options?.method==='POST') {
      expect(url).toMatch(/\/employee-master-register\/employee-1\/remove$/);
      expect(JSON.parse(String(options.body))).toEqual({version:4,reason:'Duplicate line'});
      removed = true;
      return Response.json({removed:true});
    }
    if (url.endsWith('?edit=1')) return Response.json({name:'Sample twice',version:4,siteCode:'WCL-SASTI',sites,fields:{employeeId:'CMLL001'},canRemove:true});
    return Response.json({rows:removed?[]:[{id:'employee-1',name:'Sample twice',employeeId:'CMLL001',site:'Sasti OB'}],total:removed?0:1,pageSize:50,sites,canImport:true});
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit details for Sample twice'}));
  const dialog = screen.getByRole('dialog',{name:'Edit employee details'});
  const reason = await within(dialog).findByLabelText('Why it is removed');
  const start = within(dialog).getByRole('button',{name:'Remove this line'});
  expect(start).toBeDisabled();
  fireEvent.change(reason,{target:{value:'Duplicate line'}});
  fireEvent.click(start);
  expect(within(dialog).getByText('Remove Sample twice (CMLL001) from Employee Master?')).toBeVisible();
  expect(fetchMock.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button',{name:'Yes, remove'}));
  expect(await screen.findByText('The line was removed from Employee Master.')).toBeVisible();
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Edit details for Sample twice'})).toBeNull());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('saves the leaving date, and shows no Remove to a login that may not remove',async()=>{
  const sent:unknown[] = [];
  const sites = [{code:'WCL-SASTI',label:'Sasti OB'}];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if (options?.method==='PATCH') {
      sent.push(JSON.parse(String(options.body)));
      return Response.json({saved:true});
    }
    if (url.endsWith('?edit=1')) return Response.json({name:'Sample left',version:4,siteCode:'WCL-SASTI',sites,fields:{employeeId:'CMLL002',status:'LEFT'},canRemove:false});
    return Response.json({rows:[{id:'employee-2',name:'Sample left',employeeId:'CMLL002',site:'Sasti OB'}],total:1,pageSize:50,sites,canImport:false});
  }));
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Edit details for Sample left'}));
  const dialog = screen.getByRole('dialog',{name:'Edit employee details'});
  const date = await within(dialog).findByLabelText('Leaving date (when Status is LEFT)');
  expect(within(dialog).queryByRole('button',{name:'Remove this line'})).toBeNull();
  fireEvent.change(date,{target:{value:'2026-11-20'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Save changes'}));
  expect(await screen.findByText('Employee details saved.')).toBeVisible();
  expect(sent).toEqual([{version:4,changes:{leavingDate:'2026-11-20'}}]);
});

it('prints all matching rows and the four bank columns, including records on later pages, with the current filters',async()=>{
  const first = {id:'1',employeeId:'CMLL001',name:'First employee',site:'Sasti OB',bankName:'SBI',ifscCode:'SBIN0001234',accountNo:'00123',branch:'Sasti'};
  const last = {id:'51',employeeId:'CMLL051',name:'Later & employee',site:'Sasti OB',bankName:'BOI',ifscCode:'BKID0000001',accountNo:'00456',branch:'Nagpur'};
  const fetchMock = vi.fn(async(url:string)=>{
    const params = new URL(url).searchParams;
    return Response.json(params.has('export') ? {complete:true,rows:[first,last]} : {
      rows:[first],total:51,pageSize:50,sites:[{code:'WCL-SASTI',label:'Sasti OB'}],canImport:false,
    });
  });
  vi.stubGlobal('fetch',fetchMock);
  const print = vi.fn();
  const documentWrite = vi.fn();
  const mockPopup = {
    opener:window,closed:false,focus:vi.fn(),print,close:vi.fn(),
    document:{title:'',body:{textContent:''},open:vi.fn(),write:documentWrite,close:vi.fn()},
  };
  const open = vi.spyOn(window,'open').mockReturnValue(mockPopup as unknown as Window);
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  await screen.findByText('First employee');
  for(const heading of ['BANK NAME','IFSC CODE','ACCOUNT NO','BRANCH'])expect(screen.getByRole('columnheader',{name:heading})).toBeVisible();
  fireEvent.change(screen.getByLabelText('Site'),{target:{value:'WCL-SASTI'}});
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'employee'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  const download = screen.getByRole('button',{name:'Export'});
  await waitFor(()=>expect(download).toBeEnabled());
  expect(screen.queryByRole('group',{name:'Download format'})).toBeNull();
  fireEvent.click(download);
  const formats = screen.getByRole('group',{name:'Download format'});
  expect(within(formats).getAllByRole('button').map(button=>button.textContent)).toEqual(['Excel','PDF']);
  fireEvent.keyDown(within(formats).getByRole('button',{name:'PDF'}),{key:'Escape'});
  expect(download).toHaveFocus();
  expect(download).toHaveAttribute('aria-expanded','false');
  fireEvent.click(download);
  fireEvent.click(screen.getByRole('button',{name:'PDF'}));
  expect(open).toHaveBeenCalledOnce();
  await waitFor(()=>expect(print).toHaveBeenCalledOnce());
  const url = fetchMock.mock.calls.at(-1)?.[0] ?? '';
  expect(new URL(url).searchParams.toString()).toBe('site=WCL-SASTI&search=employee&export=1');
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('Later &amp; employee'));
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('CMLL051'));
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('BKID0000001'));
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('00456'));
  expect(mockPopup.opener).toBeNull();
});

it('routes Excel rows using their own sites while another site is selected and rejects unmatched sites before saving',async()=>{
  const {utils,write}=await import('xlsx');
  const sites=[{code:'WCL-GAURI',label:'Gauri Pauni OB 2nd'},{code:'NCL-JAYANT',label:'Jayant OB'}];
  const existing={id:'old',name:'Existing',employeeId:'0001',site:'Jayant OB'};
  const posts: {rows:{siteCode:string;employeeId:string}[]}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.method==='POST'){
      posts.push(JSON.parse(String(options.body)));
      return Response.json({inserted:2,alreadyImported:0});
    }
    if(new URL(url).searchParams.has('export'))return Response.json({complete:true,rows:[existing]});
    return Response.json({rows:[existing],total:1,pageSize:50,sites,canImport:true});
  }));
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  await screen.findByText('Existing');
  fireEvent.change(screen.getByLabelText('Site'),{target:{value:'NCL-JAYANT'}});
  const picker=screen.getByLabelText('Import HR employee data');
  async function upload(lastSite:string){
    await waitFor(()=>expect(picker).toBeEnabled());
    const book=utils.book_new();
    utils.book_append_sheet(book,utils.aoa_to_sheet([
      ['Employee ID','Name','Site / Office'],['0001','Existing','Jayant OB'],
      ['0002','Employee Two','Gauri Pouni'],['0003','Employee Three',lastSite],
    ]),'Employees');
    const file=Object.assign(new File([],'employees.xlsx'),{arrayBuffer:async()=>write(book,{type:'array',bookType:'xlsx'})});
    fireEvent.change(picker,{target:{files:[file]}});
  }
  await upload('Unlisted site');
  expect(await screen.findByRole('alert')).toHaveTextContent('Employees row 4');
  expect(posts).toHaveLength(0);
  await upload('NCL-JAYANT');
  expect(await screen.findByText('2 entries added. 1 already imported.')).toBeVisible();
  expect(posts[0].rows.map(({siteCode,employeeId})=>[siteCode,employeeId])).toEqual([['WCL-GAURI','0002'],['NCL-JAYANT','0003']]);
});
