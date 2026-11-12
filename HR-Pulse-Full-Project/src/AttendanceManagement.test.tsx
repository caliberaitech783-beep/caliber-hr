import {expect,it} from 'vitest';
import {verifyLabel,punchTypeLabel,indiaToday,displayDate,fetchMessage,employeeLabel,type FetchRequest} from './AttendanceManagement';
const request=(patch:Partial<FetchRequest>):FetchRequest=>({id:'1',state:'DONE',punchesReceived:0,newPunches:0,error:'',requestedAt:'',completedAt:null,...patch});
it('translates machine codes into readable labels',()=>{
 expect(verifyLabel('1')).toBe('Fingerprint');
 expect(verifyLabel('15')).toBe('Face');
 expect(verifyLabel('99')).toBe('Other (99)');
 expect(verifyLabel('')).toBe('—');
 expect(punchTypeLabel('0')).toBe('Check-In');
 expect(punchTypeLabel('1')).toBe('Check-Out');
});
it('uses the India calendar date and day-first display',()=>{
 expect(indiaToday(new Date('2026-11-12T19:00:00Z'))).toBe('2026-11-13');
 expect(indiaToday(new Date('2026-11-12T05:00:00Z'))).toBe('2026-11-12');
 expect(displayDate('2026-11-12')).toBe('12-11-2026');
});
it('summarises a fetch without hiding failures',()=>{
 expect(fetchMessage(request({punchesReceived:5,newPunches:4}))).toBe('Fetch complete. 4 new punches added (1 already saved).');
 expect(fetchMessage(request({punchesReceived:1,newPunches:1}))).toBe('Fetch complete. 1 new punch added.');
 expect(fetchMessage(request({}))).toBe('Fetch complete. The machine had no new punches.');
 expect(fetchMessage(request({state:'FAILED',error:'The bridge PC did not respond.'}))).toBe('The bridge PC did not respond.');
 expect(fetchMessage(request({state:'RUNNING'}))).toMatch(/Fetching/);
});
it('shows linked employees by code and name, and flags unlinked IDs',()=>{
 expect(employeeLabel({employeeCode:'E001',employeeName:'Ravi Kumar',machineName:'RAVI'})).toBe('E001 · Ravi Kumar');
 expect(employeeLabel({employeeCode:'',employeeName:'',machineName:'RAVI'})).toBe('Not linked (RAVI)');
 expect(employeeLabel({employeeCode:'',employeeName:'',machineName:''})).toBe('Not linked');
});
