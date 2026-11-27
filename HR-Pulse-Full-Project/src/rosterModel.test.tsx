import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import AttendanceRegister,{type RegisterRow} from './AttendanceRegister';
import {buildRoster,lineTotals,tripDutyCode} from './rosterModel';
import {rosterWorkbook} from './attendanceRosterExcel';
import type {AttendanceRow} from './misAttendanceModel';
import {DEFAULT_POLICY} from '../server/attendance-policy.mjs';

afterEach(()=>{vi.unstubAllGlobals();});
const dates=['2026-11-01','2026-11-02','2026-11-03','2026-11-04','2026-11-05'];
const day=(date:string,status:string,calendar='')=>({date,status,calendar,note:'',in:status==='P'?'08:00':'',out:status==='P'?'17:00':'',workedMinutes:status==='P'?480:null,late:false,early:false,missPunch:status==='MP',gatePassMinutes:0,gatePassDeduction:0,exempt:false});
const bio:RegisterRow={id:'e1',code:'CMPL101',name:'Ramesh Kumar',siteId:'s1',site:'Gevra',siteType:'Site',department:'Operations',shift:'General',designation:'Dumper operator',exempt:false,shiftStart:'08:00',shiftEnd:'17:00',
 days:[day('2026-11-01','WO','WO'),day('2026-11-02','P'),day('2026-11-03','A'),day('2026-11-04','P'),day('2026-11-05','MP')],
 summary:{full:2,half:0,absent:1,missPunch:1,late:0,early:0,lateEarly:0,halfDutyCuts:0,duties:2,gatePassDeduction:0,H:0,L:0,OD:0,WO:1,IN:0}};
const at=(date:string,from:string,to:string)=>({start:`${date} ${from}`,end:`${date} ${to}`,startMs:Date.parse(`${date}T${from}:00+05:30`),endMs:Date.parse(`${date}T${to}:00+05:30`)});
const duty=(date:string,extra:Partial<AttendanceRow>={}):AttendanceRow=>({id:date,date,site:'Gevra',shift:'S1',employeeId:'D-77',employeeKey:'k1',employeeName:'Ramesh Kumar',caliberCode:'cmpl101',designation:'Dumper',
 sources:['Trip card'],equipment:['DT-12'],references:'',note:'',output:'14 trips',window:at(date,'06:00','14:00'),status:'Present',verification:'MIS batch closed',verified:true,otHours:0,otNote:'',...extra});
const trips=[duty('2026-11-02'),duty('2026-11-03'),duty('2026-11-04',{window:at('2026-11-04','06:00','11:00')}),duty('2026-11-05',{verified:false,status:'Pending',verification:'MIS batch open'})];

it('marks a punched trip card Present whatever its hours (no 4-hour half day)',()=>{
 expect(tripDutyCode(trips[0])).toBe('P');
 expect(tripDutyCode(trips[2])).toBe('P');
 expect(tripDutyCode(duty('2026-11-06',{window:at('2026-11-06','06:00','08:00')}))).toBe('P');
 expect(tripDutyCode(duty('2026-11-06',{window:undefined}))).toBe('P');
 expect(tripDutyCode(duty('2026-11-06',{status:'Absent'}))).toBe('A');
 expect(tripDutyCode(trips[3])).toBe('?');
});

it('marks the employee Present for the date when Shift 3 is present and Shift 1 and 2 are absent',()=>{
 const date='2026-11-17';
 const shiftDuties=[
  duty(date,{id:'s1',shift:'S1',status:'Absent'}),
  duty(date,{id:'s2',shift:'S2',status:'Absent'}),
  duty(date,{id:'s3',shift:'S3',status:'Present'})
 ];
 const [group]=buildRoster([{...bio,days:[day(date,'P')]}],shiftDuties,[date],'2026-11-18',DEFAULT_POLICY);
 expect(group.tripCodes[date]).toBe('P');
 expect(group.tripDays[date].duties).toHaveLength(3);
});

it('joins trip card and biometric on the Caliber code and lists the days that differ',()=>{
 const [g]=buildRoster([bio],trips,dates,'2026-11-06',DEFAULT_POLICY);
 expect(dates.map(d=>g.tripCodes[d])).toEqual(['WO','P','P','P','?']);
 expect(dates.map(d=>g.bioCodes[d])).toEqual(['WO','P','A','P','MP']);
 expect(g.mismatches.map(m=>[m.date,m.reason])).toEqual([['2026-11-03','Trip card present, biometric absent']]);
 expect(g.pending).toBe(1);
 expect(lineTotals(g.tripCodes,dates)).toMatchObject({present:3,half:0,weeklyOff:1,paidDays:4});
 const other=buildRoster([],[duty('2026-11-02',{caliberCode:'CMPL900',employeeName:'Not linked'})],dates,'2026-11-06');
 expect(other[0].code).toBe('CMPL900');
 expect(other[0].bio).toBeUndefined();
 expect(other[0].mismatches[0].reason).toBe('Trip card on duty, no biometric record');
 const office=buildRoster([bio],[],dates,'2026-11-06')[0];
 expect([office.hasTripCards,office.mismatches.length]).toEqual([false,0]);
});

