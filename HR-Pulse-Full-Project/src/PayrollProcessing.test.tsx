import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import PayrollProcessing from './PayrollProcessing';
import {api} from './api';

vi.mock('./api',()=>({api:vi.fn(),downloadBlob:vi.fn()}));
it('opens all nine payroll workflows and saves overtime against the selected employee and period', async()=>{
  const query=vi.mocked(api);
  query.mockImplementation(async(_grant,path,method)=>{
    if(path==='payroll') return [{id:'e1',name:'Employee One',code:'E01'}];
    if(method==='POST') return {ok:true};
    return {history:[{month:'2020-01',amounts:{basic:30000,hra:0,fixedAllowance:0},reason:''}],inputs:{},version:4,slip:null,settlement:null,exitMonth:null,
      preview:{days:30,paidDays:30,earnings:{basic:30000,overtime:0},deductions:{},gross:30000,withheld:0,net:30000}};
  });
  render(<PayrollProcessing grant="grant"/>);
  await screen.findByRole('heading',{name:'Salary structure'});
  for(const name of ['Monthly payroll processing','Salary revision','Allowances & deductions','Bonus & incentives','Payslip generation','PF / ESIC / PT / TDS','Full & final settlement','Overtime calculations']){
    fireEvent.click(screen.getByRole('button',{name}));
    expect(screen.getByRole('heading',{name})).toBeInTheDocument();
  }
  fireEvent.change(screen.getByLabelText('Overtime hours'),{target:{value:'2.5'}});
  fireEvent.change(screen.getByLabelText('Overtime rate per hour (₹)'),{target:{value:'150'}});
  fireEvent.click(screen.getByRole('button',{name:'Save overtime calculations'}));
  await waitFor(()=>expect(query).toHaveBeenCalledWith('grant',expect.stringContaining('employee=e1&month='),'POST',{
    action:'overtime',structureMonth:'2020-01',version:4,hours:2.5,hourlyRate:150
  }));
  await screen.findByText('Saved.');
});

