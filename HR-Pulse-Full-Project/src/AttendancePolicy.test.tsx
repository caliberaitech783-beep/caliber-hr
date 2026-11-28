import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import AttendancePolicySettings from './AttendancePolicy';
import AttendanceRegister,{hoursText,monthRange,siteTotals,weekStart,type RegisterRow} from './AttendanceRegister';
import AttendanceManagement,{ATTENDANCE_MENU,attendanceGroup,attendanceSidebarView,attendanceSidebarViews,legacyModuleUrl} from './AttendanceManagement';
import {DEFAULT_POLICY} from '../server/attendance-policy.mjs';

afterEach(()=>{vi.unstubAllGlobals();});
const policy={...DEFAULT_POLICY,exemptRoles:[...DEFAULT_POLICY.exemptRoles]};

it('groups the Attendance Management sub menus as approved',()=>{
 expect(ATTENDANCE_MENU.map(g=>[g.group,[...g.items]])).toEqual([
  ['Attendance fetch',['Biometric integration','Trip card and logbook']],
  ['Attendance regularization',['Late come / early going','OD (on duty)','Miss punch','Gate pass','Overtime','Weekly off and holiday']],
  ['Shift management',['Shift roster','Monthly attendance register','Weekly and daily attendance register','Site-wise attendance']],
  ['Settings',['HR policy · attendance']],
 ]);
 expect(attendanceGroup('Gate pass')).toBe('Attendance regularization');
 expect(legacyModuleUrl('punch',{...policy,graceMinutes:10})).toMatch(/attendance-module\.html\?view=punch&grace=10&full=7&absent=4&lunch=60&perCut=3$/);
});

it('formats register periods and site totals',()=>{
 expect(monthRange('2026-02')).toEqual({from:'2026-02-01',to:'2026-02-28'});
 expect(weekStart('2026-11-20')).toBe('2026-11-16');
 expect(weekStart('2026-11-16')).toBe('2026-11-16');
 expect(hoursText(419)).toBe('6:59');
 expect(hoursText(null)).toBe('—');
 const day=(status:string,extra={})=>({date:'2026-11-02',status,note:'',in:'',out:'',workedMinutes:null,late:false,early:false,missPunch:status==='MP',gatePassMinutes:0,gatePassDeduction:0,exempt:false,...extra});
 const row=(site:string,days:ReturnType<typeof day>[])=>({id:site+days.length,code:'',name:'',siteId:'',site,siteType:'',shift:'',designation:'',exempt:false,shiftStart:'',shiftEnd:'',days,summary:{} as RegisterRow['summary']});
 expect(siteTotals([row('Nagpur',[day('P',{late:true})]),row('Nagpur',[day('HD',{early:true})]),row('Sasti',[day('MP'),day('L'),day('H')])])).toEqual([
  {site:'Nagpur',employees:2,P:1,HD:1,A:0,MP:0,leave:0,off:0,late:1,early:1},
  {site:'Sasti',employees:1,P:0,HD:0,A:0,MP:1,leave:1,off:1,late:0,early:0},
 ]);
});

it('shows the policy rules and lets an HR administrator change the numbers',async()=>{
 const calls:{url:string;body?:string}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  calls.push({url,body:init?.body as string});
  if(init?.method==='POST')return Response.json({policy:JSON.parse(String(init.body)).policy,version:1,updatedBy:'hr.admin',updatedAt:'2026-11-20T05:00:00Z'});
  return Response.json({policy,version:0,updatedBy:'',updatedAt:null,canEdit:true});
 }));
 render(<AttendancePolicySettings grant={'a'.repeat(43)}/>);
 expect(await screen.findByText(/Under 4 hrs = Absent · 4 hrs to under 7 hrs = Half duty · 7 hrs or more = Full duty/)).toBeTruthy();
 expect(screen.getByText(/08:15 is on time and 08:16 is late/)).toBeTruthy();
 expect(screen.getByText(/Drivers are not exempt/)).toBeTruthy();
 const save=screen.getByRole('button',{name:'Save policy'});
 expect(save).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/^Late come grace after shift start/),{target:{value:'10'}});
 expect(screen.getByText(/08:10 is on time and 08:11 is late/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Exempt roles (comma separated)'),{target:{value:'CMD, Driver'}});
 expect(screen.getByRole('alert')).toHaveTextContent('Drivers are not exempt');
 expect(save).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Exempt roles (comma separated)'),{target:{value:'CMD, Director, VP, CFO, CA'}});
 fireEvent.click(save);
 expect(await screen.findByText(/Attendance policy saved/)).toBeTruthy();
 const posted=calls.find(c=>c.body);
 expect(JSON.parse(posted!.body!)).toEqual({version:0,policy:{...policy,graceMinutes:10}});
});

it('keeps the policy read-only for site-restricted users',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({policy,version:2,updatedBy:'hr.admin',updatedAt:null,canEdit:false})));
 render(<AttendancePolicySettings grant={'a'.repeat(43)}/>);
 expect(await screen.findByText(/Only an HR administrator without a site restriction/)).toBeTruthy();
 expect(screen.getByLabelText(/^Lunch break excluded from working hours/)).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Save policy'})).toBeNull();
});

const register={from:'2026-11-02',to:'2026-11-02',policy,rows:[{id:'e1',code:'C001',name:'Ravi Kumar',siteId:'s1',site:'Nagpur',siteType:'Office',shift:'General',designation:'Accountant',exempt:false,shiftStart:'08:00',shiftEnd:'17:00',
 days:[{date:'2026-11-02',status:'HD',note:'',in:'08:16',out:'14:00',workedMinutes:284,late:true,early:true,missPunch:false,gatePassMinutes:135,gatePassDeduction:225,exempt:false}],
 summary:{full:0,half:1,absent:0,missPunch:0,late:1,early:1,lateEarly:2,halfDutyCuts:0,duties:0.5,gatePassDeduction:225,H:0,L:0,OD:0,WO:0,IN:0}}]};