it('safely reconciles an old CMPL trip-card prefix with the unique CMLL employee identity',()=>{
 const date='2026-11-08',employee={...bio,id:'majri-8812',code:'CMLL8812',name:'Ajay Kumar Yadav',site:'Majri OC',department:'Driver',designation:'Tipper Driver',days:[day(date,'MP')]};
 const card=duty(date,{caliberCode:'CMPL8812',employeeName:'AJAY KUMAR YADAV',site:'Majri OC',designation:'Tipper Driver'});
 const groups=buildRoster([employee],[card],[date],'2026-11-09',DEFAULT_POLICY);
 expect(groups).toHaveLength(1);
 expect(groups[0].code).toBe('CMLL8812');
 expect(groups[0].tripCodes[date]).toBe('P');
 expect(groups[0].bioCodes[date]).toBe('MP');
 expect(groups[0].mismatches[0].reason).toBe('Trip card on duty, biometric miss punch');
});

it('does not guess when a legacy trip-card code could identify more than one employee',()=>{
 const date='2026-11-08',same={...bio,name:'Same Name',site:'Majri OC',days:[day(date,'P')]};
 const groups=buildRoster([{...same,id:'one',code:'CMLL0099'},{...same,id:'two',code:'OTHER99'}],[duty(date,{caliberCode:'CMPL99',employeeName:'Same Name',site:'Majri OC'})],[date],'2026-11-09');
 expect(groups.filter(group=>group.hasTripCards)).toHaveLength(1);
 expect(groups.find(group=>group.hasTripCards)?.code).toBe('CMPL99');
});

it('shows Trip Card and Bio Matric lines, the difference count and its days',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;
  if(url.includes('attendance/mis'))return Response.json({attendanceEquipment:[],attendanceShifts:trips.map(t=>({siteKey:'Gevra',date:t.date,shift:'S1',state:t.verified?'closed':'open',batch:'B1'})),
   otDuties:trips.map(t=>({date:t.date,site:'Gevra',siteKey:'Gevra',shift:'S1',employeeId:'D-77',employeeKey:'k1',employeeName:'Ramesh Kumar',caliberCode:'CMPL101',doors:'DT-12',equipment:'Dumper',category:'Dumper',logBooks:['VLB'],books:'',trips:14})),
   ot:[],performance:trips.map(t=>({date:t.date,site:'Gevra',siteKey:'Gevra',shift:'S1',employeeId:'D-77',employeeName:'Ramesh Kumar',start:t.window!.start,end:t.window!.end,km:null})),details:[],exceptions:[],corrections:[],canEdit:true});
  const from=q.get('from')!;
  return Response.json({from,to:q.get('to'),policy:DEFAULT_POLICY,rows:[{...bio,days:bio.days.map(d=>({...d,date:from.slice(0,8)+d.date.slice(8)}))}]});}));
 render(<AttendanceRegister grant={'a'.repeat(43)} mode="month"/>);
 const table=await screen.findByRole('table',{name:'Attendance roster'});
 await waitFor(()=>expect(within(table).getByRole('rowheader',{name:'Trip Card'})).toBeTruthy());
 expect(within(table).getByRole('rowheader',{name:'Bio Matric'})).toBeTruthy();
 for(const heading of ['Source','Sr. No.','Employee ID','Name','Department','Designation','Paid days','Diff. of Trip Card and Bio-matric'])expect(within(table).getByRole('columnheader',{name:heading})).toBeTruthy();
 const open=await within(table).findByRole('button',{name:/days differ for Ramesh Kumar/});
 fireEvent.click(open);
 const drill=screen.getByRole('table',{name:'Differences for Ramesh Kumar'});
 expect(within(drill).getAllByRole('row').length).toBeGreaterThan(1);
 fireEvent.click(screen.getByLabelText('Only employees with a difference'));
 expect(within(table).getByText('Ramesh Kumar')).toBeTruthy();
});

it('writes the coloured roster workbook with both lines and a Differences sheet',async()=>{
 const groups=buildRoster([bio],trips,dates,'2026-11-06');
 const wb=await rosterWorkbook({groups,dates,tripsLoaded:true,monthly:true,from:'2026-11-01',to:'2026-11-05'});
 const ws=wb.getWorksheet('Roster')!;
 const last=ws.getRow(4).cellCount;
 expect([ws.getCell('A5').value,ws.getCell('A6').value]).toEqual(['Trip Card','Bio Matric']);
 expect(ws.getRow(4).getCell(last).value).toBe('Diff. of Trip Card and Bio-matric');
 expect(ws.getRow(5).getCell(last).value).toBe(1);
 expect((ws.getCell('I5').fill as {fgColor:{argb:string}}).fgColor.argb).toBe('FFEAF3DE');
 expect(wb.getWorksheet('Differences')!.rowCount).toBe(2);
});


it('splits trip card requests into weeks and matches HR and MIS site names',async()=>{
 const {weekPieces,sameSite}=await import('./rosterModel');
 expect(weekPieces('2026-11-01','2026-11-22')).toEqual([{from:'2026-11-01',to:'2026-11-07'},{from:'2026-11-08',to:'2026-11-14'},{from:'2026-11-15',to:'2026-11-21'},{from:'2026-11-22',to:'2026-11-22'}]);
 expect([sameSite('Jayant','Jayant OB'),sameSite('Jayant OB','jayant-ob'),sameSite('Gevra','Dipka'),sameSite('Majri','Majri Coal'),sameSite('Sasti OC','Sasti OCP'),sameSite('Sasti OC','SASTI'),sameSite('Sasti OC','Dhuptala OC')]).toEqual([true,true,false,true,true,true,false]);
});

