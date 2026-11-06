import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useState} from 'react';
import FourDigitYears from './FourDigitYears';
afterEach(cleanup);
it('limits date, month and datetime years before controlled form state receives them',()=>{
 function Form(){const[values,setValues]=useState<Record<string,string>>({});return <FourDigitYears>{['date','month','datetime-local'].map(type=><input key={type} aria-label={type} type={type} value={values[type]||''} onChange={e=>setValues({...values,[type]:e.target.value})}/>)}<output>{JSON.stringify(values)}</output></FourDigitYears>;}
 render(<Form/>);
 for(const [type,value,want] of [['date','20255-06-15','2025-06-15'],['month','20255-06','2025-06'],['datetime-local','20255-06-15T12:30','2025-06-15T12:30']]){
  const input=screen.getByLabelText(type) as HTMLInputElement;
  fireEvent.input(input,{target:{value}});expect(input.value).toBe(want);expect(screen.getByRole('status').textContent).toContain(want);
  fireEvent.input(input,{target:{value:''}});expect(input.value).toBe('');
 }
});
it('handles year of passing and year fields while preserving experience durations and stricter bounds',()=>{
 render(<FourDigitYears><input aria-label="Year of Passing 1"/><label>Year<input type="number"/></label><input aria-label="Total experience (years)" type="number"/><input aria-label="past date" type="date" max="2026-11-06"/></FourDigitYears>);
 for(const label of ['Year of Passing 1','Year']){const input=screen.getByLabelText(label) as HTMLInputElement;fireEvent.input(input,{target:{value:'20255'}});expect(input.value).toBe('2025');expect(input.max).toBe('9999');}
 const experience=screen.getByLabelText('Total experience (years)') as HTMLInputElement;fireEvent.input(experience,{target:{value:'12.5'}});expect(experience.value).toBe('12.5');
 expect((screen.getByLabelText('past date') as HTMLInputElement).max).toBe('2026-11-06');
});
it('applies bounds to date inputs opened after initial render',async()=>{
 function Form(){const[open,setOpen]=useState(false);return <FourDigitYears><button onClick={()=>setOpen(true)}>Open</button>{open&&<input aria-label="new date" type="date"/>}</FourDigitYears>;}
 render(<Form/>);fireEvent.click(screen.getByText('Open'));await waitFor(()=>expect((screen.getByLabelText('new date') as HTMLInputElement).max).toBe('9999-12-31'));
 expect((screen.getByLabelText('new date') as HTMLInputElement).min).toBe('1000-01-01');
});
