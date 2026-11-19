import {describe,expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import RequestProgress,{progressView} from './RequestProgress';

const steps=[{label:'Site HR'},{label:'Project Manager'},{label:'Regional HR'},{label:'Directors'}];
describe('request approval progress',()=>{
  it('marks finished steps done and the waiting step current',()=>{
    const v=progressView('PENDING',{state:'PENDING',stage:1,steps});
    expect(v.steps.map(s=>s.state)).toEqual(['done','done','current','todo','todo']);
    expect(v.summary).toBe('Waiting: Project Manager · 2 of 4');
  });
  it('shows where a request was rejected',()=>{
    const v=progressView('REJECTED',{state:'REJECTED',stage:2,steps});
    expect(v.steps.map(s=>s.state)).toEqual(['done','done','rejected','todo','todo']);
    expect(v.summary).toBe('Rejected at Project Manager');
  });
  it('shows every step done once approved',()=>{
    expect(progressView('APPROVED',{state:'APPROVED',stage:4,steps}).steps.every(s=>s.state==='done')).toBe(true);
  });
  it('shows a draft as not submitted even after an earlier rejection',()=>{
    const v=progressView('DRAFT',{state:'REJECTED',stage:1,steps});
    expect(v.summary).toBe('Draft · not submitted');
    expect(v.steps).toHaveLength(1);
  });
  it('renders the summary and step labels',()=>{
    render(<RequestProgress status="PENDING" progress={{state:'PENDING',stage:0,steps:[{label:'HOD'},{label:'Regional HR'}]}}/>);
    expect(screen.getByText('Waiting: HOD · 1 of 2')).toBeTruthy();
    expect(screen.getByText('Regional HR')).toBeTruthy();
  });
});
