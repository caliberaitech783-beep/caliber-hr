import {describe,expect,it} from 'vitest';
import {parseBiometricCsv,parseBiometricDat,parseBiometricText} from './biometricImport';

describe('biometric attendance import',()=>{
 it('reads CSV headings and uses the only machine when serial is omitted',()=>{
  expect(parseBiometricCsv('Biometric ID,Name,Punch Time\n101,Ravi,2026-11-23 08:15:00','SST01')).toEqual([{serial:'SST01',biometricId:'101',name:'Ravi',punchedAt:'2026-11-23 08:15:00',verify:'',punchType:''}]);
 });
 it('reads pipe-separated text with a machine serial',()=>{
  expect(parseBiometricText('SST02 | 202 | Asha | 23-11-2026 17:10:00')).toEqual([{serial:'SST02',biometricId:'202',name:'Asha',punchedAt:'2026-11-23 17:10:00',verify:'',punchType:''}]);
 });
 it('requires a serial when the site has multiple machines',()=>{
  expect(()=>parseBiometricCsv('Biometric ID,Punch Time\n101,2026-11-23 08:15:00')).toThrow('Machine Serial');
 });
 it('reads a ZKTeco attlog .dat: employee no., time, verify and in/out state, on the given machine',()=>{
  const dat='\uFEFF        101\t2026-11-01 07:58:12\t1\t0\t0\t0\r\n       2045\t2026-11-01 19:02:40\t15\t1\t0\t0\r\n\r\n';
  expect(parseBiometricDat(dat,'SST01')).toEqual([
   {serial:'SST01',biometricId:'101',name:'',punchedAt:'2026-11-01 07:58:12',verify:'1',punchType:'0'},
   {serial:'SST01',biometricId:'2045',name:'',punchedAt:'2026-11-01 19:02:40',verify:'15',punchType:'1'}]);
 });
 it('asks for the machine when an attlog .dat has no serial to go to',()=>{
  expect(()=>parseBiometricDat('101\t2026-11-01 07:58:12\t1\t0\t0\t0','')).toThrow('machine serial');
 });
 it('names the bad line of an attlog .dat',()=>{
  expect(()=>parseBiometricDat('101\t2026-11-01 07:58:12\t1\t0\ngarbage line','SST01')).toThrow('Line 2');
 });
 it('still reads a .dat written in the pipe text layout',()=>{
  expect(parseBiometricDat('SST02 | 202 | Asha | 2026-11-23 17:10:00')[0]).toMatchObject({serial:'SST02',biometricId:'202',punchedAt:'2026-11-23 17:10:00'});
 });
});