const misReport=()=>({attendanceEquipment:[],attendanceShifts:trips.map(t=>({siteKey:'Gevra',date:t.date,shift:'S1',state:t.verified?'closed':'open',batch:'B1'})),
 otDuties:[...trips.map(t=>({date:t.date,site:'Gevra',siteKey:'Gevra',shift:'S1',employeeId:'D-77',employeeKey:'k1',employeeName:'Ramesh Kumar',caliberCode:'CMPL101',doors:'DT-12',equipment:'Dumper',category:'Dumper',logBooks:['VLB'],books:'',trips:14})),
  {date:'2026-11-02',site:'Dipka',siteKey:'Dipka',shift:'S1',employeeId:'D-90',employeeKey:'k9',employeeName:'Other Site',caliberCode:'CMPL909',doors:'DZ-1',equipment:'Dozer',category:'Dozer',logBooks:['ELB'],books:'',trips:null}],
 ot:[],performance:trips.map(t=>({date:t.date,site:'Gevra',siteKey:'Gevra',shift:'S1',employeeId:'D-77',employeeName:'Ramesh Kumar',start:t.window!.start,end:t.window!.end,km:null})),details:[],exceptions:[],corrections:[],canEdit:true});

it('Attendance roster tab: site first, Trip card reads MIS week by week, Biometric reads the punches',async()=>{
 const {default:AttendanceManagement}=await import('./AttendanceManagement');
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(url);const q=new URL(url,'https://x').searchParams;
  if(url.includes('attendance/status'))return Response.json({configured:true,bridgeOnline:false,bridgeLastSeen:null,devices:[],lastFetch:null,canLink:false,canManageDevices:false});
  if(url.includes('attendance/punches'))return Response.json({rows:[]});
  if(url.includes('attendance/unlinked'))return Response.json([]);
  if(url.includes('attendance/policy'))return Response.json({policy:DEFAULT_POLICY,version:1,canEdit:false});
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'GV',name:'Gevra'},{id:'s2',kind:'sites',code:'DP',name:'Dipka'}]);
  if(url.includes('attendance/mis'))return Response.json(misReport());
  if(url.includes('attendance/manual-biometric'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,site:q.get('site'),machines:[],rows:[{...bio,linked:true,machinesUsed:['Main gate · 101']}]});
  if(url.includes('attendance/site-register'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,site:q.get('site'),
   machines:[{serial:'SST01',name:'ESSL K90',location:'Main gate',online:true,lastContact:null,lastPunch:'2026-11-10 16:10',punches:42}],
   rows:q.get('site')==='Gevra'?[{...bio,linked:true,machinesUsed:['Main gate · 101'],days:bio.days.map(d=>({...d,punches:d.in?[d.in+' Main gate',d.out+' Main gate']:[]}))},
    {...bio,id:'u:SST01|77',code:'',name:'RAMU (machine)',department:'',designation:'',linked:false,machinesUsed:['Main gate · 77']}]:[]});
  return Response.json({rows:[],total:0});}));
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Biometric integration"/>);
 expect(screen.queryByText('Attendance fetch › Biometric integration')).toBeNull();
 expect(screen.queryByText(/Punches from the ESSL fingerprint/)).toBeNull();
 const tabs=document.querySelector('[aria-label="Biometric views"]')!.querySelectorAll('button');
 expect(document.querySelector('.attendance-topbar')?.contains(screen.getByRole('button',{name:'Fetch attendance'}))).toBe(true);
 expect([...tabs].map(b=>b.textContent).slice(-2)).toEqual(['Biometric vs trip card','Attendance roster']);
 fireEvent.click(screen.getByRole('button',{name:'Attendance roster'}));
 expect(screen.queryByText(/Choose the site and dates, then press Trip card/)).toBeNull();
 const trip=await screen.findByRole('button',{name:'Trip card (VLB · ELB · LMV)'});
 expect(trip).toBeDisabled();
 expect(screen.getByText('Select a site first.')).toBeTruthy();
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Gevra'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Gevra'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-01'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-10'}});
 expect(calls.some(u=>u.includes('attendance/mis')||u.includes('attendance/register'))).toBe(false);
 fireEvent.click(trip);
 const table=await screen.findByRole('table',{name:'Attendance roster'});
 await waitFor(()=>expect(within(table).getByText('Ramesh Kumar')).toBeTruthy());
 fireEvent.click(screen.getByLabelText('Department'));
 expect(screen.getByRole('checkbox',{name:'Operations'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Smart search Department'),{target:{value:'oper'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Operations'}));
 expect(screen.getByText('Operations',{selector:'summary'})).toBeTruthy();
 fireEvent.click(screen.getAllByRole('button',{name:'Clear filter'})[0]);
 expect(screen.getByText('All departments',{selector:'summary'})).toBeTruthy();
 fireEvent.click(screen.getByLabelText('Designation'));
 expect(screen.getByRole('checkbox',{name:'Dumper operator'})).toBeTruthy();
 expect(screen.getByLabelText('Smart search Designation')).toBeTruthy();
 expect(within(table).queryByPlaceholderText('Search')).toBeNull();
 const employeeFilter=within(table).getByRole('button',{name:'Filter Employee ID'});
 vi.spyOn(employeeFilter,'getBoundingClientRect').mockReturnValue({left:120,bottom:200} as DOMRect);
 fireEvent.click(employeeFilter);
 const columnFilter=screen.getByRole('dialog',{name:'Employee ID column filter'});
 expect(columnFilter).toHaveStyle({left:'120px',top:'205px'});
 expect(within(columnFilter).getByRole('button',{name:'Sort Employee ID ascending'})).toBeTruthy();
 expect(within(columnFilter).getByRole('button',{name:'Sort Employee ID descending'})).toBeTruthy();
 expect(within(columnFilter).getByRole('button',{name:'Clear Employee ID filter and sort'})).toBeTruthy();
 expect(within(columnFilter).getByPlaceholderText('Filter...')).toBeTruthy();
 expect(within(columnFilter).getByRole('button',{name:'All values'})).toBeTruthy();
 fireEvent.click(within(columnFilter).getByRole('button',{name:'CMPL101'}));
 expect(within(columnFilter).getByRole('button',{name:'CMPL101'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(within(columnFilter).getByRole('button',{name:'Close'}));
 expect(within(table).getByText('Ramesh Kumar')).toBeTruthy();
 expect(within(table).queryByText('Other Site')).toBeNull();
 expect(within(table).getByText(/VLB \d/)).toBeTruthy();
 expect(calls.filter(u=>u.includes('attendance/mis')).map(u=>new URL(u,'https://x').searchParams.get('from')).sort()).toEqual(['01','02','03','04','05','06','07','08','09','10'].map(d=>'2026-11-'+d));
 expect(calls.filter(u=>u.includes('attendance/mis')).every(u=>new URL(u,'https://x').searchParams.get('site')==='Gevra')).toBe(true);
 await waitFor(()=>expect(within(table).getByText('Operations')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Biometric'}));
 await waitFor(()=>expect(within(screen.getByRole('table',{name:'Attendance roster'})).getByText('Ramesh Kumar')).toBeTruthy());
 expect(calls.some(u=>u.includes('attendance/site-register')&&u.includes('site=Gevra'))).toBe(true);
 // Machines panel, In / Out under the codes, the machine column and the unlinked machine ID.
 expect(screen.getByRole('heading',{name:'Gevra · 1 biometric machine'})).toBeTruthy();
 const roster=screen.getByRole('table',{name:'Attendance roster'});
 expect(within(roster).getByRole('columnheader',{name:'Machine · ID'})).toBeTruthy();
 expect(within(roster).getByRole('columnheader',{name:'Worked hours'})).toBeTruthy();
 expect(within(roster).getAllByText('08:00').length).toBeGreaterThan(0);
 expect(within(roster).getAllByText('17:00').length).toBeGreaterThan(0);
 expect(within(roster).getByText('Not linked')).toBeTruthy();
 expect(within(roster).getByText('RAMU (machine)')).toBeTruthy();
 fireEvent.click(within(roster).getByRole('button',{name:'Filter Name'}));
 const nameFilter=screen.getByRole('dialog',{name:'Name column filter'});
 fireEvent.click(within(nameFilter).getByRole('button',{name:'Ramesh Kumar'}));
 fireEvent.click(within(nameFilter).getByRole('button',{name:'RAMU (machine)'}));
 expect(within(nameFilter).getByRole('button',{name:'Ramesh Kumar'})).toHaveAttribute('aria-pressed','true');
 expect(within(nameFilter).getByRole('button',{name:'RAMU (machine)'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(within(nameFilter).getByRole('button',{name:'Close'}));
 expect(within(roster).getByText('Ramesh Kumar')).toBeTruthy();
 expect(within(roster).getByText('RAMU (machine)')).toBeTruthy();
 expect(screen.queryByText(/machine ID punched at Gevra but is not linked/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Upload machine log'}));
 const upload=screen.getByRole('dialog',{name:'Upload machine log · Gevra'});
 expect(within(upload).getByLabelText('Machine log files')).toBeTruthy();
 fireEvent.click(within(upload).getByRole('button',{name:'Cancel'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Codes only'}));
 expect(within(roster).queryAllByText('08:00').length).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'Trip card vs Biometric'}));
 expect(await screen.findByRole('button',{name:/days differ for Ramesh Kumar/})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Manual Biometric'}));
 await waitFor(()=>expect(within(screen.getByRole('table',{name:'Attendance roster'})).getByText('Ramesh Kumar')).toBeTruthy());
 expect(calls.some(u=>u.includes('attendance/manual-biometric')&&u.includes('site=Gevra'))).toBe(true);
 expect(screen.queryByText('Only employees with a difference')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Print\/Export/}));
 expect(screen.getByRole('menuitem',{name:'Download as PDF'})).toBeTruthy();
 expect(screen.getByRole('menuitem',{name:'Smart Print'})).toBeTruthy();
 expect(screen.getByRole('menuitem',{name:'Download as Excel'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'M.B-Trip card Mismatch'}));
 const comparison=await screen.findByRole('tablist',{name:'Employee comparison status'});
 expect(within(comparison).getByRole('tab',{name:/Affected Employees/})).toHaveAttribute('aria-selected','true');
 expect(within(comparison).getByRole('tab',{name:/All OK/})).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Affected employee details'})).toBeNull();
 fireEvent.click(within(comparison).getByRole('tab',{name:/Affected Employees/}));
 const breakdown=await screen.findByRole('region',{name:'Affected employee details'});
 const viewDates=within(breakdown).getAllByRole('button',{name:'View dates'})[0];
 const employeeRow=viewDates.closest('tr')!;
 fireEvent.click(viewDates);
 expect(employeeRow.nextElementSibling).toHaveClass('manual-date-row');
 expect(within(employeeRow.nextElementSibling as HTMLElement).getByText(/exact affected records/)).toBeTruthy();
 fireEvent.click(within(breakdown).getByRole('button',{name:'Print/Export'}));
 expect(within(breakdown).getByRole('menuitem',{name:'Smart Print / PDF'})).toBeTruthy();
 expect(within(breakdown).getByRole('menuitem',{name:'Download as Excel'})).toBeTruthy();
});

it('reads MIS one day per request, retries failed days, and keeps the days that worked',async()=>{
 const {fetchTripCards,setRetryPause}=await import('./rosterData');
 setRetryPause(async()=>{});
 const tries:Record<string,number>={};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const day=new URL(url,'https://x').searchParams.get('from')!;tries[day]=(tries[day]||0)+1;
  if(day==='2026-11-03')return Response.json({error:'The MIS attendance feed is temporarily unavailable.'},{status:503});
  if(day==='2026-11-02'&&tries[day]===1)throw new DOMException('signal timed out','TimeoutError');
  const report=misReport();return Response.json({...report,otDuties:report.otDuties.filter(d=>d.date===day||d.date<day)});}));
 const progress:number[]=[];
 const result=await fetchTripCards('a'.repeat(43),'2026-11-01','2026-11-04','Sasti OC'.replace('Sasti OC','Gevra'),done=>progress.push(done));
 // 03 fails every time: three tries, then three more in the second pass. 02 timed out once and then worked.
 expect(tries).toEqual({'2026-11-01':1,'2026-11-02':2,'2026-11-03':6,'2026-11-04':1});
 expect(result.failed).toEqual(['2026-11-03']);
 expect([...new Set(result.rows.map(r=>r.date))].sort()).toEqual(['2026-11-02','2026-11-04']);
 expect(result.misSites).toEqual(['Dipka','Gevra']);
 expect(progress.at(-1)).toBe(4);
});

it('reports each day as it arrives so the muster fills in day by day',async()=>{
 const {streamTripCards,setRetryPause}=await import('./rosterData');
 const {applyDay}=await import('./AttendanceRoster');
 setRetryPause(async()=>{});
 let first=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const day=new URL(url,'https://x').searchParams.get('from')!;
  if(day==='2026-11-03'&&first){first=false;return Response.json({error:'MIS busy'},{status:503});}
  return Response.json(misReport());}));
 const updates:string[]=[];let stream:Parameters<typeof applyDay>[0]={key:'k',days:{},rows:{},errors:{},sites:[],runs:0,saved:{},fresh:[],save:null,signatures:{},stale:[],unchecked:false};
 const failed=await streamTripCards('a'.repeat(43),['2026-11-02','2026-11-03','2026-11-04'],'Gevra',u=>{updates.push(u.day.slice(8)+':'+u.state);stream=applyDay(stream,u);});
 expect(failed).toEqual([]);
 expect(updates.filter(u=>u.endsWith(':done')).sort()).toEqual(['02:done','03:done','04:done']);
 expect(updates).toContain('03:retrying');
 expect(updates.indexOf('02:done')).toBeLessThan(updates.indexOf('03:done'));
 expect(Object.keys(stream.rows).sort()).toEqual(['2026-11-02','2026-11-03','2026-11-04']);
 expect(stream.rows['2026-11-02'].every(r=>r.date==='2026-11-02'&&r.site==='Gevra')).toBe(true);
});

it('gives Manual Biometric the extended biometric report timeout',async()=>{
 const timeout=vi.spyOn(AbortSignal,'timeout');
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({rows:[],machines:[]})));
 try{
  const {BIO_DAY_TIMEOUT_MS,fetchManualBiometric}=await import('./rosterData');
  await fetchManualBiometric('a'.repeat(43),'2026-11-01','2026-11-20','Dhoptala OB 2nd');
  expect(timeout).toHaveBeenLastCalledWith(BIO_DAY_TIMEOUT_MS);
 }finally{timeout.mockRestore();}
});

