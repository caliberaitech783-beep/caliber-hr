import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import WorkDuration from './WorkDuration';
import LocalEmployeeReviewForm from './LocalEmployeeReviewForm';
afterEach(()=>{cleanup();localStorage.clear();});
it('calculates elapsed calendar duration and clears incomplete or reversed ranges',()=>{
 const view=render(<WorkDuration from="2020-01-15" to="2023-03-20"/>);
 expect(screen.getByLabelText('Work Duration').textContent).toBe('3 years, 2 months, 5 days');
 view.rerender(<WorkDuration from="2024-01-31" to="2024-02-29"/>);
 expect(screen.getByLabelText('Work Duration').textContent).toBe('0 years, 1 month, 0 days');
 view.rerender(<WorkDuration from="2024-01-31" to="2024-01-31"/>);
 expect(screen.getByLabelText('Work Duration').textContent).toBe('0 years, 0 months, 0 days');
 view.rerender(<WorkDuration from="2024-01-31" to="2023-01-31"/>);
 expect(screen.getByLabelText('Work Duration').textContent).toBe('Check date range');
 view.rerender(<WorkDuration from="2024-01-31" to=""/>);
 expect(screen.getByLabelText('Work Duration').textContent).toBe('—');
});
const record={id:'duration-test',code:'E1',name:'Sample',data:{officeData:{'From Date':'2020-01-15 | 2024-01-31','To Date':'2023-03-20 | 2024-02-29'}}};
it('shows independent durations next to the dates in approved experience reviews',()=>{
 render(<LocalEmployeeReviewForm record={record} owner="reviewer" readOnly/>);
 fireEvent.click(screen.getByRole('button',{name:'Previous Work Experience'}));
 const headers=screen.getAllByRole('columnheader').map(header=>header.textContent);
 expect(headers.indexOf('Work Duration')).toBe(headers.indexOf('To Date')+1);
 expect(screen.getByLabelText('Work Duration 1').textContent).toBe('3 years, 2 months, 5 days');
 expect(screen.getByLabelText('Work Duration 2').textContent).toBe('0 years, 1 month, 0 days');
 expect((screen.getByLabelText('From Date 1') as HTMLInputElement).readOnly).toBe(true);
});
it('recalculates while editing an existing experience entry',()=>{
 render(<LocalEmployeeReviewForm record={record} owner="reviewer"/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit'}));
 fireEvent.click(screen.getByRole('button',{name:'Previous Work Experience'}));
 fireEvent.change(screen.getByLabelText('To Date 1'),{target:{value:'2021-01-15'}});
 expect(screen.getByLabelText('Work Duration 1').textContent).toBe('1 year, 0 months, 0 days');
});
