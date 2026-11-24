import '@testing-library/jest-dom/vitest';
import {render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {RosterTable,VIEW_TABS,type TripState} from './AttendanceRoster';

describe('Manual Biometric attendance roster',()=>{
 it('is a separate tab with import and no trip-card comparison controls',()=>{
  expect(VIEW_TABS.map(([,label])=>label)).toEqual(['Trip card (VLB · ELB · LMV)','Biometric','Trip card vs Biometric','Manual Biometric']);
  const trip:TripState={status:'idle',message:'',rows:null};
  render(<RosterTable groups={[]} dates={['2026-11-24']} view="manual" trip={trip}
   bio={{running:false,message:'Imported biometric attendance',days:{},counts:{},errors:{},failed:[]}}
   monthly={false} from="2026-11-24" to="2026-11-24" onImport={vi.fn()} emptyText="No manual biometric attendance imported."/>);
  expect(screen.getByRole('button',{name:'Import attendance log'})).toBeInTheDocument();
  expect(screen.getByText('No manual biometric attendance imported.')).toBeInTheDocument();
  expect(screen.queryByText('Only employees with a difference')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader',{name:'Diff. of Trip Card and Bio-matric'})).not.toBeInTheDocument();
 });
});
