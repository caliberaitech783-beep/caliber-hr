import {describe,expect,it} from 'vitest';
import {classifyDocumentText} from './bulkDocuments';

const names=['Aadhaar (masked display)','PAN','Bank proof / cancelled cheque','UAN / PF details','Education certificates'];
describe('classifyDocumentText',()=>{
 it('identifies documents from their printed text',()=>{
  expect(classifyDocumentText('Government of India\nUnique Identification Authority of India\nYour Aadhaar No.:',names)).toBe('Aadhaar (masked display)');
  expect(classifyDocumentText('INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPermanent Account Number Card',names)).toBe('PAN');
  expect(classifyDocumentText('Universal Account Number (UAN)\nEmployees Provident Fund Organisation',names)).toBe('UAN / PF details');
  expect(classifyDocumentText('Statement of Marks\nMaharashtra State Board of Secondary and Higher Secondary Education',names)).toBe('Education certificates');
 });
 it('prefers bank details over the Aadhaar number printed in a passbook',()=>{
  expect(classifyDocumentText('SAVINGS FUND GENERAL\nIFSC Code: PUNB0000000\nA/C No: 0000 INR Aadhaar:XX0000',names)).toBe('Bank proof / cancelled cheque');
 });
 it('ignores documents not shown in the checklist and unknown text',()=>{
  expect(classifyDocumentText('Driving Licence\nDL No MH00',names)).toBeUndefined();
  expect(classifyDocumentText('Some unrelated letter',names)).toBeUndefined();
 });
});
