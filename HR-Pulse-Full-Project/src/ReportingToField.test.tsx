vi.mock('./paddleOcr',()=>({readPaddlePasses:vi.fn(async()=>({text:'',warning:''})),readPaddleText:vi.fn(async()=>'')}));
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReportingToField} from './EmployeeLocation';

const managers=[{label:'Sunil – Manager (Majri OB)',value:'Sunil – Manager'},{label:'Amit – General Manager (Sasti OB)',value:'Amit – General Manager'}];
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();});

describe('Reporting To (owner, 21 Nov 2026)',()=>{
 it('lists the Manager-and-above people of the chosen department and saves the choice under "Reporting To"',async()=>{
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
  const fetch=vi.fn(async(_url:string)=>Response.json({managers}));vi.stubGlobal('fetch',fetch);
  const {container}=render(<form><ReportingToField department="Maintenance" site="Majri OB"/></form>);
  const select=await screen.findByRole('combobox',{name:'Reporting To'});
  expect(String(fetch.mock.calls[0][0])).toContain('reporting-managers?department=Maintenance');
  expect(Array.from((select as HTMLSelectElement).options).map(option=>option.text)).toEqual(['Select manager','Sunil – Manager (Majri OB)','Amit – General Manager (Sasti OB)','Other (write the name)']);
  fireEvent.change(select,{target:{value:'Amit – General Manager'}});
  expect(new FormData(container.querySelector('form')!).get('Reporting To')).toBe('Amit – General Manager');
  fireEvent.change(select,{target:{value:'__other__'}});
  fireEvent.change(screen.getByLabelText("Write the reporting manager's name"),{target:{value:'New Person'}});
  expect(new FormData(container.querySelector('form')!).get('Reporting To')).toBe('New Person');
 });
 it('falls back to typing the name when the department has no manager',async()=>{
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({managers:[]})));
  render(<form><ReportingToField department="Banking" site=""/></form>);
  await waitFor(()=>expect(screen.getByPlaceholderText(/No manager found for this department/)).toBeTruthy());
 });
});

describe('Reporting To keeps the pick (owner, 22 Nov 2026)',()=>{
 it('a redraw of the form while the pick is being made does not put the box back to "Select manager"',async()=>{
  sessionStorage.setItem('hrPulseSession',JSON.stringify({grant:'a'.repeat(43)}));
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({managers})));
  /* Like the draft autosave: the form redraws itself on every input. */
  function Form(){const[,setTick]=useState(0),form=useRef<HTMLFormElement>(null);
   useEffect(()=>{const f=form.current!,redraw=()=>flushSync(()=>setTick(t=>t+1));f.addEventListener('input',redraw);f.addEventListener('change',redraw);return()=>{f.removeEventListener('input',redraw);f.removeEventListener('change',redraw);};},[]);
   return <form ref={form}><ReportingToField department="Maintenance" site="Majri OB"/></form>;}
  const {container}=render(<Form/>);
  const select=await screen.findByRole('combobox',{name:'Reporting To'}) as HTMLSelectElement;
  act(()=>{select.value='Amit – General Manager';select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(select.value).toBe('Amit – General Manager');
  expect(new FormData(container.querySelector('form')!).get('Reporting To')).toBe('Amit – General Manager');
 });
});
