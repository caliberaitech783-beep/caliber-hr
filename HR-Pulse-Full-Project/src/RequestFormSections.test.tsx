import {describe,expect,it} from 'vitest';
import {formProgress,missingFields,dateProblem} from './RequestFormSections';
const od=[
 {key:'name',label:'Employee name',type:'text',required:true},{key:'employeeId',label:'Employee ID',type:'reference',required:true},
 {key:'outDutyDate',label:'From date',type:'date',required:true},{key:'toDate',label:'To date',type:'date',required:true},
 {key:'purpose',label:'Purpose',type:'text',required:true},{key:'authorityName',label:'Authority name',type:'text'},
];
describe('OD form progress',()=>{
 it('groups OD fields into numbered parts and counts required ones',()=>{
  const p=formProgress('outDutyRequests',od,{employeeId:'e',name:'A'});
  expect(p.groups.map(g=>g.title)).toEqual(['Employee','Visit and dates','Authority and signature','Review']);
  expect(p.complete).toEqual([true,false,true,true]);
  expect(p.current).toBe(1);expect(`${p.done}/${p.total}`).toBe('2/5');expect(p.ready).toBe(false);
 });
 it('flags a to date before the from date and lists missing fields',()=>{
  const data={employeeId:'e',name:'A',outDutyDate:'2026-11-20',toDate:'2026-11-19',purpose:'Audit'};
  expect(dateProblem('outDutyRequests',data)).toMatch(/on or after/);
  expect(formProgress('outDutyRequests',od,data).ready).toBe(false);
  expect(missingFields('outDutyRequests',od,{name:'A'}).map(f=>f.key)).toEqual(['employeeId','outDutyDate','toDate','purpose']);
 });
});
