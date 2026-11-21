import {describe,expect,it} from 'vitest';
import {documentRegion,regionalDocumentRule,regionalDocumentStatus} from './regionalDocuments';
import {classifyDocumentText} from './bulkDocuments';

describe('Police verification and Self declaration region rule',()=>{
 it('finds the region from the region, joining category or site',()=>{
  expect(documentRegion('WCL','','')).toBe('WCL');
  expect(documentRegion('','NCL','')).toBe('NCL');
  for(const site of ['Sasti OB','Majri OB','Dhoptala OB 2nd','Gauri Pauni OB 2nd','sasti oc','dhuptala oc','gauri pouni ob'])expect(documentRegion('',site)).toBe('WCL');
  for(const site of ['Jayant OB East','Jayant OB West','Dudhichua OB East','Dudhichua OB West','ncl-dude'])expect(documentRegion('',site)).toBe('NCL');
  expect(documentRegion('Nagpur Corporate Office','CORPORATE','Nagpur CO')).toBe('');
 });
 it('is mandatory at joining for WCL and within 20 days for NCL',()=>{
  expect(regionalDocumentRule('WCL').startsWith('Mandatory')).toBe(true);
  expect(regionalDocumentRule('NCL')).toBe('Within 20 days of joining (NCL)');
  expect(regionalDocumentRule('NCL').startsWith('Mandatory')).toBe(false);
  expect(regionalDocumentRule('')).toBe('As per policy');
 });
 it('needs the Self declaration form only for a LOCAL resident',()=>{
  expect(regionalDocumentRule('WCL','Self declaration form','LOCAL')).toBe('Mandatory at joining (WCL)');
  expect(regionalDocumentRule('NCL','Self declaration form','local')).toBe('Within 20 days of joining (NCL)');
  for(const resident of ['CAMP','Non-local','']){
   expect(regionalDocumentRule('WCL','Self declaration form',resident)).toBe('Optional – needed only for LOCAL resident');
   expect(regionalDocumentRule('WCL','Police verification',resident)).toBe('Mandatory at joining (WCL)');
   expect(regionalDocumentStatus({region:'NCL',joiningDate:'2020-01-01',uploaded:'',name:'Self declaration form',resident}).state).toBe('optional');
  }
  expect(regionalDocumentStatus({region:'NCL',joiningDate:'2020-01-01',uploaded:'',name:'Self declaration form',resident:'LOCAL',today:new Date(2026,10,21)}).state).toBe('overdue');
 });
 it('shows the NCL due date and marks it overdue after 20 days',()=>{
  const today=new Date(2026,10,21);
  expect(regionalDocumentStatus({region:'NCL',joiningDate:'2026-11-10',uploaded:'',today})).toEqual({state:'due',label:'Pending – due 30/11/2026 (9 days left)',due:'30/11/2026'});
  expect(regionalDocumentStatus({region:'NCL',joiningDate:'01/11/2026',uploaded:'',today})).toEqual({state:'due',label:'Pending – due 21/11/2026 (0 days left)',due:'21/11/2026'});
  expect(regionalDocumentStatus({region:'NCL',joiningDate:'2026-10-31',uploaded:'',today}).state).toBe('overdue');
  expect(regionalDocumentStatus({region:'NCL',joiningDate:'2026-10-01',uploaded:'police.pdf',today})).toEqual({state:'uploaded',label:'police.pdf'});
  expect(regionalDocumentStatus({region:'WCL',joiningDate:'2026-11-10',uploaded:'',today}).state).toBe('missing');
 });
 it('files bulk pages under the two documents',()=>{
  const names=['Police verification','Self declaration form','Aadhaar (masked display)'];
  expect(classifyDocumentText('POLICE VERIFICATION CERTIFICATE\nAadhaar 1234 5678 9012',names)).toBe('Police verification');
  expect(classifyDocumentText('Self-Declaration by the employee',names)).toBe('Self declaration form');
 });
});