it('opens saved trip cards at once, reads MIS only for the other days, and saves them',async()=>{
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 const calls:{url:string;method:string;body?:{day:string;rows:unknown[]}}[]=[];
 const savedDay=misReport();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,method,body});
  const q=new URL(url,'https://x').searchParams;
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'GV',name:'Gevra'}]);
  if(url.includes('attendance/register'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,rows:[]});
  if(url.includes('attendance/trip-cards')&&method==='GET'){
   const {mapMisAttendance}=await import('./misAttendanceModel');
   return Response.json({site:'Gevra',days:[{day:'2026-11-02',rows:mapMisAttendance(savedDay).filter(r=>r.date==='2026-11-02'&&r.site==='Gevra'),duties:1,savedBy:'vinod',savedAt:'2026-11-22T10:00:00Z'}]});}
  if(url.includes('attendance/trip-cards')&&method==='POST')return Response.json({day:body.day,duties:body.rows.length,savedBy:'vinod',savedAt:'2026-11-22T11:00:00Z'});
  if(url.includes('attendance/mis'))return Response.json(misReport());
  return Response.json({});}));
 render(<AttendanceRosterPage grant={'a'.repeat(43)}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Gevra'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Gevra'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-02'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-04'}});
 fireEvent.click(screen.getByRole('button',{name:'Trip card (VLB · ELB · LMV)'}));
 const save=await screen.findByRole('button',{name:'Save trip cards (2 days)'});
 expect(screen.getByText(/Saved copy: 1 of 3 days .*by vinod\)\. 2 days read from MIS are not saved yet\./)).toBeTruthy();
 expect(calls.filter(c=>c.url.includes('attendance/mis?')).map(c=>new URL(c.url,'https://x').searchParams.get('from')).sort()).toEqual(['2026-11-03','2026-11-04']);
 fireEvent.click(save);
 await screen.findByRole('button',{name:'Saved'});
 const posts=calls.filter(c=>c.method==='POST');
 expect(posts.map(c=>c.body!.day).sort()).toEqual(['2026-11-03','2026-11-04']);
 expect(posts.every(c=>c.body!.rows.length>0)).toBe(true);
 expect(screen.getByText(/Saved copy: 3 of 3 days/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/Fetch again/}));
 await waitFor(()=>expect(calls.filter(c=>c.url.includes('attendance/mis?')).length).toBe(5));
});

