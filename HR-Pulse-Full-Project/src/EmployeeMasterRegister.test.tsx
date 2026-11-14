import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import EmployeeMasterRegister from './EmployeeMasterRegister';

afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('prints all matching rows, including records on later pages, with the current filters',async()=>{
  const first = {id:'1',employeeId:'CMLL001',name:'First employee',site:'Sasti OB'};
  const last = {id:'51',employeeId:'CMLL051',name:'Later & employee',site:'Sasti OB'};
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
  fireEvent.change(screen.getByLabelText('Site'),{target:{value:'WCL-SASTI'}});
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'employee'}});
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  const download = screen.getByRole('button',{name:'Download PDF'});
  await waitFor(()=>expect(download).toBeEnabled());
  fireEvent.click(download);
  expect(open).toHaveBeenCalledOnce();
  await waitFor(()=>expect(print).toHaveBeenCalledOnce());
  const url = fetchMock.mock.calls.at(-1)?.[0] ?? '';
  expect(new URL(url).searchParams.toString()).toBe('site=WCL-SASTI&search=employee&export=1');
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('Later &amp; employee'));
  expect(documentWrite).toHaveBeenCalledWith(expect.stringContaining('CMLL051'));
  expect(mockPopup.opener).toBeNull();
});
