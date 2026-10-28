import {it,expect} from 'vitest';
import {calendarSite} from './calendarSites';
it('matches holiday codes, old aliases and site IDs without mixing east and west',()=>{
 const sites=[{id:'east-id',code:'NCL-DUDE',name:'Dudichua OB East',kind:'sites'}];
 expect(calendarSite('east-id',sites)).toBe('Dudhichua East OC');
 expect(calendarSite('DCH-E',sites)).toBe('Dudhichua East OC');
 expect(calendarSite('NCL-DUDW',sites)).toBe('Dudhichua OC');
 expect(calendarSite('',sites)).toBe('All sites');
 expect(calendarSite('Other location',sites)).toBe('Other location');
});