// Owner, 27 Nov 2026: Pulse-II is the master of trip card attendance. A saved day is shown only while Pulse-II still signs
// that site and day the same way; a day that changed in MIS after it was saved is read from MIS again, by itself.
it('shows a saved day only while MIS still signs it the same way, and reads a changed day again',async()=>{
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 const {mapMisAttendance}=await import('./misAttendanceModel');
 const calls:{url:string;method:string;body?:{day:string;rows:unknown[];signature?:string}}[]=[];
 const rowsOf=(date:string)=>mapMisAttendance(misReport()).filter(r=>r.date===date&&r.site==='Gevra');
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,method,body});
  const q=new URL(url,'https://x').searchParams;
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'GV',name:'Gevra'}]);
  if(url.includes('attendance/register'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,rows:[]});
  if(url.includes('attendance/trip-cards')&&method==='GET')return Response.json({site:'Gevra',days:[
   {day:'2026-11-02',rows:rowsOf('2026-11-02'),duties:1,savedBy:'vinod',savedAt:'2026-11-22T10:00:00Z',signature:'gevra:same'},
   {day:'2026-11-03',rows:[],duties:0,savedBy:'vinod',savedAt:'2026-11-22T10:00:00Z',signature:'gevra:old'},
   {day:'2026-11-04',rows:rowsOf('2026-11-04'),duties:1,savedBy:'vinod',savedAt:'2026-11-22T10:00:00Z'}]});
  if(url.includes('attendance/trip-cards')&&method==='POST')return Response.json({day:body.day,duties:body.rows.length,savedBy:'vinod',savedAt:'2026-11-27T15:00:00Z'});
  const days=[{siteKey:'gevra',date:'2026-11-02',signature:'same'},{siteKey:'gevra',date:'2026-11-03',signature:'new'},{siteKey:'gevra',date:'2026-11-04',signature:'four'},{siteKey:'dipka',date:'2026-11-03',signature:'other'}];
  if(url.includes('attendance/mis/days'))return Response.json({supported:true,days});
  if(url.includes('attendance/mis?'))return Response.json({...misReport(),signed:true,days});
  return Response.json({});}));
 render(<AttendanceRosterPage grant={'a'.repeat(43)}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Gevra'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Gevra'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-02'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-04'}});
 fireEvent.click(screen.getByRole('button',{name:'Trip card (VLB · ELB · LMV)'}));
 const save=await screen.findByRole('button',{name:'Save trip cards (2 days)'});
 // 2 Nov is still what MIS holds; 3 Nov changed in MIS after it was saved, and 4 Nov was saved before days were signed.
 expect(calls.filter(c=>c.url.includes('attendance/mis?')).map(c=>new URL(c.url,'https://x').searchParams.get('from')).sort()).toEqual(['2026-11-03','2026-11-04']);
 expect(calls.filter(c=>c.url.includes('attendance/mis/days')).map(c=>{const q=new URL(c.url,'https://x').searchParams;return q.get('from')+'|'+q.get('to');})).toEqual(['2026-11-02|2026-11-04']);
 expect(screen.getByText(/2 saved days were no longer what MIS holds .* read from MIS again: 03-11, 04-11\./)).toBeTruthy();
 fireEvent.click(save);
 await screen.findByRole('button',{name:'Saved'});
 const posts=calls.filter(c=>c.method==='POST');
 expect(posts.map(c=>c.body!.day+'='+c.body!.signature).sort()).toEqual(['2026-11-03=gevra:new','2026-11-04=gevra:four']);
});

