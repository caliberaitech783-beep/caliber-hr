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

it('rates a trip card duty with the attendance hours rule',()=>{
 expect(tripDutyCode(trips[0],DEFAULT_POLICY)).toBe('P');
 expect(tripDutyCode(trips[2],DEFAULT_POLICY)).toBe('HD');
 expect(tripDutyCode(trips[3],DEFAULT_POLICY)).toBe('?');
});

it('joins trip card and biometric on the Caliber code and lists the days that differ',()=>{
 const [g]=buildRoster([bio],trips,dates,'2026-11-06',DEFAULT_POLICY);
 expect(dates.map(d=>g.tripCodes[d])).toEqual(['WO','P','P','HD','?']);
 expect(dates.map(d=>g.bioCodes[d])).toEqual(['WO','P','A','P','MP']);
 expect(g.mismatches.map(m=>[m.date,m.reason])).toEqual([['2026-11-03','Trip card present, biometric absent'],['2026-11-04','Trip card half day, biometric present']]);
 expect(g.pending).toBe(1);
 expect(lineTotals(g.tripCodes,dates)).toMatchObject({present:2,half:1,weeklyOff:1,paidDays:3.5});
 const other=buildRoster([],[duty('2026-11-02',{caliberCode:'CMPL900',employeeName:'Not linked'})],dates,'2026-11-06');
 expect(other[0].code).toBe('CMPL900');
 expect(other[0].bio).toBeUndefined();
 expect(other[0].mismatches[0].reason).toBe('Trip card on duty, no biometric record');
 const office=buildRoster([bio],[],dates,'2026-11-06')[0];
 expect([office.hasTripCards,office.mismatches.length]).toEqual([false,0]);
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
 expect(ws.getRow(5).getCell(last).value).toBe(2);
 expect((ws.getCell('I5').fill as {fgColor:{argb:string}}).fgColor.argb).toBe('FFEAF3DE');
 expect(wb.getWorksheet('Differences')!.rowCount).toBe(3);
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
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'GV',name:'Gevra'},{id:'s2',kind:'sites',code:'DP',name:'Dipka'},{id:'d1',kind:'departments',code:'OP',name:'Operations'}]);
  if(url.includes('attendance/mis'))return Response.json(misReport());
  if(url.includes('attendance/register'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,rows:[bio,{...bio,id:'e2',code:'CMPL555',name:'Dipka Person',site:'Dipka'}]});
  return Response.json({rows:[],total:0});}));
 render(<AttendanceManagement grant={'a'.repeat(43)} view="Biometric integration"/>);
 const tabs=document.querySelector('[aria-label="Biometric views"]')!.querySelectorAll('button');
 expect([...tabs].map(b=>b.textContent).slice(-2)).toEqual(['Biometric vs trip card','Attendance roster']);
 fireEvent.click(screen.getByRole('button',{name:'Attendance roster'}));
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
 expect(within(table).queryByText('Other Site')).toBeNull();
 expect(within(table).getByText(/VLB \d/)).toBeTruthy();
 expect(calls.filter(u=>u.includes('attendance/mis')).map(u=>new URL(u,'https://x').searchParams.get('from')).sort()).toEqual(['01','02','03','04','05','06','07','08','09','10'].map(d=>'2026-11-'+d));
 await waitFor(()=>expect(within(table).getByText('Operations')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Biometric'}));
 await waitFor(()=>expect(within(screen.getByRole('table',{name:'Attendance roster'})).getByText('Ramesh Kumar')).toBeTruthy());
 expect(screen.queryByText('Dipka Person')).toBeNull();
 expect(calls.some(u=>u.includes('attendance/register'))).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Trip card vs Biometric'}));
 expect(await screen.findByRole('button',{name:/days differ for Ramesh Kumar/})).toBeTruthy();
});

it('reads MIS one day per request, retries a failed day once, and keeps the days that worked',async()=>{
 const {fetchTripCards}=await import('./rosterData');
 const tries:Record<string,number>={};
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const day=new URL(url,'https://x').searchParams.get('from')!;tries[day]=(tries[day]||0)+1;
  if(day==='2026-11-03')return Response.json({error:'The MIS attendance feed is temporarily unavailable.'},{status:503});
  if(day==='2026-11-02'&&tries[day]===1)throw new DOMException('signal timed out','TimeoutError');
  const report=misReport();return Response.json({...report,otDuties:report.otDuties.filter(d=>d.date===day||d.date<day)});}));
 const progress:number[]=[];
 const result=await fetchTripCards('a'.repeat(43),'2026-11-01','2026-11-04','Sasti OC'.replace('Sasti OC','Gevra'),done=>progress.push(done));
 expect(tries).toEqual({'2026-11-01':1,'2026-11-02':2,'2026-11-03':2,'2026-11-04':1});
 expect(result.failed).toEqual(['2026-11-03']);
 expect([...new Set(result.rows.map(r=>r.date))].sort()).toEqual(['2026-11-02','2026-11-04']);
 expect(result.misSites).toEqual(['Dipka','Gevra']);
 expect(progress.at(-1)).toBe(4);
});
