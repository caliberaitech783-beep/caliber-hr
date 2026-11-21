import {describe,expect,it} from 'vitest';
import {siteProjectChoices} from './SalaryFields';
import {siteProjectMismatch} from '../server/joining-required.mjs';
import {loadMessSites} from './salaryCalc';

const all=loadMessSites().map(s=>s.site);

describe('Site / Project follows the selected site and the login site rights',()=>{
 it('offers only the site picked at the top of the form',()=>{
  expect(siteProjectChoices(all,{site:'Majri OB',permittedSites:null})).toEqual(['Majri OB']);
  expect(siteProjectChoices(all,{site:'Gauri Pauni OB',permittedSites:['Gauri Pauni OB']})).toEqual(['Gouri Pauni OB']);
  expect(siteProjectChoices(all,{site:'Nagpur CO'})).toEqual(['Nagpur Corporate Office']);
 });
 it('before a site is picked offers only the login sites',()=>{
  expect(siteProjectChoices(all,{permittedSites:['Majri OB','Dudhichua OB East']}).sort()).toEqual(['Dhudhichua OB East','Majri OB']);
  expect(siteProjectChoices(all,{permittedSites:[]})).toEqual([]);
  expect(siteProjectChoices(all,{permittedSites:null})).toEqual(all);
 });
 it('server refuses a Site / Project other than the selected site',()=>{
  expect(siteProjectMismatch({'Site *':'Majri OB','Site / Project':'Majri OB'})).toBe('');
  expect(siteProjectMismatch({'Site *':'Gauri Pauni OB','Site / Project':'Gouri Pauni OB'})).toBe('');
  expect(siteProjectMismatch({'Site *':'Dudhichua OB West','Site / Project':'Dhudhichua OB West'})).toBe('');
  expect(siteProjectMismatch({'Site *':'Chandrapur HO','Site / Project':'Chandrapur Head Office'})).toBe('');
  expect(siteProjectMismatch({'Site *':'Majri OB','Site / Project':'Sasti OB'})).toMatch(/must be the selected site/);
  expect(siteProjectMismatch({'Site *':'Jayant OB East','Site / Project':'Jayant OB West'})).toMatch(/must be the selected site/);
 });
});
