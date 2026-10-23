import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './modules.mjs';
test('holiday categories preserve source classifications',()=>{for(const holidayType of ['National','Government','Festival','Declared','Public','Company','Optional'])assert.equal(validate('holidays',{code:'SITE-2026-01-26',name:'Republic Day',date:'2026-01-26',siteId:'site',holidayType}).holidayType,holidayType);assert.throws(()=>validate('holidays',{code:'X',name:'X',date:'2026-01-26',holidayType:'Unknown'}));});