it('signs a site-day from every MIS site that is this site, and says when MIS holds none or did not sign',async()=>{
 const {misDaySignature,checkSavedTripCards}=await import('./rosterData');
 const days=[{siteKey:'majri ob',date:'2026-11-08',signature:'abc'},{siteKey:'sasti ob',date:'2026-11-08',signature:'zzz'},{siteKey:'majri ob',date:'2026-11-09',signature:'def'}];
 expect(misDaySignature(days,'Majri OC','2026-11-08')).toBe('majri ob:abc');
 expect(misDaySignature(days,'Majri OC','2026-11-10')).toBe('none');
 expect(misDaySignature(undefined,'Majri OC','2026-11-08')).toBe('');
 // While Pulse-II does not sign yet (or cannot be asked), the saved days are shown as before.
 const saved=[{day:'2026-11-08',rows:[],duties:0,savedBy:'v',savedAt:'',signature:'majri ob:abc'}];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({supported:false,days:[]})));
 expect(await checkSavedTripCards('a'.repeat(43),'Majri OC',saved)).toEqual({fresh:saved,stale:[],checked:false});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'MIS busy'},{status:400})));
 expect((await checkSavedTripCards('a'.repeat(43),'Majri OC',saved)).checked).toBe(false);
});

it('adds the days of two written forms of one code together instead of replacing the first',()=>{
 const employee={...bio,id:'majri-8812',code:'CMLL8812',name:'Ajay Kumar Yadav',site:'Majri OC',days:[day('2026-11-08','P'),day('2026-11-09','P')]};
 const cards=[duty('2026-11-08',{caliberCode:'CMLL8812',employeeName:'AJAY KUMAR YADAV',site:'Majri OC'}),duty('2026-11-09',{caliberCode:'CMPL8812',employeeName:'AJAY KUMAR YADAV',site:'Majri OC'})];
 const groups=buildRoster([employee],cards,['2026-11-08','2026-11-09'],'2026-11-10',DEFAULT_POLICY);
 expect(groups).toHaveLength(1);
 expect([groups[0].tripCodes['2026-11-08'],groups[0].tripCodes['2026-11-09']]).toEqual(['P','P']);
});

