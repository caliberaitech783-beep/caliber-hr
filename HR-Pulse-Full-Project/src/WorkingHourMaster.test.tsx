import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import WorkingHourMaster from './WorkingHourMaster';
import {setWorkingHours,workingHoursOptions} from '../server/working-hours.mjs';
import type {Module} from './api';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();setWorkingHours(undefined);});

const module:Module={title:'Working Hour Master',menu:'Master Configuration',fields:[],canWrite:true};
const line=(id:string,code:string,status='ACTIVE',version=1)=>({id,kind:'workingHours',code,name:`${code} hours`,data:{code,name:`${code} hours`,remarks:''},status,version,updated_at:''});

it('lists one set of hours for Corporate / HO and OB / COAL, adds, switches off and back on, and every form takes the new list',async()=>{
  let rows=[line('a','12'),line('b','8'),line('c','10','INACTIVE',3)];
  const calls:{url:string;method:string;body?:unknown}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
    const method=options?.method||'GET',body=options?.body?JSON.parse(String(options.body)):undefined;
    calls.push({url,method,body});
    if(method==='POST'&&url.endsWith('/records/workingHours')){rows=[...rows,line('d',String(body.code))];return Response.json(rows.at(-1));}
    if(method==='POST'&&url.endsWith('/deactivate')){rows=rows.map(row=>url.includes('/'+row.id+'/')?{...row,status:'INACTIVE',version:row.version+1}:row);return Response.json({});}
    if(method==='PUT'){rows=rows.map(row=>url.endsWith('/'+row.id)?{...row,status:'ACTIVE',version:row.version+1}:row);return Response.json({});}
    return Response.json({rows,total:rows.length});
  }));
  render(<WorkingHourMaster grant={'a'.repeat(43)} module={module}/>);
  const table=await screen.findByRole('region',{name:'Working hours'});
  await waitFor(()=>expect(within(table).getAllByRole('row')).toHaveLength(4));
  expect(within(table).getAllByRole('row').slice(1).map(row=>row.textContent)).toEqual([
    expect.stringContaining('8 hoursCorporate / HO and OB / COALActive'),
    expect.stringContaining('10 hoursCorporate / HO and OB / COALSwitched off'),
    expect.stringContaining('12 hoursCorporate / HO and OB / COALActive')]);
  // The forms read the master's active hours.
  expect(workingHoursOptions()).toEqual(['8 hours','12 hours']);

  fireEvent.change(screen.getByLabelText('Hours'),{target:{value:'12'}});
  fireEvent.click(screen.getByRole('button',{name:'Add hours'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('12 hours is already in the list.');

  fireEvent.change(screen.getByLabelText('Hours'),{target:{value:'7'}});
  fireEvent.click(screen.getByRole('button',{name:'Add hours'}));
  expect(await screen.findByRole('status')).toHaveTextContent('7 hours added. Corporate / HO and OB / COAL offer it now.');
  expect(calls.find(call=>call.method==='POST'&&call.url.endsWith('/records/workingHours'))?.body).toEqual({code:'7',remarks:''});
  await waitFor(()=>expect(workingHoursOptions()).toEqual(['7 hours','8 hours','12 hours']));

  // A switched-off line comes back with the same record (its code is unique), never a second line.
  fireEvent.change(screen.getByLabelText('Hours'),{target:{value:'10'}});
  fireEvent.click(screen.getByRole('button',{name:'Add hours'}));
  await waitFor(()=>expect(calls.some(call=>call.method==='PUT'&&call.url.endsWith('/records/workingHours/c'))).toBe(true));
  expect(calls.find(call=>call.method==='PUT')?.body).toEqual({code:'10',remarks:'',version:3});
  await waitFor(()=>expect(workingHoursOptions()).toEqual(['7 hours','8 hours','10 hours','12 hours']));

  const eight=within(table).getAllByRole('row').find(row=>row.textContent?.startsWith('8'))!;
  fireEvent.click(within(eight).getByRole('button',{name:'Switch off'}));
  expect(await screen.findByText(/8 hours switched off\. Employees who already have it keep it/)).toBeInTheDocument();
  await waitFor(()=>expect(workingHoursOptions()).toEqual(['7 hours','10 hours','12 hours']));
});

it('a login that cannot change masters only views the list',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({rows:[line('a','12')],total:1})));
  render(<WorkingHourMaster grant={'a'.repeat(43)} module={{...module,canWrite:false}}/>);
  expect(await screen.findByText(/Only a head office login/)).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('cell',{name:'12 hours'})).toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'Switch off'})).toBeNull();
  expect(screen.getByRole('button',{name:'Add hours'})).toBeDisabled();
});
