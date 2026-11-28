import {it,expect} from 'vitest';
// @ts-expect-error The server register is plain JavaScript; this exercises the API calculation itself.
import {buildRegister} from '../server/attendance-register.mjs';
import {buildRoster} from './rosterModel';
import type {AttendanceRow} from './misAttendanceModel';

it('existing driver C punches match S3 trip cards without a morning miss-punch difference',()=>{
  const dates=['2026-11-27','2026-11-28','2026-11-29'];
  const employee={id:'driver-1',code:'CMLL100',name:'Night driver',site:'Sasti OC',siteType:'Site',designation:'Driver',starts:null,ends:null};
  const punches=['2026-11-27 21:00','2026-11-28 05:00','2026-11-28 21:00','2026-11-29 05:00'].map(at=>({employeeId:employee.id,at}));
  const register=buildRegister({from:dates[0],to:dates[2],today:'2026-11-30',employees:[employee],punches});
  const cards:AttendanceRow[]=dates.slice(0,2).map(date=>({date,id:date,site:employee.site,shift:'S3',employeeId:employee.code,employeeKey:'driver-1',caliberCode:employee.code,employeeName:employee.name,designation:'Driver',sources:['Trip card'],equipment:[],status:'Present',verified:true,verification:'MIS batch closed',references:'',note:'',output:'',otHours:0,otNote:''}));
  const [group]=buildRoster(register.rows,cards,dates,'2026-11-30');
  expect(group.bioCodes).toEqual({'2026-11-27':'P','2026-11-28':'P','2026-11-29':'A'});
  expect(group.tripCodes).toEqual(group.bioCodes);
  expect(group.mismatches).toEqual([]);
  expect(group.bio?.summary.missPunch).toBe(0);
  expect(punches[1].at).toBe('2026-11-28 05:00');
});
