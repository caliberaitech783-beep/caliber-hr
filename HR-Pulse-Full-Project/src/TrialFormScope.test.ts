import {describe,expect,it} from 'vitest';
import {pulseTrialSites} from './TrialForm';

describe('Pulse Trial Form site scope',()=>{
 it('maps a site-specific Pulse assignment to its Trial Form region and site',()=>{
  expect(pulseTrialSites('WCL-SASTI','Site')).toEqual([{region:'WCL',site:'Sasti OB'}]);
  expect(pulseTrialSites('Sasti OB','Location')).toEqual([{region:'WCL',site:'Sasti OB'}]);
 });

 it('keeps every Trial Form site available for unrestricted admins',()=>{
  expect(pulseTrialSites('All Sites','Admin')).toBeNull();
  expect(pulseTrialSites(undefined,'Administrator')).toBeNull();
 });

 it('limits multi-site users to their Pulse assignments',()=>{
  expect(pulseTrialSites('NCL-JAYANT|NCL-JAYANT-W','Regional')).toEqual([
   {region:'NCL',site:'Jayant OB East'},
   {region:'NCL',site:'Jayant OB West'},
  ]);
 });
});
