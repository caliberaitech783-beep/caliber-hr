import test from 'node:test';
import assert from 'node:assert/strict';
import {underageBirthDate,todayInIndia} from './joining-required.mjs';
test('Submit Employee refuses an employee younger than 18 as of today (India)',()=>{
  assert.equal(underageBirthDate('2008-11-21','2026-11-21'),'');
  assert.equal(underageBirthDate('21/11/2008','2026-11-21'),'');
  assert.match(underageBirthDate('2008-11-22','2026-11-21'),/at least 18 years.*21\/11\/2008/);
  assert.match(underageBirthDate('2030-01-01','2026-11-21'),/at least 18/);
  assert.equal(underageBirthDate('','2026-11-21'),'');
  assert.equal(underageBirthDate('2010-02-30','2028-02-29'),''); // not a real date: left to the DD/MM/YYYY check
  assert.match(underageBirthDate('2010-03-01','2028-02-29'),/28\/02\/2010/);
  assert.equal(todayInIndia(new Date('2026-11-20T19:00:00Z')),'2026-11-21');
});