it('opens saved biometric logs at once, reads the punches only for the other days, and saves them',async()=>{
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 const calls:{url:string;method:string;body?:{site:string;day:string}}[]=[];
 const dayRegister=(day:string)=>({from:day,to:day,policy:DEFAULT_POLICY,site:'Sasti OC',machines:[{serial:'JNP1',name:'STAFF 1',location:'OFFICE',online:true,lastContact:null,lastPunch:day+' 17:00',punches:3}],
  rows:[{...bio,site:'Sasti OC',days:bio.days.filter(d=>d.date===day),linked:true,machinesUsed:['OFFICE · 101']}]});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const method=init?.method||'GET';const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,method,body});
  const q=new URL(url,'https://x').searchParams;
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'SO',name:'Sasti OC'}]);
  if(url.includes('attendance/biometric-days')&&method==='GET')return Response.json({site:'Sasti OC',days:[{day:'2026-11-02',register:dayRegister('2026-11-02'),punches:3,people:1,savedBy:'vinod',savedAt:'2026-11-22T10:00:00Z'}]});
  if(url.includes('attendance/biometric-days')&&method==='POST')return Response.json({day:body.day,punches:3,people:1,savedBy:'vinod',savedAt:'2026-11-23T08:00:00Z'});
  if(url.includes('site-register'))return Response.json(dayRegister(q.get('from')!));
  return Response.json({});}));
 render(<AttendanceRosterPage grant={'a'.repeat(43)}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Sasti OC'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Sasti OC'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-02'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-04'}});
 fireEvent.click(screen.getByRole('button',{name:'Biometric'}));
 const save=await screen.findByRole('button',{name:'Save biometric (2 days)'});
 expect(screen.getByText(/Saved biometric logs: 1 of 3 days .*by vinod\)\. 2 days read from the punches are not saved yet\./)).toBeTruthy();
 expect(calls.filter(c=>c.url.includes('site-register')).map(c=>new URL(c.url,'https://x').searchParams.get('from')).sort()).toEqual(['2026-11-03','2026-11-04']);
 fireEvent.click(save);
 await screen.findByRole('button',{name:'Saved'});
 expect(calls.filter(c=>c.method==='POST').map(c=>c.body!.day).sort()).toEqual(['2026-11-03','2026-11-04']);
 expect(calls.filter(c=>c.method==='POST').every(c=>c.body!.site==='Sasti OC'&&Object.keys(c.body!).length===2)).toBe(true);
 expect(screen.getByText(/Saved biometric logs: 3 of 3 days/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/Fetch again/}));
 await waitFor(()=>expect(calls.filter(c=>c.url.includes('site-register')).length).toBe(5));
});

it('Biometric tab says when the site has no machine yet and offers Add machine',async()=>{
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'SO',name:'Sasti OC'}]);
  if(url.includes('attendance/site-register'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,site:'Sasti OC',machines:[],rows:[]});
  return Response.json({});}));
 const manage=vi.fn();
 render(<AttendanceRosterPage grant={'a'.repeat(43)} onManageMachines={manage}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Sasti OC'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Sasti OC'}});
 fireEvent.click(screen.getByRole('button',{name:'Biometric'}));
 expect((await screen.findAllByText(/No biometric machine is added for Sasti OC yet/)).length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Add machine'}));
 expect(manage).toHaveBeenCalled();
});

it('Fetch from these machines asks the bridge PC for each machine of the site',async()=>{
 const {fetchFromMachines}=await import('./rosterData');
 const posts:string[]=[];let polls=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){const serial=JSON.parse(String(init.body)).deviceSerial;posts.push(serial);return Response.json({id:serial,state:'PENDING',punchesReceived:0,newPunches:0,error:''});}
  polls++;const id=url.split('/').pop()!;return Response.json(id==='B'?{id,state:'FAILED',punchesReceived:0,newPunches:0,error:'Bridge PC offline'}:{id,state:'DONE',punchesReceived:9,newPunches:4,error:''});}));
 const steps:string[]=[];
 await fetchFromMachines('a'.repeat(43),['A','B'],(serial,request,error)=>steps.push(serial+':'+(request?.state||error)),async()=>{});
 expect(posts).toEqual(['A','B']);
 expect(steps).toEqual(['A:PENDING','A:DONE','B:PENDING','B:FAILED']);
 expect(polls).toBe(2);
});

