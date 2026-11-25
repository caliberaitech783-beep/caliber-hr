import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {RegisterRow} from './AttendanceRegister';
import {DEFAULT_POLICY} from '../server/attendance-policy.mjs';

/* Attendance roster › Manual Biometric: only an HR administrator corrects a day or deletes saved logs (owner, 25 Nov 2026). */
afterEach(()=>{vi.unstubAllGlobals();});
const day=(date:string,status:string,extra={})=>({date,status,calendar:'',note:'',in:status==='P'?'07:41':status==='MP'?'07:30':'',out:status==='P'?'18:51':'',
 workedMinutes:status==='P'?600:null,late:false,early:false,missPunch:status==='MP',gatePassMinutes:0,gatePassDeduction:0,exempt:false,...extra});
const row=(days:ReturnType<typeof day>[]):RegisterRow=>({id:'e1',code:'CMLL20611',name:'AADIL KHAN',siteId:'s1',site:'Dhoptala OB 2nd',siteType:'Site',department:'MAINTANANACE',shift:'',
 designation:'TIPPER HELPER',exempt:false,shiftStart:'',shiftEnd:'',days,
 summary:{full:1,half:0,absent:0,missPunch:1,late:0,early:0,lateEarly:0,halfDutyCuts:0,duties:1,gatePassDeduction:0,H:0,L:0,OD:0,WO:0,IN:0}} as RegisterRow);

function mockApi(canCorrect:boolean,days=[day('2026-11-01','P'),day('2026-11-02','MP')]){
 const sent:{url:string;method:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{const q=new URL(url,'https://x').searchParams,method=init?.method||'GET';
  if(method!=='GET'){sent.push({url,method,body:init?.body?JSON.parse(String(init.body)):null});return Response.json({day:'2026-11-02',savedCopyUpdated:true});}
  if(url.includes('/lookups'))return Response.json([{id:'s1',kind:'sites',code:'DH',name:'Dhoptala OB 2nd'}]);
  if(url.includes('manual-biometric-days'))return Response.json({site:'Dhoptala OB 2nd',days:[{day:'2026-11-01',savedBy:'stupal',savedAt:'2026-11-25T10:16:00Z',punches:4,people:1,register:{rows:[],machines:[]}}]});
  if(url.includes('attendance/manual-biometric'))return Response.json({from:q.get('from'),to:q.get('to'),policy:DEFAULT_POLICY,site:'Dhoptala OB 2nd',machines:[],canCorrect,
   rows:[{...row(days),linked:true,machinesUsed:['CEXJ230861482']}]});
  return Response.json({});}));
 return sent;
}
async function openManual(){
 const {AttendanceRosterPage}=await import('./AttendanceRoster');
 render(<AttendanceRosterPage grant={'a'.repeat(43)}/>);
 const site=screen.getByLabelText('Site');
 await waitFor(()=>expect(within(site).getByRole('option',{name:'Dhoptala OB 2nd'})).toBeTruthy());
 fireEvent.change(site,{target:{value:'Dhoptala OB 2nd'}});
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-01'}});
 fireEvent.change(screen.getByLabelText('To'),{target:{value:'2026-11-02'}});
 fireEvent.click(screen.getByRole('button',{name:'Manual Biometric'}));
 await waitFor(()=>expect(within(screen.getByRole('table',{name:'Attendance roster'})).getByText('AADIL KHAN')).toBeTruthy());
}

it('Site HR sees the roster with no day correction and no Delete of saved logs',async()=>{
 mockApi(false);
 await openManual();
 expect(screen.queryByRole('button',{name:/^Correct AADIL KHAN/})).toBeNull();
 expect(screen.queryByRole('button',{name:'Delete All'})).toBeNull();
 expect(await screen.findByText(/only an HR administrator can correct a day/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'View Saved Logs'}));
 const saved=screen.getByRole('dialog',{name:'Saved manual biometric logs'});
 expect(within(saved).queryByRole('button',{name:/Delete/})).toBeNull();
 expect(within(saved).getByText('HR administrator only')).toBeTruthy();
});

it('an HR administrator corrects a miss punch with the In / Out and a reason',async()=>{
 const sent=mockApi(true);
 await openManual();
 expect(screen.getByRole('button',{name:'Delete All'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Correct AADIL KHAN on 02-11-2026'}));
 const dialog=screen.getByRole('dialog',{name:'Correct attendance day'});
 expect(within(dialog).getByText(/From the punches/).textContent).toMatch(/MP.*07:30/);
 fireEvent.change(within(dialog).getByLabelText('Out'),{target:{value:'19:05'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Save correction'}));
 expect(await within(dialog).findByText('Write the reason for the correction.')).toBeTruthy();
 expect(sent).toEqual([]);
 fireEvent.change(within(dialog).getByLabelText('Reason'),{target:{value:'Out punch missed, machine down'}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Save correction'}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Correct attendance day'})).toBeNull());
 expect(sent).toEqual([{url:expect.stringContaining('attendance/manual-biometric/corrections'),method:'POST',
  body:{site:'Dhoptala OB 2nd',day:'2026-11-02',employeeCode:'CMLL20611',status:'',in:'07:30',out:'19:05',reason:'Out punch missed, machine down'}}]);
 expect(await screen.findByText(/AADIL KHAN · 02-11-2026 corrected\. The saved log of that day shows it too\./)).toBeTruthy();
});

it('a corrected day is marked, says who changed it, and can be undone',async()=>{
 const sent=mockApi(true,[day('2026-11-01','OD',{note:'Corrected by vinod: Site visit',corrected:{by:'vinod',at:'2026-11-25T10:00:00Z',reason:'Site visit',before:{status:'A',in:'',out:''},status:'OD',in:'',out:''}}),day('2026-11-02','P')]);
 vi.spyOn(window,'confirm').mockReturnValue(true);
 await openManual();
 const box=screen.getByRole('button',{name:'Correct AADIL KHAN on 01-11-2026'});
 expect(box).toHaveClass('roster-corrected');
 expect(box.getAttribute('title')).toMatch(/Corrected by vinod: Site visit \(was A/);
 fireEvent.click(box);
 const dialog=screen.getByRole('dialog',{name:'Correct attendance day'});
 expect(within(dialog).getByLabelText('Code')).toHaveValue('OD');
 fireEvent.click(within(dialog).getByRole('button',{name:'Undo correction'}));
 await waitFor(()=>expect(sent.length).toBe(1));
 expect(sent[0]).toEqual({url:expect.stringContaining('attendance/manual-biometric/corrections'),method:'DELETE',body:{site:'Dhoptala OB 2nd',day:'2026-11-01',employeeCode:'CMLL20611'}});
});
