import '@testing-library/jest-dom/vitest';
import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {isManualBiometricIIEmployee,isManualMismatchEmployee,manualUsesAForm,RosterTable,VIEW_TABS,type TripState} from './AttendanceRoster';
import {MANUAL_MISMATCH_COLOURS,manualMismatchTone} from './manualMismatchColors';

describe('Manual Biometric attendance roster',()=>{
 it('limits mismatch employees to trip-card staff and biometric drivers or operators',()=>{
  const group=(designation:string,hasTripCards=false,bioCodes:Record<string,string>={'2026-11-01':'P'})=>({designation,hasTripCards,bioCodes} as never);
  expect(isManualMismatchEmployee(group('HR Executive',true))).toBe(true);
  expect(isManualMismatchEmployee(group('Tipper Driver'))).toBe(true);
  expect(isManualMismatchEmployee(group('Dozer Operator'))).toBe(true);
  expect(isManualMismatchEmployee(group('PC OPERATOR'))).toBe(true);
  expect(isManualMismatchEmployee(group('Office Executive'))).toBe(false);
  expect(isManualMismatchEmployee(group('Maintenance Helper'))).toBe(false);
  expect(isManualMismatchEmployee(group('Driver',false,{}))).toBe(false);
 });
 it('uses the requested colour category for each MB / Trip Card combination',()=>{
  expect(manualMismatchTone('P','P')).toBe('match');
  expect(manualMismatchTone('A','P')).toBe('absent-present');
  expect(manualMismatchTone('P','A')).toBe('present-absent');
  expect(manualMismatchTone('MP','P')).toBe('miss-present');
  expect(manualMismatchTone('HD','P')).toBe('half-present');
  expect(manualMismatchTone('MP','A')).toBe('miss-absent');
  expect(manualMismatchTone('HD','A')).toBe('half-absent');
  expect(MANUAL_MISMATCH_COLOURS['absent-present'].fill).toBe('FAEEDA');
  expect(MANUAL_MISMATCH_COLOURS['present-absent'].fill).toBe('FCEBEB');
 });
 it('keeps Manual Biometric II to non-Driver and non-Operator staff',()=>{
  const employee=(department:string,designation:string)=>({department,designation} as never);
  expect(isManualBiometricIIEmployee(employee('HR','HR Executive'))).toBe(true);
  expect(isManualBiometricIIEmployee(employee('Maintenance','Fitter'))).toBe(true);
  expect(isManualBiometricIIEmployee(employee('DRIVERS','Office Staff'))).toBe(false);
  expect(isManualBiometricIIEmployee(employee('Production','Tipper Driver'))).toBe(false);
  expect(isManualBiometricIIEmployee(employee('OPERATORS','Helper'))).toBe(false);
  expect(isManualBiometricIIEmployee(employee('Production','Dozer Operator'))).toBe(false);
 });
 it('uses A-Form only for NCL manual logs, not WCL',()=>{
  expect(manualUsesAForm('Jayant OB East')).toBe(true);
  expect(manualUsesAForm('Dudhichua East')).toBe(true);
  expect(manualUsesAForm('Dudhichua West')).toBe(true);
  expect(manualUsesAForm('Dhoptala OB 2nd')).toBe(false);
  expect(manualUsesAForm('Gauri Pauni OB 2nd')).toBe(false);
  expect(manualUsesAForm('Sasti OC')).toBe(false);
 });
 it('is a separate tab with import and no trip-card comparison controls',()=>{
  expect(VIEW_TABS.map(([,label])=>label)).toEqual(['Trip card (VLB · ELB · LMV)','Biometric','Trip card vs Biometric','Manual Biometric','Manual Biometric II','M.B-Trip card Mismatch']);
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
 it('gives Manual Biometric II the DAT import controls',()=>{
  const trip:TripState={status:'idle',message:'',rows:null};
  render(<RosterTable groups={[]} dates={['2026-11-24']} view="manual2" trip={trip}
   bio={{running:false,message:'Imported biometric attendance',days:{},counts:{},errors:{},failed:[]}}
   monthly={false} from="2026-11-24" to="2026-11-24" onImport={vi.fn()} emptyText="No Manual Biometric II attendance imported."/>);
  expect(screen.getByRole('button',{name:'Import DAT file'})).toBeInTheDocument();
  expect(screen.getByText('No Manual Biometric II attendance imported.')).toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'A-Form No.'})).toBeInTheDocument();
 });
 it('hides A-Form No. from WCL Manual Biometric II',()=>{
  const trip:TripState={status:'idle',message:'',rows:null};
  render(<RosterTable groups={[]} dates={['2026-11-24']} view="manual2" trip={trip} showAForm={false}
   bio={{running:false,message:'Imported biometric attendance',days:{},counts:{},errors:{},failed:[]}}
   monthly={false} from="2026-11-24" to="2026-11-24"/>);
  expect(screen.queryByRole('columnheader',{name:'A-Form No.'})).not.toBeInTheDocument();
  expect(screen.getByRole('columnheader',{name:'Employee ID'})).toBeInTheDocument();
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
   bioCodes:{'2026-11-01':'P','2026-11-02':'A','2026-11-04':'P'},tripCodes:{'2026-11-01':'P','2026-11-02':'P','2026-11-03':'P'},tripDays:{},hasTripCards:true,pending:0,machines:[],linked:true,
   mismatches:[{date:'2026-11-02',bio:'A',trip:'P',reason:'Attendance status differs',bioDetail:'',tripDetail:''},{date:'2026-11-03',bio:'',trip:'P',reason:'Trip Card present, biometric missing',bioDetail:'',tripDetail:''},{date:'2026-11-04',bio:'P',trip:'',reason:'Biometric present, Trip Card missing',bioDetail:'',tripDetail:''}]},
   {key:'2',code:'CMLL17417',name:'Matching Employee',site:'Dhoptala OB 2nd',department:'Driver',designation:'Driver',shift:'',exempt:false,bioCodes:{'2026-11-01':'P'},tripCodes:{'2026-11-01':'P'},tripDays:{},hasTripCards:true,pending:0,machines:[],linked:true,mismatches:[]}];
  render(<RosterTable groups={groups as never} dates={['2026-11-01','2026-11-02','2026-11-03','2026-11-04']} view="manualMismatch" trip={trip} monthly={false} from="2026-11-01" to="2026-11-04"/>);
  expect(screen.queryByRole('region',{name:/employee details/})).not.toBeInTheDocument();
  expect(screen.getByRole('table',{name:'Manual Biometric and Trip Card comparison'})).toBeInTheDocument();
  expect(screen.getAllByText('P / P').length).toBeGreaterThan(0);
  expect(screen.getAllByText('A / P').length).toBeGreaterThan(0);
  expect(screen.getByRole('button',{name:/P \/ PBoth present/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/A \/ ABoth absent/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/P \/ PBoth present/}));
  const pairDrill=screen.getByRole('region',{name:'P / P records employee details'}),comparisonGrid=screen.getByRole('table',{name:'Manual Biometric and Trip Card comparison'});
  expect(pairDrill).toBeInTheDocument();
  expect(pairDrill.compareDocumentPosition(comparisonGrid)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByText('Matching Employee').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button',{name:'View dates'}).length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button',{name:/Print\/Export/}).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:/P \/ PBoth present/}));
  expect(screen.getByRole('button',{name:/^Both present/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Trip Card only/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Biometric only/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/Trip Card only/}));
  fireEvent.click(screen.getByRole('button',{name:'View dates'}));
  expect(screen.getByText(/Trip Card present: P \(Present\) · Manual Biometric record missing/)).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:/Affected Employees 1/})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:/All OK 1/})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:/Affected Employees 1/}));
  expect(screen.queryByText('Matching Employee')).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'Affected employee details'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'View dates'}));
    expect(screen.getByText(/Attendance status differs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:/All OK 1/}));
  expect(screen.getAllByText('Matching Employee').length).toBeGreaterThan(0);
  expect(screen.queryByText('Balasani Srinivas')).not.toBeInTheDocument();
  expect(screen.getByRole('region',{name:'All OK employee details'})).toBeInTheDocument();
 });
});
