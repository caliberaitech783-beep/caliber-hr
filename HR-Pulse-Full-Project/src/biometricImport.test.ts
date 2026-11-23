import {describe,expect,it} from 'vitest';
import {machineNoInFileName,parseBiometricCsv,parseBiometricDat,parseBiometricText,pickMachine,readMachineLog} from './biometricImport';

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
 it('reads a USB attlog with no machine and leaves out lines the server would refuse',()=>{
  const log=readMachineLog('1_attlog.dat','﻿ 101\t2026-11-01 07:58:12\t1\t0\t0\t0\r\n 2045\t2026-11-03 19:02:40\t15\t1\r\n 77\t2026-02-30 08:00:00\t1\t0\r\njunk\r\n\r\n 101\t2026-11-02 08:01:00\t1\t0\n');
  expect(log).toMatchObject({fileName:'1_attlog.dat',ids:['101','2045'],from:'2026-11-01',to:'2026-11-03',needsMachine:true,skipped:[3,4]});
  expect(log.rows[0]).toEqual({serial:'',biometricId:'101',name:'',punchedAt:'2026-11-01 07:58:12',verify:'1',punchType:'0'});
  expect(()=>readMachineLog('empty.dat','nothing here\n')).toThrow('no biometric punch');
 });
 it('reads a CSV with serials as it is, and one without waiting for the machine',()=>{
  expect(readMachineLog('p.csv','Machine Serial,Biometric ID,Punch Time\nSST01,101,2026-11-23 08:15:00').needsMachine).toBe(false);
  expect(readMachineLog('p.txt','101 | Ravi | 2026-11-23 08:15:00').rows[0]).toMatchObject({serial:'',biometricId:'101',name:'Ravi'});
 });
 it('picks the machine: serial in the file name, machine no., only machine, then the IDs it already knows',()=>{
  const known=(...ids:string[])=>ids.map(biometricId=>({biometricId,employeeCode:'',employeeName:'',machineName:''}));
  const machines=[{serial:'JNP2242100339',name:'STAFF 1',location:'',machineNo:'1',ids:known('101')},{serial:'JNP2242700221',name:'GENERAL STAFF 1',location:'',machineNo:'2',ids:known('101','2045','300')}];
  expect(pickMachine({fileName:'JNP2242700221_attlog.dat',ids:['101']},machines)).toEqual({serial:'JNP2242700221',reason:'file-name',matched:1});
  expect(machineNoInFileName('001_attlog (2).dat')).toBe('1');
  expect(pickMachine({fileName:'1_attlog.dat',ids:['2045']},machines)).toEqual({serial:'JNP2242100339',reason:'machine-no',matched:0});
  expect(pickMachine({fileName:'attlog.dat',ids:['101','2045']},machines)).toEqual({serial:'JNP2242700221',reason:'ids',matched:2});
  expect(pickMachine({fileName:'attlog.dat',ids:['101']},machines)).toEqual({serial:'',reason:'none',matched:0});
  expect(pickMachine({fileName:'attlog.dat',ids:['9']},machines.slice(0,1))).toMatchObject({serial:'JNP2242100339',reason:'only'});
 });
 it('still reads a .dat written in the pipe text layout',()=>{
  expect(parseBiometricDat('SST02 | 202 | Asha | 2026-11-23 17:10:00')[0]).toMatchObject({serial:'SST02',biometricId:'202',punchedAt:'2026-11-23 17:10:00'});
 });
});
