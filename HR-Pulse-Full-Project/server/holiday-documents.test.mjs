import {test} from 'node:test';
import assert from 'node:assert/strict';
import {holidayAliases,validateDocument,createHolidayDocuments} from './holiday-documents.mjs';
test('holiday group and site aliases are separate',()=>{assert.ok(holidayAliases('DCH-E','NCL').includes('NCL-DUDE'));assert.deepEqual(holidayAliases('NGP','NCL'),[]);assert.ok(!holidayAliases(null,'WCL').includes('NGP'));assert.equal(holidayAliases(null,'CO/HO').includes('CHP'),true);});
test('document validates content and limits',()=>{assert.equal(validateDocument({name:'notice.pdf',content:Buffer.from('%PDF-1.7 test').toString('base64')}).mime,'application/pdf');assert.throws(()=>validateDocument({name:'notice.pdf',content:Buffer.from('<html>').toString('base64')}));assert.throws(()=>validateDocument({name:'notice.html',content:'YWJj'}));assert.throws(()=>validateDocument({name:'notice.pdf',content:Buffer.alloc(1000001).toString('base64')}));});
test('document APIs require holiday permission',async()=>{const service=createHolidayDocuments({query(){throw Error('Must not query');}});await assert.rejects(service.holidayDocuments({permissions:{}},new URLSearchParams({site:'NGP'})),e=>e.status===403);});
