import {describe,expect,it} from 'vitest';
import {parseBiometricCsv,parseBiometricText} from './biometricImport';

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
});