it('shows the daily register and gate pass deductions from the server day calculation',async()=>{
 const fetch=vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;return Response.json({...register,from:q.get('from'),to:q.get('to'),rows:register.rows.map(r=>({...r,days:r.days.map(d=>({...d,date:q.get('from')}))}))});});
 vi.stubGlobal('fetch',fetch);
 const {unmount}=render(<AttendanceRegister grant={'a'.repeat(43)} mode="week-day"/>);
 const table=await screen.findByRole('table');
 await waitFor(()=>expect(within(table).getByText('Ravi Kumar')).toBeTruthy());
 expect(within(table).getByText('Half duty')).toBeTruthy();
 expect(within(table).getByRole('cell',{name:'Late'})).toBeTruthy();
 expect(within(table).getByText('4:44')).toBeTruthy();
 unmount();
 render(<AttendanceRegister grant={'a'.repeat(43)} mode="gate"/>);
 const gate=await screen.findByRole('table');
 await waitFor(()=>expect(within(gate).getByText('₹225')).toBeTruthy());
 expect(within(gate).getByText('2:15')).toBeTruthy();
 expect(String((fetch.mock.calls.at(-1) as unknown[]|undefined)?.[0])).toMatch(/attendance\/register\?from=\d{4}-\d{2}-01&to=/);
});

it('opens OD and gate pass from the existing leave screens without the leave form',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;return Response.json(url.includes('register')?{...register,from:q.get('from'),to:q.get('to'),rows:[]}:url.includes('policy')?{policy,version:0,canEdit:false}:url.includes('records/')?{rows:[],total:0}:{});}));
 const module={title:'Gate Pass',menu:'Employee Master',fields:[],canWrite:true};
 const {unmount}=render(<AttendanceManagement grant={'a'.repeat(43)} view="Gate pass" config={{gatePasses:module}}/>);
 expect(await screen.findByRole('button',{name:'Gate Pass'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Employee Leave Form'})).toBeNull();
 expect(screen.queryByRole('button',{name:'OD Form'})).toBeNull();
 expect(screen.getByText('Attendance regularization › Gate pass')).toBeTruthy();
 unmount();
 render(<AttendanceManagement grant={'a'.repeat(43)} view="OD (on duty)"/>);
 expect(await screen.findByRole('button',{name:'OD Form'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Gate Pass'})).toBeNull();
});


it('shows OD, Miss punch, Gate pass, Overtime and Weekly off and holiday as tabs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;return Response.json(url.includes('register')?{...register,from:q.get('from'),to:q.get('to'),rows:[]}:url.includes('policy')?{policy,version:0,canEdit:false}:url.includes('records/')?{rows:[],total:0}:{});}));
 const onNavigate=vi.fn();
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Miss punch" onNavigate={onNavigate}/>);
 const tabs=screen.getByRole('tablist',{name:'Attendance regularization'});
 expect(within(tabs).getAllByRole('tab').map(t=>t.textContent)).toEqual(['Late come / early going','OD','Miss punch','Gate pass','Overtime','Weekly off and holiday']);
 expect(within(tabs).getByRole('tab',{name:'Miss punch'}).getAttribute('aria-selected')).toBe('true');
 fireEvent.click(within(tabs).getByRole('tab',{name:'OD'}));
 expect(onNavigate).toHaveBeenCalledWith('OD (on duty)');
 expect(await screen.findByText('Attendance regularization › OD (on duty)')).toBeTruthy();
});

it('opens the five tab-only screens from Late come / early going, not from the sidebar',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Late come / early going"/>);
 expect(screen.getByRole('tablist',{name:'Attendance regularization'})).toBeTruthy();
 expect(attendanceSidebarViews).toEqual(['Biometric integration','Trip card and logbook','Late come / early going','Shift roster','Monthly attendance register','Weekly and daily attendance register','Site-wise attendance','HR policy · attendance']);
 expect(attendanceSidebarView('Overtime')).toBe('Late come / early going');
 expect(attendanceSidebarView('Shift roster')).toBe('Shift roster');
});

// Owner, 28 Nov 2026: Shift roster has both rosters, the trip card roster and the other staff roster, on tabs.
it('shows the trip card roster and the other staff roster on their own tabs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('lookups')?[{kind:'sites',id:'s1',name:'Majri OC'}]:url.includes('policy')?{policy,version:0,canEdit:false}:{rows:[]})));
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Shift roster"/>);
 const tabs=screen.getByRole('tablist',{name:'Roster'});
 expect(within(tabs).getAllByRole('tab').map(t=>t.textContent)).toEqual(['Trip card roster','Other staff roster']);
 expect(within(tabs).getByRole('tab',{name:'Trip card roster'}).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByRole('heading',{name:'Shift roster'})).toBeTruthy();
 fireEvent.click(within(tabs).getByRole('tab',{name:'Other staff roster'}));
 expect(await screen.findByRole('heading',{name:'Other staff roster'})).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Shift roster'})).toBeNull();
 const source=screen.getByLabelText('Roster source');
 expect(within(source).getAllByRole('button').map(b=>b.textContent)).toEqual(['Other Staff Biometric','Comparison']);
});

it('shows no regularization tabs on other attendance screens',()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Monthly attendance register"/>);
 expect(screen.queryByRole('tablist',{name:'Attendance regularization'})).toBeNull();
});
