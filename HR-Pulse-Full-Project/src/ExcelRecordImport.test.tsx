import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {utils,write} from 'xlsx';
import {Records} from './Modules';
afterEach(()=>vi.unstubAllGlobals());
it('loads an Excel template and submits mapped records only after the user imports',async()=>{
 let submitted:unknown;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(options?.method==='POST'){submitted=JSON.parse(String(options.body));return Response.json({imported:1});}
  return Response.json(url.endsWith('/lookups')?[]:{rows:[],total:0,page:1,pageSize:50});
 }));
 const module={title:'Leave Types',menu:'Master Configuration',canWrite:true,fields:[{key:'code',label:'Code',type:'text'},{key:'name',label:'Name',type:'text'}]};
 render(<Records grant="test" kind="leaveTypes" module={module} notice={()=>{}}/>);
 await screen.findByText('No records found');
 fireEvent.click(screen.getByRole('button',{name:'Import Excel'}));
 const input=screen.getByLabelText('Choose Excel');expect(input).toHaveAttribute('accept',expect.stringContaining('.xlsx'));
 const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Code','Name'],['EL','Earned Leave']]),'Data');
 const bytes=write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer,file=new File([bytes],'leave-types.xlsx');
 Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
 fireEvent.change(input,{target:{files:[file]}});
 await screen.findByRole('button',{name:'Import 1 records'});expect(submitted).toBeUndefined();
 fireEvent.click(screen.getByRole('button',{name:'Import 1 records'}));
 await waitFor(()=>expect(submitted).toEqual({records:[{code:'EL',name:'Earned Leave'}]}));
});
