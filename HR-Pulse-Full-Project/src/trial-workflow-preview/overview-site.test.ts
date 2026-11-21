import {describe, expect, it} from 'vitest';
import {overviewTable} from './views';
import type {Trial} from './records';

/* All candidates shows a Site name column with the site's region under it (owner, 21 Nov 2026). */
const row = (site: string) => ({id:'t1',formNo:'TF/2026-27/0019',stage:'done',result:'PASS',site,name:'Avinash Thakur',father:'',dob:'',mobile:'9285197208',aadhaar:'',address:'',dl:'',dlValid:'',referredBy:'AMIT SINGH',employer:'',batch:'',createdAt:'2026-11-21T06:00:00Z',trialDate:'2026-11-21T12:21',photo:'',post:'Driver',experience:'5',vehicles:['Dumper/Tipper'],otherVehicle:'',docs:{},history:[]}) as unknown as Trial;

describe('All candidates site name column', () => {
  it('adds a Site name heading after Candidate', () => {
    const box = document.createElement('div');
    box.innerHTML = overviewTable([row('Jayant OB East')]);
    const headings = [...box.querySelectorAll('th')].map(th=>th.textContent);
    expect(headings.slice(0,4)).toEqual(['Form no.','Candidate','Site name','Post']);
  });
  it('shows the site and its region', () => {
    const box = document.createElement('div');
    box.innerHTML = overviewTable([row('Jayant OB East'),row('Majri'),row('')]);
    const cells = [...box.querySelectorAll('tbody tr')].map(tr=>tr.querySelectorAll('td')[2].textContent);
    expect(cells[0]).toContain('NCL');
    expect(cells[1]).toContain('Majri');
    expect(cells[1]).toContain('WCL');
    expect(cells[2]).toBe('–');
  });
});
