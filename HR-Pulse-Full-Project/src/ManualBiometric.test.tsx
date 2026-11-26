import '@testing-library/jest-dom/vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {RosterTable,VIEW_TABS,type TripState} from './AttendanceRoster';

describe('Manual Biometric attendance roster',()=>{
 it('is a separate tab with import and no trip-card comparison controls',()=>{
  expect(VIEW_TABS.map(([,label])=>label)).toEqual(['Trip card (VLB · ELB · LMV)','Biometric','Trip card vs Biometric','Manual Biometric','M.B-Trip card Mismatch']);
  const trip:TripState={status:'idle',message:'',rows:null};
  render(<RosterTable groups={[]} dates={['2026-11-24']} view="manual" trip={trip}
   bio={{running:false,message:'Imported biometric attendance',days:{},counts:{},errors:{},failed:[]}}
   monthly={false} from="2026-11-24" to="2026-11-24" onImport={vi.fn()} emptyText="No manual biometric attendance imported."/>);
  expect(screen.getByRole('button',{name:'Import attendance log'})).toBeInTheDocument();
  expect(screen.getByText('No manual biometric attendance imported.')).toBeInTheDocument();
  expect(screen.queryByText('Only employees with a difference')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader',{name:'Diff. of Trip Card and Bio-matric'})).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'A-Form No.'})).toBeInTheDocument();
 });
 it('places a working Delete All beside the day-box controls',()=>{
  const remove=vi.fn(),trip:TripState={status:'idle',message:'',rows:null};
  render(<RosterTable groups={[]} dates={['2026-11-24']} view="manual" trip={trip}
   bio={{running:false,message:'Imported biometric attendance',days:{},counts:{},errors:{},failed:[],onDeleteSaved:remove}}
   monthly={false} from="2026-11-24" to="2026-11-24"/>);
  const controls=screen.getByRole('group',{name:'Day boxes'}),button=screen.getByRole('button',{name:'Delete All'});
  expect(controls.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(button);expect(remove).toHaveBeenCalledOnce();
 });
 it('shows all dates with MB / Trip Card values and can keep only mismatched employees',()=>{
  const trip:TripState={status:'ready',message:'',rows:[]};
  const groups=[{key:'1',code:'CMLL17416',name:'Balasani Srinivas',site:'Dhoptala OB 2nd',department:'Driver',designation:'Tipper Driver',shift:'',exempt:false,
   bioCodes:{'2026-11-01':'P','2026-11-02':'A'},tripCodes:{'2026-11-01':'P','2026-11-02':'P'},tripDays:{},hasTripCards:true,pending:0,machines:[],linked:true,
   mismatches:[{date:'2026-11-02',bio:'A',trip:'P',reason:'Attendance status differs',bioDetail:'',tripDetail:''}]},
   {key:'2',code:'CMLL17417',name:'Matching Employee',site:'Dhoptala OB 2nd',department:'Driver',designation:'Driver',shift:'',exempt:false,bioCodes:{'2026-11-01':'P'},tripCodes:{'2026-11-01':'P'},tripDays:{},hasTripCards:true,pending:0,machines:[],linked:true,mismatches:[]}];
  render(<RosterTable groups={groups as never} dates={['2026-11-01','2026-11-02']} view="manualMismatch" trip={trip} monthly={false} from="2026-11-01" to="2026-11-02"/>);
  expect(screen.getAllByText('P / P')).toHaveLength(1);
  expect(screen.getByText('A / P')).toBeInTheDocument();
  expect(screen.queryByText('Matching Employee')).not.toBeInTheDocument();
  expect(screen.getByRole('tab',{name:/Affected Employees 1/})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:/All OK 1/})).toBeInTheDocument();
  expect(screen.getByRole('region',{name:'Affected employee details'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'View dates'}));
  expect(screen.getByText('Attendance status differs')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:/All OK 1/}));
  expect(screen.getAllByText('Matching Employee').length).toBeGreaterThan(0);
  expect(screen.queryByText('Balasani Srinivas')).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'All OK employee details'})).toBeInTheDocument();
 });
});
