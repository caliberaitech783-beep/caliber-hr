import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {utils,write} from 'xlsx';
import EmployeeMasterRegister from './EmployeeMasterRegister';

afterEach(()=>{
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function hourWiseFile() {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['SL. No','EMPLOYEE ID','AADHAR NO',"EMPLOYEE'S NAME",'Shift Time'],
    [1,'CMPL1408',925100000000,'FIRST MAN','12 hrs'],[2,'CMPL1203',960800000000,'SECOND MAN','8 hrs']]),'MAJRI OB');
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['SL.NO','EMO ID','CMLL ID','NAME','Shift Hours'],
    [1,20287,'CMLL20287','THIRD MAN','11 Hrs Day'],[2,0,'LEFT','GONE MAN','8 Hrs Day & Night']]),'GOURI POUNI OB');
  const bytes = write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
  const file = new File([bytes],'ALL SITES HOUR WISE FILE.xlsx');
  Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
  return file;
}

it('shows what the hour-wise Excel will change, then updates Working Hours only on Update',async()=>{
  const posts:{apply:boolean;rows:Record<string,unknown>[]}[] = [];
  const answer = (applied:boolean)=>({applied,rows:3,people:3,updated:2,same:0,registerLines:2,joinedEmployees:0,
    held:{notFound:1,twoLines:0,twoHours:0},listLimit:300,nameDiffers:1,
    nameDiffersList:[{employeeId:'CMPL1203',name:'SECOND MAN',sheet:'MAJRI OB',row:3,hours:'8 hours',detail:'Employee Master: SECAND MAN'}],
    lists:{notFound:[{employeeId:'CMLL20287',name:'THIRD MAN',sheet:'GOURI POUNI OB',row:2,hours:'11 hours',detail:''}],twoLines:[],twoHours:[]}});
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    if (url.endsWith('/employee-master-working-hours')) {
      const input = JSON.parse(String(options?.body));
      posts.push(input);
      return Response.json(answer(input.apply));
    }
    return Response.json({rows:[{id:'employee-1',name:'FIRST MAN',employeeId:'CMLL1408',site:'Majri OB',workingHours:'12 hours'}],total:1,pageSize:50,sites:[{code:'WCL-MAJRI',label:'Majri OB'}],canImport:true});
  }));
  render(<EmployeeMasterRegister grant={'a'.repeat(43)}/>);
  expect(await screen.findByRole('columnheader',{name:'WORKING HOURS'})).toBeInTheDocument();
  expect(screen.getByRole('cell',{name:'12 hours'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Update Working Hours from Excel'),{target:{files:[hourWiseFile()]}});
  const dialog = await screen.findByRole('dialog',{name:'Update Working Hours'},{timeout:10000});
  // Only the Employee ID, the name and the hours left the browser, and nothing was saved yet.
  expect(posts).toEqual([{apply:false,rows:[
    {sheet:'MAJRI OB',row:2,employeeId:'CMPL1408',name:'FIRST MAN',hours:'12 hours'},
    {sheet:'MAJRI OB',row:3,employeeId:'CMPL1203',name:'SECOND MAN',hours:'8 hours'},
    {sheet:'GOURI POUNI OB',row:2,employeeId:'CMLL20287',name:'THIRD MAN',hours:'11 hours'}]}]);
  expect(dialog).toHaveTextContent('No employee is added, removed or moved and no other detail is changed.');
  expect(dialog).toHaveTextContent('Employee ID not in Employee Master: 1');
  expect(dialog).toHaveTextContent('Rows of the file left out: 1');
  // A name written differently is updated by Employee ID and only listed.
  expect(dialog).toHaveTextContent('Updated by Employee ID, name written differently: 1');
  expect(dialog).toHaveTextContent('Employee Master: SECAND MAN');
  expect(dialog).not.toHaveTextContent('A different name on this Employee ID');
  fireEvent.click(within(dialog).getByRole('button',{name:'Update Working Hours of 2 employees'}));
  await waitFor(()=>expect(posts).toHaveLength(2));
  expect(posts[1].apply).toBe(true);
  expect(posts[1].rows).toEqual(posts[0].rows);
  expect(await screen.findByText(/Working Hours updated for 2 employees\. 0 already had the same hours\. Nothing else was changed\./)).toBeInTheDocument();
},20000);