it('In / Out sheet lists every employee and date with In, Out and the punches',async()=>{
 const row={...bio,linked:true,machinesUsed:['Main gate · 101'],days:bio.days.map(d=>({...d,punches:d.in?[d.in+' Main gate']:[]}))};
 const groups=buildRoster([row],null,dates,'2026-11-06');
 const wb=await rosterWorkbook({groups,dates,tripsLoaded:false,monthly:false,from:'2026-11-01',to:'2026-11-05',view:'bio'});
 const io=wb.getWorksheet('In - Out')!;
 expect(io.getRow(1).values).toContain('Every punch (machine)');
 expect(io.rowCount).toBe(6);
 expect(io.getRow(3).getCell(7).value).toBe('08:00');
 expect(io.getRow(3).getCell(12).value).toBe('08:00 Main gate');
});

it('Biometric reads one day per request and joins the days: each person once, punches added up, cuts counted over the month',async()=>{
 const {streamBiometric,joinBiometricDays,setRetryPause}=await import('./rosterData');
 setRetryPause(async()=>{});
 const asked:string[]=[];let busy=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams;const day=q.get('from')!;asked.push(day);expect(q.get('to')).toBe(day);
  if(day==='2026-11-03'&&busy){busy=false;return Response.json({error:'HR busy'},{status:503});}
  return Response.json({from:day,to:day,policy:DEFAULT_POLICY,site:'Gevra',machines:[{serial:'SST01',name:'K90',location:'Main gate',online:true,lastContact:null,lastPunch:day+' 17:00',punches:2}],
   rows:[{...bio,days:bio.days.filter(d=>d.date===day).map(d=>({...d,late:day!=='2026-11-05'})),linked:true,machinesUsed:['Main gate · 101']}]});}));
 const results:Record<string,unknown>={};const states:string[]=[];
 const failed=await streamBiometric('a'.repeat(43),['2026-11-02','2026-11-03','2026-11-04','2026-11-05'],'Gevra',u=>{states.push(u.day.slice(8)+':'+u.state);if(u.result)results[u.day]=u.result;});
 expect(failed).toEqual([]);
 expect(states).toContain('03:retrying');
 expect(asked.filter(d=>d==='2026-11-03').length).toBe(2);
 const joined=joinBiometricDays(Object.values(results) as never,3)!;
 expect(joined.rows).toHaveLength(1);
 expect(joined.rows[0].days.map(d=>d.date)).toEqual(['2026-11-02','2026-11-03','2026-11-04','2026-11-05']);
 expect(joined.machines[0].punches).toBe(8);
 expect(joined.rows[0].summary.halfDutyCuts).toBe(1);
});

it('Manual Biometric reads every site in daily batches and retries only a failed day',async()=>{
 const {fetchManualBiometric,setRetryPause}=await import('./rosterData');setRetryPause(async()=>{});
 const asked:string[]=[];let failedOnce=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const q=new URL(url,'https://x').searchParams,day=q.get('from')!;asked.push(day);expect(q.get('to')).toBe(day);
  if(day==='2026-11-03'&&failedOnce){failedOnce=false;return Response.json({error:'Database busy'},{status:503});}
  return Response.json({from:day,to:day,policy:DEFAULT_POLICY,site:'Majri OB',canCorrect:true,machines:[],rows:[{...bio,site:'Majri OB',days:bio.days.filter(d=>d.date===day),linked:true,machinesUsed:['MAJRI-01']}]});}));
 const result=await fetchManualBiometric('a'.repeat(43),'2026-11-02','2026-11-04','Majri OB');
 expect(result.rows[0].days.map(day=>day.date)).toEqual(['2026-11-02','2026-11-03','2026-11-04']);
 expect(result.failedDays).toEqual([]);expect(result.canCorrect).toBe(true);
 expect(asked.filter(day=>day==='2026-11-03')).toHaveLength(2);
});

it('Biometric tab shows which days it is reading and how many punches arrived; machines without a bridge PC are not waited for',async()=>{
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 const posts:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const q=new URL(url,'https://x').searchParams;
  if(init?.method==='POST'){posts.push(url);return Response.json({});}
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'SO',name:'Sasti OC'}]);
  if(url.includes('site-register')){const day=q.get('from')!;
   return Response.json({from:day,to:day,policy:DEFAULT_POLICY,site:'Sasti OC',machines:[{serial:'JNP1',name:'GENERAL STAFF 1',location:'OFFICE',ipAddress:'192.168.16.13',bridgeName:'',online:false,lastContact:null,lastPunch:'',punches:3}],
    rows:[{...bio,site:'Sasti OC',days:bio.days.filter(d=>d.date===day),linked:true,machinesUsed:['OFFICE · 101']}]});}
  return Response.json({});}));
 render(<AttendanceRosterPage grant={'a'.repeat(43)}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Sasti OC'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Sasti OC'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-02'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-04'}});
 fireEvent.click(screen.getByRole('button',{name:'Biometric'}));
 expect(await screen.findByText(/3 of 3 days read · 9 punches/)).toBeTruthy();
 const roster=screen.getByRole('table',{name:'Attendance roster'});
 expect(within(roster).getByText('Ramesh Kumar')).toBeTruthy();
 expect(within(roster).getByRole('columnheader',{name:/^2\s*Mo/}).getAttribute('title')).toMatch(/Read · 3 punches/);
 fireEvent.click(screen.getByRole('button',{name:'Fetch from these machines'}));
 expect(await screen.findByText(/GENERAL STAFF 1: no bridge PC yet/)).toBeTruthy();
 expect(posts).toEqual([]);
});
